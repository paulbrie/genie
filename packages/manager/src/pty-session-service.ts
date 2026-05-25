import { getDb } from "./db/index.js";
import { ptySessions } from "./db/schema.js";
import { and, desc, eq, sql } from "drizzle-orm";

export type PtySessionKind = "shell" | "claude";

export interface PtySessionRecord {
  id: string;
  ownerId: string;
  kind: PtySessionKind;
  projectId: string | null;
  instanceId: string | null;
  vpsHost: string;
  commandLabel: string | null;
  /** Direct-SSH reattach payload — host/port/username/privateKeyPath. Null for
   *  project-VPS sessions (the connection is resolved live from projectService). */
  sshConfig: Record<string, unknown> | null;
  createdAt: Date;
  lastActivity: Date;
}

export interface CreatePtySessionInput {
  id: string;
  ownerId: string;
  kind: PtySessionKind;
  projectId?: string | null;
  instanceId?: string | null;
  vpsHost: string;
  commandLabel?: string | null;
  sshConfig?: Record<string, unknown> | null;
}

export async function createPtySession(input: CreatePtySessionInput): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(ptySessions)
    .values({
      id: input.id,
      ownerId: input.ownerId,
      kind: input.kind,
      projectId: input.projectId ?? null,
      instanceId: input.instanceId ?? null,
      vpsHost: input.vpsHost,
      commandLabel: input.commandLabel ?? null,
      sshConfig: input.sshConfig ?? null,
      createdAt: now,
      lastActivity: now,
    })
    .onConflictDoUpdate({
      target: ptySessions.id,
      // Reattach to an existing row → just bump activity and keep the original
      // ownership/metadata. The id is stable across reattaches by design.
      set: { lastActivity: now },
    });
}

/** Cheap upsert-style activity bump. Safe to call on every keystroke; in
 *  practice ws-server throttles. */
export async function touchPtySession(id: string): Promise<void> {
  await getDb()
    .update(ptySessions)
    .set({ lastActivity: new Date() })
    .where(eq(ptySessions.id, id));
}

export interface ListPtySessionsFilters {
  /** If set, restrict to sessions owned by this user. Pass null for "all
   *  users" (only allowed for superadmin callers; the WS handler enforces). */
  ownerId?: string | null;
  projectId?: string | null;
  instanceId?: string | null;
  vpsHost?: string | null;
}

export async function listPtySessions(filters: ListPtySessionsFilters): Promise<PtySessionRecord[]> {
  const conds = [];
  if (filters.ownerId) conds.push(eq(ptySessions.ownerId, filters.ownerId));
  if (filters.projectId) conds.push(eq(ptySessions.projectId, filters.projectId));
  if (filters.instanceId) conds.push(eq(ptySessions.instanceId, filters.instanceId));
  if (filters.vpsHost) conds.push(eq(ptySessions.vpsHost, filters.vpsHost));

  const rows = await getDb()
    .select()
    .from(ptySessions)
    .where(conds.length === 0 ? sql`true` : and(...conds))
    .orderBy(desc(ptySessions.lastActivity));

  return rows.map((r) => ({
    id: r.id,
    ownerId: r.ownerId,
    kind: r.kind as PtySessionKind,
    projectId: r.projectId,
    instanceId: r.instanceId,
    vpsHost: r.vpsHost,
    commandLabel: r.commandLabel,
    sshConfig: r.sshConfig as Record<string, unknown> | null,
    createdAt: r.createdAt,
    lastActivity: r.lastActivity,
  }));
}

export async function getPtySession(id: string): Promise<PtySessionRecord | null> {
  const rows = await getDb()
    .select()
    .from(ptySessions)
    .where(eq(ptySessions.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    ownerId: r.ownerId,
    kind: r.kind as PtySessionKind,
    projectId: r.projectId,
    instanceId: r.instanceId,
    vpsHost: r.vpsHost,
    commandLabel: r.commandLabel,
    sshConfig: r.sshConfig as Record<string, unknown> | null,
    createdAt: r.createdAt,
    lastActivity: r.lastActivity,
  };
}

/** Forget a persisted session — removes the row but does NOT kill the tmux
 *  session on the VPS. Use when the user wants to drop a stale entry without
 *  cleaning up the remote process (e.g. the VPS is gone or unreachable). */
export async function forgetPtySession(id: string): Promise<void> {
  await getDb().delete(ptySessions).where(eq(ptySessions.id, id));
}
