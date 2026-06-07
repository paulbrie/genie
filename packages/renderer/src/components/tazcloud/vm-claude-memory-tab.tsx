"use client";

// Manage popup tab that browses Claude Code's memory files stored on the VM:
// the user-level memory at ~/.claude/CLAUDE.md and the persistent auto-memory
// under ~/.claude/projects/<encoded-cwd>/memory/*.md (MEMORY.md index + one
// file per remembered fact). Discovery is a single `find … -printf` over the
// popup's existing SSH `exec` helper (same path as Processes / Claude Logs).
// Memory files are small markdown, so the detail pane just cats the whole file.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, FileText, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type ExecFn = (command: string) => Promise<{ output: string; error?: boolean }>;

interface MemoryEntry {
  path: string;
  mtime: number;
  size: number;
  group: string;
  name: string;
}

// Two finds unioned: the auto-memory markdown under each project's memory/
// folder, plus the global user memory file. Sorted newest-first, capped.
const DISCOVER_CMD =
  "{ find ~/.claude/projects -maxdepth 3 -path '*/memory/*.md' -printf '%T@\\t%s\\t%p\\n' 2>/dev/null; " +
  "find ~/.claude -maxdepth 1 -name 'CLAUDE.md' -printf '%T@\\t%s\\t%p\\n' 2>/dev/null; } | sort -rn | head -n 200";

// Memory files are small; cap defensively in case one was hand-edited huge.
const CAT_BYTES = 262_144;

// Claude encodes the project cwd by replacing `/` with `-`. The reverse is
// ambiguous for dirs that legitimately contain `-`, but it's accurate for the
// common case (`/Users/paul/projects/genie` ⇄ `-Users-paul-projects-genie`).
function decodeProjectDir(name: string): string {
  if (!name.startsWith("-")) return name;
  return name.replace(/-/g, "/");
}

function parseEntries(output: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const [tsStr, sizeStr, ...rest] = line.split("\t");
    if (!tsStr || !sizeStr || rest.length === 0) continue;
    const path = rest.join("\t");
    const ts = Number.parseFloat(tsStr);
    const size = Number.parseInt(sizeStr, 10);
    if (!Number.isFinite(ts) || !Number.isFinite(size)) continue;

    let group: string;
    let name: string;
    const proj = path.match(/\/\.claude\/projects\/([^/]+)\/memory\/(.+)$/);
    if (proj) {
      group = decodeProjectDir(proj[1]);
      name = proj[2];
    } else if (/\/\.claude\/CLAUDE\.md$/.test(path)) {
      group = "User memory (~/.claude)";
      name = "CLAUDE.md";
    } else {
      continue;
    }
    entries.push({ path, mtime: Math.floor(ts * 1000), size, group, name });
  }
  return entries;
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

/** Browse Claude Code memory files stored on the VM. Uses the popup's SSH
 *  `exec` so it works for any provider (TazCloud, DO, Hetzner, plain ssh) —
 *  same wiring as the Processes / Claude Logs tabs. */
export function VmClaudeMemoryTab({ exec }: { exec: ExecFn }) {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
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

  const loadFile = useCallback(
    async (path: string) => {
      setSelected(path);
      setContent(null);
      setContentLoading(true);
      try {
        const safe = path.replace(/'/g, "'\\''");
        const res = await exec(`head -c ${CAT_BYTES} '${safe}' 2>&1`);
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
    const map = new Map<string, MemoryEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.group) ?? [];
      arr.push(e);
      map.set(e.group, arr);
    }
    // MEMORY.md (the index) floats to the top of each group; rest by recency.
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.name === "MEMORY.md") return -1;
        if (b.name === "MEMORY.md") return 1;
        return b.mtime - a.mtime;
      });
    }
    return Array.from(map.entries()).sort((a, b) => {
      const am = Math.max(...a[1].map((x) => x.mtime));
      const bm = Math.max(...b[1].map((x) => x.mtime));
      return bm - am;
    });
  }, [entries]);

  const selectedEntry = useMemo(
    () => entries?.find((e) => e.path === selected) ?? null,
    [entries, selected],
  );

  return (
    <div className="bg-mantle rounded-lg p-3 border border-overlay0/20">
      <div className="flex items-center gap-2 mb-2">
        <Brain size={12} className="text-mauve" />
        <span className="text-md font-medium text-subtext0">Claude Memory</span>
        {entries && (
          <span className="text-md text-overlay0 font-mono">
            {entries.length} file{entries.length === 1 ? "" : "s"}
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
              No Claude memory files found under{" "}
              <span className="font-mono text-overlay1">~/.claude/</span> for this SSH user.
            </div>
          ) : (
            grouped.map(([group, files]) => (
              <div key={group} className="mb-3">
                <div className="text-[10px] text-overlay1 font-mono truncate mb-0.5" title={group}>
                  {group}
                </div>
                {files.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => loadFile(f.path)}
                    className={cn(
                      "w-full text-left px-2 py-1 rounded text-xs font-mono flex items-center gap-2 transition-colors",
                      selected === f.path
                        ? "bg-surface0 text-text"
                        : "text-overlay1 hover:bg-mantle hover:text-text",
                    )}
                  >
                    <FileText size={10} className="shrink-0 text-overlay0" />
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto text-overlay0 shrink-0">{fmtRel(f.mtime)}</span>
                    <span className="text-overlay0 shrink-0 w-14 text-right">{fmtSize(f.size)}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="overflow-auto">
          {!selected ? (
            <div className="text-overlay0 text-xs py-2 px-2">
              Select a memory file to view its contents.
            </div>
          ) : (
            <>
              {selectedEntry && (
                <div className="text-[10px] text-overlay1 font-mono mb-2 break-all">
                  <span className="text-overlay0">{selectedEntry.path}</span>
                  <span className="ml-2 text-overlay0">
                    · {fmtSize(selectedEntry.size)} · {fmtRel(selectedEntry.mtime)}
                  </span>
                  {selectedEntry.size > CAT_BYTES && (
                    <span className="ml-2 text-peach">(showing first {fmtSize(CAT_BYTES)})</span>
                  )}
                </div>
              )}
              {contentLoading ? (
                <div className="flex items-center gap-2 text-overlay0 text-md py-2 px-2">
                  <Loader2 size={11} className="animate-spin" /> Loading…
                </div>
              ) : content && content.trim() ? (
                <pre className="whitespace-pre-wrap break-words text-overlay1 font-mono leading-snug m-0 text-xs">
                  {content}
                </pre>
              ) : (
                <div className="text-overlay0 text-xs py-2 px-2">This memory file is empty.</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
