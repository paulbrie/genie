import { eq } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { projects } from "./db/schema.js";
import type { ProjectDef, ProjectCommand, ProcessStatus, VpsInstance, VpsInfo } from "./types.js";
import { v4 as uuidv4 } from "uuid";

// --- Helpers ---

function migrateVpsInstances(raw: unknown): VpsInstance[] {
  if (!raw) return [];
  // Already an array of VpsInstance[]
  if (Array.isArray(raw)) return raw as VpsInstance[];
  // Legacy single VpsInfo object — wrap in array
  const legacy = raw as VpsInfo & { id?: string; label?: string };
  if (legacy.connection) {
    return [{
      id: legacy.id || uuidv4(),
      label: legacy.label || "default",
      connection: legacy.connection,
      services: legacy.services || [],
      digitalocean: legacy.digitalocean,
    }];
  }
  return [];
}

function rowToProjectDef(row: typeof projects.$inferSelect): ProjectDef {
  return {
    id: row.id,
    name: row.name,
    commands: (row.commands as ProjectCommand[]) || [],
    commandStatuses: (row.commandStatuses as Record<string, ProcessStatus>) || {},
    vpsInstances: migrateVpsInstances(row.vps),
    vpsRegion: row.vpsRegion || undefined,
    vpsSize: row.vpsSize || undefined,
    vpsBaseImageId: row.vpsBaseImageId || undefined,
    vpsBaseImageConfigName: row.vpsBaseImageConfigName || undefined,
    setupFiles: (row.setupFiles as Record<string, string>) || {},
    secrets: (row.secrets as { key: string; value: string }[]) || [],
    doToken: row.doToken || undefined,
    gitlabDeployKey: row.gitlabDeployKey || undefined,
    dbUrl: row.dbUrl || undefined,
    gitFolders: (row.gitFolders as string[]) || [],
  };
}

// --- CRUD ---

export async function getAll(): Promise<ProjectDef[]> {

  const db = getDb();
  const rows = await db.select().from(projects).orderBy(projects.createdAt);
  return rows.map(rowToProjectDef);
}

export async function getById(id: string): Promise<ProjectDef | null> {
  const db = getDb();
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!row) return null;
  return rowToProjectDef(row);
}

export async function add(entry: {
  name: string;
  commands?: { name: string; command: string; mode?: "inline" | "terminal" }[];
  vpsRegion?: string;
  vpsSize?: string;
  vpsBaseImageId?: number;
  vpsBaseImageConfigName?: string;
  secrets?: { key: string; value: string }[];
  doToken?: string;
  gitlabDeployKey?: string;
  dbUrl?: string;
}): Promise<ProjectDef> {

  const db = getDb();

  const commands: ProjectCommand[] = (entry.commands || []).map((c) => ({
    id: uuidv4(),
    name: c.name,
    command: c.command,
    mode: c.mode,
  }));
  const commandStatuses: Record<string, ProcessStatus> = {};
  for (const cmd of commands) {
    commandStatuses[cmd.id] = "stopped";
  }

  const [row] = await db
    .insert(projects)
    .values({
      name: entry.name,
      commands,
      commandStatuses,
      vpsRegion: entry.vpsRegion || null,
      vpsSize: entry.vpsSize || null,
      vpsBaseImageId: entry.vpsBaseImageId || null,
      vpsBaseImageConfigName: entry.vpsBaseImageConfigName || null,
      secrets: entry.secrets || [],
      doToken: entry.doToken || null,
      gitlabDeployKey: entry.gitlabDeployKey || null,
      dbUrl: entry.dbUrl || null,
    })
    .returning();

  return rowToProjectDef(row);
}

export async function update(
  id: string,
  fields: {
    name?: string;
    commands?: { id?: string; name: string; command: string; mode?: "inline" | "terminal" }[];
    vpsRegion?: string;
    vpsSize?: string;
    vpsBaseImageId?: number | null;
    vpsBaseImageConfigName?: string;
    setupFiles?: Record<string, string>;
    secrets?: { key: string; value: string }[];
    doToken?: string;
    gitlabDeployKey?: string;
    dbUrl?: string;
    gitFolders?: string[];
  },
): Promise<ProjectDef | null> {
  const db = getDb();
  const [existing] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!existing) return null;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.vpsRegion !== undefined) updates.vpsRegion = fields.vpsRegion || null;
  if (fields.vpsSize !== undefined) updates.vpsSize = fields.vpsSize || null;
  if (fields.vpsBaseImageId !== undefined) updates.vpsBaseImageId = fields.vpsBaseImageId || null;
  if (fields.vpsBaseImageConfigName !== undefined) updates.vpsBaseImageConfigName = fields.vpsBaseImageConfigName || null;
  if (fields.setupFiles !== undefined) updates.setupFiles = fields.setupFiles;
  if (fields.secrets !== undefined) updates.secrets = fields.secrets;
  if (fields.doToken !== undefined) updates.doToken = fields.doToken || null;
  if (fields.gitlabDeployKey !== undefined) updates.gitlabDeployKey = fields.gitlabDeployKey || null;
  if (fields.dbUrl !== undefined) updates.dbUrl = fields.dbUrl || null;
  if (fields.gitFolders !== undefined) updates.gitFolders = fields.gitFolders;

  if (fields.commands) {
    const existingCommands = (existing.commands as ProjectCommand[]) || [];
    const existingIds = new Set(existingCommands.map((c) => c.id));
    const existingStatuses = (existing.commandStatuses as Record<string, ProcessStatus>) || {};

    const newCommands: ProjectCommand[] = fields.commands.map((c) => {
      if (c.id && existingIds.has(c.id)) {
        return { id: c.id, name: c.name, command: c.command, mode: c.mode };
      }
      return { id: uuidv4(), name: c.name, command: c.command, mode: c.mode };
    });
    const newStatuses: Record<string, ProcessStatus> = {};
    for (const cmd of newCommands) {
      newStatuses[cmd.id] = existingStatuses[cmd.id] || "stopped";
    }
    updates.commands = newCommands;
    updates.commandStatuses = newStatuses;
  }

  const [row] = await db
    .update(projects)
    .set(updates)
    .where(eq(projects.id, id))
    .returning();

  if (!row) return null;
  return rowToProjectDef(row);
}

export async function remove(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
  return result.length > 0;
}

export async function updateCommandStatus(
  projectId: string,
  commandId: string,
  status: ProcessStatus,
): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ commandStatuses: projects.commandStatuses })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!existing) return;

  const statuses = { ...(existing.commandStatuses as Record<string, ProcessStatus>) };
  statuses[commandId] = status;

  await db
    .update(projects)
    .set({ commandStatuses: statuses, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

// --- Bulk mutation helper (for ws-server patterns that mutate and save) ---

export async function patchProject(id: string, patch: Partial<{
  vpsInstances: VpsInstance[];
  commandStatuses: Record<string, ProcessStatus>;
  setupFiles: Record<string, string>;
}>): Promise<ProjectDef | null> {
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if ("vpsInstances" in patch) updates.vps = patch.vpsInstances ?? [];
  if (patch.commandStatuses !== undefined) updates.commandStatuses = patch.commandStatuses;
  if (patch.setupFiles !== undefined) updates.setupFiles = patch.setupFiles;

  const [row] = await db
    .update(projects)
    .set(updates)
    .where(eq(projects.id, id))
    .returning();

  if (!row) return null;
  return rowToProjectDef(row);
}

// --- VPS Instance helpers ---

export async function addVpsInstance(projectId: string, instance: VpsInstance): Promise<ProjectDef | null> {
  const project = await getById(projectId);
  if (!project) return null;
  const instances = [...project.vpsInstances, instance];
  return patchProject(projectId, { vpsInstances: instances });
}

export async function removeVpsInstance(projectId: string, instanceId: string): Promise<ProjectDef | null> {
  const project = await getById(projectId);
  if (!project) return null;
  const instances = project.vpsInstances.filter(v => v.id !== instanceId);
  return patchProject(projectId, { vpsInstances: instances });
}

export async function updateVpsInstance(projectId: string, instanceId: string, patch: Partial<VpsInstance>): Promise<ProjectDef | null> {
  const project = await getById(projectId);
  if (!project) return null;
  const instances = project.vpsInstances.map(v =>
    v.id === instanceId ? { ...v, ...patch } : v
  );
  return patchProject(projectId, { vpsInstances: instances });
}
