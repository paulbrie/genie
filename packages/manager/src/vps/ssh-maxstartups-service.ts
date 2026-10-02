import { desc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { sshMaxStartupsEvents, projects } from "../db/schema.js";

export interface SshMaxStartupsEvent {
  projectId: string;
  projectName: string | null;
  instanceId: string;
  occurredAt: string; // ISO
  drops: number;
  maxStartups: string | null;
}

/** Record a drop event (drops > 0). Best-effort and decoupled from the hot
 *  metrics insert — a DB hiccup here must never break stats ingestion. */
export async function recordSshMaxStartupsEvent(ev: {
  projectId: string;
  instanceId: string;
  occurredAt: Date;
  drops: number;
  maxStartups: string | null;
}): Promise<void> {
  try {
    await getDb().insert(sshMaxStartupsEvents).values({
      projectId: ev.projectId,
      instanceId: ev.instanceId,
      occurredAt: ev.occurredAt,
      drops: ev.drops,
      maxStartups: ev.maxStartups,
    });
  } catch (err) {
    console.error(`[ssh-maxstartups] record failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Fleet-wide drop events in the last `hours`, newest first, capped. Powers the
 *  superadmin "MaxStartups drops" panel. */
export async function listSshMaxStartupsEvents(hours: number, limit = 1000): Promise<SshMaxStartupsEvent[]> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await getDb()
    .select({
      projectId: sshMaxStartupsEvents.projectId,
      projectName: projects.name,
      instanceId: sshMaxStartupsEvents.instanceId,
      occurredAt: sshMaxStartupsEvents.occurredAt,
      drops: sshMaxStartupsEvents.drops,
      maxStartups: sshMaxStartupsEvents.maxStartups,
    })
    .from(sshMaxStartupsEvents)
    .leftJoin(projects, eq(projects.id, sshMaxStartupsEvents.projectId))
    .where(gte(sshMaxStartupsEvents.occurredAt, since))
    .orderBy(desc(sshMaxStartupsEvents.occurredAt))
    .limit(limit);
  return rows.map((r) => ({
    projectId: r.projectId,
    projectName: r.projectName ?? null,
    instanceId: r.instanceId,
    occurredAt: r.occurredAt.toISOString(),
    drops: r.drops,
    maxStartups: r.maxStartups ?? null,
  }));
}

/** Drop rows older than `days` (retention sweep). */
export async function pruneSshMaxStartupsEvents(days = 30): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  try {
    await getDb().delete(sshMaxStartupsEvents).where(lte(sshMaxStartupsEvents.occurredAt, cutoff));
  } catch {
    /* best-effort */
  }
}
