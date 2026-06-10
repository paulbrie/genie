import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import type { Role } from "../ws-acl.js";
import { hasRole } from "./handler-auth.js";
import { watchServerMetrics, unwatchServerMetrics } from "../server-metrics.js";

/** Superadmin-only live server throughput dashboard subscription. The ACL gates
 *  delivery of admin:server-metrics:* (superadmin), and we re-check the role
 *  here before registering the watcher. Returns true if handled. */
export async function handleAdminServerMetricsMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  role: Role | null,
): Promise<boolean> {
  switch (msg.type) {
    case "admin:server-metrics:watch": {
      if (!hasRole(role, "superadmin")) return true;
      watchServerMetrics(ws, send);
      return true;
    }
    case "admin:server-metrics:unwatch": {
      unwatchServerMetrics(ws);
      return true;
    }
    default:
      return false;
  }
}
