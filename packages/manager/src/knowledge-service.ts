// Knowledge bundle ("Concepts" nav): conceptual docs about how Genie itself is
// built. The DB (`knowledge_docs`) is the source of truth — superadmins edit
// entries from the UI. On first boot the table is seeded from the repo
// `knowledge/` folder; thereafter the folder is ignored (edits live in the DB).

import fsp from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { knowledgeDocs } from "./db/schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/manager/src/knowledge-service.ts → repo root (../../..). In a built
// dist the file sits at packages/manager/dist/, which resolves to the same root.
const KNOWLEDGE_DIR = path.resolve(here, "../../..", "knowledge");

export interface KnowledgeInput {
  path: string;
  title?: string;
  content: string;
}

/** First `# Heading` in the markdown, or null. */
function extractTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : null;
}

/** Normalize a user-supplied path: trim, strip leading slashes, collapse to
 *  forward slashes. Throws if empty or escaping the tree via "..". */
function normalizePath(raw: string): string {
  const clean = (raw ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean) throw new Error("path is required");
  if (clean.split("/").some((seg) => seg === "..")) throw new Error("path must not contain '..'");
  return clean;
}

// --- DB CRUD --------------------------------------------------------------

export async function listKnowledge() {
  const db = getDb();
  return db.select().from(knowledgeDocs).orderBy(knowledgeDocs.path);
}

export async function createKnowledge(input: KnowledgeInput, userId: string | null) {
  const p = normalizePath(input.path);
  const title = (input.title?.trim() || extractTitle(input.content) || path.basename(p)).trim();
  const db = getDb();
  const [row] = await db.insert(knowledgeDocs).values({
    path: p,
    title,
    content: input.content ?? "",
    createdBy: userId,
  }).returning();
  return row;
}

export async function updateKnowledge(id: string, input: Partial<KnowledgeInput>) {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.path !== undefined) patch.path = normalizePath(input.path);
  if (input.content !== undefined) patch.content = input.content;
  // Title follows content/path unless explicitly provided: prefer an explicit
  // title, else the content's H1, else the basename.
  if (input.title !== undefined && input.title.trim()) {
    patch.title = input.title.trim();
  } else if (input.content !== undefined) {
    const derived = extractTitle(input.content);
    patch.title = (derived || path.basename((patch.path as string) ?? "")).trim() || "Untitled";
  }
  const [row] = await db.update(knowledgeDocs).set(patch).where(eq(knowledgeDocs.id, id)).returning();
  return row ?? null;
}

export async function deleteKnowledge(id: string) {
  const db = getDb();
  await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, id));
}

// --- One-time seed from disk ----------------------------------------------

/** Recursively collect `.md` files under `dir`, returning paths relative to root. */
async function collectMarkdown(dir: string, root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdown(full, root)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/** Insert any `knowledge/` markdown files whose path isn't already in the DB.
 *  Idempotent and non-destructive: existing rows (incl. UI edits) are left
 *  untouched. Returns the number of rows inserted. */
export async function seedKnowledgeFromDisk(): Promise<number> {
  const relPaths = await collectMarkdown(KNOWLEDGE_DIR, KNOWLEDGE_DIR);
  if (relPaths.length === 0) return 0;
  const db = getDb();
  let inserted = 0;
  for (const rel of relPaths.sort((a, b) => a.localeCompare(b))) {
    const content = await fsp.readFile(path.join(KNOWLEDGE_DIR, rel), "utf8");
    const title = extractTitle(content) ?? path.basename(rel);
    const result = await db.insert(knowledgeDocs)
      .values({ path: rel, title, content })
      .onConflictDoNothing({ target: knowledgeDocs.path })
      .returning({ id: knowledgeDocs.id });
    inserted += result.length;
  }
  return inserted;
}
