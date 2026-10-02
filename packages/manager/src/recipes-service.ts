import { eq, sql } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { recipes } from "./db/schema.js";

export interface RecipeInput {
  slug: string;
  label: string;
  description?: string;
  icon?: string;
  port?: number | null;
  checkScript: string;
  installScript: string;
  uninstallScript?: string;
  setupShSnippet?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commands?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: any[];
  /** Per-apply prompted values (PATs etc). Never persisted at apply time —
   *  the *schema* is in the DB; the *values* live only in the modal state. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  secrets?: any[];
}

export async function listRecipes() {
  const db = getDb();
  return db.select().from(recipes).orderBy(recipes.label);
}

export async function getRecipe(id: string) {
  const db = getDb();
  const [row] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);
  return row ?? null;
}

export async function createRecipe(input: RecipeInput, userId: string | null) {
  if (!input.slug?.trim()) throw new Error("slug is required");
  if (!input.label?.trim()) throw new Error("label is required");
  if (!input.checkScript?.trim()) throw new Error("checkScript is required");
  if (!input.installScript?.trim()) throw new Error("installScript is required");
  const db = getDb();
  const [row] = await db.insert(recipes).values({
    slug: input.slug.trim(),
    label: input.label.trim(),
    description: input.description ?? "",
    icon: input.icon || "Package",
    port: input.port ?? null,
    checkScript: input.checkScript,
    installScript: input.installScript,
    uninstallScript: input.uninstallScript ?? "",
    setupShSnippet: input.setupShSnippet ?? "",
    commands: input.commands ?? [],
    options: input.options ?? [],
    secrets: input.secrets ?? [],
    createdBy: userId,
  }).returning();
  return row;
}

export async function updateRecipe(id: string, input: Partial<RecipeInput>) {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (input.slug !== undefined) patch.slug = input.slug.trim();
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.port !== undefined) patch.port = input.port;
  if (input.checkScript !== undefined) patch.checkScript = input.checkScript;
  if (input.installScript !== undefined) patch.installScript = input.installScript;
  if (input.uninstallScript !== undefined) patch.uninstallScript = input.uninstallScript;
  if (input.setupShSnippet !== undefined) patch.setupShSnippet = input.setupShSnippet;
  if (input.commands !== undefined) patch.commands = input.commands;
  if (input.options !== undefined) patch.options = input.options;
  if (input.secrets !== undefined) patch.secrets = input.secrets;
  const [row] = await db.update(recipes).set(patch).where(eq(recipes.id, id)).returning();
  return row ?? null;
}

export async function deleteRecipe(id: string) {
  const db = getDb();
  await db.delete(recipes).where(eq(recipes.id, id));
}

/** Idempotent boot-time seed: upsert each built-in recipe by slug. Updates
 *  every field except createdBy/createdAt so editing a recipe in
 *  default-recipes.ts and redeploying refreshes the DB row in place.
 *
 *  Returns counts so the boot log can show what happened. */
export async function seedDefaultRecipes(defaults: RecipeInput[]): Promise<{ inserted: number; updated: number }> {
  const db = getDb();
  let inserted = 0;
  let updated = 0;
  for (const r of defaults) {
    const values = {
      slug: r.slug.trim(),
      label: r.label.trim(),
      description: r.description ?? "",
      icon: r.icon || "Package",
      port: r.port ?? null,
      checkScript: r.checkScript,
      installScript: r.installScript,
      uninstallScript: r.uninstallScript ?? "",
      setupShSnippet: r.setupShSnippet ?? "",
      commands: r.commands ?? [],
      options: r.options ?? [],
      secrets: r.secrets ?? [],
    };
    const result = await db.insert(recipes)
      .values(values)
      .onConflictDoUpdate({
        target: recipes.slug,
        set: { ...values, updatedAt: sql`now()` },
      })
      .returning({ id: recipes.id, createdAt: recipes.createdAt, updatedAt: recipes.updatedAt });
    if (result.length > 0) {
      const row = result[0];
      // Heuristic: if createdAt and updatedAt are within 1s of each other this
      // was an insert; otherwise it was an update.
      const dt = Math.abs(new Date(row.updatedAt).getTime() - new Date(row.createdAt).getTime());
      if (dt < 1000) inserted += 1; else updated += 1;
    }
  }
  return { inserted, updated };
}
