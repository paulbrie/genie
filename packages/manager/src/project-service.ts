import { eq, inArray } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { projects, teamMembers, teams, users } from "./db/schema.js";
import { type ProjectDef, type ProjectCommand, type ProcessStatus, type VpsInstance, type VpsInfo, VPS_SSH_USERNAME } from "./types.js";
import { v4 as uuidv4 } from "uuid";

// --- Helpers ---

function normalizeConnection(conn: VpsInstance["connection"]): VpsInstance["connection"] {
  return conn.username === "root" ? { ...conn, username: VPS_SSH_USERNAME } : conn;
}

function migrateVpsInstances(raw: unknown): VpsInstance[] {
  if (!raw) return [];
  // Already an array of VpsInstance[]
  if (Array.isArray(raw)) {
    return (raw as VpsInstance[]).map(inst =>
      inst.connection ? { ...inst, connection: normalizeConnection(inst.connection) } : inst
    );
  }
  // Legacy single VpsInfo object — wrap in array
  const legacy = raw as VpsInfo & { id?: string; label?: string };
  if (legacy.connection) {
    return [{
      id: legacy.id || uuidv4(),
      label: legacy.label || "default",
      connection: normalizeConnection(legacy.connection),
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
    vpsProvider: (row.vpsProvider as "digitalocean" | "tazcloud" | null) || "digitalocean",
    vpsRegion: row.vpsRegion || undefined,
    vpsSize: row.vpsSize || undefined,
    vpsImage: row.vpsImage || undefined,
    vpsBaseImageId: row.vpsBaseImageId || undefined,
    vpsBaseImageConfigName: row.vpsBaseImageConfigName || undefined,
    setupFiles: (row.setupFiles as Record<string, string>) || {},
    secrets: (row.secrets as { key: string; value: string }[]) || [],
    doToken: row.doToken || undefined,
    gitlabDeployKey: row.gitlabDeployKey || undefined,
    dbUrl: row.dbUrl || undefined,
    gitFolders: (row.gitFolders as string[]) || [],
    teamId: row.teamId ?? null,
  };
}

/** Team IDs the given user is a member of. */
async function getUserTeamIds(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db.select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return rows.map((r) => r.teamId);
}

async function isUserAdmin(userId: string): Promise<boolean> {
  const db = getDb();
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.role === "admin" || u?.role === "superadmin";
}

/** Map of teamId → team name, for decorating ProjectDef.teamName on list responses. */
async function getTeamNameMap(): Promise<Map<string, string>> {
  const db = getDb();
  const rows = await db.select({ id: teams.id, name: teams.name }).from(teams);
  return new Map(rows.map((r) => [r.id, r.name]));
}

function attachTeamName(p: ProjectDef, teamMap: Map<string, string>): ProjectDef {
  return { ...p, teamName: p.teamId ? teamMap.get(p.teamId) ?? null : null };
}

// --- CRUD ---

export async function getAll(): Promise<ProjectDef[]> {

  const db = getDb();
  const rows = await db.select().from(projects).orderBy(projects.createdAt);
  const teamMap = await getTeamNameMap();
  return rows.map((r) => attachTeamName(rowToProjectDef(r), teamMap));
}

/**
 * Project list a given user is allowed to see.
 *   - Admin/superadmin: every project.
 *   - Normal user:      projects whose teamId is one of the user's teams.
 *                       Projects with null teamId are hidden from normal users.
 *   - userId === null:  empty list (unauthenticated).
 */
export async function getAllForUser(userId: string | null): Promise<ProjectDef[]> {
  if (!userId) return [];
  if (await isUserAdmin(userId)) return getAll();

  const teamIds = await getUserTeamIds(userId);
  if (teamIds.length === 0) return [];

  const db = getDb();
  const rows = await db.select()
    .from(projects)
    .where(inArray(projects.teamId, teamIds))
    .orderBy(projects.createdAt);
  const teamMap = await getTeamNameMap();
  return rows.map((r) => attachTeamName(rowToProjectDef(r), teamMap));
}

/** True iff the given user is allowed to see the given project. */
export async function userCanSeeProject(userId: string | null, projectId: string): Promise<boolean> {
  if (!userId) return false;
  if (await isUserAdmin(userId)) return true;
  const db = getDb();
  const [row] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row || !row.teamId) return false;
  const teamIds = await getUserTeamIds(userId);
  return teamIds.includes(row.teamId);
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
  vpsProvider?: "digitalocean" | "tazcloud";
  vpsRegion?: string;
  vpsSize?: string;
  vpsImage?: string;
  vpsBaseImageId?: number;
  vpsBaseImageConfigName?: string;
  secrets?: { key: string; value: string }[];
  doToken?: string;
  gitlabDeployKey?: string;
  dbUrl?: string;
  teamId?: string | null;
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
      vpsProvider: entry.vpsProvider || "digitalocean",
      vpsRegion: entry.vpsRegion || null,
      vpsSize: entry.vpsSize || null,
      vpsImage: entry.vpsImage || null,
      vpsBaseImageId: entry.vpsBaseImageId || null,
      vpsBaseImageConfigName: entry.vpsBaseImageConfigName || null,
      secrets: entry.secrets || [],
      doToken: entry.doToken || null,
      gitlabDeployKey: entry.gitlabDeployKey || null,
      dbUrl: entry.dbUrl || null,
      teamId: entry.teamId ?? null,
    })
    .returning();

  return rowToProjectDef(row);
}

export async function update(
  id: string,
  fields: {
    name?: string;
    commands?: { id?: string; name: string; command: string; mode?: "inline" | "terminal" }[];
    vpsProvider?: "digitalocean" | "tazcloud";
    vpsRegion?: string;
    vpsSize?: string;
    vpsImage?: string;
    vpsBaseImageId?: number | null;
    vpsBaseImageConfigName?: string;
    setupFiles?: Record<string, string>;
    secrets?: { key: string; value: string }[];
    doToken?: string;
    gitlabDeployKey?: string;
    dbUrl?: string;
    gitFolders?: string[];
    teamId?: string | null;
  },
): Promise<ProjectDef | null> {
  const db = getDb();
  const [existing] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!existing) return null;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.vpsProvider !== undefined) updates.vpsProvider = fields.vpsProvider;
  if (fields.vpsRegion !== undefined) updates.vpsRegion = fields.vpsRegion || null;
  if (fields.vpsSize !== undefined) updates.vpsSize = fields.vpsSize || null;
  if (fields.vpsImage !== undefined) updates.vpsImage = fields.vpsImage || null;
  if (fields.vpsBaseImageId !== undefined) updates.vpsBaseImageId = fields.vpsBaseImageId || null;
  if (fields.vpsBaseImageConfigName !== undefined) updates.vpsBaseImageConfigName = fields.vpsBaseImageConfigName || null;
  if (fields.setupFiles !== undefined) updates.setupFiles = fields.setupFiles;
  if (fields.secrets !== undefined) updates.secrets = fields.secrets;
  if (fields.doToken !== undefined) updates.doToken = fields.doToken || null;
  if (fields.gitlabDeployKey !== undefined) updates.gitlabDeployKey = fields.gitlabDeployKey || null;
  if (fields.dbUrl !== undefined) updates.dbUrl = fields.dbUrl || null;
  if (fields.gitFolders !== undefined) updates.gitFolders = fields.gitFolders;
  if (fields.teamId !== undefined) updates.teamId = fields.teamId;

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
