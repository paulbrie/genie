import { desc, eq, and, gte, lte } from "drizzle-orm";
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
