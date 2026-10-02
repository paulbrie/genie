"use client";

// Extension-side Git panel — talks to the manager's `git:*` handlers
// (status, log, branches, diff, stage/unstage, commit, pull, push, stash).
// The full status/log/branches/diff drill-down is encoded as a 3-state UI
// (`showLog`, `showBranches`, `diffContent !== null`) that swaps the body —
// extension popups are too narrow for a sidebar layout.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowUp, Check, Circle, Copy, File, FileEdit, FilePlus,
  FileQuestion, FileX, GitBranch, GitCommit, Loader2, Minus, Plus, RefreshCw, X,
} from "lucide-react";
import { wsRequest } from "@/lib/ws";

// Minimal projection of the manager's project shape — duplicated rather than
// imported from `../page` to keep the tab modules independent of the page.
interface ExtensionProject {
  id: string;
  name: string;
  dbUrl?: string;
  gitFolders?: string[];
  vpsInstances: {
    id: string;
    label: string;
    connection: { host: string };
    digitalocean?: { ipAddress: string };
  }[];
}

interface GitFileEntry {
  path: string;
  index: string;   // X column from porcelain
  working: string;  // Y column from porcelain
}

function parseGitPorcelain(porcelain: string | undefined | null): { files: GitFileEntry[]; branchLine: string | null } {
  if (!porcelain) return { files: [], branchLine: null };
  const lines = porcelain.split("\n").filter(Boolean);
  let branchLine: string | null = null;
  const files: GitFileEntry[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      branchLine = line;
      continue;
    }
    if (line.length < 4) continue;
    const index = line[0];
    const working = line[1];
    const path = line.slice(3);
    files.push({ path, index, working });
  }
  return { files, branchLine };
}

function gitFileIcon(index: string, working: string) {
  const status = working !== " " && working !== "?" ? working : index;
  switch (status) {
    case "A": return <FilePlus size={13} className="text-green" />;
    case "M": return <FileEdit size={13} className="text-yellow" />;
    case "D": return <FileX size={13} className="text-red" />;
    case "R": return <FileEdit size={13} className="text-blue" />;
    case "?": return <FileQuestion size={13} className="text-overlay0" />;
    default: return <File size={13} className="text-overlay0" />;
  }
}

export function GitPanel({ project }: { project: ExtensionProject }) {
  const inst = project.vpsInstances[0];
  const folders = project.gitFolders && project.gitFolders.length > 0 ? project.gitFolders : ["/opt/project"];
  const [selectedFolder, setSelectedFolder] = useState(folders[0]);

  // Sync selectedFolder when gitFolders changes
  useEffect(() => {
    if (!folders.includes(selectedFolder)) {
      setSelectedFolder(folders[0]);
    }
  }, [folders.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [files, setFiles] = useState<GitFileEntry[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([]);
  const [showBranches, setShowBranches] = useState(false);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const loadStatus = useCallback(async () => {
    if (!inst) return;
    setLoading(true);
    setError(null);
    try {
      const res = await wsRequest("git:status", { projectId: project.id, instanceId: inst.id, folder: selectedFolder }, 15000);
      if (res.message) {
        // Error response from git:error
        setError(res.message);
        setLoading(false);
        return;
      }
      const porcelain = res.porcelain || "";
      if (porcelain.startsWith("fatal:")) {
        setError(porcelain);
        setLoading(false);
        return;
      }
      setBranch(res.branch || "");
      setAhead(res.ahead || 0);
      setBehind(res.behind || 0);
      const parsed = parseGitPorcelain(porcelain);
      setFiles(parsed.files);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [project.id, inst?.id, selectedFolder]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const loadLog = useCallback(async () => {
    if (!inst) return;
    try {
      const res = await wsRequest("git:log", { projectId: project.id, instanceId: inst.id, folder: selectedFolder, count: 30 }, 15000);
      setLogEntries(res.log ? res.log.split("\n") : []);
    } catch {}
  }, [project.id, inst?.id, selectedFolder]);

  const loadBranches = useCallback(async () => {
    if (!inst) return;
    try {
      const res = await wsRequest("git:branches", { projectId: project.id, instanceId: inst.id, folder: selectedFolder }, 15000);
      const parsed = (res.branches || "").split("\n").filter(Boolean).map((line: string) => {
        const isCurrent = line.includes("*");
        const name = line.replace("*", "").trim();
        return { name, current: isCurrent };
      });
      setBranches(parsed);
    } catch {}
  }, [project.id, inst?.id, selectedFolder]);

  const viewDiff = useCallback(async (file: string, staged: boolean) => {
    if (!inst) return;
    try {
      const res = await wsRequest("git:diff", { projectId: project.id, instanceId: inst.id, folder: selectedFolder, file, staged }, 15000);
      setDiffContent(res.diff || "(no changes)");
      setDiffFile(file);
    } catch {}
  }, [project.id, inst?.id, selectedFolder]);

  const doAction = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!inst) return;
    setActionLoading(action);
    setError(null);
    try {
      await wsRequest(action, { projectId: project.id, instanceId: inst.id, folder: selectedFolder, ...payload }, 60000);
      await loadStatus();
    } catch (err: any) {
      setError(err.message);
    }
    setActionLoading(null);
  }, [project.id, inst?.id, selectedFolder, loadStatus]);

  const stagedFiles = files.filter(f => f.index !== " " && f.index !== "?");
  const unstagedFiles = files.filter(f => f.working !== " " || f.index === "?");

  const toggleFile = (path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (!inst) return <div className="p-4 text-overlay0" style={{ fontSize: 13 }}>No VPS instance available.</div>;

  if (diffContent !== null) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
          <button onClick={() => { setDiffContent(null); setDiffFile(null); }} className="text-overlay1 hover:text-text transition-colors p-1">
            <ArrowLeft size={13} />
          </button>
          <span className="text-text truncate" style={{ fontSize: 13 }}>Diff: {diffFile}</span>
        </div>
        <pre className="flex-1 overflow-auto p-3 text-subtext0 whitespace-pre-wrap break-words" style={{ fontSize: 12, lineHeight: 1.5 }}>
          {diffContent.split("\n").map((line, i) => {
            let cls = "text-subtext0";
            if (line.startsWith("+")) cls = "text-green";
            else if (line.startsWith("-")) cls = "text-red";
            else if (line.startsWith("@@")) cls = "text-blue";
            return <div key={i} className={cls}>{line}</div>;
          })}
        </pre>
      </div>
    );
  }

  if (showLog) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
          <button onClick={() => setShowLog(false)} className="text-overlay1 hover:text-text transition-colors p-1">
            <ArrowLeft size={13} />
          </button>
          <GitCommit size={13} className="text-mauve" />
          <span className="text-text" style={{ fontSize: 13 }}>Commit Log</span>
          <div className="flex-1" />
          <button onClick={loadLog} className="text-overlay1 hover:text-text transition-colors p-1">
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {logEntries.length === 0 ? (
            <div className="text-overlay0 text-center py-8" style={{ fontSize: 13 }}>No commits</div>
          ) : logEntries.map((entry, i) => {
            const hash = entry.slice(0, 7);
            const msg = entry.slice(8);
            return (
              <div key={i} className="flex items-start gap-2 px-3 py-1.5 border-b border-surface0/50 hover:bg-surface0/30 transition-colors" style={{ fontSize: 13 }}>
                <code className="text-mauve shrink-0" style={{ fontSize: 12 }}>{hash}</code>
                <span className="text-text break-words">{msg}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (showBranches) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
          <button onClick={() => setShowBranches(false)} className="text-overlay1 hover:text-text transition-colors p-1">
            <ArrowLeft size={13} />
          </button>
          <GitBranch size={13} className="text-mauve" />
          <span className="text-text" style={{ fontSize: 13 }}>Branches</span>
          <div className="flex-1" />
          <button onClick={loadBranches} className="text-overlay1 hover:text-text transition-colors p-1">
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {branches.length === 0 ? (
            <div className="text-overlay0 text-center py-8" style={{ fontSize: 13 }}>No branches</div>
          ) : branches.map((b) => (
            <button
              key={b.name}
              onClick={async () => {
                if (!b.current) {
                  await doAction("git:checkout", { branch: b.name });
                  setShowBranches(false);
                }
              }}
              disabled={b.current || actionLoading !== null}
              className={`flex items-center gap-2 w-full px-3 py-2 border-b border-surface0/50 text-left transition-colors ${
                b.current ? "bg-surface0/30 text-mauve" : "hover:bg-surface0/30 text-text"
              }`}
              style={{ fontSize: 13 }}
            >
              {b.current && <Check size={13} className="text-green shrink-0" />}
              {!b.current && <Circle size={11} className="text-overlay0 shrink-0" />}
              <span className="truncate">{b.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
        <GitBranch size={13} className="text-mauve" />
        {folders.length > 1 ? (
          <select
            value={selectedFolder}
            onChange={(e) => setSelectedFolder(e.target.value)}
            className="bg-surface0 text-text border border-surface1 rounded px-1.5 py-0.5 outline-none"
            style={{ fontSize: 13 }}
          >
            {folders.map(f => <option key={f} value={f}>{f.split("/").pop() || f}</option>)}
          </select>
        ) : (
          <span className="text-text truncate" style={{ fontSize: 13 }}>{selectedFolder}</span>
        )}
        <div className="flex-1" />
        <button onClick={() => { loadBranches(); setShowBranches(true); }} className="text-overlay1 hover:text-text transition-colors px-1.5 py-0.5 rounded hover:bg-surface0" style={{ fontSize: 12 }}>
          {branch || "..."}
        </button>
        {ahead > 0 && <span className="text-green flex items-center gap-0.5" style={{ fontSize: 12 }}><ArrowUp size={11} />{ahead}</span>}
        {behind > 0 && <span className="text-yellow flex items-center gap-0.5" style={{ fontSize: 12 }}><ArrowDown size={11} />{behind}</span>}
        <button onClick={loadStatus} disabled={loading} className="text-overlay1 hover:text-text transition-colors p-1">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-red bg-red/10 border-b border-red/20" style={{ fontSize: 13 }}>
          <span className="flex-1 truncate">{error}</span>
          <button
            onClick={() => {
              const fallback = () => {
                const ta = document.createElement("textarea");
                ta.value = error;
                ta.style.cssText = "position:fixed;opacity:0";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
              };
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(error).catch(fallback);
              } else {
                fallback();
              }
            }}
            className="shrink-0 text-red/60 hover:text-red transition-colors p-0.5"
            title="Copy error"
          >
            <Copy size={13} />
          </button>
          <button
            onClick={() => setError(null)}
            className="shrink-0 text-red/60 hover:text-red transition-colors p-0.5"
            title="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {loading && files.length === 0 ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 size={18} className="text-mauve animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {files.length === 0 && !loading && (
            <div className="text-overlay0 text-center py-8" style={{ fontSize: 13 }}>Working tree clean</div>
          )}

          {/* Staged files */}
          {stagedFiles.length > 0 && (
            <div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface0/30 border-b border-surface0">
                <span className="text-green" style={{ fontSize: 12 }}>Staged ({stagedFiles.length})</span>
                <div className="flex-1" />
                <button
                  onClick={() => doAction("git:unstage", { files: stagedFiles.map(f => f.path) })}
                  disabled={actionLoading !== null}
                  className="text-overlay1 hover:text-text transition-colors"
                  style={{ fontSize: 12 }}
                >
                  Unstage All
                </button>
              </div>
              {stagedFiles.map(f => (
                <div key={"s-" + f.path} className="flex items-center gap-2 px-3 py-1 border-b border-surface0/50 hover:bg-surface0/30 transition-colors group" style={{ fontSize: 13 }}>
                  {gitFileIcon(f.index, " ")}
                  <button onClick={() => viewDiff(f.path, true)} className="text-text truncate text-left flex-1 hover:text-mauve transition-colors">{f.path}</button>
                  <button
                    onClick={() => doAction("git:unstage", { files: [f.path] })}
                    className="text-overlay0 hover:text-text opacity-0 group-hover:opacity-100 transition-all"
                    title="Unstage"
                  >
                    <Minus size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Unstaged / untracked files */}
          {unstagedFiles.length > 0 && (
            <div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface0/30 border-b border-surface0">
                <span className="text-yellow" style={{ fontSize: 12 }}>Changes ({unstagedFiles.length})</span>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    const toStage = selectedFiles.size > 0
                      ? unstagedFiles.filter(f => selectedFiles.has(f.path)).map(f => f.path)
                      : unstagedFiles.map(f => f.path);
                    doAction("git:stage", { files: toStage });
                    setSelectedFiles(new Set());
                  }}
                  disabled={actionLoading !== null}
                  className="text-overlay1 hover:text-text transition-colors"
                  style={{ fontSize: 12 }}
                >
                  {selectedFiles.size > 0 ? `Stage Selected (${selectedFiles.size})` : "Stage All"}
                </button>
              </div>
              {unstagedFiles.map(f => (
                <div key={"u-" + f.path} className="flex items-center gap-2 px-3 py-1 border-b border-surface0/50 hover:bg-surface0/30 transition-colors group" style={{ fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(f.path)}
                    onChange={() => toggleFile(f.path)}
                    className="accent-mauve"
                  />
                  {gitFileIcon(f.index, f.working)}
                  <button onClick={() => viewDiff(f.path, false)} className="text-text truncate text-left flex-1 hover:text-mauve transition-colors">{f.path}</button>
                  <button
                    onClick={() => doAction("git:stage", { files: [f.path] })}
                    className="text-overlay0 hover:text-text opacity-0 group-hover:opacity-100 transition-all"
                    title="Stage"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Commit bar */}
      {stagedFiles.length > 0 && (
        <div className="shrink-0 border-t border-surface0 px-3 py-2 bg-mantle flex items-center gap-2">
          <input
            type="text"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && commitMsg.trim()) {
                doAction("git:commit", { message: commitMsg.trim() });
                setCommitMsg("");
              }
            }}
            placeholder="Commit message..."
            className="flex-1 bg-surface0 text-text placeholder-overlay0 border border-surface1 rounded px-2 py-1 outline-none focus:border-mauve transition-colors"
            style={{ fontSize: 13 }}
          />
          <button
            onClick={() => {
              if (commitMsg.trim()) {
                doAction("git:commit", { message: commitMsg.trim() });
                setCommitMsg("");
              }
            }}
            disabled={!commitMsg.trim() || actionLoading !== null}
            className="px-3 py-1 rounded bg-mauve text-crust hover:bg-mauve/80 disabled:opacity-40 transition-colors"
            style={{ fontSize: 13 }}
          >
            {actionLoading === "git:commit" ? <Loader2 size={13} className="animate-spin" /> : "Commit"}
          </button>
        </div>
      )}

      {/* Action bar */}
      <div className="shrink-0 border-t border-surface0 px-3 py-2 bg-mantle flex items-center gap-2">
        <button
          onClick={() => doAction("git:pull")}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface0 hover:bg-surface1 text-text transition-colors disabled:opacity-40"
          style={{ fontSize: 12 }}
        >
          {actionLoading === "git:pull" ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}
          Pull
        </button>
        <button
          onClick={() => doAction("git:push")}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface0 hover:bg-surface1 text-text transition-colors disabled:opacity-40"
          style={{ fontSize: 12 }}
        >
          {actionLoading === "git:push" ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />}
          Push
        </button>
        <button
          onClick={() => doAction("git:stash")}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface0 hover:bg-surface1 text-text transition-colors disabled:opacity-40"
          style={{ fontSize: 12 }}
        >
          Stash
        </button>
        <button
          onClick={() => doAction("git:stash-pop")}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface0 hover:bg-surface1 text-text transition-colors disabled:opacity-40"
          style={{ fontSize: 12 }}
        >
          Pop
        </button>
        <div className="flex-1" />
        <button
          onClick={() => { loadLog(); setShowLog(true); }}
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface0 hover:bg-surface1 text-text transition-colors"
          style={{ fontSize: 12 }}
        >
          <GitCommit size={12} />
          Log
        </button>
      </div>
    </div>
  );
}
