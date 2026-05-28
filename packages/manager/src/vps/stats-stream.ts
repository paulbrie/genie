import { type WebSocket, WebSocket as Ws } from "ws";
import type { VpsStatsPayload } from "@genie/vps-stats";
import type { SshConnectionConfig } from "./ssh-client.js";
import {
  evictAllSessionsForHost,
  evictSession,
  getCachedSession,
} from "./ssh-session-cache.js";
import {
  ensureVpsStats,
  isGenieStatsServiceActive,
  vpsStatsDaemonCommand,
  vpsStatsTailCommand,
} from "./ensure-vps-stats.js";
import { enqueueVpsMetricSample } from "./vps-metric-service.js";
import { dbgSsh } from "../debug-ssh-log.js";
import { getActiveSshConnections } from "./ssh-metrics.js";

export const STATS_STALE_MS = 15_000;

const INITIAL_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;
/** Cap parallel SSH dials when many VMs are watched at once. */
const MAX_CONCURRENT_CONNECTS = 4;

export function statsStreamKey(projectId: string, instanceId: string): string {
  return `${projectId}:${instanceId}`;
}

function connectionKey(cfg: SshConnectionConfig): string {
  return `${cfg.host}:${cfg.port}:${cfg.username}`;
}

interface CachedEntry {
  stats: VpsStatsPayload;
  updatedAt: number;
}

interface HostTransport {
  config: SshConnectionConfig;
  /** Instance keys (projectId:instanceId) sharing this SSH tail session. */
  keys: Set<string>;
  abort: { stop: boolean };
}

const cache = new Map<string, CachedEntry>();
/** WS clients watching a given instance stream key. */
const watchers = new Map<string, Set<WebSocket>>();
/** Instance key → SSH target used when the watch was registered. */
const keyConnections = new Map<string, SshConnectionConfig>();
/** One tail stream per host:port:user — prevents N duplicate SSH sessions to the same VM. */
const hostTransports = new Map<string, HostTransport>();
const retryBackoffMs = new Map<string, number>();

function hostBackoffKey(ck: string): string {
  return ck;
}

function retryDelayMs(ck: string): number {
  return retryBackoffMs.get(ck) ?? INITIAL_RETRY_MS;
}

function bumpRetryBackoff(ck: string): void {
  const next = Math.min(retryDelayMs(ck) * 2, MAX_RETRY_MS);
  retryBackoffMs.set(ck, next);
}

function resetRetryBackoff(ck: string): void {
  retryBackoffMs.delete(ck);
}

let connectInFlight = 0;
const connectWaiters: Array<() => void> = [];

async function acquireConnectSlot(): Promise<void> {
  if (connectInFlight < MAX_CONCURRENT_CONNECTS) {
    connectInFlight++;
    return;
  }
  await new Promise<void>((resolve) => {
    connectWaiters.push(() => {
      connectInFlight++;
      resolve();
    });
  });
}

function releaseConnectSlot(): void {
  connectInFlight = Math.max(0, connectInFlight - 1);
  const next = connectWaiters.shift();
  if (next) next();
}

export function getCachedVpsStats(projectId: string, instanceId: string): VpsStatsPayload | null {
  const entry = cache.get(statsStreamKey(projectId, instanceId));
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > STATS_STALE_MS) return null;
  return entry.stats;
}

function setCache(key: string, stats: VpsStatsPayload): void {
  cache.set(key, { stats, updatedAt: Date.now() });
}

function parseStreamKey(key: string): { projectId: string; instanceId: string } {
  const idx = key.indexOf(":");
  return { projectId: key.slice(0, idx), instanceId: key.slice(idx + 1) };
}

function handleStatsLine(
  key: string,
  line: string,
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): void {
  if (!line.trim()) return;
  let msg: { type?: string; ts?: number; stats?: VpsStatsPayload };
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type !== "stats" || !msg.stats) return;
  setCache(key, msg.stats);
  const { projectId, instanceId } = parseStreamKey(key);
  enqueueVpsMetricSample(projectId, instanceId, msg.ts ?? Date.now(), msg.stats);
  notifyWatchers(key, projectId, instanceId, msg.stats, send);
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

function notifyWatchersError(
  key: string,
  projectId: string,
  instanceId: string,
  message: string,
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): void {
  const set = watchers.get(key);
  if (!set?.size) return;
  const msg = { type: "vps:stats:error", payload: { projectId, instanceId, message } };
  for (const ws of set) {
    if (ws.readyState === Ws.OPEN) send(ws, msg);
  }
}

function notifyTransportError(
  transport: HostTransport,
  message: string,
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): void {
  for (const key of transport.keys) {
    const { projectId, instanceId } = parseStreamKey(key);
    notifyWatchersError(key, projectId, instanceId, message, send);
  }
}

function transportHasWatchers(transport: HostTransport): boolean {
  for (const key of transport.keys) {
    if (watchers.get(key)?.size) return true;
  }
  return false;
}

async function runHostTransportLoop(
  ck: string,
  transport: HostTransport,
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): Promise<void> {
  const { config } = transport;

  while (!transport.abort.stop && transportHasWatchers(transport)) {
    let sshSession: Awaited<ReturnType<typeof getCachedSession>> | undefined;
    let channel: Awaited<ReturnType<Awaited<ReturnType<typeof getCachedSession>>["execStreaming"]>> | undefined;
    let lineBuffer = "";
    let acquiredSlot = false;

    const teardownTransport = () => {
      try {
        channel?.close();
      } catch {
        /* */
      }
      channel = undefined;
      sshSession = undefined;
    };

    try {
      await acquireConnectSlot();
      acquiredSlot = true;
      await ensureVpsStats(config);
      const useSystemd = await isGenieStatsServiceActive(config);
      // #region agent log
      dbgSsh("stats-stream.ts:loop", "stats stream connectSsh", "H3", {
        host: config.host,
        username: config.username,
        activeSsh: getActiveSshConnections(),
      });
      // #endregion
      sshSession = await getCachedSession(config);
      const streamCmd = useSystemd ? vpsStatsTailCommand() : vpsStatsDaemonCommand(5);
      channel = await sshSession.execStreaming(streamCmd);

      channel.stdout.on("data", (chunk: Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() || "";
        for (const line of lines) {
          for (const key of transport.keys) {
            if (watchers.get(key)?.size) {
              handleStatsLine(key, line, send);
            }
          }
        }
      });

      channel.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) console.error(`[vps-stats:${config.host}] ${text}`);
      });

      await new Promise<void>((resolve) => {
        channel!.stdout.on("end", () => resolve());
        channel!.stdout.on("close", () => resolve());
      });
      resetRetryBackoff(ck);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[vps-stats] stream error for ${config.host}: ${message}`);
      notifyTransportError(transport, message, send);
    } finally {
      teardownTransport();
      if (acquiredSlot) releaseConnectSlot();
    }

    if (transport.abort.stop || !transportHasWatchers(transport)) break;

    const delay = retryDelayMs(ck);
    bumpRetryBackoff(ck);
    await new Promise((r) => setTimeout(r, delay));
  }

  hostTransports.delete(ck);
  evictSession(config);
}

function ensureHostTransport(
  key: string,
  connection: SshConnectionConfig,
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): void {
  const ck = connectionKey(connection);
  const existing = hostTransports.get(ck);
  if (existing) {
    existing.keys.add(key);
    return;
  }

  const transport: HostTransport = {
    config: connection,
    keys: new Set([key]),
    abort: { stop: false },
  };
  hostTransports.set(ck, transport);
  void runHostTransportLoop(ck, transport, send);
}

function releaseInstanceKey(key: string): void {
  const connection = keyConnections.get(key);
  keyConnections.delete(key);
  if (!connection) return;

  const ck = connectionKey(connection);
  const transport = hostTransports.get(ck);
  if (!transport) return;

  transport.keys.delete(key);
  if (!transportHasWatchers(transport)) {
    transport.abort.stop = true;
    if (transport.keys.size === 0) {
      hostTransports.delete(ck);
    }
  }
}

/** Stop all stats tail streams targeting `host` (used by /ssh kill-all). */
export function stopStatsStreamsForHost(host: string): void {
  for (const [ck, transport] of hostTransports) {
    if (transport.config.host !== host) continue;
    transport.abort.stop = true;
    hostTransports.delete(ck);
  }
  for (const [key, conn] of keyConnections) {
    if (conn.host === host) {
      keyConnections.delete(key);
    }
  }
  evictAllSessionsForHost(host);
}

export function watchVpsStats(
  ws: WebSocket,
  projectId: string,
  instanceId: string,
  connection: SshConnectionConfig,
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): void {
  const key = statsStreamKey(projectId, instanceId);
  keyConnections.set(key, connection);

  let set = watchers.get(key);
  if (!set) {
    set = new Set();
    watchers.set(key, set);
  }
  set.add(ws);

  ensureHostTransport(key, connection, send);

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
  if (set.size === 0) {
    watchers.delete(key);
    releaseInstanceKey(key);
  }
}

/** Drop all watches for a disconnected WebSocket client. */
export function unwatchVpsStatsForClient(ws: WebSocket): void {
  for (const [key, set] of watchers) {
    if (!set.delete(ws)) continue;
    if (set.size === 0) {
      watchers.delete(key);
      releaseInstanceKey(key);
    }
  }
}

export function clearVpsStatsCache(projectId: string, instanceId: string): void {
  cache.delete(statsStreamKey(projectId, instanceId));
}
