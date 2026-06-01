// CRUD for the `agents` table. Mirrors the shape of recipes-service.ts so the
// renderer's admin UI can reuse the same patterns (list, get, upsert, delete).
//
// Validation lives here, not in the WS handler — so a CLI script (the v0 smoke
// test) and the eventual UI both go through the same gate.

import { eq } from "drizzle-orm";
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

export async function listAgents(): Promise<AgentDef[]> {
  const db = getDb();
  const rows = await db.select().from(agents).orderBy(agents.label);
  return rows.map(rowToAgent);
}

export async function getAgentById(id: string): Promise<AgentDef | null> {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return row ? rowToAgent(row) : null;
}

export async function getAgentBySlug(slug: string): Promise<AgentDef | null> {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  return row ? rowToAgent(row) : null;
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

export async function createAgent(input: AgentInput, userId: string | null): Promise<AgentDef> {
  validate(input);
  const db = getDb();
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

export async function updateAgent(id: string, input: Partial<AgentInput>): Promise<AgentDef | null> {
  const db = getDb();
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

export async function deleteAgent(id: string): Promise<void> {
  const db = getDb();
  await db.delete(agents).where(eq(agents.id, id));
}

/** Convenience for the v0 smoke-test script: upsert by slug, returning the row. */
export async function upsertAgentBySlug(
  input: AgentInput,
  userId: string | null,
): Promise<AgentDef> {
  const existing = await getAgentBySlug(input.slug);
  if (existing) {
    const updated = await updateAgent(existing.id, input);
    if (!updated) throw new Error(`Agent ${input.slug} disappeared mid-upsert`);
    return updated;
  }
  return createAgent(input, userId);
}
