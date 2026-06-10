import { wsSend, wsRequest } from "@/lib/ws";
import type { ServerMetricSample } from "@/store/types/common";

/** Subscribe to the live server throughput stream (superadmin-only on the server). */
export function watchServerMetrics(): void {
  wsSend("admin:server-metrics:watch", {});
}

export function unwatchServerMetrics(): void {
  wsSend("admin:server-metrics:unwatch", {});
}

/** Fetch persisted per-minute history for a trailing window (1 | 6 | 24 hours). */
export async function fetchServerMetricsHistory(hours: number): Promise<ServerMetricSample[]> {
  const res = await wsRequest<{ rows?: ServerMetricSample[] }>("admin:server-metrics:history", { hours });
  return res.rows ?? [];
}
