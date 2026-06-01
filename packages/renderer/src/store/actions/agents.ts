import { batch } from "subjecto";
import { wsSend } from "@/lib/ws";
import { $agents } from "../subjects/agents";
import type { AgentDef, AgentSandboxConfig, RunState } from "../types/agents";

/** Server-side input for agents:upsert. Matches packages/manager/src/agents/
 *  registry.ts `AgentInput`. */
export interface AgentUpsertInput {
  slug: string;
  label: string;
  description?: string;
  systemPrompt?: string;
  modelId?: string;
  maxToolRounds?: number;
  tools?: string[];
  sandbox: AgentSandboxConfig;
}

/** Fetch the user's visible agents (their own + built-ins). The server replies
 *  with `agents:list`. */
export function loadAgents(): void {
  batch(() => {
    const v = $agents.getValue();
    v.loading = true;
    v.error = null;
  });
  wsSend("agents:list", {});
}

/** Upsert (create-or-update by slug). Server replies with `agents:upserted`
 *  on success or `agents:error` on validation/ACL failure, plus an
 *  `agents:list:stale` ping to refetch. */
export function upsertAgent(input: AgentUpsertInput): void {
  $agents.getValue().saveError = null;
  wsSend("agents:upsert", input);
}

export function deleteAgent(id: string): void {
  wsSend("agents:delete", { id });
}

/** Kick off a run. Generates a requestId so concurrent runs in the same WS
 *  can be demuxed by the panel — the server echoes it on every
 *  `agents:run:event` and the `agents:run:complete` frame. */
export function runAgent(agent: AgentDef, userMessage: string): string {
  const requestId = `${agent.id}:${Date.now()}:${Math.floor(Math.random() * 1e6).toString(36)}`;
  const v = $agents.getValue();
  const initial: RunState = {
    agentId: agent.id,
    status: "running",
    output: "",
    toolEvents: [],
    error: null,
    result: null,
  };
  v.runs[requestId] = initial;
  wsSend("agents:run", { agentId: agent.id, userMessage, requestId });
  return requestId;
}

/** Clear a finished run from the panel (cosmetic — doesn't touch the DB). */
export function clearAgentRun(requestId: string): void {
  delete $agents.getValue().runs[requestId];
}
