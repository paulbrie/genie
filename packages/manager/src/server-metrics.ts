// Live server-side throughput metrics for the superadmin "Server" dashboard.
//
// Keeps a per-second ring buffer for the trailing hour of two counters:
//   - statsRequests: VM stats-daemon postbacks to POST /api/vps/stats per second
//   - wsSent:        WebSocket frames the server sent to clients per second
//
// A 1s ticker closes the current second into the ring and pushes it to every
// subscribed superadmin socket; on subscribe we replay the whole hour. Pure
// in-memory, reset on process restart (which is also when serverStartedAt is
// captured — that's the "Server up since X" the dashboard shows).

import { type WebSocket } from "ws";
import type { WsMessage } from "./types.js";

export interface ServerMetricBucket {
  /** Epoch ms at which this one-second bucket was closed. */
  t: number;
  /** Stats-daemon postbacks received during this second. */
  statsRequests: number;
  /** WebSocket frames sent by the server during this second. */
  wsSent: number;
}

type SendFn = (ws: WebSocket, message: WsMessage) => void;

const HISTORY_SECONDS = 3600;

/** When this manager process started — the dashboard renders "up since" from it. */
export const serverStartedAt = Date.now();

/** Closed one-second buckets, oldest first, capped at HISTORY_SECONDS. */
const history: ServerMetricBucket[] = [];

/** Accumulator for the second currently in progress. */
let cur = { statsRequests: 0, wsSent: 0 };

/** Subscribed superadmin sockets (gated in the WS handler). */
const watchers = new Set<WebSocket>();

let ticker: ReturnType<typeof setInterval> | null = null;
let sendFn: SendFn | null = null;

/** Count one inbound stats-daemon postback. Called from the HTTP handler. */
export function recordStatsRequest(): void {
  cur.statsRequests++;
}

/** Count outbound WebSocket frame(s). Called from send/broadcast helpers. */
export function recordWsSent(n = 1): void {
  cur.wsSent += n;
}

function snapshotMessage(): WsMessage {
  return {
    type: "admin:server-metrics:snapshot",
    payload: { startedAt: serverStartedAt, buckets: history },
  };
}

/** Start the 1s ticker that rolls the buffer forward and fans out to watchers. */
export function startServerMetrics(send: SendFn): void {
  sendFn = send;
  if (ticker) return;
  ticker = setInterval(() => {
    const bucket: ServerMetricBucket = {
      t: Date.now(),
      statsRequests: cur.statsRequests,
      wsSent: cur.wsSent,
    };
    cur = { statsRequests: 0, wsSent: 0 };
    history.push(bucket);
    if (history.length > HISTORY_SECONDS) history.shift();

    if (!watchers.size || !sendFn) return;
    const msg: WsMessage = { type: "admin:server-metrics:tick", payload: { bucket } };
    for (const ws of watchers) {
      if (ws.readyState === ws.OPEN) sendFn(ws, msg);
      else watchers.delete(ws);
    }
  }, 1000);
  ticker.unref();
}

export function stopServerMetrics(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  watchers.clear();
}

/** Subscribe a (superadmin) socket and replay the trailing hour immediately. */
export function watchServerMetrics(ws: WebSocket, send: SendFn): void {
  watchers.add(ws);
  send(ws, snapshotMessage());
}

export function unwatchServerMetrics(ws: WebSocket): void {
  watchers.delete(ws);
}
