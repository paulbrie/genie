// CRUD for the `agents` table with per-user ACL.
//
// Visibility model (private-by-default):
//   - Built-in agents (is_builtin=true) are visible to every authenticated user.
//   - User-created agents are visible only to their owner.
//   - Admins are *not* given a blanket override here — there is no
//     "everyone's agents" view in the UI today. If a future admin tool needs
//     it, add a separate `listAllAgents()` that bypasses ACL.
//
// Mutation model:
//   - Anyone can create their own agent (owner = the caller).
//   - Only the owner can update / delete their agent.
//   - Built-ins are read-only (admin editing comes later, when there's a UI
//     for it).
//
// `userId === null` means "system context" (boot-time seeds, the smoke-test
// script, future cron triggers) and bypasses ACL. The WS handler never passes
// null — it always sources userId from the authenticated session.

import { and, eq, or, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { agents } from "../db/schema.js";
import type { AgentDef, AgentSandboxConfig } from "./types.js";

export interface AgentInput {
  slug: string;
  label: string;
  description?: string;
  systemPrompt?: string;
  modelId?: string;
  maxToolRounds?: number;
  tools?: string[];
  sandbox: AgentSandboxConfig;
}

/** Row shape returned by Drizzle — `jsonb` columns come back as `unknown`. */
function rowToAgent(row: typeof agents.$inferSelect): AgentDef {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    description: row.description,
    systemPrompt: row.systemPrompt,
    modelId: row.modelId,
    maxToolRounds: row.maxToolRounds,
    tools: Array.isArray(row.tools) ? (row.tools as string[]) : [],
    sandbox: row.sandbox as AgentSandboxConfig,
    ownerUserId: row.ownerUserId,
    isBuiltin: row.isBuiltin,
  };
}

/** `null` userId = system context — bypasses ACL, sees everything. */
export async function listAgents(userId: string | null): Promise<AgentDef[]> {
  const db = getDb();
  const rows = userId === null
    ? await db.select().from(agents).orderBy(agents.label)
    : await db.select().from(agents)
        .where(or(eq(agents.ownerUserId, userId), eq(agents.isBuiltin, true)))
        .orderBy(agents.label);
  return rows.map(rowToAgent);
}

/** Returns null when the row doesn't exist or the user can't see it. */
export async function getAgentById(
  id: string,
  userId: string | null,
): Promise<AgentDef | null> {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!row) return null;
  if (!canSee(row, userId)) return null;
  return rowToAgent(row);
}

export async function getAgentBySlug(
  slug: string,
  userId: string | null,
): Promise<AgentDef | null> {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  if (!row) return null;
  if (!canSee(row, userId)) return null;
  return rowToAgent(row);
}

function canSee(row: typeof agents.$inferSelect, userId: string | null): boolean {
  if (userId === null) return true;
  if (row.isBuiltin) return true;
  return row.ownerUserId === userId;
}

function canWrite(row: typeof agents.$inferSelect, userId: string | null): boolean {
  if (userId === null) return true;
  // Built-ins are read-only to everyone until there's an admin edit UI.
  if (row.isBuiltin) return false;
  return row.ownerUserId === userId;
}

function validate(input: AgentInput): void {
  if (!input.slug?.trim()) throw new Error("agent slug is required");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.slug)) {
    throw new Error("agent slug must be lowercase letters, digits, dashes");
  }
  if (!input.label?.trim()) throw new Error("agent label is required");
  if (!input.sandbox || !input.sandbox.kind) throw new Error("agent sandbox.kind is required");
  if (input.sandbox.kind === "project-docker") {
    if (!input.sandbox.projectId) throw new Error("project-docker sandbox needs projectId");
    if (!input.sandbox.instanceId) throw new Error("project-docker sandbox needs instanceId");
  }
}

export async function createAgent(
  input: AgentInput,
  userId: string | null,
): Promise<AgentDef> {
  validate(input);
  const db = getDb();
  // Slug is globally unique so we surface conflicts up-front with a clean
  // error rather than the raw PG unique-violation.
  const [existing] = await db.select({ id: agents.id })
    .from(agents).where(eq(agents.slug, input.slug.trim())).limit(1);
  if (existing) throw new Error(`Agent slug '${input.slug}' is already taken`);

  const [row] = await db.insert(agents).values({
    slug: input.slug.trim(),
    label: input.label.trim(),
    description: input.description ?? "",
    systemPrompt: input.systemPrompt ?? "",
    modelId: input.modelId ?? "claude-sonnet",
    maxToolRounds: input.maxToolRounds ?? 40,
    tools: input.tools ?? [],
    sandbox: input.sandbox,
    ownerUserId: userId,
    isBuiltin: false,
  }).returning();
  return rowToAgent(row);
}

export async function updateAgent(
  id: string,
  input: Partial<AgentInput>,
  userId: string | null,
): Promise<AgentDef | null> {
  const db = getDb();
  const [existing] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!existing) return null;
  if (!canWrite(existing, userId)) {
    throw new Error("Not authorized to modify this agent");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (input.slug !== undefined) patch.slug = input.slug.trim();
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (input.systemPrompt !== undefined) patch.systemPrompt = input.systemPrompt;
  if (input.modelId !== undefined) patch.modelId = input.modelId;
  if (input.maxToolRounds !== undefined) patch.maxToolRounds = input.maxToolRounds;
  if (input.tools !== undefined) patch.tools = input.tools;
  if (input.sandbox !== undefined) patch.sandbox = input.sandbox;
  const [row] = await db.update(agents).set(patch).where(eq(agents.id, id)).returning();
  return row ? rowToAgent(row) : null;
}

export async function deleteAgent(id: string, userId: string | null): Promise<void> {
  const db = getDb();
  const [existing] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!existing) return;
  if (!canWrite(existing, userId)) {
    throw new Error("Not authorized to delete this agent");
  }
  await db.delete(agents).where(eq(agents.id, id));
}

/** Convenience: upsert by slug, scoped to the caller's ownership. Used by the
 *  v0 smoke-test script (userId=null = system) and could later back a CLI
 *  flow. Won't clobber a built-in or someone else's agent. */
export async function upsertAgentBySlug(
  input: AgentInput,
  userId: string | null,
): Promise<AgentDef> {
  const db = getDb();
  const [existing] = await db.select().from(agents).where(eq(agents.slug, input.slug)).limit(1);
  if (existing) {
    if (!canWrite(existing, userId)) {
      throw new Error(`Agent slug '${input.slug}' is taken by another user or is built-in`);
    }
    const updated = await updateAgent(existing.id, input, userId);
    if (!updated) throw new Error(`Agent ${input.slug} disappeared mid-upsert`);
    return updated;
  }
  return createAgent(input, userId);
}
