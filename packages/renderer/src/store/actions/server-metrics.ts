import { wsSend, wsRequest } from "@/lib/ws";
import type { ServerMetricSample, RequestVolumeResult } from "@/store/types/common";

const EMPTY_REQUEST_VOLUME: RequestVolumeResult = { bucketSeconds: 3600, mode: "user", series: [], points: [] };

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

/** Fetch per-user request volume (Claude popup + Genie Chat + Terminal) for a
 *  trailing window. Pass a userId to get that user's per-surface breakdown. */
export async function fetchRequestsByUser(hours: number, userId?: string | null): Promise<RequestVolumeResult> {
  const res = await wsRequest<{ result?: RequestVolumeResult }>(
    "admin:server-metrics:requests-by-user",
    { hours, userId: userId ?? null },
  );
  return res.result ?? EMPTY_REQUEST_VOLUME;
}
