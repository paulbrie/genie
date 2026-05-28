import { type WebSocket, WebSocket as Ws } from "ws";
import type { VpsStatsPayload } from "@genie/vps-stats";
import { connectSsh, type SshConnectionConfig } from "./ssh-client.js";
import {
  ensureVpsStats,
  isGenieStatsServiceActive,
  vpsStatsDaemonCommand,
  vpsStatsTailCommand,
} from "./ensure-vps-stats.js";
import { enqueueVpsMetricSample } from "./vps-metric-service.js";

export const STATS_STALE_MS = 15_000;

const INITIAL_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;
/** Cap parallel SSH dials when the Monitor tab fans out across many VMs. */
const MAX_CONCURRENT_CONNECTS = 4;

export function statsStreamKey(projectId: string, instanceId: string): string {
  return `${projectId}:${instanceId}`;
}

interface CachedEntry {
  stats: VpsStatsPayload;
  updatedAt: number;
}

interface StatsStreamSession {
  projectId: string;
  instanceId: string;
  stop: () => void;
  restarting: boolean;
}

const cache = new Map<string, CachedEntry>();
const streams = new Map<string, StatsStreamSession>();
/** WS clients watching a given stream key. */
const watchers = new Map<string, Set<WebSocket>>();
const retryBackoffMs = new Map<string, number>();

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

function retryDelayMs(key: string): number {
  return retryBackoffMs.get(key) ?? INITIAL_RETRY_MS;
}

function bumpRetryBackoff(key: string): void {
  const next = Math.min(retryDelayMs(key) * 2, MAX_RETRY_MS);
  retryBackoffMs.set(key, next);
}

function resetRetryBackoff(key: string): void {
  retryBackoffMs.delete(key);
}

export function getCachedVpsStats(projectId: string, instanceId: string): VpsStatsPayload | null {
  const entry = cache.get(statsStreamKey(projectId, instanceId));
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > STATS_STALE_MS) return null;
  return entry.stats;
}

function setCache(key: string, stats: VpsStatsPayload): void {
  cache.set(key, { stats, updatedAt: Date.now() });
  resetRetryBackoff(key);
}

function handleStatsLine(
  key: string,
  projectId: string,
  instanceId: string,
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

async function startStream(
  key: string,
  projectId: string,
  instanceId: string,
  connection: SshConnectionConfig,
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): Promise<void> {
  if (streams.has(key)) return;

  const session: StatsStreamSession = {
    projectId,
    instanceId,
    restarting: false,
    stop: () => {},
  };
  streams.set(key, session);

  const run = async (): Promise<void> => {
    let sshSession: Awaited<ReturnType<typeof connectSsh>> | undefined;
    let channel: Awaited<ReturnType<Awaited<ReturnType<typeof connectSsh>>["execStreaming"]>> | undefined;
    let lineBuffer = "";
    let intentionalStop = false;
    let acquiredSlot = false;

    const teardownTransport = () => {
      try {
        channel?.close();
      } catch {
        /* */
      }
      try {
        sshSession?.close();
      } catch {
        /* */
      }
      channel = undefined;
      sshSession = undefined;
    };

    session.stop = () => {
      intentionalStop = true;
      teardownTransport();
      streams.delete(key);
    };

    try {
      await acquireConnectSlot();
      acquiredSlot = true;
      await ensureVpsStats(connection);
      const useSystemd = await isGenieStatsServiceActive(connection);
      sshSession = await connectSsh(connection, { timeoutMs: 30_000 });
      const streamCmd = useSystemd ? vpsStatsTailCommand() : vpsStatsDaemonCommand(5);
      channel = await sshSession.execStreaming(streamCmd);

      channel.stdout.on("data", (chunk: Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() || "";
        for (const line of lines) {
          handleStatsLine(key, projectId, instanceId, line, send);
        }
      });

      channel.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) console.error(`[vps-stats:${instanceId}] ${text}`);
      });

      await new Promise<void>((resolve) => {
        channel!.stdout.on("end", () => resolve());
        channel!.stdout.on("close", () => resolve());
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[vps-stats] stream error for ${key}: ${message}`);
      notifyWatchersError(key, projectId, instanceId, message, send);
    } finally {
      teardownTransport();
      streams.delete(key);
      if (acquiredSlot) releaseConnectSlot();
    }

    if (intentionalStop || session.restarting) return;

    if (watchers.get(key)?.size) {
      session.restarting = true;
      const delay = retryDelayMs(key);
      bumpRetryBackoff(key);
      await new Promise((r) => setTimeout(r, delay));
      if (watchers.get(key)?.size && !streams.has(key)) {
        void startStream(key, projectId, instanceId, connection, send);
      }
    }
  };

  void run();
}

export function watchVpsStats(
  ws: WebSocket,
  projectId: string,
  instanceId: string,
  connection: SshConnectionConfig,
  send: (ws: WebSocket, msg: { type: string; payload: Record<string, unknown> }) => void,
): void {
  const key = statsStreamKey(projectId, instanceId);
  let set = watchers.get(key);
  if (!set) {
    set = new Set();
    watchers.set(key, set);
  }
  set.add(ws);

  if (!streams.has(key)) {
    void startStream(key, projectId, instanceId, connection, send);
  }

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
    retryBackoffMs.delete(key);
    streams.get(key)?.stop();
  }
}

/** Drop all watches for a disconnected WebSocket client. */
export function unwatchVpsStatsForClient(ws: WebSocket): void {
  for (const [key, set] of watchers) {
    if (!set.delete(ws)) continue;
    if (set.size === 0) {
      watchers.delete(key);
      retryBackoffMs.delete(key);
      streams.get(key)?.stop();
    }
  }
}

export function clearVpsStatsCache(projectId: string, instanceId: string): void {
  cache.delete(statsStreamKey(projectId, instanceId));
}
