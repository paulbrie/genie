import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { claudePlugins } from "../db/schema.js";

export interface ClaudePluginInput {
  slug: string;
  label: string;
  /** "plugin" (default) or "skill" — selects the Manage-popup tab it shows under. */
  kind?: string;
  description?: string;
  icon?: string;
  homepageUrl?: string;
  checkScript: string;
  installScript: string;
  uninstallScript?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commands?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: any[];
  /** Per-apply prompted values (e.g. plugin API keys). Schema-only at rest;
   *  values live in modal state and are never persisted. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  secrets?: any[];
}

export async function listClaudePlugins() {
  const db = getDb();
  return db.select().from(claudePlugins).orderBy(claudePlugins.label);
}

export async function getClaudePlugin(id: string) {
  const db = getDb();
  const [row] = await db.select().from(claudePlugins).where(eq(claudePlugins.id, id)).limit(1);
  return row ?? null;
}

export async function createClaudePlugin(input: ClaudePluginInput, userId: string | null) {
  if (!input.slug?.trim()) throw new Error("slug is required");
  if (!input.label?.trim()) throw new Error("label is required");
  if (!input.checkScript?.trim()) throw new Error("checkScript is required");
  if (!input.installScript?.trim()) throw new Error("installScript is required");
  const db = getDb();
  const [row] = await db.insert(claudePlugins).values({
    slug: input.slug.trim(),
    label: input.label.trim(),
    kind: input.kind || "plugin",
    description: input.description ?? "",
    icon: input.icon || "Puzzle",
    homepageUrl: input.homepageUrl ?? "",
    checkScript: input.checkScript,
    installScript: input.installScript,
    uninstallScript: input.uninstallScript ?? "",
    commands: input.commands ?? [],
    options: input.options ?? [],
    secrets: input.secrets ?? [],
    createdBy: userId,
  }).returning();
  return row;
}

export async function updateClaudePlugin(id: string, input: Partial<ClaudePluginInput>) {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (input.slug !== undefined) patch.slug = input.slug.trim();
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.description !== undefined) patch.description = input.description;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.homepageUrl !== undefined) patch.homepageUrl = input.homepageUrl;
  if (input.checkScript !== undefined) patch.checkScript = input.checkScript;
  if (input.installScript !== undefined) patch.installScript = input.installScript;
  if (input.uninstallScript !== undefined) patch.uninstallScript = input.uninstallScript;
  if (input.commands !== undefined) patch.commands = input.commands;
  if (input.options !== undefined) patch.options = input.options;
  if (input.secrets !== undefined) patch.secrets = input.secrets;
  const [row] = await db.update(claudePlugins).set(patch).where(eq(claudePlugins.id, id)).returning();
  return row ?? null;
}

export async function deleteClaudePlugin(id: string) {
  const db = getDb();
  await db.delete(claudePlugins).where(eq(claudePlugins.id, id));
}

/** Idempotent boot-time seed: upsert each built-in plugin by slug. Updates
 *  every field except createdBy/createdAt so editing a plugin in
 *  default-claude-plugins.ts and redeploying refreshes the DB row in place.
 *
 *  Returns counts so the boot log can show what happened. */
export async function seedDefaultClaudePlugins(defaults: ClaudePluginInput[]): Promise<{ inserted: number; updated: number }> {
  const db = getDb();
  let inserted = 0;
  let updated = 0;
  for (const p of defaults) {
    const values = {
      slug: p.slug.trim(),
      label: p.label.trim(),
      kind: p.kind || "plugin",
      description: p.description ?? "",
      icon: p.icon || "Puzzle",
      homepageUrl: p.homepageUrl ?? "",
      checkScript: p.checkScript,
      installScript: p.installScript,
      uninstallScript: p.uninstallScript ?? "",
      commands: p.commands ?? [],
      options: p.options ?? [],
      secrets: p.secrets ?? [],
    };
    const result = await db.insert(claudePlugins)
      .values(values)
      .onConflictDoUpdate({
        target: claudePlugins.slug,
        set: { ...values, updatedAt: sql`now()` },
      })
      .returning({ id: claudePlugins.id, createdAt: claudePlugins.createdAt, updatedAt: claudePlugins.updatedAt });
    if (result.length > 0) {
      const row = result[0];
      const dt = Math.abs(new Date(row.updatedAt).getTime() - new Date(row.createdAt).getTime());
      if (dt < 1000) inserted += 1; else updated += 1;
    }
  }
  return { inserted, updated };
}
