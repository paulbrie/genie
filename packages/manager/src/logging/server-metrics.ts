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
import { gte, lt, asc } from "drizzle-orm";
import type { WsMessage } from "../types.js";
import { getDb } from "../db/index.js";
import { serverMetricSamples } from "../db/schema.js";

export interface ServerMetricBucket {
  /** Epoch ms at which this one-second bucket was closed. */
  t: number;
  /** Stats-daemon postbacks received during this second. */
  statsRequests: number;
  /** WebSocket frames sent by the server during this second. */
  wsSent: number;
}

/** A persisted per-minute roll-up row, as returned to the dashboard. Counts are
 *  totals over `windowSec`; the UI divides to get a per-second rate. */
export interface ServerMetricSample {
  t: number;
  windowSec: number;
  statsRequests: number;
  wsSent: number;
}

type SendFn = (ws: WebSocket, message: WsMessage) => void;

const HISTORY_SECONDS = 3600;
/** How often the minute accumulator is flushed to server_metric_samples. */
const FLUSH_INTERVAL_MS = 60_000;
/** Rows older than this are pruned on each flush. */
const RETENTION_MS = 25 * 3_600_000;

/** When this manager process started — the dashboard renders "up since" from it. */
export const serverStartedAt = Date.now();

/** Closed one-second buckets, oldest first, capped at HISTORY_SECONDS. */
const history: ServerMetricBucket[] = [];

/** Accumulator for the second currently in progress. */
let cur = { statsRequests: 0, wsSent: 0 };

/** Accumulator for the minute roll-up persisted to the DB. windowSec counts the
 *  seconds folded in so far (usually 60, fewer right after start/flush). */
let minuteAcc = { statsRequests: 0, wsSent: 0, windowSec: 0 };

/** Subscribed superadmin sockets (gated in the WS handler). */
const watchers = new Set<WebSocket>();

let ticker: ReturnType<typeof setInterval> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
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

/** Persist the accumulated minute roll-up and prune anything past retention.
 *  Best-effort: a missing/unreachable DB (e.g. local dev) is swallowed. */
async function flushMinute(): Promise<void> {
  if (minuteAcc.windowSec === 0) return;
  const row = {
    sampledAt: new Date(),
    windowSec: minuteAcc.windowSec,
    statsRequests: minuteAcc.statsRequests,
    wsSent: minuteAcc.wsSent,
  };
  minuteAcc = { statsRequests: 0, wsSent: 0, windowSec: 0 };
  try {
    const db = getDb();
    await db.insert(serverMetricSamples).values(row);
    await db.delete(serverMetricSamples).where(lt(serverMetricSamples.sampledAt, new Date(Date.now() - RETENTION_MS)));
  } catch (err: unknown) {
    console.error(`[server-metrics] flush failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Persisted per-minute history for the given trailing window (hours). Returns
 *  oldest-first; empty on any DB error so the dashboard degrades gracefully. */
export async function getServerMetricHistory(hours: number): Promise<ServerMetricSample[]> {
  const since = new Date(Date.now() - hours * 3_600_000);
  try {
    const db = getDb();
    const rows = await db
      .select({
        sampledAt: serverMetricSamples.sampledAt,
        windowSec: serverMetricSamples.windowSec,
        statsRequests: serverMetricSamples.statsRequests,
        wsSent: serverMetricSamples.wsSent,
      })
      .from(serverMetricSamples)
      .where(gte(serverMetricSamples.sampledAt, since))
      .orderBy(asc(serverMetricSamples.sampledAt));
    return rows.map((r) => ({
      t: r.sampledAt.getTime(),
      windowSec: r.windowSec,
      statsRequests: r.statsRequests,
      wsSent: r.wsSent,
    }));
  } catch (err: unknown) {
    console.error(`[server-metrics] history query failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** Start the 1s ticker that rolls the buffer forward and fans out to watchers,
 *  plus the 60s flusher that persists per-minute roll-ups. */
export function startServerMetrics(send: SendFn): void {
  sendFn = send;
  if (!flushTimer) {
    flushTimer = setInterval(() => void flushMinute(), FLUSH_INTERVAL_MS);
    flushTimer.unref();
  }
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

    // Fold into the minute roll-up that gets persisted for the 6h/24h ranges.
    minuteAcc.statsRequests += bucket.statsRequests;
    minuteAcc.wsSent += bucket.wsSent;
    minuteAcc.windowSec += 1;

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
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
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
