// Agents CRUD + run. Mirrors the recipes-handler shape so the renderer can
// reuse the same upsert/broadcast pattern. `agents:run` streams the agent's
// token / tool / done events back over the same WS as separate messages,
// keyed by runId so the client can route them.

import { type WebSocket } from "ws";
import type { WsMessage as WsMessageBase } from "../types.js";
import * as agentRegistry from "../agents/registry.js";
import { runAgent } from "../agents/runner.js";

export interface WsMessage extends Omit<WsMessageBase, "payload"> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
}

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
      try {
        const result = await runAgent(
          {
            agentId,
            userMessage,
            context,
            triggeredByUserId: userId,
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
      }
      return true;
    }

    default:
      return false;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
