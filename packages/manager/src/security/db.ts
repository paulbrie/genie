import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { securityScans } from "../db/schema.js";
import type { SecurityScan } from "./types.js";

/** Upsert a scan into the `security_scans` table. The DB layer maps "running"
 *  → "stopping" so the persisted status is always terminal — incomplete scans
 *  shouldn't survive a restart. */
export async function saveScan(userId: string, scan: SecurityScan): Promise<void> {
  const db = getDb();
  await db.insert(securityScans).values({
    id: scan.id,
    userId,
    target: scan.target,
    status: scan.status === "completed" ? "completed" : scan.status === "error" ? "error" : "stopping",
    startedAt: new Date(scan.startedAt),
    completedAt: scan.completedAt ? new Date(scan.completedAt) : null,
    ports: scan.ports as unknown as Record<string, unknown>[],
    findings: scan.findings as unknown as Record<string, unknown>[],
    operations: scan.operations as unknown as Record<string, unknown>[],
    error: scan.error || null,
  }).onConflictDoUpdate({
    target: securityScans.id,
    set: {
      status: scan.status === "completed" ? "completed" : scan.status === "error" ? "error" : "stopping",
      completedAt: scan.completedAt ? new Date(scan.completedAt) : null,
      ports: scan.ports as unknown as Record<string, unknown>[],
      findings: scan.findings as unknown as Record<string, unknown>[],
      operations: scan.operations as unknown as Record<string, unknown>[],
      error: scan.error || null,
    },
  });
}

/** Most recent `limit` scans for a user, newest first. */
export async function listScans(userId: string, limit = 50): Promise<SecurityScan[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(securityScans)
    .where(eq(securityScans.userId, userId))
    .orderBy(desc(securityScans.startedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    target: r.target,
    status: r.status as SecurityScan["status"],
    startedAt: r.startedAt.getTime(),
    completedAt: r.completedAt?.getTime(),
    progress: 100,
    phase: r.status === "completed" ? "Complete" : r.status === "error" ? "Error" : "Stopped",
    ports: (r.ports ?? []) as unknown as SecurityScan["ports"],
    findings: (r.findings ?? []) as unknown as SecurityScan["findings"],
    operations: (r.operations ?? []) as unknown as SecurityScan["operations"],
    error: r.error ?? undefined,
  }));
}

export async function deleteScan(scanId: string): Promise<void> {
  const db = getDb();
  await db.delete(securityScans).where(eq(securityScans.id, scanId));
}
