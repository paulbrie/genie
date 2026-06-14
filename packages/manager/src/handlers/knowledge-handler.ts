// Knowledge bundle ("Concepts" nav): read + edit the repo's conceptual docs,
// stored in the DB. Superadmin-only — the WS ACL gates the `knowledge:*`
// namespace to superadmin; the in-handler check is defense in depth. Mutations
// broadcast `knowledge:list:stale` so every connected superadmin refreshes.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as knowledgeService from "../knowledge-service.js";
import { type Role } from "../auth/ws-acl.js";
import { hasRole } from "./handler-auth.js";

export async function handleKnowledgeMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
  broadcast: (message: WsMessage) => void,
  role: Role | null,
): Promise<boolean> {
  if (!msg.type.startsWith("knowledge:")) return false;
  if (!hasRole(role, "superadmin")) {
    send(ws, { type: "knowledge:error", payload: { message: "Not authorized" } });
    return true;
  }
  switch (msg.type) {
    case "knowledge:list": {
      try {
        const files = await knowledgeService.listKnowledge();
        send(ws, { type: "knowledge:list", payload: { files } });
      } catch (err: unknown) {
        send(ws, { type: "knowledge:list", payload: { files: [], error: errMsg(err) } });
      }
      return true;
    }

    case "knowledge:create": {
      try {
        const row = await knowledgeService.createKnowledge(msg.payload as knowledgeService.KnowledgeInput, userId);
        send(ws, { type: "knowledge:upserted", payload: { file: row } });
        broadcast({ type: "knowledge:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "knowledge:error", payload: { message: errMsg(err) } });
      }
      return true;
    }

    case "knowledge:update": {
      try {
        const { id, ...rest } = msg.payload;
        const row = await knowledgeService.updateKnowledge(id, rest);
        if (!row) throw new Error("Document not found");
        send(ws, { type: "knowledge:upserted", payload: { file: row } });
        broadcast({ type: "knowledge:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "knowledge:error", payload: { message: errMsg(err) } });
      }
      return true;
    }

    case "knowledge:delete": {
      try {
        const { id } = msg.payload;
        await knowledgeService.deleteKnowledge(id);
        send(ws, { type: "knowledge:deleted", payload: { id } });
        broadcast({ type: "knowledge:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "knowledge:error", payload: { message: errMsg(err) } });
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
