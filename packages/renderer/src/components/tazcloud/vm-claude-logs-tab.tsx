"use client";

// Manage popup tab that browses Claude Code transcripts stored on the VM at
// ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl. Discovery is a single
// `find … -printf` over the popup's existing SSH `exec` helper (same path as
// Processes / Firewall). One session view at a time; tails the last 1 MB so
// long sessions load quickly.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";

type ExecFn = (command: string) => Promise<{ output: string; error?: boolean }>;

interface SessionEntry {
  path: string;
  mtime: number;
  size: number;
  projectDir: string;
  sessionId: string;
}

// Sorted newest-first by find; capped to keep the master pane scannable.
const DISCOVER_CMD =
  "find ~/.claude/projects -maxdepth 2 -name '*.jsonl' -printf '%T@\\t%s\\t%p\\n' 2>/dev/null | sort -rn | head -n 200";

const TAIL_BYTES = 1_048_576;

function parseEntries(output: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const [tsStr, sizeStr, ...rest] = line.split("\t");
    if (!tsStr || !sizeStr || rest.length === 0) continue;
    const path = rest.join("\t");
    const m = path.match(/\/\.claude\/projects\/([^/]+)\/([^/]+)\.jsonl$/);
    if (!m) continue;
    const ts = Number.parseFloat(tsStr);
    const size = Number.parseInt(sizeStr, 10);
    if (!Number.isFinite(ts) || !Number.isFinite(size)) continue;
    entries.push({
      path,
      mtime: Math.floor(ts * 1000),
      size,
      projectDir: m[1],
      sessionId: m[2],
    });
  }
  return entries;
}

// Claude encodes the project cwd by replacing `/` with `-`. The reverse is
// ambiguous for dirs that legitimately contain `-`, but it's accurate for the
// common case (`/Users/paul/projects/genie` ⇄ `-Users-paul-projects-genie`).
function decodeProjectDir(name: string): string {
  if (!name.startsWith("-")) return name;
  return name.replace(/-/g, "/");
}

function fmtRel(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface JsonlMessage {
  role: "user" | "assistant" | "summary" | "system";
  text: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  content?: unknown;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const raw of content) {
    if (typeof raw === "string") {
      parts.push(raw);
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const b = raw as ContentBlock;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "tool_use") parts.push(`[tool_use: ${b.name ?? "?"}]`);
    else if (b.type === "tool_result") {
      const inner = typeof b.content === "string" ? b.content : extractText(b.content);
      parts.push(inner ? `[tool_result] ${inner.slice(0, 400)}` : "[tool_result]");
    } else if (b.type === "thinking" && typeof b.text === "string") {
      parts.push(`[thinking] ${b.text}`);
    }
  }
  return parts.filter(Boolean).join("\n");
}

function parseJsonl(raw: string): JsonlMessage[] {
  const out: JsonlMessage[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let ev: { type?: string; summary?: string; message?: { role?: string; content?: unknown } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "summary" && typeof ev.summary === "string") {
      out.push({ role: "summary", text: ev.summary });
    } else if (ev.type === "user" && ev.message) {
      const text = extractText(ev.message.content);
      if (text) out.push({ role: "user", text });
    } else if (ev.type === "assistant" && ev.message) {
      const text = extractText(ev.message.content);
      if (text) out.push({ role: "assistant", text });
    }
  }
  return out;
}

/** Browse Claude Code transcripts stored on the VM at ~/.claude/projects/.
 *  Uses the popup's SSH `exec` so it works for any provider (TazCloud, DO,
 *  Hetzner, plain ssh) — same wiring as the Processes / Firewall tabs. */
export function VmClaudeLogsTab({ exec }: { exec: ExecFn }) {
  const [entries, setEntries] = useState<SessionEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await exec(DISCOVER_CMD);
      if (res.error) setError(res.output.slice(0, 200));
      else setEntries(parseEntries(res.output));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [exec]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadSession = useCallback(
    async (path: string) => {
      setSelected(path);
      setContent(null);
      setContentLoading(true);
      try {
        const safe = path.replace(/'/g, "'\\''");
        const res = await exec(`tail -c ${TAIL_BYTES} '${safe}' 2>&1`);
        setContent(res.output);
      } catch (err: unknown) {
        setContent(err instanceof Error ? err.message : String(err));
      }
      setContentLoading(false);
    },
    [exec],
  );

  const grouped = useMemo(() => {
    if (!entries) return [];
    const map = new Map<string, SessionEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.projectDir) ?? [];
      arr.push(e);
      map.set(e.projectDir, arr);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const am = Math.max(...a[1].map((x) => x.mtime));
      const bm = Math.max(...b[1].map((x) => x.mtime));
      return bm - am;
    });
  }, [entries]);

  const parsed = useMemo(() => (content ? parseJsonl(content) : null), [content]);

  const selectedEntry = useMemo(
    () => entries?.find((e) => e.path === selected) ?? null,
    [entries, selected],
  );

  return (
    <div className="bg-mantle rounded-lg p-3 border border-overlay0/20">
      <div className="flex items-center gap-2 mb-2">
        <ScrollText size={12} className="text-peach" />
        <span className="text-md font-medium text-subtext0">Claude Logs</span>
        {entries && (
          <span className="text-md text-overlay0 font-mono">
            {entries.length} session{entries.length === 1 ? "" : "s"}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={refresh}
          disabled={loading}
          className="text-overlay0 hover:text-blue transition-colors disabled:opacity-50"
        >
          <RefreshCw size={11} className={cn(loading && "animate-spin")} />
        </button>
      </div>
      {error && <div className="text-xs text-red font-mono mb-2 break-all">{error}</div>}
      <div className="grid grid-cols-[280px_1fr] gap-3 h-[460px]">
        <div className="overflow-auto pr-1 border-r border-overlay0/20">
          {loading && !entries ? (
            <div className="flex items-center gap-2 text-overlay0 text-md py-2">
              <Loader2 size={11} className="animate-spin" /> Loading…
            </div>
          ) : entries && entries.length === 0 ? (
            <div className="text-overlay0 text-xs py-2 leading-relaxed">
              No Claude transcripts found under{" "}
              <span className="font-mono text-overlay1">~/.claude/projects/</span> for this SSH user.
            </div>
          ) : (
            grouped.map(([dir, sessions]) => (
              <div key={dir} className="mb-3">
                <div
                  className="text-[10px] text-overlay1 font-mono truncate mb-0.5"
                  title={decodeProjectDir(dir)}
                >
                  {decodeProjectDir(dir)}
                </div>
                {sessions.map((s) => (
                  <button
                    key={s.path}
                    onClick={() => loadSession(s.path)}
                    className={cn(
                      "w-full text-left px-2 py-1 rounded text-xs font-mono flex items-center gap-2 transition-colors",
                      selected === s.path
                        ? "bg-surface0 text-text"
                        : "text-overlay1 hover:bg-mantle hover:text-text",
                    )}
                  >
                    <FileText size={10} className="shrink-0 text-overlay0" />
                    <span className="truncate">{s.sessionId.slice(0, 8)}</span>
                    <span className="ml-auto text-overlay0 shrink-0">{fmtRel(s.mtime)}</span>
                    <span className="text-overlay0 shrink-0 w-14 text-right">{fmtSize(s.size)}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="overflow-auto">
          {!selected ? (
            <div className="text-overlay0 text-xs py-2 px-2">
              Select a session to view its transcript.
            </div>
          ) : (
            <>
              {selectedEntry && (
                <div className="text-[10px] text-overlay1 font-mono mb-2 break-all">
                  <span className="text-overlay0">{selectedEntry.path}</span>
                  <span className="ml-2 text-overlay0">
                    · {fmtSize(selectedEntry.size)} · {fmtRel(selectedEntry.mtime)}
                  </span>
                  {selectedEntry.size > TAIL_BYTES && (
                    <span className="ml-2 text-peach">(showing last {fmtSize(TAIL_BYTES)})</span>
                  )}
                </div>
              )}
              {contentLoading ? (
                <div className="flex items-center gap-2 text-overlay0 text-md py-2 px-2">
                  <Loader2 size={11} className="animate-spin" /> Loading…
                </div>
              ) : parsed && parsed.length > 0 ? (
                <div className="space-y-2">
                  {parsed.map((m, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span
                        className={cn(
                          "shrink-0 w-16 font-mono uppercase tracking-wide text-[10px] pt-0.5",
                          m.role === "user"
                            ? "text-blue"
                            : m.role === "assistant"
                              ? "text-green"
                              : m.role === "summary"
                                ? "text-mauve"
                                : "text-overlay0",
                        )}
                      >
                        {m.role}
                      </span>
                      <pre className="whitespace-pre-wrap break-words text-overlay1 font-mono leading-snug flex-1 m-0 text-xs">
                        {m.text}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-overlay0 text-xs py-2 px-2">
                  No parseable messages in this session.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
