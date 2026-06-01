import { type WebSocket, WebSocket as Ws } from "ws";
import type { VpsStatsPayload } from "@genie/vps-stats";
import { enqueueVpsMetricSample, getLatestVpsMetricSamples } from "./vps-metric-service.js";

export const STATS_STALE_MS = 15_000;

export function statsStreamKey(projectId: string, instanceId: string): string {
  return `${projectId}:${instanceId}`;
}

interface CachedEntry {
  stats: VpsStatsPayload;
  updatedAt: number;
}

const cache = new Map<string, CachedEntry>();
/** WS clients watching a given instance stream key. */
const watchers = new Map<string, Set<WebSocket>>();

export function getCachedVpsStats(projectId: string, instanceId: string): VpsStatsPayload | null {
  const entry = cache.get(statsStreamKey(projectId, instanceId));
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > STATS_STALE_MS) return null;
  return entry.stats;
}

function setCache(key: string, stats: VpsStatsPayload): void {
  cache.set(key, { stats, updatedAt: Date.now() });
}

function notifyWatchers(
  key: string,
  projectId: string,
  instanceId: string,
  stats: VpsStatsPayload,
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): void {
  const set = watchers.get(key);
  if (!set?.size) return;
  const msg = { type: "vps:stats:update", payload: { projectId, instanceId, stats } };
  for (const ws of set) {
    if (ws.readyState === Ws.OPEN) send(ws, msg);
  }
}

/**
 * Ingest a single stats sample pushed by the on-VM genie-stats daemon over
 * HTTPS (POST /api/vps/stats). Caches it for instant replay, persists it to the
 * metric history, and fans it out to any live UI watchers. This is the sole
 * data source now that VMs push instead of the manager tailing them over SSH.
 */
export function ingestVpsStats(
  projectId: string,
  instanceId: string,
  ts: number,
  stats: VpsStatsPayload,
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): void {
  const key = statsStreamKey(projectId, instanceId);
  setCache(key, stats);
  enqueueVpsMetricSample(projectId, instanceId, ts, stats);
  notifyWatchers(key, projectId, instanceId, stats, send);
}

/**
 * Register a UI client as a watcher of an instance's live stats. The actual
 * samples arrive via `ingestVpsStats` from the VM's HTTPS postback; this just
 * subscribes the socket and replays the most recent cached value.
 */
export function watchVpsStats(
  ws: WebSocket,
  projectId: string,
  instanceId: string,
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): void {
  const key = statsStreamKey(projectId, instanceId);
  let set = watchers.get(key);
  if (!set) {
    set = new Set();
    watchers.set(key, set);
  }
  set.add(ws);

  const cached = cache.get(key);
  if (cached) {
    send(ws, {
      type: "vps:stats:update",
      payload: { projectId, instanceId, stats: cached.stats },
    });
  }
}

export function unwatchVpsStats(ws: WebSocket, projectId: string, instanceId: string): void {
  const key = statsStreamKey(projectId, instanceId);
  const set = watchers.get(key);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) watchers.delete(key);
}

/** Drop all watches for a disconnected WebSocket client. */
export function unwatchVpsStatsForClient(ws: WebSocket): void {
  for (const [key, set] of watchers) {
    if (!set.delete(ws)) continue;
    if (set.size === 0) watchers.delete(key);
  }
}

export function clearVpsStatsCache(projectId: string, instanceId: string): void {
  cache.delete(statsStreamKey(projectId, instanceId));
}

function parseStreamKey(key: string): { projectId: string; instanceId: string } {
  const idx = key.indexOf(":");
  return { projectId: key.slice(0, idx), instanceId: key.slice(idx + 1) };
}

/**
 * Decide whether the dev DB-poll fallback should run. Explicit
 * GENIE_STATS_DB_POLL=1/0 wins; otherwise auto-enable when this manager isn't
 * publicly addressable (MANAGER_URL unset or pointing at localhost) — i.e. a
 * dev manager that won't receive the VM's postback but shares prod's DB.
 */
function dbPollEnabled(): boolean {
  const flag = process.env.GENIE_STATS_DB_POLL;
  if (flag === "1") return true;
  if (flag === "0") return false;
  const url = process.env.MANAGER_URL?.trim();
  if (!url) return true; // unset → defaults to http://127.0.0.1:PORT (dev)
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * Dev-only fallback: when this manager doesn't receive the VM's HTTPS postback
 * (the VM posts to prod), but dev and prod share a DB, poll the latest persisted
 * sample for each watched VM every 5s and push it to watchers — the same
 * `vps:stats:update` the live path emits, just sourced from the DB. The
 * persisted row carries only scalar gauges, so processes/ports come back empty.
 * Auto-enabled when MANAGER_URL is unset/localhost; force with GENIE_STATS_DB_POLL=1/0.
 */
export function startStatsDbPoll(
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): void {
  if (!dbPollEnabled()) return;
  console.log("[vps-stats] DB-poll fallback enabled (reading vps_metric_samples every 5s)");

  const timer = setInterval(() => {
    void (async () => {
      const keys = [...watchers.keys()].filter((k) => watchers.get(k)?.size);
      if (keys.length === 0) return;
      const instances = keys.map(parseStreamKey);
      let latest: Awaited<ReturnType<typeof getLatestVpsMetricSamples>>;
      try {
        latest = await getLatestVpsMetricSamples(instances);
      } catch (err: unknown) {
        console.error(`[vps-stats] DB-poll query failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      for (const key of keys) {
        const m = latest[key];
        if (!m) continue;
        const cached = cache.get(key);
        // Skip if we've already pushed this exact sample.
        if (cached && cached.updatedAt >= m.sampledAt) continue;
        const { projectId, instanceId } = parseStreamKey(key);
        const stats: VpsStatsPayload = {
          cpuPercent: m.cpuPercent,
          memUsedBytes: m.memUsedBytes,
          memTotalBytes: m.memTotalBytes,
          memPercent: m.memPercent,
          diskUsedBytes: m.diskUsedBytes,
          diskTotalBytes: m.diskTotalBytes,
          diskPercent: m.diskPercent,
          processes: [],
          openPorts: [],
          externalPorts: [],
        };
        cache.set(key, { stats, updatedAt: m.sampledAt });
        notifyWatchers(key, projectId, instanceId, stats, send);
      }
    })();
  }, 5000);
  timer.unref();
}
