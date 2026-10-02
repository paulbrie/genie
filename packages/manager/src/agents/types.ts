// Shared types for the agent management feature. Kept separate from the DB
// schema so the WS layer / renderer can import these without dragging Drizzle.

/** Where the agent runs. v0 supports "project-docker"; "firecracker" arrives
 *  in Phase 3. The renderer's agent editor picks one kind and fills in the
 *  fields required for it. */
export type AgentSandboxConfig =
  | {
      kind: "project-docker";
      /** Project whose VPS hosts the container. */
      projectId: string;
      /** Which VPS instance of that project. Single-VPS projects can pass the
       *  default instance id. */
      instanceId: string;
      /** Hard timeout (seconds) for the whole agent run. Enforced by the
       *  backend via `docker stop --time`. Default 600s. */
      timeoutSec?: number;
      /** Docker image to use. Defaults to `node:20-slim` so we don't ship a
       *  custom image until the cold-start cost actually bites. */
      image?: string;
    }
  | {
      kind: "firecracker";
      /** Agent-host VPS (provisioned with the `agent-host` recipe). */
      host: string;
      timeoutSec?: number;
    };

/** What a user enters in the agent editor. The DB row mirrors this 1:1
 *  modulo audit columns. `tools` is an allowlist of tool names; empty = all. */
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

/** Streamed events from a running agent — mirrors the vps-agent's outbound
 *  protocol so the renderer can treat one of these the same way it treats a
 *  chat stream today. */
export type AgentRunEvent =
  | { type: "ready" }
  | { type: "token"; token: string }
  | { type: "tool"; name: string; input: Record<string, unknown>; result: string }
  | { type: "done"; fullContent: string }
  | { type: "error"; message: string };
