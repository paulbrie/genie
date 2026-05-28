import { connectSsh, type SshConnectionConfig, type SshSession } from "./ssh-client.js";

// A long-lived SSH session per (host, port, username), reused across probes so
// the Clouds panels (admin:tazcloud:stats / admin:droplets:stats) and any other
// high-frequency caller stops paying for a TCP+SSH handshake on every refresh
// tick. Before this, N VMs meant N handshakes every refresh round; now it's N
// handshakes the first time and zero thereafter until idle eviction.

const IDLE_TTL_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

interface Entry {
  /** Resolved session — null while a dial is in flight or after eviction. */
  session: SshSession | null;
  /** In-flight dial promise; lets concurrent callers share one handshake. */
  dialing: Promise<SshSession> | null;
  cfg: SshConnectionConfig;
  /** ms timestamp of the last successful getCachedSession/execCached use. */
  lastUsed: number;
}

const cache = new Map<string, Entry>();

function keyOf(cfg: SshConnectionConfig): string {
  return `${cfg.host}:${cfg.port}:${cfg.username}`;
}

/** Return a cached SSH session for `cfg`, dialing once on first use. Concurrent
 *  callers for the same key share the same in-flight dial. The session is NOT
 *  closed by callers — let the idle reaper or `evictSession` handle teardown. */
export async function getCachedSession(cfg: SshConnectionConfig): Promise<SshSession> {
  const key = keyOf(cfg);
  const existing = cache.get(key);
  if (existing) {
    if (existing.session) {
      existing.lastUsed = Date.now();
      return existing.session;
    }
    if (existing.dialing) {
      const s = await existing.dialing;
      existing.lastUsed = Date.now();
      return s;
    }
  }
  const dialing = connectSsh(cfg);
  const entry: Entry = { session: null, dialing, cfg, lastUsed: Date.now() };
  cache.set(key, entry);
  try {
    const session = await dialing;
    entry.session = session;
    entry.dialing = null;
    entry.lastUsed = Date.now();
    return session;
  } catch (err) {
    cache.delete(key);
    throw err;
  }
}

/** Forcibly drop the cached session for `cfg`. Closes the underlying SSH
 *  connection if one is still open. Safe to call on a missing entry. */
export function evictSession(cfg: SshConnectionConfig): void {
  const key = keyOf(cfg);
  const entry = cache.get(key);
  if (!entry) return;
  try { entry.session?.close(); } catch { /* ignore */ }
  cache.delete(key);
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
    return await session.exec(command, onData, opts);
  } catch (err) {
    evictSession(cfg);
    const session = await getCachedSession(cfg);
    return await session.exec(command, onData, opts);
  }
}

/** Close every cached session and clear the cache. Intended for graceful
 *  shutdown — callers that just want one entry gone should use evictSession. */
export function evictAllSessions(): void {
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
    if (entry.session && now - entry.lastUsed > IDLE_TTL_MS) {
      try { entry.session.close(); } catch { /* ignore */ }
      cache.delete(key);
    }
  }
}, SWEEP_INTERVAL_MS).unref();
