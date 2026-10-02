// Agent types mirror packages/manager/src/agents/types.ts — kept here so the
// renderer can compile without reaching into another package.
//
// One agent definition (row in the manager's `agents` table) drives both the
// list/edit UI and the run streamer. The run state is purely client-side: each
// run has a transient `requestId` (we generate it) keyed against a buffer of
// streamed events the panel renders live.

export type AgentSandboxConfig =
  | {
      kind: "project-docker";
      projectId: string;
      instanceId: string;
      timeoutSec?: number;
      image?: string;
    }
  | {
      kind: "firecracker";
      host: string;
      timeoutSec?: number;
    };

export interface AgentDef {
  id: string;
  slug: string;
  label: string;
  description: string;
  systemPrompt: string;
  modelId: string;
  maxToolRounds: number;
  tools: string[];
  sandbox: AgentSandboxConfig;
  ownerUserId: string | null;
  isBuiltin: boolean;
}

/** Live streaming events from a run — matches the manager's AgentRunEvent. */
export type AgentRunEvent =
  | { type: "ready" }
  | { type: "token"; token: string }
  | { type: "tool"; name: string; input: Record<string, unknown>; result: string }
  | { type: "done"; fullContent: string }
  | { type: "error"; message: string };

export interface AgentRunResult {
  runId: string;
  status: "succeeded" | "failed" | "timeout" | "cancelled";
  output: string;
  error?: string;
  toolEvents: Array<{ name: string; input: Record<string, unknown>; result: string }>;
}

/** Transient client-side state for one in-flight or completed run. Keyed by
 *  the requestId we generate before sending `agents:run`. */
export interface RunState {
  agentId: string;
  status: "running" | "succeeded" | "failed" | "timeout" | "cancelled";
  /** Accumulated assistant text — what we render in the chat bubble. */
  output: string;
  /** Tool calls executed by the agent, in order. */
  toolEvents: AgentRunEvent[];
  error: string | null;
  /** Final result once `agents:run:complete` arrives. */
  result: AgentRunResult | null;
}

export interface AgentsState {
  list: AgentDef[];
  loading: boolean;
  error: string | null;
  /** Surfaced separately so a "Save failed" banner doesn't blank the list. */
  saveError: string | null;
  /** Active + recent runs, keyed by requestId. We don't truncate — at most a
   *  handful per session and they're tiny. */
  runs: Record<string, RunState>;
}
