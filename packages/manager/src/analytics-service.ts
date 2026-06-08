// Product-analytics event store + aggregation for the superadmin dashboard.
//
// Events are small, named, and metadata-only (see analytics_events in schema).
// Never store command text, file contents, or secrets in `props` — this table
// is for "what features get used / who's active", not forensics (that's
// audit_log).

import { and, desc, eq, gte, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { analyticsEvents, users } from "./db/schema.js";

/** Look up display names for a set of user ids in one query and return a
 *  map id → name. Used to repaint analytics rows whose stored `userName`
 *  is null (most terminal events don't capture it at emit time). */
async function resolveUserNames(userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return new Map();
  const db = getDb();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Pick the best label for an analytics row: current users.name → stored
 *  event userName → 'unknown'. Live users.name wins so the dashboard
 *  reflects renames immediately and isn't stuck on whatever was emitted at
 *  event time. */
function pickName(userId: string | null, stored: string | null, map: Map<string, string>): string {
  if (userId && map.has(userId)) return map.get(userId)!;
  return stored || "unknown";
}

const MAX_PROPS_BYTES = 4_000;

export interface AnalyticsEventInput {
  userId: string | null;
  userName: string | null;
  event: string;
  /** Project the event relates to, when applicable. Enables the dashboard's
   *  per-project filter. Null for account-level events. */
  projectId?: string | null;
  props?: Record<string, unknown> | null;
  ip?: string | null;
}

export interface AnalyticsFilters {
  userId?: string | null;
  projectId?: string | null;
}

/** Insert one event. Fire-and-forget: never throws into the caller (analytics
 *  must not break a real request). Oversized props are dropped, not stored. */
export async function recordEvent(e: AnalyticsEventInput): Promise<void> {
  try {
    const db = getDb();
    let props = e.props ?? null;
    if (props) {
      try {
        if (JSON.stringify(props).length > MAX_PROPS_BYTES) props = { _truncated: true };
      } catch {
        props = null;
      }
    }
    await db.insert(analyticsEvents).values({
      userId: e.userId,
      userName: e.userName,
      event: e.event,
      projectId: e.projectId ?? null,
      props: props as Record<string, unknown> | null,
      ip: e.ip ?? null,
    });
  } catch (err) {
    console.error("[analytics] failed to record event:", err instanceof Error ? err.message : String(err));
  }
}

export interface AnalyticsSummary {
  /** ISO range start (inclusive) the summary was computed over. */
  since: string;
  /** Distinct users with any event in range. */
  activeUsers: number;
  /** Per-event totals in range, most frequent first. */
  eventCounts: { event: string; count: number }[];
  /** Daily distinct-active-users + total event count (oldest → newest). */
  daily: { day: string; users: number; events: number }[];
  /** Onboarding funnel: distinct users who reached each step in range. */
  funnel: { loggedIn: number; openedTerminal: number; sentCommand: number };
  /** Most active users in range. */
  topUsers: { userId: string; name: string; count: number }[];
  /** Commands sent per user, split by terminal flavour (excludes silent
   *  programmatic injects). Top users by total, for the stacked bar chart. */
  commandsByUser: { userId: string; name: string; claude: number; terminal: number }[];
  /** Which tabs each user opened — a users×tabs matrix for the heatmap. Tab
   *  keys are bare nav keys (`projects`) plus namespaced `admin:*` / `manage:*`
   *  keys; columns are the most-used tabs, rows the most-active users. */
  tabAccess: {
    columns: string[];
    rows: { userId: string; name: string; counts: Record<string, number> }[];
  };
}

/** Shared WHERE: time range + optional user / project filters. */
function scopeWhere(from: Date, f: AnalyticsFilters, ...extra: (SQL | undefined)[]) {
  const c: SQL[] = [gte(analyticsEvents.createdAt, from)];
  if (f.userId) c.push(eq(analyticsEvents.userId, f.userId));
  if (f.projectId) c.push(eq(analyticsEvents.projectId, f.projectId));
  for (const e of extra) if (e) c.push(e);
  return and(...c);
}

async function distinctUsersForEvent(from: Date, f: AnalyticsFilters, event: string): Promise<number> {
  const db = getDb();
  const [r] = await db
    .select({ n: sql<number>`count(distinct ${analyticsEvents.userId})::int` })
    .from(analyticsEvents)
    .where(scopeWhere(from, f, eq(analyticsEvents.event, event)));
  return r?.n ?? 0;
}

/** Compute the dashboard summary over [from, now], optionally scoped to one user
 *  and/or project. */
export async function getAnalyticsSummary(from: Date, filters: AnalyticsFilters = {}): Promise<AnalyticsSummary> {
  const db = getDb();

  const [active] = await db
    .select({ n: sql<number>`count(distinct ${analyticsEvents.userId})::int` })
    .from(analyticsEvents)
    .where(scopeWhere(from, filters));

  const eventCounts = await db
    .select({ event: analyticsEvents.event, count: sql<number>`count(*)::int` })
    .from(analyticsEvents)
    .where(scopeWhere(from, filters))
    .groupBy(analyticsEvents.event)
    .orderBy(desc(sql`count(*)`));

  const daySql = sql<string>`to_char(date_trunc('day', ${analyticsEvents.createdAt}), 'YYYY-MM-DD')`;
  const daily = await db
    .select({
      day: daySql,
      users: sql<number>`count(distinct ${analyticsEvents.userId})::int`,
      events: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .where(scopeWhere(from, filters))
    .groupBy(daySql)
    .orderBy(daySql);

  const topUsersRaw = await db
    .select({
      userId: analyticsEvents.userId,
      storedName: sql<string | null>`max(${analyticsEvents.userName})`,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .where(scopeWhere(from, filters, isNotNull(analyticsEvents.userId)))
    .groupBy(analyticsEvents.userId)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const [loggedIn, openedTerminal, sentCommand] = await Promise.all([
    distinctUsersForEvent(from, filters, "auth.login"),
    distinctUsersForEvent(from, filters, "terminal.open"),
    distinctUsersForEvent(from, filters, "terminal.command_sent"),
  ]);

  // Commands sent per user, split Claude vs normal terminal. Silent injects
  // (tmux-attach automation) are excluded so the numbers reflect real usage.
  const commandsRaw = await db
    .select({
      userId: analyticsEvents.userId,
      storedName: sql<string | null>`max(${analyticsEvents.userName})`,
      claude: sql<number>`(count(*) filter (where ${analyticsEvents.props}->>'kind' = 'claude'))::int`,
      terminal: sql<number>`(count(*) filter (where coalesce(${analyticsEvents.props}->>'kind', 'shell') <> 'claude'))::int`,
    })
    .from(analyticsEvents)
    .where(scopeWhere(from, filters,
      eq(analyticsEvents.event, "terminal.command_sent"),
      isNotNull(analyticsEvents.userId),
      sql`coalesce(${analyticsEvents.props}->>'silent', '') <> 'true'`,
    ))
    .groupBy(analyticsEvents.userId)
    .orderBy(desc(sql`count(*)`))
    .limit(12);

  const tabAccess = await getTabAccess(from, filters);

  // Repaint userIds with live names — every aggregation above stored
  // userName as null for terminal/inject events, so the dashboard would
  // otherwise show every bar as "unknown".
  const nameMap = await resolveUserNames([
    ...topUsersRaw.map((u) => u.userId),
    ...commandsRaw.map((u) => u.userId),
  ]);
  const commandsByUser = commandsRaw.map((u) => ({
    userId: u.userId ?? "",
    name: pickName(u.userId, u.storedName, nameMap),
    claude: u.claude,
    terminal: u.terminal,
  }));

  return {
    since: from.toISOString(),
    activeUsers: active?.n ?? 0,
    eventCounts,
    daily,
    funnel: { loggedIn, openedTerminal, sentCommand },
    topUsers: topUsersRaw.map((u) => ({
      userId: u.userId ?? "",
      name: pickName(u.userId, u.storedName, nameMap),
      count: u.count,
    })),
    commandsByUser,
    tabAccess,
  };
}

/** Per-user tab-access matrix, merging main-nav `nav.view` events with the
 *  namespaced `tab.view` events emitted for Admin and Manage-popup sub-tabs. */
async function getTabAccess(
  from: Date,
  filters: AnalyticsFilters,
): Promise<AnalyticsSummary["tabAccess"]> {
  const db = getDb();
  const MAX_COLUMNS = 16;
  const MAX_ROWS = 15;

  const navKey = sql<string>`${analyticsEvents.props}->>'nav'`;
  const navRows = await db
    .select({
      userId: analyticsEvents.userId,
      storedName: sql<string | null>`max(${analyticsEvents.userName})`,
      tab: navKey,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .where(scopeWhere(from, filters,
      eq(analyticsEvents.event, "nav.view"),
      isNotNull(analyticsEvents.userId),
      sql`${analyticsEvents.props}->>'nav' is not null`,
    ))
    .groupBy(analyticsEvents.userId, navKey);

  const scopeKey = sql<string>`${analyticsEvents.props}->>'scope'`;
  const tabKey = sql<string>`${analyticsEvents.props}->>'tab'`;
  const tabRows = await db
    .select({
      userId: analyticsEvents.userId,
      storedName: sql<string | null>`max(${analyticsEvents.userName})`,
      scope: scopeKey,
      tab: tabKey,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .where(scopeWhere(from, filters,
      eq(analyticsEvents.event, "tab.view"),
      isNotNull(analyticsEvents.userId),
      sql`${analyticsEvents.props}->>'tab' is not null`,
    ))
    .groupBy(analyticsEvents.userId, scopeKey, tabKey);

  const nameMap = await resolveUserNames([
    ...navRows.map((r) => r.userId),
    ...tabRows.map((r) => r.userId),
  ]);

  // Flatten both sources into (user, tabKey, count) cells with a unified key.
  type Cell = { userId: string; name: string; key: string; count: number };
  const cells: Cell[] = [];
  for (const r of navRows) {
    if (r.userId && r.tab) cells.push({ userId: r.userId, name: pickName(r.userId, r.storedName, nameMap), key: r.tab, count: r.count });
  }
  for (const r of tabRows) {
    if (r.userId && r.tab) cells.push({ userId: r.userId, name: pickName(r.userId, r.storedName, nameMap), key: `${r.scope ?? "tab"}:${r.tab}`, count: r.count });
  }

  // Most-used tabs become the columns (capped).
  const colTotals = new Map<string, number>();
  for (const c of cells) colTotals.set(c.key, (colTotals.get(c.key) ?? 0) + c.count);
  const columns = [...colTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_COLUMNS)
    .map(([k]) => k);
  const colSet = new Set(columns);

  // Most-active users (over the kept columns) become the rows (capped).
  const userMap = new Map<string, { userId: string; name: string; total: number; counts: Record<string, number> }>();
  for (const c of cells) {
    if (!colSet.has(c.key)) continue;
    let u = userMap.get(c.userId);
    if (!u) { u = { userId: c.userId, name: c.name, total: 0, counts: {} }; userMap.set(c.userId, u); }
    u.counts[c.key] = (u.counts[c.key] ?? 0) + c.count;
    u.total += c.count;
  }
  const rows = [...userMap.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_ROWS)
    .map(({ userId, name, counts }) => ({ userId, name, counts }));

  return { columns, rows };
}

/** Delete events older than `days`. Called on boot to bound table growth. */
export async function pruneOldEvents(days: number): Promise<void> {
  try {
    const db = getDb();
    await db.execute(sql`DELETE FROM analytics_events WHERE created_at < now() - make_interval(days => ${days})`);
  } catch (err) {
    console.error("[analytics] prune failed:", err instanceof Error ? err.message : String(err));
  }
}
