import { connectSsh, type SshConnectionConfig, type SshSession } from "./ssh-client.js";

// One SSH client per (host, port, username). Callers use ensureServerTunnel() to
// pin a server while the Manage UI (or similar) is open; execCached multiplexes
// commands as channels on that single connection.

const IDLE_TTL_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

interface Entry {
  /** Resolved session — null while a dial is in flight or after eviction. */
  session: SshSession | null;
  cfg: SshConnectionConfig;
  /** ms timestamp of the last successful getCachedSession/execCached use. */
  lastUsed: number;
}

const cache = new Map<string, Entry>();
/** One in-flight dial per cache key — prevents parallel WS handlers from each
 *  calling connectSsh() before the cache entry exists (which orphaned ~50
 *  connections when opening the Manage popup). */
const inflightDials = new Map<string, Promise<SshSession>>();
/** Servers with an explicit open tunnel (Manage popup, etc.) — skip idle reaper. */
const pinnedTunnels = new Set<ServerTunnelKey>();

/** ssh2 allows multiple channels per connection, but overlapping execs on one
 *  cached session (stats fan-out + bundle upload) can stall probes for 30s+ on
 *  busy VMs. Serialize exec per cached session. */
const execTail = new WeakMap<SshSession, Promise<unknown>>();

function execSerialized<T>(session: SshSession, run: () => Promise<T>): Promise<T> {
  const prev = execTail.get(session) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(run);
  execTail.set(session, next);
  return next;
}

export type ServerTunnelKey = string;

export function serverTunnelKey(cfg: SshConnectionConfig): ServerTunnelKey {
  return `${cfg.host}:${cfg.port}:${cfg.username}`;
}

function keyOf(cfg: SshConnectionConfig): ServerTunnelKey {
  return serverTunnelKey(cfg);
}

function startDial(key: string, cfg: SshConnectionConfig): Promise<SshSession> {
  if (!inflightDials.has(key)) {
    let resolveDial!: (s: SshSession) => void;
    let rejectDial!: (err: unknown) => void;
    const dial = new Promise<SshSession>((resolve, reject) => {
      resolveDial = resolve;
      rejectDial = reject;
    });
    inflightDials.set(key, dial);

    void connectSsh(cfg, {
      onSessionClosed: () => {
        const entry = cache.get(key);
        if (entry?.session) entry.session = null;
      },
    })
      .then((session) => {
        const entry = cache.get(key);
        if (entry) {
          entry.session = session;
          entry.lastUsed = Date.now();
        } else {
          cache.set(key, { session, cfg, lastUsed: Date.now() });
        }
        resolveDial(session);
        return session;
      })
      .catch((err) => {
        const entry = cache.get(key);
        if (entry && !entry.session) cache.delete(key);
        rejectDial(err);
      })
      .finally(() => {
        if (inflightDials.get(key) === dial) inflightDials.delete(key);
      });
  }
  return inflightDials.get(key)!;
}

/** Return a cached SSH session for `cfg`, dialing once on first use. Concurrent
 *  callers for the same key share the same in-flight dial. The session is NOT
 *  closed by callers — let the idle reaper or `evictSession` handle teardown. */
export function pinServerTunnel(cfg: SshConnectionConfig): void {
  pinnedTunnels.add(serverTunnelKey(cfg));
}

export function unpinServerTunnel(cfg: SshConnectionConfig): void {
  pinnedTunnels.delete(serverTunnelKey(cfg));
}

export function isServerTunnelPinned(cfg: SshConnectionConfig): boolean {
  return pinnedTunnels.has(serverTunnelKey(cfg));
}

function isServerTunnelPinnedByKey(key: ServerTunnelKey): boolean {
  return pinnedTunnels.has(key);
}

/** Establish (or reuse) one SSH tunnel for this server and pin until release. */
export async function ensureServerTunnel(cfg: SshConnectionConfig): Promise<SshSession> {
  pinServerTunnel(cfg);
  return getCachedSession(cfg);
}

/** Close the tunnel and allow idle reaper to drop the cache entry. */
export function releaseServerTunnel(cfg: SshConnectionConfig): void {
  unpinServerTunnel(cfg);
  evictSession(cfg);
}

export async function getCachedSession(cfg: SshConnectionConfig): Promise<SshSession> {
  const key = keyOf(cfg);
  const existing = cache.get(key);
  if (existing?.session) {
    existing.lastUsed = Date.now();
    return existing.session;
  }

  if (!existing) {
    cache.set(key, { session: null, cfg, lastUsed: Date.now() });
  }

  return startDial(key, cfg);
}

/** Forcibly drop the cached session for `cfg`. Closes the underlying SSH
 *  connection if one is still open. Safe to call on a missing entry.
 *  Does NOT clear `inflightDials` — parallel retry callers must share one redial. */
export function evictSession(cfg: SshConnectionConfig): void {
  const key = keyOf(cfg);
  const entry = cache.get(key);
  if (entry) {
    try { entry.session?.close(); } catch { /* ignore */ }
    entry.session = null;
  }
  cache.delete(key);
}

/** Drop every cached session targeting `host` (all ports/users). Used when
 *  /ssh kills a pile of leaked connections so the stats cache can't revive
 *  them on the next probe. */
export function evictAllSessionsForHost(host: string): void {
  const clearedInflight = [...inflightDials.keys()].filter((k) => k.startsWith(`${host}:`));
  for (const key of clearedInflight) inflightDials.delete(key);
  const clearedCache: string[] = [];
  for (const [key, entry] of cache) {
    if (entry.cfg.host !== host) continue;
    clearedCache.push(key);
    try { entry.session?.close(); } catch { /* ignore */ }
    cache.delete(key);
  }
}

/** Run `command` over the cached session and return its stdout/stderr. On
 *  failure (the cached session may have silently died between probes —
 *  network glitch, VM restart, idle SSH timeout) the entry is evicted and the
 *  command is retried once on a fresh dial. Probe commands are read-only and
 *  idempotent, so retry is safe for the stats path. */
export async function execCached(
  cfg: SshConnectionConfig,
  command: string,
  onData?: (data: string) => void,
  opts?: { timeoutMs?: number; idleTimeoutMs?: number },
): Promise<string> {
  try {
    const session = await getCachedSession(cfg);
    return await execSerialized(session, () => session.exec(command, onData, opts));
  } catch (err) {
    evictSession(cfg);
    if (err instanceof Error && err.message.includes("timed out")) throw err;
    const session = await getCachedSession(cfg);
    return await execSerialized(session, () => session.exec(command, onData, opts));
  }
}

/** Close every cached session and clear the cache. Intended for graceful
 *  shutdown — callers that just want one entry gone should use evictSession. */
export function evictAllSessions(): void {
  inflightDials.clear();
  for (const entry of cache.values()) {
    try { entry.session?.close(); } catch { /* ignore */ }
  }
  cache.clear();
}

/** For tests / diagnostics: number of currently-cached SSH sessions. */
export function cachedSessionCount(): number {
  return cache.size;
}

// Reap idle sessions so a VM that hasn't been probed in a while doesn't keep
// an SSH connection open indefinitely. unref() so this timer never blocks
// process shutdown.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (isServerTunnelPinnedByKey(key)) continue;
    if (entry.session && now - entry.lastUsed > IDLE_TTL_MS) {
      try { entry.session.close(); } catch { /* ignore */ }
      cache.delete(key);
    }
  }
}, SWEEP_INTERVAL_MS).unref();
