import { batch } from "subjecto";
import { $agents } from "../subjects/agents";
import { loadAgents } from "../actions/agents";
import type { AgentDef, AgentRunEvent, AgentRunResult, RunState } from "../types/agents";
import type { HandlerMap } from "./types";

// --- Agents messages ---
//
// Wire format from packages/manager/src/handlers/agents-handler.ts:
//   agents:list            → { agents: AgentDef[], error?: string }
//   agents:upserted        → { agent: AgentDef }
//   agents:deleted         → { id: string }
//   agents:error           → { message: string }
//   agents:list:stale      → {} (refetch)
//   agents:run:event       → { requestId: string, event: AgentRunEvent }
//   agents:run:complete    → { requestId: string, result: AgentRunResult }

export const handlers: HandlerMap = {
  "agents:list": (payload) => {
    batch(() => {
      const v = $agents.getValue();
      v.list = (payload.agents as AgentDef[]) || [];
      v.error = payload.error ?? null;
      v.loading = false;
    });
  },

  "agents:upserted": (payload) => {
    const v = $agents.getValue();
    const agent = payload.agent as AgentDef;
    const idx = v.list.findIndex((a) => a.id === agent.id);
    if (idx >= 0) v.list[idx] = agent;
    else v.list.push(agent);
    v.saveError = null;
  },

  "agents:deleted": (payload) => {
    const v = $agents.getValue();
    v.list = v.list.filter((a) => a.id !== payload.id);
  },

  "agents:error": (payload) => {
    $agents.getValue().saveError = payload.message ?? "Unknown error";
  },

  "agents:list:stale": (_payload) => {
    loadAgents();
  },

  "agents:run:event": (payload) => {
    const reqId = payload.requestId as string;
    const ev = payload.event as AgentRunEvent;
    const v = $agents.getValue();
    const run: RunState | undefined = v.runs[reqId];
    if (!run) return;
    switch (ev.type) {
      case "ready":
        // No-op for now — the panel infers "ready" from status="running".
        break;
      case "token":
        run.output += ev.token;
        break;
      case "tool":
        run.toolEvents.push(ev);
        break;
      case "done":
        run.output = ev.fullContent;
        break;
      case "error":
        run.error = ev.message;
        break;
    }
  },

  "agents:run:complete": (payload) => {
    const reqId = payload.requestId as string;
    const result = payload.result as AgentRunResult;
    const v = $agents.getValue();
    const run = v.runs[reqId];
    if (!run) return;
    run.status = result.status;
    run.result = result;
    if (result.error && !run.error) run.error = result.error;
    // If the final result has a populated output (server canonicalises it),
    // overwrite the streamed accumulator so we don't double-count.
    if (result.output) run.output = result.output;
  },
};
