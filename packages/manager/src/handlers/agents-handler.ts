// Agents CRUD + run. Mirrors the recipes-handler shape so the renderer can
// reuse the same upsert/broadcast pattern. `agents:run` streams the agent's
// token / tool / done events back over the same WS as separate messages,
// keyed by runId so the client can route them.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as agentRegistry from "../agents/registry.js";
import { runAgent } from "../agents/runner.js";
import * as analyticsService from "../logging/analytics-service.js";

// In-flight runs, keyed by `${userId}:${requestId}`, so an `agents:cancel` can
// abort the matching run. Scoping the key to the user means one user can't
// cancel another's run by guessing a requestId.
const activeRuns = new Map<string, AbortController>();

export async function handleAgentsMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
  broadcast: (message: WsMessage) => void,
): Promise<boolean> {
  switch (msg.type) {
    case "agents:list": {
      try {
        const rows = await agentRegistry.listAgents(userId);
        send(ws, { type: "agents:list", payload: { agents: rows } });
      } catch (err: unknown) {
        send(ws, { type: "agents:list", payload: { agents: [], error: errMsg(err) } });
      }
      return true;
    }

    case "agents:get": {
      try {
        const { id, slug } = msg.payload;
        const row = id
          ? await agentRegistry.getAgentById(id, userId)
          : slug
            ? await agentRegistry.getAgentBySlug(slug, userId)
            : null;
        send(ws, { type: "agents:get", payload: { agent: row } });
      } catch (err: unknown) {
        send(ws, { type: "agents:error", payload: { message: errMsg(err) } });
      }
      return true;
    }

    case "agents:upsert": {
      try {
        // Upsert by slug — the slug is the stable id from the user's POV.
        const row = await agentRegistry.upsertAgentBySlug(
          msg.payload as agentRegistry.AgentInput,
          userId,
        );
        send(ws, { type: "agents:upserted", payload: { agent: row } });
        // Targeted ping: only this client's list need refresh (agents are
        // private). Other clients owned by the same user are out of luck
        // until they reload — fine for v0.
        send(ws, { type: "agents:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "agents:error", payload: { message: errMsg(err) } });
      }
      return true;
    }

    case "agents:delete": {
      try {
        const { id } = msg.payload;
        await agentRegistry.deleteAgent(id, userId);
        send(ws, { type: "agents:deleted", payload: { id } });
        send(ws, { type: "agents:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "agents:error", payload: { message: errMsg(err) } });
      }
      return true;
    }

    case "agents:run": {
      const { agentId, userMessage, context, requestId } = msg.payload as {
        agentId: string;
        userMessage: string;
        context?: string;
        /** Client-supplied id echoed back on every event/complete message so
         *  concurrent runs in the same WS can be demultiplexed by the client. */
        requestId?: string;
      };
      const reqId = requestId ?? agentId;
      const runKey = `${userId}:${reqId}`;
      const controller = new AbortController();
      activeRuns.set(runKey, controller);
      void analyticsService.recordEvent({ userId, userName: null, event: "agent.run", props: {}, ip: null });
      try {
        const result = await runAgent(
          {
            agentId,
            userMessage,
            context,
            triggeredByUserId: userId,
            signal: controller.signal,
          },
          (ev) => {
            send(ws, {
              type: "agents:run:event",
              payload: { requestId: reqId, event: ev },
            });
          },
        );
        send(ws, {
          type: "agents:run:complete",
          payload: { requestId: reqId, result },
        });
      } catch (err: unknown) {
        send(ws, {
          type: "agents:run:complete",
          payload: {
            requestId: reqId,
            result: { status: "failed", output: "", error: errMsg(err), toolEvents: [] },
          },
        });
      } finally {
        activeRuns.delete(runKey);
      }
      return true;
    }

    case "agents:cancel": {
      // Abort the in-flight run for this (user, requestId). No-op if it already
      // finished — the run's own `agents:run:complete` reports the final status.
      const { requestId } = msg.payload as { requestId?: string };
      if (requestId) activeRuns.get(`${userId}:${requestId}`)?.abort();
      return true;
    }

    default:
      return false;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
