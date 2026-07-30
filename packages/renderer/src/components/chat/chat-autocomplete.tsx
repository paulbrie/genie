"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { wsRequest } from "@/lib/ws";

/** Slash commands surfaced in the `/` autocomplete. Limited to ones that work in
 *  chat's headless (`claude -p`) mode — interactive/TUI-only commands (/mcp,
 *  /status, /config, /permissions, /agents, /vim, /memory, /model) just return
 *  "isn't available in this environment", so they're intentionally omitted. The
 *  genie-* MCP tools still work in chat — ask for them in natural language.
 *  (Custom project commands under .claude/commands/ could be added later.) */
const SLASH_COMMANDS: { name: string; desc: string }[] = [
  { name: "clear", desc: "Clear conversation history" },
  { name: "compact", desc: "Summarize & compact the context" },
  { name: "cost", desc: "Show token usage & cost" },
  { name: "init", desc: "Generate a CLAUDE.md for the project" },
  { name: "review", desc: "Review a pull request" },
  { name: "simplify", desc: "Simplify & clean up the changed code" },
  { name: "pr-comments", desc: "Show PR comments" },
  { name: "release-notes", desc: "Show release notes" },
  { name: "help", desc: "List available commands" },
];

interface FileEntry { name: string; isDirectory: boolean }
type Trigger =
  | { kind: "slash"; query: string }
  | { kind: "file"; query: string; tokenStart: number }
  | null;

export interface AcItem { label: string; hint?: string; insert: string; keepOpen?: boolean }

/** Drives a CLI-style autocomplete for a chat textarea: `/` → slash commands,
 *  `@` → file paths under the project root (segment-by-segment, via the same
 *  vps:fs:readDirectory the Files tab uses). Returns handlers to spread onto the
 *  textarea plus the popup state to render. */
export function useChatAutocomplete(opts: {
  value: string;
  setValue: (v: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  projectId: string;
  instanceId: string;
  remoteRoot?: string;
}) {
  const { value, setValue, textareaRef, projectId, instanceId } = opts;
  const remoteRoot = opts.remoteRoot ?? "/opt/project";
  const [trigger, setTrigger] = useState<Trigger>(null);
  const [items, setItems] = useState<AcItem[]>([]);
  const [index, setIndex] = useState(0);
  const dirCacheRef = useRef<Record<string, FileEntry[]>>({});
  const pendingCaretRef = useRef<number | null>(null);
  const fetchSeq = useRef(0);

  // Apply a queued caret position after a controlled value update.
  useEffect(() => {
    if (pendingCaretRef.current != null && textareaRef.current) {
      const pos = pendingCaretRef.current;
      pendingCaretRef.current = null;
      textareaRef.current.selectionStart = textareaRef.current.selectionEnd = pos;
    }
  }, [value, textareaRef]);

  const detect = useCallback((val: string, caret: number): Trigger => {
    // Slash commands only when the whole message starts with '/' and the caret
    // is still within that first token (mirrors the CLI).
    if (val.startsWith("/")) {
      const firstSpace = val.indexOf(" ");
      if (firstSpace === -1 || caret <= firstSpace) return { kind: "slash", query: val.slice(1, caret) };
    }
    // @ file mention: the token under the caret begins with '@'.
    const before = val.slice(0, caret);
    const m = before.match(/(?:^|\s)@([^\s]*)$/);
    if (m) return { kind: "file", query: m[1], tokenStart: caret - m[1].length - 1 };
    return null;
  }, []);

  const refresh = useCallback((t: Trigger) => {
    setTrigger(t);
    setIndex(0);
    if (!t) { setItems([]); return; }
    if (t.kind === "slash") {
      const q = t.query.toLowerCase();
      setItems(SLASH_COMMANDS
        .filter((c) => c.name.toLowerCase().startsWith(q))
        .map((c) => ({ label: "/" + c.name, hint: c.desc, insert: "/" + c.name + " " })));
      return;
    }
    const q = t.query;
    const lastSlash = q.lastIndexOf("/");
    const dir = lastSlash === -1 ? "" : q.slice(0, lastSlash);
    const partial = (lastSlash === -1 ? q : q.slice(lastSlash + 1)).toLowerCase();
    const dirPath = remoteRoot + (dir ? "/" + dir : "");
    const seq = ++fetchSeq.current;
    const apply = (entries: FileEntry[]) => {
      if (seq !== fetchSeq.current) return; // a newer query superseded this one
      setItems(entries
        .filter((e) => e.name.toLowerCase().startsWith(partial))
        .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
        .slice(0, 10)
        .map((e) => ({
          label: e.name + (e.isDirectory ? "/" : ""),
          hint: dir || undefined,
          insert: "@" + (dir ? dir + "/" : "") + e.name + (e.isDirectory ? "/" : " "),
          keepOpen: e.isDirectory,
        })));
    };
    const cached = dirCacheRef.current[dirPath];
    if (cached) { apply(cached); return; }
    void wsRequest<{ ok: boolean; entries?: FileEntry[] }>("vps:fs:readDirectory", { projectId, instanceId, path: dirPath })
      .then((res) => { const e = res.ok && res.entries ? res.entries : []; dirCacheRef.current[dirPath] = e; apply(e); })
      .catch(() => apply([]));
  }, [projectId, instanceId, remoteRoot]);

  const onChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    refresh(detect(e.target.value, e.target.selectionStart ?? e.target.value.length));
  }, [setValue, refresh, detect]);

  const accept = useCallback((item: AcItem) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    if (!trigger) return;
    const tokenStart = trigger.kind === "slash" ? 0 : trigger.tokenStart;
    const next = value.slice(0, tokenStart) + item.insert + value.slice(caret);
    const newCaret = tokenStart + item.insert.length;
    pendingCaretRef.current = newCaret;
    setValue(next);
    if (item.keepOpen) refresh(detect(next, newCaret)); // descend into the chosen directory
    else { setTrigger(null); setItems([]); }
  }, [value, trigger, textareaRef, setValue, refresh, detect]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!trigger || items.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => (i + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => (i - 1 + items.length) % items.length); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(items[index]); }
    else if (e.key === "Escape") { e.preventDefault(); setTrigger(null); setItems([]); }
  }, [trigger, items, index, accept]);

  const close = useCallback(() => { setTrigger(null); setItems([]); }, []);

  return { open: !!trigger && items.length > 0, kind: trigger?.kind, items, index, setIndex, onChange, onKeyDown, accept, close };
}

/** Popup list rendered above the chat input. */
export function ChatAutocomplete({
  open, items, index, kind, onPick,
}: {
  open: boolean;
  items: AcItem[];
  index: number;
  kind?: "slash" | "file";
  onPick: (item: AcItem) => void;
}) {
  if (!open) return null;
  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 max-h-56 overflow-y-auto rounded-lg border border-surface1 bg-mantle shadow-lg shadow-black/40 py-1 scrollbar-thin">
      <div className="px-3 pb-0.5 text-overlay0 uppercase tracking-wide" style={{ fontSize: 9 }}>
        {kind === "slash" ? "Commands" : "Files"}
      </div>
      {items.map((it, i) => (
        <button
          key={it.insert}
          onMouseDown={(e) => { e.preventDefault(); onPick(it); }}
          className={`flex items-baseline gap-2 w-full px-3 py-1 text-left outline-none transition-colors ${i === index ? "bg-surface1" : "hover:bg-surface0"}`}
          style={{ fontSize: 12 }}
        >
          <span className="font-mono text-text truncate">{it.label}</span>
          {it.hint && <span className="text-overlay0 truncate flex-1" style={{ fontSize: 11 }}>{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}
