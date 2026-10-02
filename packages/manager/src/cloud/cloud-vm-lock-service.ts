import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { cloudVmLocks } from "../db/schema.js";

export type CloudProvider = "digitalocean" | "tazcloud" | "hetzner";

/** Mark a VM as locked. Idempotent — calling twice does not duplicate rows. */
export async function setLock(provider: CloudProvider, vmId: string, lockedBy: string | null): Promise<void> {
  const db = getDb();
  const existing = await db.select({ id: cloudVmLocks.id })
    .from(cloudVmLocks)
    .where(and(eq(cloudVmLocks.provider, provider), eq(cloudVmLocks.vmId, vmId)))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(cloudVmLocks).values({ provider, vmId, lockedBy });
}

/** Remove the lock. Safe to call on an unlocked VM. */
export async function clearLock(provider: CloudProvider, vmId: string): Promise<void> {
  const db = getDb();
  await db.delete(cloudVmLocks)
    .where(and(eq(cloudVmLocks.provider, provider), eq(cloudVmLocks.vmId, vmId)));
}

/** True iff the VM has a lock row. */
export async function isLocked(provider: CloudProvider, vmId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.select({ id: cloudVmLocks.id })
    .from(cloudVmLocks)
    .where(and(eq(cloudVmLocks.provider, provider), eq(cloudVmLocks.vmId, vmId)))
    .limit(1);
  return rows.length > 0;
}

/** Bulk lookup → returns a Set of vmIds that are currently locked. Empty input → empty set. */
export async function getLockedSet(provider: CloudProvider, vmIds: string[]): Promise<Set<string>> {
  if (vmIds.length === 0) return new Set();
  const db = getDb();
  const rows = await db.select({ vmId: cloudVmLocks.vmId })
    .from(cloudVmLocks)
    .where(and(eq(cloudVmLocks.provider, provider), inArray(cloudVmLocks.vmId, vmIds)));
  return new Set(rows.map((r) => r.vmId));
}
