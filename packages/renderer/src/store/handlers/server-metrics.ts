import { $serverMetrics } from "../subjects/common";
import type { HandlerMap } from "./types";

const MAX_BUCKETS = 3600;

export const handlers: HandlerMap = {
  // Full trailing-hour replay sent on subscribe.
  "admin:server-metrics:snapshot": (payload) => {
    $serverMetrics.next({
      startedAt: payload.startedAt ?? null,
      buckets: Array.isArray(payload.buckets) ? payload.buckets.slice(-MAX_BUCKETS) : [],
    });
  },

  // One closed second, pushed every tick. Append and trim to the hour window.
  "admin:server-metrics:tick": (payload) => {
    const prev = $serverMetrics.getValue();
    const buckets = [...prev.buckets, payload.bucket].slice(-MAX_BUCKETS);
    $serverMetrics.next({ ...prev, buckets });
  },
};
