// Product-analytics event store + aggregation for the superadmin dashboard.
//
// Events are small, named, and metadata-only (see analytics_events in schema).
// Never store command text, file contents, or secrets in `props` — this table
// is for "what features get used / who's active", not forensics (that's
// audit_log).

import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { analyticsEvents } from "./db/schema.js";

const MAX_PROPS_BYTES = 4_000;

export interface AnalyticsEventInput {
  userId: string | null;
  userName: string | null;
  event: string;
  props?: Record<string, unknown> | null;
  ip?: string | null;
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
}

async function distinctUsersForEvent(from: Date, event: string): Promise<number> {
  const db = getDb();
  const [r] = await db
    .select({ n: sql<number>`count(distinct ${analyticsEvents.userId})::int` })
    .from(analyticsEvents)
    .where(and(gte(analyticsEvents.createdAt, from), eq(analyticsEvents.event, event)));
  return r?.n ?? 0;
}

/** Compute the dashboard summary over [from, now]. */
export async function getAnalyticsSummary(from: Date): Promise<AnalyticsSummary> {
  const db = getDb();

  const [active] = await db
    .select({ n: sql<number>`count(distinct ${analyticsEvents.userId})::int` })
    .from(analyticsEvents)
    .where(gte(analyticsEvents.createdAt, from));

  const eventCounts = await db
    .select({ event: analyticsEvents.event, count: sql<number>`count(*)::int` })
    .from(analyticsEvents)
    .where(gte(analyticsEvents.createdAt, from))
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
    .where(gte(analyticsEvents.createdAt, from))
    .groupBy(daySql)
    .orderBy(daySql);

  const topUsers = await db
    .select({
      userId: analyticsEvents.userId,
      name: sql<string>`coalesce(max(${analyticsEvents.userName}), 'unknown')`,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .where(and(gte(analyticsEvents.createdAt, from), isNotNull(analyticsEvents.userId)))
    .groupBy(analyticsEvents.userId)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const [loggedIn, openedTerminal, sentCommand] = await Promise.all([
    distinctUsersForEvent(from, "auth.login"),
    distinctUsersForEvent(from, "terminal.open"),
    distinctUsersForEvent(from, "terminal.command_sent"),
  ]);

  return {
    since: from.toISOString(),
    activeUsers: active?.n ?? 0,
    eventCounts,
    daily,
    funnel: { loggedIn, openedTerminal, sentCommand },
    topUsers: topUsers.map((u) => ({ userId: u.userId ?? "", name: u.name, count: u.count })),
  };
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
