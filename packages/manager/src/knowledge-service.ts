// Knowledge bundle ("Concepts" nav): conceptual docs about how Genie itself is
// built. The DB (`knowledge_docs`) is the runtime source of truth — superadmins
// edit entries from the UI. The repo `knowledge/` folder is the file-authoring
// surface, synced both ways on demand (never auto-seeded on boot):
//   • export (DB → disk, `npm run knowledge:export`) so file-only readers like
//     CLAUDE.md / Claude Code can see current Concepts;
//   • import (disk → DB, `npm run knowledge:import`) so edits made in the files
//     (e.g. by Claude Code) are pushed into the DB and show up in the UI.

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

/** `title:` from a leading `---` YAML frontmatter block, or null. */
function frontmatterTitle(markdown: string): string | null {
  const fm = markdown.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const t = fm[1].match(/^title:\s*(.+?)\s*$/m);
  return t ? t[1].trim().replace(/^["']|["']$/g, "") : null;
}

/** Best display title for a doc: frontmatter `title:`, else the first `#`
 *  heading, else the file basename. Shared by create/update/import so the tree
 *  label is consistent however a doc enters the DB. */
function deriveTitle(content: string, docPath: string): string {
  return (frontmatterTitle(content) ?? extractTitle(content) ?? path.basename(docPath)).trim() || "Untitled";
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
  const title = input.title?.trim() || deriveTitle(input.content, p);
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
    patch.title = deriveTitle(input.content, (patch.path as string) ?? "");
  }
  const [row] = await db.update(knowledgeDocs).set(patch).where(eq(knowledgeDocs.id, id)).returning();
  return row ?? null;
}

export async function deleteKnowledge(id: string) {
  const db = getDb();
  await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, id));
}

// --- Import (disk → DB) ----------------------------------------------------

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

/** Push every `knowledge/*.md` file into the DB, upserting by `path` (content +
 *  title updated for existing rows, new files inserted). This is the file →
 *  DB authoring path: edit the markdown, then run `npm run knowledge:import`.
 *  Non-destructive: a DB row whose file was deleted is left intact (remove it
 *  from the UI). Returns counts + the dir. */
export async function importKnowledgeFromDisk(): Promise<{ upserted: number; dir: string }> {
  const rels = (await collectMarkdown(KNOWLEDGE_DIR, KNOWLEDGE_DIR)).sort((a, b) => a.localeCompare(b));
  const db = getDb();
  let upserted = 0;
  for (const rel of rels) {
    const content = await fsp.readFile(path.join(KNOWLEDGE_DIR, rel), "utf8");
    const title = deriveTitle(content, rel);
    await db.insert(knowledgeDocs)
      .values({ path: rel, title, content })
      .onConflictDoUpdate({ target: knowledgeDocs.path, set: { title, content, updatedAt: new Date() } });
    upserted += 1;
  }
  return { upserted, dir: KNOWLEDGE_DIR };
}

// --- Export mirror (DB → disk) --------------------------------------------

/** Write every DB knowledge doc back out to the `knowledge/` folder so the
 *  version-controlled bundle mirrors the live (UI-edited) source of truth — the
 *  bridge that lets file-only readers (CLAUDE.md / Claude Code) see current
 *  Concepts. Non-destructive: updates/creates files but does not prune ones
 *  whose DB row was deleted (delete those by hand). Returns counts + the dir. */
export async function exportKnowledgeToDisk(): Promise<{ written: number; dir: string }> {
  const docs = await listKnowledge();
  let written = 0;
  for (const doc of docs) {
    const dest = path.join(KNOWLEDGE_DIR, doc.path);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, doc.content, "utf8");
    written += 1;
  }
  return { written, dir: KNOWLEDGE_DIR };
}
