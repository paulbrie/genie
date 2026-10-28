// genie-local user activity: validation + storage for POST /api/vps/activity
// (shipped by the on-VM genie-stats daemon from genie-local's spool) and the
// superadmin summary behind admin:vps-activity:summary.
//
// The wire format is a contract shared with genie-local's writer and the daemon:
//   {"v":1,"id":"<uuid>","ts":<epoch ms>,"event":"page.view",
//    "session":"<32 hex>|null","ipHash":"<16 hex>|null","ua":"<≤60 chars>|null",
//    "props":{…≤12 keys, string ≤200 / number / boolean / null…}}
// Events outside the allowlist or with a bad shape are rejected (counted, logged
// throttled, never stored); the daemon doesn't retry them. Props are reduced
// to the keys the contract defines for each event, so nothing else (contents,
// query strings, …) can end up in the table even if a writer sends it.

import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { vpsActivityEvents } from "../db/schema.js";

type PropKind = "string" | "number" | "boolean";

/** Allowlist: event → the props it may carry (and their types). */
const EVENT_PROPS: Record<string, Record<string, PropKind>> = {
  "page.view": { path: "string", project: "string" },
  action: { name: "string", project: "string", ok: "boolean" },
  "terminal.attach": { terminal: "string" },
  "terminal.detach": { terminal: "string", seconds: "number" },
  "auth.login": {},
  "auth.logout": {},
  "auth.failed": { reason: "string" },
};

export const VPS_ACTIVITY_EVENTS = Object.keys(EVENT_PROPS);
export const MAX_ACTIVITY_BATCH = 500;
const MAX_PROP_KEYS = 12;
const MAX_PROP_STRING = 200;
const MAX_UA = 60;
/** Clock-skew allowance for event timestamps from the VM. */
const MAX_FUTURE_MS = 24 * 60 * 60_000;
/** Nothing genie-local writes predates this. */
const MIN_TS = Date.UTC(2024, 0, 1);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_RE = /^[0-9a-f]{32}$/i;
const IP_HASH_RE = /^[0-9a-f]{16}$/i;

export interface VpsActivityRow {
  id: string;
  sessionId: string | null;
  ipHash: string | null;
  ua: string | null;
  event: string;
  props: Record<string, string | number | boolean | null>;
  occurredAt: Date;
}

export type ActivityValidation = { ok: true; row: VpsActivityRow } | { ok: false; reason: string };

function nullableMatch(v: unknown, re: RegExp): v is string | null | undefined {
  return v === null || v === undefined || (typeof v === "string" && re.test(v));
}

/** Validate one spool line (already JSON-parsed) against the contract. Pure. */
export function validateActivityEvent(raw: unknown, nowMs = Date.now()): ActivityValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not an object" };
  const e = raw as Record<string, unknown>;
  if (e.v !== 1) return { ok: false, reason: "bad version" };
  if (typeof e.id !== "string" || !UUID_RE.test(e.id)) return { ok: false, reason: "bad id" };
  if (typeof e.event !== "string" || !(e.event in EVENT_PROPS)) return { ok: false, reason: "unknown event" };
  if (typeof e.ts !== "number" || !Number.isFinite(e.ts) || e.ts < MIN_TS || e.ts > nowMs + MAX_FUTURE_MS) {
    return { ok: false, reason: "bad ts" };
  }
  if (!nullableMatch(e.session, SESSION_RE)) return { ok: false, reason: "bad session" };
  if (!nullableMatch(e.ipHash, IP_HASH_RE)) return { ok: false, reason: "bad ipHash" };
  if (!(e.ua === null || e.ua === undefined || (typeof e.ua === "string" && e.ua.length <= MAX_UA))) {
    return { ok: false, reason: "bad ua" };
  }

  // Generic props rules first (the contract's), then reduce to this event's keys.
  let rawProps: Record<string, unknown> = {};
  if (e.props !== null && e.props !== undefined) {
    if (typeof e.props !== "object" || Array.isArray(e.props)) return { ok: false, reason: "bad props" };
    rawProps = e.props as Record<string, unknown>;
  }
  const entries = Object.entries(rawProps);
  if (entries.length > MAX_PROP_KEYS) return { ok: false, reason: "too many props" };
  for (const [, v] of entries) {
    if (v === null || typeof v === "boolean") continue;
    if (typeof v === "number" && Number.isFinite(v)) continue;
    if (typeof v === "string" && v.length <= MAX_PROP_STRING) continue;
    return { ok: false, reason: "bad prop value" };
  }
  const allowed = EVENT_PROPS[e.event];
  const props: VpsActivityRow["props"] = {};
  for (const [k, v] of entries) {
    const kind = allowed[k];
    if (!kind) continue; // not part of the contract for this event: never stored
    if (v !== null && typeof v !== kind) return { ok: false, reason: `bad prop ${k}` };
    props[k] = v as string | number | boolean | null;
  }
  // A route pattern, never a concrete URL with a query string or fragment.
  if (typeof props.path === "string" && (!props.path.startsWith("/") || /[?#]/.test(props.path))) {
    return { ok: false, reason: "bad path" };
  }
  if (typeof props.seconds === "number" && props.seconds < 0) return { ok: false, reason: "bad seconds" };

  return {
    ok: true,
    row: {
      id: e.id.toLowerCase(),
      sessionId: (e.session as string | null | undefined) ?? null,
      ipHash: (e.ipHash as string | null | undefined) ?? null,
      ua: (e.ua as string | null | undefined) ?? null,
      event: e.event,
      props,
      occurredAt: new Date(e.ts),
    },
  };
}

export interface ActivityIngestResult {
  accepted: number;
  duplicates: number;
  rejected: number;
  /** Rejection reason → count, for the manager's (throttled) log line. */
  reasons: Record<string, number>;
}

/** Validate a batch and insert the valid events, ignoring ids already stored. */
export async function ingestActivityBatch(
  projectId: string,
  instanceId: string,
  events: unknown[],
  nowMs = Date.now(),
): Promise<ActivityIngestResult> {
  const rows: (typeof vpsActivityEvents.$inferInsert)[] = [];
  const reasons: Record<string, number> = {};
  let rejected = 0;
  for (const raw of events) {
    const v = validateActivityEvent(raw, nowMs);
    if (!v.ok) {
      rejected++;
      reasons[v.reason] = (reasons[v.reason] ?? 0) + 1;
      continue;
    }
    rows.push({ ...v.row, projectId, instanceId });
  }
  let accepted = 0;
  if (rows.length > 0) {
    const inserted = await getDb()
      .insert(vpsActivityEvents)
      .values(rows)
      .onConflictDoNothing({ target: vpsActivityEvents.id })
      .returning({ id: vpsActivityEvents.id });
    accepted = inserted.length;
  }
  return { accepted, duplicates: rows.length - accepted, rejected, reasons };
}

/** Delete events older than `days` in batches (keeps each DELETE short);
 *  returns how many went. */
export async function pruneOldActivity(days: number, batchSize = 10_000): Promise<number> {
  const db = getDb();
  let total = 0;
  for (;;) {
    const res = await db.execute(sql`
      DELETE FROM vps_activity_events
      WHERE ctid IN (
        SELECT ctid FROM vps_activity_events
        WHERE occurred_at < now() - make_interval(days => ${days})
        LIMIT ${batchSize}
      )
    `);
    const n = (res as unknown as { count?: number }).count ?? 0;
    total += n;
    if (n < batchSize) break;
  }
  return total;
}

// ── Summary (superadmin dashboard) ─────────────────────────────────────────

export interface VpsActivityFilters {
  projectId?: string | null;
  instanceId?: string | null;
}

export interface VpsActivitySummary {
  since: string;
  totals: {
    events: number;
    sessions: number;
    activeSessions15m: number;
    activeSessionsToday: number;
    terminalSeconds: number;
  };
  /** Per project/instance, most events first. */
  instances: {
    projectId: string;
    projectName: string;
    instanceId: string;
    instanceLabel: string | null;
    events: number;
    sessions: number;
    activeSessions15m: number;
    activeSessionsToday: number;
    terminalSeconds: number;
    lastEventAt: string | null;
  }[];
  /** Oldest → newest. */
  daily: { day: string; events: number; sessions: number }[];
  eventCounts: { event: string; count: number }[];
  topPages: { path: string; count: number; sessions: number }[];
  topActions: { name: string; count: number; failed: number }[];
  terminals: { terminal: string; attaches: number; seconds: number }[];
  recent: {
    id: string;
    projectId: string;
    instanceId: string;
    event: string;
    sessionId: string | null;
    ua: string | null;
    props: Record<string, unknown>;
    occurredAt: string;
  }[];
}

const TERMINAL_SECONDS = sql.raw(
  `coalesce(sum(case when event = 'terminal.detach' and jsonb_typeof(props->'seconds') = 'number' then (props->>'seconds')::float8 else 0 end), 0)::float8`,
);
const ACTIVE_15M = sql.raw(`count(distinct session_id) filter (where occurred_at >= now() - interval '15 minutes')::int`);
const ACTIVE_TODAY = sql.raw(`count(distinct session_id) filter (where occurred_at >= date_trunc('day', now()))::int`);

function where(from: Date, f: VpsActivityFilters, extra?: string): SQL {
  const parts: SQL[] = [sql`occurred_at >= ${from.toISOString()}::timestamptz`];
  if (f.projectId) parts.push(sql`project_id = ${f.projectId}`);
  if (f.instanceId) parts.push(sql`instance_id = ${f.instanceId}`);
  if (extra) parts.push(sql.raw(extra));
  return sql.join(parts, sql` AND `);
}

async function rows<T>(q: SQL): Promise<T[]> {
  return (await getDb().execute(q)) as unknown as T[];
}

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : d ? new Date(String(d)).toISOString() : null);

/** Compute the dashboard summary over [from, now], optionally scoped to one
 *  project and/or instance. "Active" counts distinct genie-local sessions. */
export async function getActivitySummary(from: Date, filters: VpsActivityFilters = {}): Promise<VpsActivitySummary> {
  const w = where(from, filters);
  const [
    [totals],
    instRows,
    daily,
    eventCounts,
    topPages,
    topActions,
    terminals,
    recent,
  ] = await Promise.all([
    rows<VpsActivitySummary["totals"]>(sql`
      SELECT count(*)::int AS events, count(distinct session_id)::int AS sessions,
        ${ACTIVE_15M} AS "activeSessions15m", ${ACTIVE_TODAY} AS "activeSessionsToday",
        ${TERMINAL_SECONDS} AS "terminalSeconds"
      FROM vps_activity_events WHERE ${w}`),
    rows<{
      projectId: string; projectName: string | null; vps: unknown; instanceId: string; events: number; sessions: number;
      activeSessions15m: number; activeSessionsToday: number; terminalSeconds: number; lastEventAt: unknown;
    }>(sql`
      SELECT a.*, p.name AS "projectName", p.vps AS vps FROM (
        SELECT project_id AS "projectId", instance_id AS "instanceId", count(*)::int AS events,
          count(distinct session_id)::int AS sessions,
          ${ACTIVE_15M} AS "activeSessions15m", ${ACTIVE_TODAY} AS "activeSessionsToday",
          ${TERMINAL_SECONDS} AS "terminalSeconds", max(occurred_at) AS "lastEventAt"
        FROM vps_activity_events WHERE ${w}
        GROUP BY 1, 2
      ) a LEFT JOIN projects p ON p.id = a."projectId"
      ORDER BY a.events DESC LIMIT 100`),
    rows<VpsActivitySummary["daily"][number]>(sql`
      SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*)::int AS events,
        count(distinct session_id)::int AS sessions
      FROM vps_activity_events WHERE ${w} GROUP BY 1 ORDER BY 1`),
    rows<VpsActivitySummary["eventCounts"][number]>(sql`
      SELECT event, count(*)::int AS count FROM vps_activity_events WHERE ${w}
      GROUP BY 1 ORDER BY 2 DESC, 1`),
    rows<VpsActivitySummary["topPages"][number]>(sql`
      SELECT props->>'path' AS path, count(*)::int AS count, count(distinct session_id)::int AS sessions
      FROM vps_activity_events WHERE ${where(from, filters, `event = 'page.view' AND props->>'path' IS NOT NULL`)}
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 15`),
    rows<VpsActivitySummary["topActions"][number]>(sql`
      SELECT props->>'name' AS name, count(*)::int AS count,
        (count(*) filter (where props->>'ok' = 'false'))::int AS failed
      FROM vps_activity_events WHERE ${where(from, filters, `event = 'action' AND props->>'name' IS NOT NULL`)}
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 15`),
    rows<VpsActivitySummary["terminals"][number]>(sql`
      SELECT props->>'terminal' AS terminal,
        (count(*) filter (where event = 'terminal.attach'))::int AS attaches,
        ${TERMINAL_SECONDS} AS seconds
      FROM vps_activity_events
      WHERE ${where(from, filters, `event IN ('terminal.attach', 'terminal.detach') AND props->>'terminal' IS NOT NULL`)}
      GROUP BY 1 ORDER BY 3 DESC, 2 DESC, 1 LIMIT 15`),
    rows<{
      id: string; projectId: string; instanceId: string; event: string; sessionId: string | null;
      ua: string | null; props: Record<string, unknown>; occurredAt: unknown;
    }>(sql`
      SELECT id, project_id AS "projectId", instance_id AS "instanceId", event, session_id AS "sessionId",
        ua, props, occurred_at AS "occurredAt"
      FROM vps_activity_events WHERE ${w} ORDER BY occurred_at DESC LIMIT 50`),
  ]);

  return {
    since: from.toISOString(),
    totals: totals ?? { events: 0, sessions: 0, activeSessions15m: 0, activeSessionsToday: 0, terminalSeconds: 0 },
    instances: instRows.map(({ vps, lastEventAt, projectName, ...r }) => ({
      ...r,
      projectName: projectName ?? r.projectId,
      instanceLabel: instanceLabel(vps, r.instanceId),
      lastEventAt: iso(lastEventAt),
    })),
    daily: zeroFillDays(from, daily),
    eventCounts,
    topPages,
    topActions,
    terminals,
    recent: recent.map((r) => ({ ...r, occurredAt: iso(r.occurredAt) ?? "" })),
  };
}

/** One entry per UTC day from `from` to today, so the chart is continuous. */
function zeroFillDays(from: Date, daily: VpsActivitySummary["daily"]): VpsActivitySummary["daily"] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const out: VpsActivitySummary["daily"] = [];
  const end = new Date().toISOString().slice(0, 10);
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); ; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, events: 0, sessions: 0 });
    if (day >= end) break;
  }
  return out;
}

/** The instance's label from projects.vps (VpsInstance[]), when it has one. */
function instanceLabel(vps: unknown, instanceId: string): string | null {
  if (!Array.isArray(vps)) return null;
  const inst = vps.find((v) => v && typeof v === "object" && (v as { id?: unknown }).id === instanceId) as
    | { label?: unknown }
    | undefined;
  return typeof inst?.label === "string" ? inst.label : null;
}
