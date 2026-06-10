import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import type { Role } from "../ws-acl.js";
import { hasRole } from "./handler-auth.js";
import { watchServerMetrics, unwatchServerMetrics, getServerMetricHistory } from "../server-metrics.js";

const VALID_RANGES = new Set([1, 6, 24]);

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
    // Persisted per-minute history for the 6h/24h ranges (request/response via reqId).
    case "admin:server-metrics:history": {
      const reqId = msg.payload?.reqId;
      if (!hasRole(role, "superadmin")) {
        send(ws, { type: "admin:server-metrics:history", payload: { reqId, hours: 0, rows: [] } });
        return true;
      }
      const hours = VALID_RANGES.has(msg.payload?.hours) ? msg.payload.hours : 6;
      const rows = await getServerMetricHistory(hours);
      send(ws, { type: "admin:server-metrics:history", payload: { reqId, hours, rows } });
      return true;
    }
    default:
      return false;
  }
}
