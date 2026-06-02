// Admin backup handlers — listed, created and deleted by the admin Backups tab
// via wsSend("admin:backups:..."). All three cases delegate to backup-service;
// keeping them in their own handler keeps ws-server.ts smaller and groups
// them next to the related db-handler for future drizzle-push / restore work.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as backupService from "../backup-service.js";


export async function handleBackupMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
): Promise<boolean> {
  switch (msg.type) {
    case "admin:backups:list": {
      try {
        const files = backupService.listBackups();
        send(ws, { type: "admin:backups:list", payload: { files } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:backups:create": {
      try {
        await backupService.createBackup();
        const files = backupService.listBackups();
        send(ws, { type: "admin:backups:created", payload: { files } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:backups:delete": {
      try {
        backupService.deleteBackup(msg.payload.name);
        const files = backupService.listBackups();
        send(ws, { type: "admin:backups:deleted", payload: { files } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
