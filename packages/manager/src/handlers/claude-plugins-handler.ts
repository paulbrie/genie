// Claude plugin catalog CRUD: list/create/update/delete. Mirrors the
// recipes-handler — superadmins manage the catalog; any authenticated user can
// read the list to populate the per-VM "Claude Plugins" tab. Mutations
// broadcast a `claude-plugins:list:stale` ping so every connected client
// refetches.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as claudePluginsService from "../claude-plugins-service.js";
import { type Role } from "../ws-acl.js";
import { hasRole } from "./handler-auth.js";


export async function handleClaudePluginsMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
  broadcast: (message: WsMessage) => void,
  role: Role | null,
): Promise<boolean> {
  if (!msg.type.startsWith("claude-plugins:")) return false;

  // Reads are open to any authenticated user (gated by ws-acl override on
  // claude-plugins:list / list:stale). Mutations require superadmin because
  // install scripts run as root on every VM that installs the plugin.
  if (msg.type !== "claude-plugins:list" && !hasRole(role, "superadmin")) {
    send(ws, { type: "claude-plugins:error", payload: { message: "Not authorized" } });
    return true;
  }

  switch (msg.type) {
    case "claude-plugins:list": {
      try {
        const rows = await claudePluginsService.listClaudePlugins();
        send(ws, { type: "claude-plugins:list", payload: { plugins: rows } });
      } catch (err: unknown) {
        send(ws, { type: "claude-plugins:list", payload: { plugins: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "claude-plugins:create": {
      try {
        const row = await claudePluginsService.createClaudePlugin(msg.payload as claudePluginsService.ClaudePluginInput, userId);
        send(ws, { type: "claude-plugins:upserted", payload: { plugin: row } });
        broadcast({ type: "claude-plugins:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "claude-plugins:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "claude-plugins:update": {
      try {
        const { id, ...rest } = msg.payload;
        const row = await claudePluginsService.updateClaudePlugin(id, rest);
        if (!row) throw new Error("Plugin not found");
        send(ws, { type: "claude-plugins:upserted", payload: { plugin: row } });
        broadcast({ type: "claude-plugins:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "claude-plugins:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "claude-plugins:delete": {
      try {
        const { id } = msg.payload;
        await claudePluginsService.deleteClaudePlugin(id);
        send(ws, { type: "claude-plugins:deleted", payload: { id } });
        broadcast({ type: "claude-plugins:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "claude-plugins:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
