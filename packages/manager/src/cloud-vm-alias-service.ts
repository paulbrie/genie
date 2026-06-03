import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { cloudVmAliases } from "./db/schema.js";

export type CloudProvider = "digitalocean" | "tazcloud" | "hetzner";

/** Set or update a Genie-side display name for a cloud VM. Trimmed name is stored. */
export async function setAlias(provider: CloudProvider, vmId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("name is required");
  const db = getDb();
  const existing = await db.select({ id: cloudVmAliases.id })
    .from(cloudVmAliases)
    .where(and(eq(cloudVmAliases.provider, provider), eq(cloudVmAliases.vmId, vmId)))
    .limit(1);
  if (existing.length > 0) {
    await db.update(cloudVmAliases)
      .set({ name: trimmed, updatedAt: new Date() })
      .where(eq(cloudVmAliases.id, existing[0].id));
  } else {
    await db.insert(cloudVmAliases).values({ provider, vmId, name: trimmed });
  }
}

/** Drop the alias for one VM (used on VM delete). Safe if it doesn't exist. */
export async function clearAlias(provider: CloudProvider, vmId: string): Promise<void> {
  const db = getDb();
  await db.delete(cloudVmAliases)
    .where(and(eq(cloudVmAliases.provider, provider), eq(cloudVmAliases.vmId, vmId)));
}

/** Bulk lookup → returns `{ vmId: name }` for the requested ids. Empty input → empty map. */
export async function getAliasMap(provider: CloudProvider, vmIds: string[]): Promise<Map<string, string>> {
  if (vmIds.length === 0) return new Map();
  const db = getDb();
  const rows = await db.select({ vmId: cloudVmAliases.vmId, name: cloudVmAliases.name })
    .from(cloudVmAliases)
    .where(and(eq(cloudVmAliases.provider, provider), inArray(cloudVmAliases.vmId, vmIds)));
  return new Map(rows.map((r) => [r.vmId, r.name]));
}
