// Dedicated SSH connection pool for best-effort stats/tmux probes.
//
// Probes are low-value and high-frequency (the VM connection popup polls every
// 5s). Running them over the *interactive* shared session (see ssh-session-cache)
// is dangerous: a slow probe exec on a busy VM would otherwise tear that session
// down and kill any open PTY (e.g. a Claude shell). This pool keeps probes on
// their own connection per (host, port, username) so a probe failure — timeout
// or hard disconnect — can never affect an interactive session.
//
// One connection per key, lazily dialed and reused; idle connections are swept.

import {
  connectSsh,
  type SshConnectionConfig,
  type SshSession,
} from "./ssh-client.js";
import { recordCommand } from "./ssh-traffic.js";

const IDLE_TTL_MS = 2 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

interface ProbeEntry {
  session: SshSession | null;
  dialing: Promise<SshSession> | null;
  lastUsed: number;
  /** Serialize execs per connection so overlapping probes don't stall each other. */
  tail: Promise<unknown>;
}

const pool = new Map<string, ProbeEntry>();

function keyOf(cfg: SshConnectionConfig): string {
  return `${cfg.host}:${cfg.port}:${cfg.username}`;
}

function evict(key: string): void {
  const entry = pool.get(key);
  if (!entry) return;
  try { entry.session?.close(); } catch { /* ignore */ }
  pool.delete(key);
}

async function getProbeSession(cfg: SshConnectionConfig): Promise<SshSession> {
  const key = keyOf(cfg);
  let entry = pool.get(key);
  if (!entry) {
    entry = { session: null, dialing: null, lastUsed: Date.now(), tail: Promise.resolve() };
    pool.set(key, entry);
  }
  entry.lastUsed = Date.now();
  if (entry.session) return entry.session;
  if (!entry.dialing) {
    entry.dialing = connectSsh(cfg, {
      onSessionClosed: () => {
        const cur = pool.get(key);
        if (cur) cur.session = null;
      },
    })
      .then((session) => {
        const cur = pool.get(key);
        if (cur) cur.session = session;
        return session;
      })
      .catch((err) => {
        // Failed dial: drop the slot so the next probe redials cleanly.
        pool.delete(key);
        throw err;
      })
      .finally(() => {
        const cur = pool.get(key);
        if (cur) cur.dialing = null;
      });
  }
  return entry.dialing;
}

/** Run a probe command on the dedicated probe connection. On a command timeout
 *  the session is kept (the exec's own channel is already closed by ssh-client);
 *  on a real connection error the probe session is dropped so the next call
 *  redials. Never touches the interactive session pool. */
export async function execProbe(
  cfg: SshConnectionConfig,
  command: string,
  onData?: (data: string) => void,
  opts?: { timeoutMs?: number; idleTimeoutMs?: number },
): Promise<string> {
  const key = keyOf(cfg);
  const startedAt = Date.now();
  let ok = false;
  let bytesIn = 0;
  try {
    const session = await getProbeSession(cfg);
    const entry = pool.get(key);
    const run = () => session.exec(command, onData, opts);
    const next = (entry ? entry.tail.catch(() => {}) : Promise.resolve()).then(run);
    if (entry) entry.tail = next;
    const out = await next;
    ok = true;
    bytesIn = Buffer.byteLength(out);
    return out;
  } catch (err) {
    // Timeout → command hung but the connection is fine; keep the session.
    // Anything else → assume the connection is gone; drop it for a fresh redial.
    if (!(err instanceof Error && err.message.includes("timed out"))) evict(key);
    throw err;
  } finally {
    recordCommand({
      ts: startedAt, host: cfg.host, username: cfg.username, kind: "probe",
      command, bytesOut: Buffer.byteLength(command), bytesIn,
      durationMs: Date.now() - startedAt, ok,
    });
  }
}

/** Drop probe connections for a host (e.g. when its session is force-evicted). */
export function evictProbeSessionsForHost(host: string): void {
  for (const key of [...pool.keys()]) {
    if (key.startsWith(`${host}:`)) evict(key);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pool) {
    if (entry.session && !entry.dialing && now - entry.lastUsed > IDLE_TTL_MS) {
      evict(key);
    }
  }
}, SWEEP_INTERVAL_MS).unref();
