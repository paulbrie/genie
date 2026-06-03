import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { orgMembers, projectMembers, projects, teamMembers, teams, users } from "./db/schema.js";
import { type ProjectDef, type ProjectCommand, type ProcessStatus, type VpsInstance, type VpsInfo, VPS_SSH_USERNAME } from "./types.js";
import { v4 as uuidv4 } from "uuid";

// --- Helpers ---

function normalizeConnection(conn: VpsInstance["connection"]): VpsInstance["connection"] {
  return conn.username === "root" ? { ...conn, username: VPS_SSH_USERNAME } : conn;
}

/** Stable key for the underlying cloud resource a VpsInstance points at, or
 *  null if it isn't linked to a known provider (those can't be deduped). */
function instanceTargetKey(inst: VpsInstance): string | null {
  if (inst.digitalocean) return `do:${inst.digitalocean.dropletId}`;
  if (inst.tazcloud) return `taz:${inst.tazcloud.vmId}`;
  return null;
}

/** Collapse duplicate instances that point at the same droplet/VM. Older deploy
 *  success/error paths could append a second record for one droplet (see the
 *  deploy handlers in ws-server), leaving a project with two buttons for the
 *  same server. This heals such rows on read; the next write persists the
 *  collapsed set. When records collide we keep the most "complete" one — a
 *  successfully-deployed record over a failed one, then the one with services. */
function dedupeVpsInstances(instances: VpsInstance[]): VpsInstance[] {
  const score = (i: VpsInstance) => (i.deployFailed ? 0 : 2) + (i.services?.length ? 1 : 0);
  const keptIndexByKey = new Map<string, number>();
  const result: VpsInstance[] = [];
  for (const inst of instances) {
    const key = instanceTargetKey(inst);
    if (!key) { result.push(inst); continue; }
    const existingIdx = keptIndexByKey.get(key);
    if (existingIdx === undefined) {
      keptIndexByKey.set(key, result.length);
      result.push(inst);
    } else if (score(inst) > score(result[existingIdx])) {
      result[existingIdx] = inst; // keep the better record, preserve ordering
    }
  }
  return result;
}

function migrateVpsInstances(raw: unknown): VpsInstance[] {
  if (!raw) return [];
  // Already an array of VpsInstance[]
  if (Array.isArray(raw)) {
    return dedupeVpsInstances((raw as VpsInstance[]).map(inst =>
      inst.connection ? { ...inst, connection: normalizeConnection(inst.connection) } : inst
    ));
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
    vpsProvider: (row.vpsProvider as "digitalocean" | "tazcloud" | "hetzner" | null) || "digitalocean",
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

/** True when the two users belong to at least one common team. Used to scope
 *  peer collaboration features (e.g. terminal sharing) to teammates. Users with
 *  no team membership never overlap with anyone (returns false). */
export async function usersShareTeam(userIdA: string, userIdB: string): Promise<boolean> {
  if (userIdA === userIdB) return true;
  const [aTeams, bTeams] = await Promise.all([getUserTeamIds(userIdA), getUserTeamIds(userIdB)]);
  if (aTeams.length === 0 || bTeams.length === 0) return false;
  const bSet = new Set(bTeams);
  return aTeams.some((t) => bSet.has(t));
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
 *   - superadmin:                 every project.
 *   - org owner/admin of org X:   every project whose team belongs to X.
 *   - explicit project member:    that project.
 *   - team member (legacy):       projects in their teams.
 *   - userId === null:            empty list (unauthenticated).
 */
export async function getAllForUser(userId: string | null): Promise<ProjectDef[]> {
  if (!userId) return [];
  // superadmin only — global admin role still has to belong to an org to see
  // projects. This is intentional: the auto-create-default-org step in auth.ts
  // ensures any admin/superadmin ends up with at least one org on first login.
  const db = getDb();
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.role === "superadmin") return getAll();

  // 1. Teams whose org the user owns/admins → see every project in those teams.
  const ownedOrgIds = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), inArray(orgMembers.role, ["owner", "admin"])));
  const orgIds = ownedOrgIds.map((r) => r.orgId);
  let teamIdsFromOrgs: string[] = [];
  if (orgIds.length > 0) {
    const rows = await db.select({ id: teams.id }).from(teams).where(inArray(teams.orgId, orgIds));
    teamIdsFromOrgs = rows.map((r) => r.id);
  }

  // 2. Legacy team membership.
  const userTeamIds = await getUserTeamIds(userId);

  // 3. Explicit project memberships.
  const directRows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  const directProjectIds = directRows.map((r) => r.projectId);

  const teamIdsAll = Array.from(new Set([...teamIdsFromOrgs, ...userTeamIds]));
  if (teamIdsAll.length === 0 && directProjectIds.length === 0) return [];

  const conds = [] as ReturnType<typeof inArray>[];
  if (teamIdsAll.length > 0) conds.push(inArray(projects.teamId, teamIdsAll));
  if (directProjectIds.length > 0) conds.push(inArray(projects.id, directProjectIds));
  const rows = await db
    .select()
    .from(projects)
    .where(conds.length === 1 ? conds[0] : or(...conds))
    .orderBy(projects.createdAt);
  const teamMap = await getTeamNameMap();
  return rows.map((r) => attachTeamName(rowToProjectDef(r), teamMap));
}

/** True iff the user can access a project that has a VPS instance pointing at the
 *  given droplet/VM. Used to authorize per-VM exec for non-admin users: they may
 *  drive the Manage popup (stats, services, recipes) only for servers attached to
 *  one of their own projects. Admins are handled by the caller (they bypass this). */
export async function userCanAccessVm(
  userId: string | null,
  match: { dropletId?: number; vmId?: string; serverId?: number },
): Promise<boolean> {
  if (!userId) return false;
  const projects = await getAllForUser(userId);
  return projects.some((p) =>
    p.vpsInstances.some((v) =>
      (match.dropletId !== undefined && v.digitalocean?.dropletId === match.dropletId) ||
      (match.vmId !== undefined && v.tazcloud?.vmId === match.vmId) ||
      (match.serverId !== undefined && v.hetzner?.serverId === match.serverId),
    ),
  );
}

/** True iff the given user is allowed to see the given project. */
export async function userCanSeeProject(userId: string | null, projectId: string): Promise<boolean> {
  if (!userId) return false;
  const db = getDb();
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.role === "superadmin") return true;

  const [row] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) return false;

  // Explicit project member?
  const [pm] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (pm) return true;

  if (!row.teamId) return false;

  // Org owner/admin of the project's team's org?
  const [team] = await db.select({ orgId: teams.orgId }).from(teams).where(eq(teams.id, row.teamId)).limit(1);
  if (team?.orgId) {
    const [member] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, team.orgId), eq(orgMembers.userId, userId)))
      .limit(1);
    if (member?.role === "owner" || member?.role === "admin") return true;
  }

  // Legacy team membership fallback.
  const teamIds = await getUserTeamIds(userId);
  return teamIds.includes(row.teamId);
}

/** True iff the user may manage (add/remove members of) this project. */
export async function userCanManageProject(userId: string | null, projectId: string): Promise<boolean> {
  if (!userId) return false;
  const db = getDb();
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.role === "superadmin") return true;

  const [row] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) return false;

  // Owner of this project (explicit)?
  const [pm] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (pm?.role === "owner") return true;

  // Org owner/admin?
  if (!row.teamId) return false;
  const [team] = await db.select({ orgId: teams.orgId }).from(teams).where(eq(teams.id, row.teamId)).limit(1);
  if (!team?.orgId) return false;
  const [orgMember] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, team.orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return orgMember?.role === "owner" || orgMember?.role === "admin";
}

// --- Per-project members ---

export interface ProjectMemberDef {
  id: string;
  projectId: string;
  userId: string;
  role: "owner" | "member";
  addedBy: string | null;
  joinedAt: Date;
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string | null;
}

export async function getProjectMembers(projectId: string): Promise<ProjectMemberDef[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: projectMembers.id,
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
      addedBy: projectMembers.addedBy,
      joinedAt: projectMembers.joinedAt,
      userName: users.name,
      userEmail: users.email,
      userAvatarUrl: users.avatarUrl,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.joinedAt);
  return rows as ProjectMemberDef[];
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  addedByUserId: string | null,
  role: "owner" | "member" = "member",
): Promise<ProjectMemberDef | null> {
  const db = getDb();
  // Upsert.
  const existing = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (existing.length > 0) {
    const [updated] = await db
      .update(projectMembers)
      .set({ role })
      .where(eq(projectMembers.id, existing[0].id))
      .returning();
    return decorateProjectMember(updated);
  }
  const [row] = await db
    .insert(projectMembers)
    .values({ projectId, userId, role, addedBy: addedByUserId })
    .returning();
  return decorateProjectMember(row);
}

export async function removeProjectMember(projectId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const res = await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .returning({ id: projectMembers.id });
  return res.length > 0;
}

export async function setProjectMemberRole(
  projectId: string,
  userId: string,
  role: "owner" | "member",
): Promise<ProjectMemberDef | null> {
  const db = getDb();
  const [updated] = await db
    .update(projectMembers)
    .set({ role })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .returning();
  if (!updated) return null;
  return decorateProjectMember(updated);
}

async function decorateProjectMember(row: typeof projectMembers.$inferSelect): Promise<ProjectMemberDef> {
  const db = getDb();
  const [u] = await db
    .select({ name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role as "owner" | "member",
    addedBy: row.addedBy,
    joinedAt: row.joinedAt,
    userName: u?.name,
    userEmail: u?.email,
    userAvatarUrl: u?.avatarUrl ?? null,
  };
}

// Touch sql import for typecheck if unused above.
void sql;

export async function getById(id: string): Promise<ProjectDef | null> {
  const db = getDb();
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!row) return null;
  return rowToProjectDef(row);
}

export async function add(entry: {
  name: string;
  commands?: { name: string; command: string; mode?: "inline" | "terminal" }[];
  vpsProvider?: "digitalocean" | "tazcloud" | "hetzner";
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
  createdByUserId?: string | null;
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

  // Creator is auto-owner so they retain access regardless of org/team changes.
  if (entry.createdByUserId) {
    await db
      .insert(projectMembers)
      .values({ projectId: row.id, userId: entry.createdByUserId, role: "owner", addedBy: entry.createdByUserId })
      .onConflictDoNothing();
  }

  return rowToProjectDef(row);
}

export async function update(
  id: string,
  fields: {
    name?: string;
    commands?: { id?: string; name: string; command: string; mode?: "inline" | "terminal" }[];
    vpsProvider?: "digitalocean" | "tazcloud" | "hetzner";
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
  // Dedup on the underlying droplet/VM (and on id): if the project already has a
  // record for this server, replace it in place rather than appending a second
  // one. Without this, a deploy that errored after the droplet was created (the
  // error path adds a failed record) followed by a fresh-id retry would leave
  // two buttons for one droplet.
  const key = instanceTargetKey(instance);
  const existingIdx = project.vpsInstances.findIndex(
    v => v.id === instance.id || (key !== null && instanceTargetKey(v) === key),
  );
  const instances = existingIdx >= 0
    ? project.vpsInstances.map((v, i) => (i === existingIdx ? instance : v))
    : [...project.vpsInstances, instance];
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
