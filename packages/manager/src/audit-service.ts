import { desc, eq, and, gte, lte, sql } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { auditLog } from "./db/schema.js";

/** Message types to skip logging (high-frequency or noisy) */
const SKIP_TYPES = new Set([
  "ping",
  "pong",
  "stats",
]);

export async function logAction(
  userId: string | null,
  userName: string | null,
  action: string,
  payload?: unknown,
  ip?: string,
): Promise<void> {
  if (SKIP_TYPES.has(action)) return;

  try {
    const db = getDb();
    await db.insert(auditLog).values({
      userId,
      userName,
      action,
      payload: payload as Record<string, unknown>,
      ip,
    });
  } catch (err) {
    console.error("[audit] Failed to log action:", err instanceof Error ? err.message : String(err));
  }
}

export async function getAuditLogs(opts: {
  userId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const conditions = [];

  if (opts.userId) conditions.push(eq(auditLog.userId, opts.userId));
  if (opts.action) conditions.push(eq(auditLog.action, opts.action));
  if (opts.from) conditions.push(gte(auditLog.createdAt, opts.from));
  if (opts.to) conditions.push(lte(auditLog.createdAt, opts.to));

  const query = db
    .select()
    .from(auditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);

  return query;
}

/** Delete audit rows older than `days`. audit_log grows on every WS action with
 *  no bound (2.5 GB / 1.5M rows observed), so a janitor trims it like the
 *  analytics/session prune jobs. Deletes in batches so the first run (which may
 *  drop >1M rows) doesn't hold one long transaction / WAL spike on the manager.
 *  Returns the total rows deleted. */
export async function pruneOldAuditLogs(days: number, batchSize = 10_000): Promise<number> {
  const db = getDb();
  let total = 0;
  try {
    // Loop until a batch deletes fewer than batchSize rows (i.e. we're done).
    for (;;) {
      const res = await db.execute(sql`
        DELETE FROM audit_log
        WHERE ctid IN (
          SELECT ctid FROM audit_log
          WHERE created_at < now() - make_interval(days => ${days})
          LIMIT ${batchSize}
        )
      `);
      const n = (res as unknown as { count?: number }).count ?? 0;
      total += n;
      if (n < batchSize) break;
    }
  } catch (err) {
    console.error("[audit] prune failed:", err instanceof Error ? err.message : String(err));
  }
  return total;
}
