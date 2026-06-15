// SSH disconnect flight recorder.
//
// A "stream stopped / connection lost" can fail at six independent layers —
// WireGuard (UDP) → wireproxy/SOCKS5 → TCP → ssh2 transport → channel/tmux →
// remote process — and ssh2 collapses most of them into one bare `close`. This
// module attributes each drop to a structured cause, keeps the last N in an
// in-memory ring (instant, for the /ssh panel), and batches them to Postgres
// (mirroring vps-metric-service.ts) so a 3am drop is still queryable at 9am.
// Every recorded event also emits ONE structured console line so it shows up in
// the prod (Railway) log stream even without the DB or UI.

import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { sshEvents } from "../db/schema.js";

/** Which subsystem owned the connection that dropped. */
export type SshEventKind = "client" | "pty" | "stats" | "tunnel" | "wireproxy";

/** Why a connection/stream ended. The first six are faults worth investigating;
 *  `process-exit` is a normal remote exit; `local-kill` is us closing it (user
 *  action, idle reap, shutdown) and is never recorded — it's pure noise. */
export type SshDisconnectCause =
  | "keepalive-timeout"   // ssh2 client-timeout: path silently black-holed (the smoking gun)
  | "remote-disconnect"   // server sent SSH_MSG_DISCONNECT / channel closed with transport alive
  | "tcp-reset"           // ECONNRESET — peer/network reset
  | "host-unreachable"    // EHOSTUNREACH / ENETUNREACH — routing/VM down
  | "handshake-timeout"   // ETIMEDOUT before `ready` — sshd not answering
  | "socks-failure"       // dialSock threw — wireproxy/WireGuard down
  | "auth-failure"        // authentication rejected
  | "stream-end"          // a long-lived command stream ended unexpectedly (stats daemon died)
  | "tcp-close"           // clean FIN with no error attribution
  | "process-exit"        // remote process exited (normal for an interactive shell)
  | "local-kill"          // we closed it (never recorded)
  | "unknown";

export type SshEventType =
  | "disconnect"
  | "wireproxy-exit"
  | "wireproxy-respawn"
  | "wireproxy-gaveup";

export interface SshEvent {
  occurredAt: number;        // ms epoch
  host: string;
  port?: number;
  username?: string;
  kind: SshEventKind;
  event: SshEventType;
  cause?: SshDisconnectCause;
  /** How long the connection lived (ms). For disconnects, ready→close. */
  lifetimeMs?: number;
  /** Silence before death (ms) — time since the last byte over this connection.
   *  The single most diagnostic number: a keepalive-timeout with idle≈45s is a
   *  dead path; idle≈0 is a hard reset mid-traffic. */
  lastDataAgeMs?: number;
  /** Freeform: err.message, terminating signal, exit code, etc. */
  detail?: string;
}

/** Classify an ssh2 error (or absence of one) into a cause. ssh2 attaches
 *  `level` (client-timeout / client-authentication / client-socket / protocol)
 *  and a socket `code` (ECONNRESET / EHOSTUNREACH / ETIMEDOUT); we read both,
 *  falling back to message matching for bundled builds that flatten them. */
export function classifySshDisconnect(
  err: unknown,
  opts?: { wasLocalClose?: boolean },
): SshDisconnectCause {
  if (opts?.wasLocalClose) return "local-kill";
  if (!err) return "tcp-close";
  const e = err as { level?: string; code?: string; message?: string };
  const level = e.level ?? "";
  const code = e.code ?? "";
  const msg = e.message ?? "";
  if (level === "client-timeout" || /keepalive|Keepalive|timed out/i.test(msg)) return "keepalive-timeout";
  if (level === "client-authentication" || /authentication|All configured auth/i.test(msg)) return "auth-failure";
  if (code === "ECONNRESET" || /ECONNRESET/.test(msg)) return "tcp-reset";
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH" || /EHOSTUNREACH|ENETUNREACH/.test(msg)) return "host-unreachable";
  if (code === "ETIMEDOUT" || /ETIMEDOUT/.test(msg)) return "handshake-timeout";
  if (/SOCKS/i.test(msg)) return "socks-failure";
  if (level === "protocol" || /disconnect/i.test(msg)) return "remote-disconnect";
  return "unknown";
}

const RING_SIZE = 500;
const ring: SshEvent[] = [];

const queue: SshEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
// Disconnects are rarer and more urgent than metric samples — flush more often
// so a drop is durable within ~15s even if the manager then crashes.
const FLUSH_INTERVAL_MS = 15_000;
const MAX_QUEUE = 200;

/** Record an SSH lifecycle event. `local-kill` disconnects are dropped (expected
 *  noise: idle reap, user close, shutdown). Everything else goes to the ring,
 *  the DB queue, and one structured console line. Never throws. */
export function recordSshEvent(ev: SshEvent): void {
  if (ev.event === "disconnect" && ev.cause === "local-kill") return;

  ring.push(ev);
  if (ring.length > RING_SIZE) ring.shift();

  queue.push(ev);
  if (queue.length >= MAX_QUEUE) void flushSshEvents();

  const secs = (ms?: number) => (ms == null ? "" : `${Math.round(ms / 1000)}s`);
  const tag = ev.event === "disconnect" ? `cause=${ev.cause}` : ev.event;
  const parts = [`[ssh-event] ${ev.kind} ${ev.host}${ev.username ? `@${ev.username}` : ""} ${tag}`];
  if (ev.lifetimeMs != null) parts.push(`life=${secs(ev.lifetimeMs)}`);
  if (ev.lastDataAgeMs != null) parts.push(`idle=${secs(ev.lastDataAgeMs)}`);
  if (ev.detail) parts.push(`— ${ev.detail.slice(0, 200)}`);
  // Faults to stderr (so they survive stdout filtering); wireproxy lifecycle to stdout.
  const line = parts.join(" ");
  if (ev.event === "disconnect") console.error(line);
  else console.log(line);
}

/** Most-recent events first — for the /ssh panel. In-memory, no DB round-trip. */
export function listRecentSshEvents(limit = 100): SshEvent[] {
  return ring.slice(-limit).reverse();
}

export async function flushSshEvents(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    const db = getDb();
    await db.insert(sshEvents).values(
      batch.map((e) => ({
        occurredAt: new Date(e.occurredAt),
        host: e.host,
        port: e.port ?? null,
        username: e.username ?? null,
        kind: e.kind,
        event: e.event,
        cause: e.cause ?? null,
        lifetimeMs: e.lifetimeMs ?? null,
        lastDataAgeMs: e.lastDataAgeMs ?? null,
        detail: e.detail ? e.detail.slice(0, 2000) : null,
      })),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ssh-event] flush failed (${batch.length} rows): ${message}`);
  }
}

export function startSshEventFlusher(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushSshEvents(); }, FLUSH_INTERVAL_MS);
  flushTimer.unref();
}

export async function stopSshEventFlusher(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushSshEvents();
}

export interface SshEventRow {
  occurredAt: string;
  host: string;
  port: number | null;
  username: string | null;
  kind: string;
  event: string;
  cause: string | null;
  lifetimeMs: number | null;
  lastDataAgeMs: number | null;
  detail: string | null;
}

export interface SshEventsReport {
  windowHours: number;
  host: string | null;
  totalEvents: number;
  disconnects: number;
  wireproxyEvents: number;
  byCause: { cause: string; count: number; avgLifeMs: number | null; avgIdleMs: number | null }[];
  byHostCause: { host: string; cause: string; count: number; lastAt: string }[];
  wireproxyLifecycle: { occurredAt: string; event: string; detail: string | null }[];
  hotWindows: { startMs: number; drops: number; wpEvents: string[] }[];
  unknownPct: number;
}

/** Build the structured "what's dropping and why" report consumed by the admin
 *  SSH Events panel. Same bucketing logic as scripts/ssh-events-report.ts, but
 *  callable from a WS handler. All times are returned as ISO strings (epoch ms
 *  only for the time-bucket key, which the renderer formats locally). */
export async function buildSshEventsReport(opts: { hours: number; host?: string | null }): Promise<SshEventsReport> {
  const hours = Math.max(1, Math.min(24 * 7, Math.floor(opts.hours))); // clamp to 1h..7d
  const host = opts.host?.trim() ? opts.host.trim() : null;
  const rows = await getSshEventHistory({ hours, limit: 5000, ...(host ? { host } : {}) });

  const disconnects = rows.filter((r) => r.event === "disconnect");
  const wpEvents = rows.filter((r) => r.event !== "disconnect");

  // By cause
  const causeMap = new Map<string, { count: number; lifeSum: number; lifeN: number; idleSum: number; idleN: number }>();
  for (const r of disconnects) {
    const c = r.cause ?? "unknown";
    const b = causeMap.get(c) ?? { count: 0, lifeSum: 0, lifeN: 0, idleSum: 0, idleN: 0 };
    b.count++;
    if (r.lifetimeMs != null) { b.lifeSum += r.lifetimeMs; b.lifeN++; }
    if (r.lastDataAgeMs != null) { b.idleSum += r.lastDataAgeMs; b.idleN++; }
    causeMap.set(c, b);
  }
  const byCause = [...causeMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([cause, b]) => ({
      cause,
      count: b.count,
      avgLifeMs: b.lifeN ? Math.round(b.lifeSum / b.lifeN) : null,
      avgIdleMs: b.idleN ? Math.round(b.idleSum / b.idleN) : null,
    }));

  // By host × cause (top 20)
  const hostCauseMap = new Map<string, { host: string; cause: string; count: number; lastAt: string }>();
  for (const r of disconnects) {
    const k = `${r.host}\t${r.cause ?? "unknown"}`;
    const b = hostCauseMap.get(k) ?? { host: r.host, cause: r.cause ?? "unknown", count: 0, lastAt: r.occurredAt };
    b.count++;
    if (r.occurredAt > b.lastAt) b.lastAt = r.occurredAt;
    hostCauseMap.set(k, b);
  }
  const byHostCause = [...hostCauseMap.values()].sort((a, b) => b.count - a.count).slice(0, 20);

  // Wireproxy lifecycle (most recent first, capped)
  const wireproxyLifecycle = wpEvents.slice(0, 30).map((r) => ({
    occurredAt: r.occurredAt,
    event: r.event,
    detail: r.detail,
  }));

  // Hot 5-min windows: cross-reference disconnect bursts with wireproxy events
  // landing in the same bucket. A drop wave that lines up against a
  // wireproxy-exit is the single most diagnostic thing we can show.
  const BUCKET_MS = 5 * 60_000;
  const buckets = new Map<number, { drops: number; wpEvents: string[] }>();
  for (const r of disconnects) {
    const k = Math.floor(new Date(r.occurredAt).getTime() / BUCKET_MS);
    const b = buckets.get(k) ?? { drops: 0, wpEvents: [] };
    b.drops++;
    buckets.set(k, b);
  }
  for (const r of wpEvents) {
    const k = Math.floor(new Date(r.occurredAt).getTime() / BUCKET_MS);
    const b = buckets.get(k) ?? { drops: 0, wpEvents: [] };
    b.wpEvents.push(r.event);
    buckets.set(k, b);
  }
  const hotWindows = [...buckets.entries()]
    .filter(([, v]) => v.drops >= 10)
    .sort((a, b) => b[1].drops - a[1].drops)
    .slice(0, 10)
    .map(([k, v]) => ({ startMs: k * BUCKET_MS, drops: v.drops, wpEvents: v.wpEvents }));

  const unknownCount = causeMap.get("unknown")?.count ?? 0;
  const unknownPct = disconnects.length > 0 ? Math.round((100 * unknownCount) / disconnects.length) : 0;

  return {
    windowHours: hours,
    host,
    totalEvents: rows.length,
    disconnects: disconnects.length,
    wireproxyEvents: wpEvents.length,
    byCause,
    byHostCause,
    wireproxyLifecycle,
    hotWindows,
    unknownPct,
  };
}

/** Post-mortem query: persisted events for a host (or all hosts) in the last
 *  `hours`, newest first. This is the "show every disconnect for host X in the
 *  last 24h" tool. */
export async function getSshEventHistory(opts: {
  host?: string;
  hours: number;
  limit?: number;
}): Promise<SshEventRow[]> {
  const since = new Date(Date.now() - opts.hours * 3_600_000);
  const db = getDb();
  const where = opts.host
    ? and(eq(sshEvents.host, opts.host), gte(sshEvents.occurredAt, since))
    : gte(sshEvents.occurredAt, since);
  const rows = await db
    .select()
    .from(sshEvents)
    .where(where)
    .orderBy(desc(sshEvents.occurredAt))
    .limit(opts.limit ?? 500);
  return rows.map((r) => ({
    occurredAt: r.occurredAt.toISOString(),
    host: r.host,
    port: r.port,
    username: r.username,
    kind: r.kind,
    event: r.event,
    cause: r.cause,
    lifetimeMs: r.lifetimeMs,
    lastDataAgeMs: r.lastDataAgeMs,
    detail: r.detail,
  }));
}
