// Sandbox backend interface — where an agent's process actually runs.
//
// Each backend hides the difference between Docker on a project's VPS (v0,
// see project-docker.ts) and a Firecracker microVM on a dedicated agent host
// (Phase 3) behind one shape: open a stdio channel to a freshly-spawned
// `@genie/vps-agent` process, return a handle the runner can talk to using the
// existing JSON-line protocol, then clean the container/VM up on stop().
//
// The runner doesn't need to know which backend it's using.

import type { AgentSandboxConfig } from "../types.js";

/** Per-run inputs to the backend. */
export interface SandboxSpec {
  /** Unique id used as a container / VM label, so a leaked sandbox can be
   *  reaped and so two concurrent runs of the same agent don't collide. */
  runId: string;
  /** The agent's persona — forwarded into the agent process's `init` message. */
  persona: {
    systemPrompt: string;
    modelId: string;
    allowedTools: string[];
    maxToolRounds: number;
  };
  /** Anthropic API key — passed via env, never logged. */
  anthropicApiKey: string;
  /** Backend-specific config from `agents.sandbox` (kind, projectId, instanceId, timeoutSec, ...). */
  config: AgentSandboxConfig;
}

/** A live handle to a running sandbox. The runner sends and receives JSON
 *  lines on this; `stop()` should be safe to call from any state. */
export interface SandboxHandle {
  /** Opaque backend reference, persisted on agent_runs.sandbox_ref so leaked
   *  containers/VMs can be reaped after a manager restart. */
  ref: string;
  send(msg: object): void;
  onMessage(handler: (msg: Record<string, unknown>) => void): void;
  /** Fired when the sandbox process exits (normal or crash). */
  onExit(handler: (code: number | null) => void): void;
  /** Stderr from the sandbox — kept separate so the runner can log it. */
  onStderr(handler: (text: string) => void): void;
  /** Best-effort cleanup. Idempotent. */
  stop(): Promise<void>;
}

export interface SandboxBackend {
  spawn(spec: SandboxSpec): Promise<SandboxHandle>;
}
