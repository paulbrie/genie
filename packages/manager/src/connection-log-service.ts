import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { connectionLog } from "./db/schema.js";

export interface DisconnectRecord {
  userId: string | null;
  userName: string | null;
  clientType: string | null;
  ip: string | null;
  userAgent: string | null;
  railwayRequestId: string | null;
  connectedAt: Date;
  closedAt: Date;
  durationSec: number | null;
  closeCode: number | null;
  closeDescription: string | null;
  closeHint: string | null;
  closeReason: string | null;
  aliveLastPing: boolean | null;
}

/** Fire-and-forget: one INSERT per WebSocket close. Errors are swallowed (the
 *  [ws-close] log line still prints to stdout, so we don't lose forensics if
 *  the DB is temporarily unreachable). Mirrors auditService.logAction. */
export async function recordDisconnect(r: DisconnectRecord): Promise<void> {
  try {
    const db = getDb();
    await db.insert(connectionLog).values(r);
  } catch (err) {
    console.error("[connection-log] insert failed:", err instanceof Error ? err.message : String(err));
  }
}

export async function getConnectionLogs(opts: {
  userId?: string;
  closeCode?: number;
  railwayRequestId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const conditions = [];
  if (opts.userId) conditions.push(eq(connectionLog.userId, opts.userId));
  if (opts.closeCode !== undefined) conditions.push(eq(connectionLog.closeCode, opts.closeCode));
  if (opts.railwayRequestId) conditions.push(eq(connectionLog.railwayRequestId, opts.railwayRequestId));
  if (opts.from) conditions.push(gte(connectionLog.closedAt, opts.from));
  if (opts.to) conditions.push(lte(connectionLog.closedAt, opts.to));
  return db.select()
    .from(connectionLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(connectionLog.closedAt))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
}

/** Delete rows older than `days`, batched so a large first-run prune doesn't
 *  hold one long transaction. Mirrors pruneOldAuditLogs. */
export async function pruneOldConnectionLogs(days: number, batchSize = 10_000): Promise<number> {
  const db = getDb();
  let total = 0;
  try {
    for (;;) {
      const res = await db.execute(sql`
        DELETE FROM connection_log
        WHERE ctid IN (
          SELECT ctid FROM connection_log
          WHERE closed_at < now() - make_interval(days => ${days})
          LIMIT ${batchSize}
        )
      `);
      const n = (res as unknown as { count?: number }).count ?? 0;
      total += n;
      if (n < batchSize) break;
    }
  } catch (err) {
    console.error("[connection-log] prune failed:", err instanceof Error ? err.message : String(err));
  }
  return total;
}
