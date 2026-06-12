import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import type { Role } from "../auth/ws-acl.js";
import { hasRole } from "./handler-auth.js";
import { watchServerMetrics, unwatchServerMetrics, getServerMetricHistory } from "../logging/server-metrics.js";
import { getRequestVolumeByUser, type RequestVolumeResult } from "../logging/analytics-service.js";

const VALID_RANGES = new Set([1, 6, 24]);

/** Time-bucket width per range, sized for ~12–24 points: 1h→5m, 6h→30m, 24h→1h. */
const BUCKET_SECONDS: Record<number, number> = { 1: 300, 6: 1800, 24: 3600 };

const EMPTY_REQUEST_VOLUME: RequestVolumeResult = { bucketSeconds: 3600, mode: "user", series: [], points: [] };

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
    // Per-user (or per-surface, when filtered) request volume for the stacked
    // "Requests by user" chart. Sourced from analytics_events (request/response via reqId).
    case "admin:server-metrics:requests-by-user": {
      const reqId = msg.payload?.reqId;
      if (!hasRole(role, "superadmin")) {
        send(ws, { type: "admin:server-metrics:requests-by-user", payload: { reqId, result: EMPTY_REQUEST_VOLUME } });
        return true;
      }
      const hours = VALID_RANGES.has(msg.payload?.hours) ? msg.payload.hours : 24;
      const userId = typeof msg.payload?.userId === "string" && msg.payload.userId ? msg.payload.userId : null;
      const result = await getRequestVolumeByUser(
        new Date(Date.now() - hours * 3_600_000),
        BUCKET_SECONDS[hours] ?? 3600,
        { userId },
      );
      send(ws, { type: "admin:server-metrics:requests-by-user", payload: { reqId, result } });
      return true;
    }
    default:
      return false;
  }
}
