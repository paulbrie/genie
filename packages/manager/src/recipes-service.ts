import { eq } from "drizzle-orm";
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
  const [row] = await db.update(recipes).set(patch).where(eq(recipes.id, id)).returning();
  return row ?? null;
}

export async function deleteRecipe(id: string) {
  const db = getDb();
  await db.delete(recipes).where(eq(recipes.id, id));
}
