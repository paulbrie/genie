// Agent runner — orchestrates one execution of a user-defined agent.
//
//   1. Loads the agent definition.
//   2. Inserts an `agent_runs` row in status=queued.
//   3. Picks the sandbox backend (today: project-docker only).
//   4. Spawns the sandbox, sends `init`, waits for `ready`.
//   5. Sends the user's `chat` message; streams events to the caller AND
//      accumulates them into `tool_events` so the run is replayable.
//   6. On `done`/`error`/timeout, persists the row and cleans the sandbox up.
//
// One call per run. The same agent can be run concurrently; each run gets its
// own container (containerName encodes the run id).

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { agentRuns } from "../db/schema.js";
import { getAgentById } from "./registry.js";
import { projectDockerBackend } from "./sandbox/project-docker.js";
import type { SandboxBackend, SandboxHandle } from "./sandbox/index.js";
import type { AgentRunEvent, AgentSandboxConfig } from "./types.js";

const READY_TIMEOUT_MS = 30_000;

export interface AgentRunInput {
  agentId: string;
  userMessage: string;
  /** Optional extra context appended to the system prompt. */
  context?: string;
  /** Free-form input to record on the run row (for non-chat triggers later). */
  input?: Record<string, unknown>;
  /** User id that triggered this run; null = system / scheduler. */
  triggeredByUserId?: string | null;
}

export interface AgentRunResult {
  runId: string;
  status: "succeeded" | "failed" | "timeout" | "cancelled";
  output: string;
  error?: string;
  toolEvents: Array<{ name: string; input: Record<string, unknown>; result: string }>;
}

/** Pick the backend for the given sandbox config. Centralised so a future
 *  firecracker backend just adds a case here. */
function pickBackend(sandbox: AgentSandboxConfig): SandboxBackend {
  switch (sandbox.kind) {
    case "project-docker":
      return projectDockerBackend;
    case "firecracker":
      throw new Error("firecracker sandbox not implemented yet (Phase 3)");
  }
}

export async function runAgent(
  input: AgentRunInput,
  onEvent: (ev: AgentRunEvent) => void,
): Promise<AgentRunResult> {
  const agent = await getAgentById(input.agentId);
  if (!agent) throw new Error(`Agent ${input.agentId} not found`);

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const db = getDb();
  const projectId = agent.sandbox.kind === "project-docker" ? agent.sandbox.projectId : null;
  const instanceId = agent.sandbox.kind === "project-docker" ? agent.sandbox.instanceId : null;
  const timeoutSec = agent.sandbox.timeoutSec ?? 600;

  // Create the run row first so a crash mid-spawn still leaves a trace.
  const [runRow] = await db.insert(agentRuns).values({
    agentId: agent.id,
    triggeredByUserId: input.triggeredByUserId ?? null,
    projectId,
    instanceId,
    status: "queued",
    input: { userMessage: input.userMessage, context: input.context, ...input.input },
  }).returning({ id: agentRuns.id });
  const runId = runRow.id;

  const toolEvents: AgentRunResult["toolEvents"] = [];
  let fullContent = "";
  let handle: SandboxHandle | null = null;
  let finalStatus: AgentRunResult["status"] = "failed";
  let errorMessage: string | undefined;

  // A single promise that resolves on `done`/`error`/exit/timeout. Whoever
  // settles first wins; the rest are cleaned up in `finally`.
  let settle: (() => void) | null = null;
  const settled = new Promise<void>((resolve) => { settle = resolve; });
  const finish = () => { settle?.(); settle = null; };

  let readySignal: (() => void) | null = null;
  const readyPromise = new Promise<void>((resolve) => { readySignal = resolve; });

  try {
    const backend = pickBackend(agent.sandbox);
    handle = await backend.spawn({
      runId,
      persona: {
        systemPrompt: agent.systemPrompt,
        modelId: agent.modelId,
        allowedTools: agent.tools,
        maxToolRounds: agent.maxToolRounds,
      },
      anthropicApiKey,
      config: agent.sandbox,
    });

    await db.update(agentRuns).set({
      status: "running",
      sandboxRef: handle.ref,
    }).where(eq(agentRuns.id, runId));

    handle.onMessage((msg) => {
      const type = msg.type as string;
      switch (type) {
        case "ready":
          readySignal?.();
          readySignal = null;
          onEvent({ type: "ready" });
          break;
        case "token":
          if (typeof msg.token === "string") {
            fullContent += msg.token;
            onEvent({ type: "token", token: msg.token });
          }
          break;
        case "tool":
          if (typeof msg.name === "string") {
            const ev = {
              name: msg.name,
              input: (msg.input as Record<string, unknown>) ?? {},
              result: typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result),
            };
            toolEvents.push(ev);
            onEvent({ type: "tool", ...ev });
          }
          break;
        case "done":
          if (typeof msg.fullContent === "string") fullContent = msg.fullContent;
          finalStatus = "succeeded";
          onEvent({ type: "done", fullContent });
          finish();
          break;
        case "error":
          errorMessage = typeof msg.message === "string" ? msg.message : "Unknown agent error";
          finalStatus = "failed";
          onEvent({ type: "error", message: errorMessage });
          finish();
          break;
        default:
          // Ignore browser:request and any other types the runner doesn't
          // consume yet — browser proxying is a chat-mode-only concern.
          break;
      }
    });

    handle.onStderr((text) => {
      // Container/Node stderr — useful for diagnosing why the agent didn't
      // start. Keep it out of the event stream (would confuse the renderer's
      // token/tool channels) but log it for the operator.
      console.error(`[agent:${agent.slug}:${runId}] ${text.trimEnd()}`);
    });

    handle.onExit(() => {
      // If we exit before `done`/`error`, classify as failure unless we were
      // already settled (e.g. the runner called stop() after a timeout).
      if (settle) {
        errorMessage = errorMessage ?? "Sandbox process exited before completion";
        finalStatus = "failed";
        onEvent({ type: "error", message: errorMessage });
        finish();
      }
    });

    // Send init. The agent answers with `ready` (or `error`). The persona
    // fields (systemPrompt, modelId, allowedTools) live on the agent row;
    // the runner just forwards them through the protocol.
    handle.send({
      type: "init",
      apiKey: anthropicApiKey,
      projectDir: "/workspace",
      maxToolRounds: agent.maxToolRounds,
      modelId: agent.modelId,
      systemPrompt: agent.systemPrompt,
      allowedTools: agent.tools,
    });

    // Wait for the `ready` ack — with a hard cap. If the container is slow to
    // start (cold image pull, slow VPS) this guards us from hanging forever.
    const readyTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Agent did not become ready within ${READY_TIMEOUT_MS}ms`)), READY_TIMEOUT_MS),
    );
    await Promise.race([readyPromise, readyTimeout]);

    handle.send({
      type: "chat",
      messages: [{ role: "user", content: input.userMessage }],
      context: input.context,
    });

    // Run-level timeout: aborts the run if `done`/`error` never arrives.
    const runTimeout = new Promise<void>((resolve) =>
      setTimeout(() => {
        if (settle) {
          finalStatus = "timeout";
          errorMessage = `Run exceeded ${timeoutSec}s timeout`;
          onEvent({ type: "error", message: errorMessage });
          finish();
        }
        resolve();
      }, timeoutSec * 1000),
    );

    await Promise.race([settled, runTimeout]);
  } catch (err: any) {
    const msg = typeof err?.message === "string" ? err.message : String(err);
    errorMessage = msg;
    finalStatus = "failed";
    onEvent({ type: "error", message: msg });
  } finally {
    if (handle) {
      try { await handle.stop(); } catch { /* best-effort */ }
    }
    await db.update(agentRuns).set({
      status: finalStatus,
      output: { fullContent },
      error: errorMessage ?? null,
      toolEvents: toolEvents,
      finishedAt: new Date(),
    }).where(eq(agentRuns.id, runId));
  }

  return {
    runId,
    status: finalStatus,
    output: fullContent,
    error: errorMessage,
    toolEvents,
  };
}
