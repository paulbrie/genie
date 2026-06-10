import { wsSend } from "@/lib/ws";

/** Subscribe to the live server throughput stream (superadmin-only on the server). */
export function watchServerMetrics(): void {
  wsSend("admin:server-metrics:watch", {});
}

export function unwatchServerMetrics(): void {
  wsSend("admin:server-metrics:unwatch", {});
}
