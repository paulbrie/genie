"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { useDeepSubjectAll } from "@/lib/hooks";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, FileText, RefreshCw, Plus, Pencil, Trash2, Save, X, HardDriveDownload, HardDriveUpload } from "lucide-react";
import { wsRequest } from "@/lib/ws";
import { $auth, $knowledge } from "@/store/subjects";
import {
  loadKnowledge,
  selectKnowledgeFile,
  createKnowledge,
  updateKnowledge,
  deleteKnowledge,
  clearKnowledgeSaveError,
} from "@/store/actions";
import type { KnowledgeFile } from "@/store/types";
import { cn } from "@/lib/utils";
import { ViewHeader } from "@/components/ui/view-header";
import { Button } from "@/components/ui/button";

interface TreeGroup {
  /** Folder name, or "" for root-level files. */
  dir: string;
  files: KnowledgeFile[];
}

/** Group files by their top-level folder, root-level files first. */
function groupByDir(files: KnowledgeFile[]): TreeGroup[] {
  const groups = new Map<string, KnowledgeFile[]>();
  for (const f of files) {
    const slash = f.path.indexOf("/");
    const dir = slash === -1 ? "" : f.path.slice(0, slash);
    const arr = groups.get(dir) ?? [];
    arr.push(f);
    groups.set(dir, arr);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
    .map(([dir, files]) => ({ dir, files }));
}

/** Resolve a relative link as written in the bundle (e.g. "/recipes/recipe.md",
 *  "./recipe.md", or a folder link like "recipes/") against the current file's
 *  folder to a knowledge path that exists in `files`. Folder links resolve to
 *  that folder's index.md. Returns null if it isn't a local doc link. */
function resolveMdLink(href: string, fromPath: string, files: KnowledgeFile[]): string | null {
  if (!href || /^[a-z]+:\/\//i.test(href) || href.startsWith("#") || href.startsWith("mailto:")) return null;
  const [rawPath] = href.split("#");
  if (!rawPath) return null;

  const baseDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const seed = rawPath.startsWith("/") ? [] : baseDir ? baseDir.split("/") : [];
  const stack: string[] = [...seed];
  for (const part of rawPath.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const base = stack.join("/");

  const candidates = base.endsWith(".md") ? [base] : [`${base}/index.md`, `${base}.md`];
  return candidates.find((c) => files.some((f) => f.path === c)) ?? null;
}

type EditorState = { mode: "new" } | { mode: "edit"; id: string };

const inputClass =
  "w-full px-2.5 py-1.5 rounded bg-crust border border-surface0 text-text text-md outline-none focus:border-mauve";

/** Split a leading `---` YAML frontmatter block from the markdown body. Returns
 *  the parsed key/values and the remaining body. Without frontmatter, meta is
 *  empty and body is the input unchanged. (The bundle's OKF format puts metadata
 *  in frontmatter, which ReactMarkdown would otherwise mangle into a heading.) */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) meta[key] = val;
  }
  return { meta, body: raw.slice(m[0].length) };
}

/** Parse a `[a, b, c]` or `a, b, c` frontmatter list into trimmed items. */
function parseList(val: string | undefined): string[] {
  if (!val) return [];
  return val.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Rendered metadata header for a doc's frontmatter. */
function FrontmatterHeader({ meta }: { meta: Record<string, string> }) {
  const title = meta.title;
  const tags = parseList(meta.tags);
  // Show remaining scalar fields (not the ones we render specially) as a meta row.
  const shown = new Set(["title", "description", "tags", "resource"]);
  const extras = Object.entries(meta).filter(([k, v]) => !shown.has(k) && v);
  if (!title && !meta.description && !tags.length && !meta.resource && !extras.length) return null;
  return (
    <div className="mb-4 pb-4 border-b border-surface0">
      {title && <h1 className="text-xl font-semibold text-text m-0">{title}</h1>}
      {meta.description && <p className="text-md text-subtext0 mt-1 mb-0">{meta.description}</p>}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {tags.map((t) => (
            <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-surface0 text-subtext0">{t}</span>
          ))}
        </div>
      )}
      {(extras.length > 0 || meta.resource) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-overlay0">
          {extras.map(([k, v]) => (
            <span key={k}><span className="text-overlay0/70">{k}:</span> <span className="text-subtext0">{v}</span></span>
          ))}
          {meta.resource && (
            <a href={meta.resource} target="_blank" rel="noreferrer" className="text-blue hover:underline">source ↗</a>
          )}
        </div>
      )}
    </div>
  );
}

export function KnowledgePanel() {
  const knowledge = useDeepSubjectAll($knowledge);
  const { files, selectedPath, loading, loaded, error, saveError } = knowledge;
  const [auth] = useSubject($auth);
  // Superadmin-only data — wait for auth to attach before fetching. On a direct
  // page load the panel mounts before the WS authenticates, so a mount-only
  // fetch would be dropped; keying on the role re-runs once auth lands.
  const canEdit = auth.user?.role === "superadmin";

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draftPath, setDraftPath] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  // Path we just saved — when a matching file shows up in the list, close the editor.
  const savingPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (canEdit && !loaded) loadKnowledge();
  }, [canEdit, loaded]);

  const groups = useMemo(() => groupByDir(files), [files]);
  const selected = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? null,
    [files, selectedPath],
  );
  const fm = useMemo(() => parseFrontmatter(selected?.content ?? ""), [selected]);

  // Close the editor once the saved doc lands in the list with matching content.
  useEffect(() => {
    const target = savingPathRef.current;
    if (!target) return;
    if (files.some((f) => f.path === target && f.content === draftContent)) {
      savingPathRef.current = null;
      setEditor(null);
    }
  }, [files, draftContent]);

  function openNew() {
    clearKnowledgeSaveError();
    setDraftPath("");
    setDraftContent("# New concept\n\n");
    setEditor({ mode: "new" });
  }

  function openEdit(file: KnowledgeFile) {
    clearKnowledgeSaveError();
    setDraftPath(file.path);
    setDraftContent(file.content);
    setEditor({ mode: "edit", id: file.id });
  }

  function cancelEdit() {
    clearKnowledgeSaveError();
    savingPathRef.current = null;
    setEditor(null);
  }

  function save() {
    const path = draftPath.trim();
    if (!path) return;
    savingPathRef.current = path;
    if (editor?.mode === "edit") {
      updateKnowledge(editor.id, { path, content: draftContent });
    } else {
      createKnowledge({ path, content: draftContent });
    }
  }

  function remove(file: KnowledgeFile) {
    if (!window.confirm(`Delete "${file.path}"? This can't be undone.`)) return;
    deleteKnowledge(file.id);
  }

  async function doExport() {
    setExporting(true);
    setSyncMsg(null);
    try {
      const res = await wsRequest<{ written?: number; error?: string }>("knowledge:export", {}, 30_000);
      setSyncMsg(res.error ? `Export failed: ${res.error}` : `Exported ${res.written ?? 0} file(s)`);
    } catch {
      setSyncMsg("Export failed: request timed out");
    } finally {
      setExporting(false);
      window.setTimeout(() => setSyncMsg(null), 5000);
    }
  }

  async function doImport() {
    if (!window.confirm("Import overwrites DB docs with the contents of knowledge/*.md (upsert by path). Continue?")) return;
    setImporting(true);
    setSyncMsg(null);
    try {
      const res = await wsRequest<{ upserted?: number; error?: string }>("knowledge:import", {}, 30_000);
      setSyncMsg(res.error ? `Import failed: ${res.error}` : `Imported ${res.upserted ?? 0} file(s)`);
    } catch {
      setSyncMsg("Import failed: request timed out");
    } finally {
      setImporting(false);
      window.setTimeout(() => setSyncMsg(null), 5000);
    }
  }

  const mdComponents = useMemo(
    () => ({
      a: ({ href, children, ...props }: { href?: string; children?: React.ReactNode }) => {
        const target = href && selected ? resolveMdLink(href, selected.path, files) : null;
        if (target) {
          return (
            <a
              href={`#${target}`}
              onClick={(e) => {
                e.preventDefault();
                selectKnowledgeFile(target);
              }}
              {...props}
            >
              {children}
            </a>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer" {...props}>
            {children}
          </a>
        );
      },
    }),
    [files, selected],
  );

  return (
    <div className="flex-1 flex flex-col h-full px-5 py-4 min-h-0">
      <ViewHeader
        title="Concepts"
        subtitle="How Genie is built — conceptual documentation"
        statusIndicator={<BookOpen size={18} className="text-mauve shrink-0" />}
        actions={
          <>
            {syncMsg && (
              <span className={cn("text-sm mr-1", syncMsg.includes("failed") ? "text-red" : "text-green")}>
                {syncMsg}
              </span>
            )}
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => loadKnowledge()} disabled={loading}>
              <RefreshCw size={14} className={cn(loading && "animate-spin")} />
              Refresh
            </Button>
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={doImport}
                disabled={importing}
                title="Pull docs from the repo knowledge/ folder into the DB (upsert by path)"
              >
                <HardDriveUpload size={14} className={cn(importing && "animate-pulse")} />
                Import
              </Button>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={doExport}
                disabled={exporting}
                title="Write all docs to the repo knowledge/ folder so they're committable"
              >
                <HardDriveDownload size={14} className={cn(exporting && "animate-pulse")} />
                Export
              </Button>
            )}
            {canEdit && (
              <Button variant="primary" size="sm" className="gap-1.5" onClick={openNew}>
                <Plus size={14} />
                New
              </Button>
            )}
          </>
        }
      />

      <div className="flex-1 flex min-h-0 gap-4 pt-4">
        {/* File tree */}
        <aside className="w-64 shrink-0 overflow-y-auto scrollbar-thin border border-surface0 rounded-md bg-mantle p-2">
          {error && <p className="text-md text-red px-2 py-1">{error}</p>}
          {!error && files.length === 0 && (
            <p className="text-md text-overlay0 px-2 py-1">
              {loading ? "Loading…" : "No documents yet."}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.dir || "__root"} className="mb-2">
              {group.dir && (
                <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-overlay0">
                  {group.dir}
                </div>
              )}
              {group.files.map((f) => (
                <button
                  key={f.id}
                  onClick={() => selectKnowledgeFile(f.path)}
                  className={cn(
                    "flex items-center gap-2 w-full text-left px-2 py-1.5 rounded border-none cursor-pointer",
                    "text-md transition-colors duration-150",
                    f.path === selectedPath
                      ? "bg-surface0 text-text"
                      : "bg-transparent text-subtext0 hover:bg-surface0/60 hover:text-text",
                  )}
                  title={f.path}
                >
                  <FileText size={14} className="shrink-0 text-overlay0" />
                  <span className="truncate">{f.title}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* Reader / editor */}
        <main className="flex-1 min-w-0 flex flex-col border border-surface0 rounded-md bg-mantle overflow-hidden">
          {editor ? (
            <div className="flex flex-col h-full p-4 gap-3 min-h-0">
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  placeholder="path, e.g. recipes/my-concept.md"
                  value={draftPath}
                  onChange={(e) => setDraftPath(e.target.value)}
                  spellCheck={false}
                />
                <Button variant="primary" size="sm" className="gap-1.5 shrink-0" onClick={save} disabled={!draftPath.trim()}>
                  <Save size={14} />
                  Save
                </Button>
                <Button variant="ghost" size="sm" className="gap-1.5 shrink-0" onClick={cancelEdit}>
                  <X size={14} />
                  Cancel
                </Button>
              </div>
              {saveError && <p className="text-md text-red">{saveError}</p>}
              <textarea
                className={cn(inputClass, "flex-1 resize-none font-mono text-sm leading-relaxed scrollbar-thin")}
                placeholder="Markdown content…"
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                spellCheck={false}
              />
              <p className="text-xs text-overlay0">
                The title is the first <code>#</code> heading. Links like{" "}
                <code>[Recipe](recipes/recipe.md)</code> resolve within this bundle.
              </p>
            </div>
          ) : selected ? (
            <>
              <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-surface0 shrink-0">
                <span className="text-md text-overlay0 truncate font-mono" title={selected.path}>
                  {selected.path}
                </span>
                {canEdit && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => openEdit(selected)}>
                      <Pencil size={14} />
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-red" onClick={() => remove(selected)}>
                      <Trash2 size={14} />
                      Delete
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin p-5 select-text">
                <div className="max-w-3xl">
                  <FrontmatterHeader meta={fm.meta} />
                  <div className="chat-markdown">
                  <ReactMarkdown key={selected.path} remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {fm.body.replace(/ /g, " ")}
                  </ReactMarkdown>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-md text-overlay0 p-5">
              {loading ? "Loading…" : "Select a document, or create one with “New”."}
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
