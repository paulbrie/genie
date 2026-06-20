"use client";

// Manager popup tab: register git repos (URL + fine-grained token) against
// a VM, browse their commits + branches over the existing git:* SSH handler,
// and toggle hourly auto-save. Server reconciles the on-VM daemon whenever a
// row changes (see vps/git-autosave-reconciler.ts).
//
// State is local (useState). No Subject — the same data isn't shared with
// other components, and the popup is short-lived.

import { useCallback, useEffect, useState } from "react";
import {
  GitBranch, GitCommit, GitFork, KeyRound, Loader2, Plus, RefreshCw, Trash2,
  Download, Upload, AlertTriangle, ArrowLeftRight, Archive, FileDiff,
} from "lucide-react";
import { wsRequest } from "@/lib/ws";
import { cn } from "@/lib/utils";

interface VpsGitRepoPublic {
  id: string;
  projectId: string;
  instanceId: string;
  repoUrl: string;
  repoPath: string;
  provider: "github" | "gitlab" | "other";
  hasToken: boolean;
  autoSave: boolean;
}

interface VmGithubTabProps {
  projectId: string;
  instanceId: string;
}

const DEFAULT_PATH = "/opt/project";

interface DetectedRepo {
  isRepo: boolean;
  repoPath: string;
  remoteUrl: string | null;
  branch: string | null;
}

export function VmGithubTab({ projectId, instanceId }: VmGithubTabProps) {
  const [repos, setRepos] = useState<VpsGitRepoPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedRepo | null>(null);
  const [detecting, setDetecting] = useState(false);

  const loadRepos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await wsRequest<{ repos: VpsGitRepoPublic[] }>(
        "vps:git:repos:list",
        { projectId, instanceId },
      );
      setRepos(res.repos);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, instanceId]);

  useEffect(() => { void loadRepos(); }, [loadRepos]);

  // When nothing is registered, probe the VM for a pre-existing repo at the
  // default path so we can offer to adopt it instead of an empty "init" state.
  useEffect(() => {
    if (loading || repos.length > 0) { setDetected(null); return; }
    let cancelled = false;
    setDetecting(true);
    void wsRequest<DetectedRepo>("vps:git:repos:detect", { projectId, instanceId, repoPath: DEFAULT_PATH }, 30_000)
      .then((res) => { if (!cancelled) setDetected(res.isRepo ? res : null); })
      .catch(() => { if (!cancelled) setDetected(null); })
      .finally(() => { if (!cancelled) setDetecting(false); });
    return () => { cancelled = true; };
  }, [loading, repos.length, projectId, instanceId]);

  const onInit = useCallback(async () => {
    setBusyId("__init__");
    setError(null);
    try {
      await wsRequest("vps:git:repos:init", { projectId, instanceId, repoPath: DEFAULT_PATH }, 60_000);
      setShowAdd(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [projectId, instanceId]);

  const onToggleAutoSave = useCallback(async (id: string, enabled: boolean) => {
    setBusyId(id);
    try {
      await wsRequest("vps:git:repos:set-auto-save", { projectId, instanceId, id, enabled }, 60_000);
      await loadRepos();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [projectId, instanceId, loadRepos]);

  const onRemove = useCallback(async (id: string) => {
    if (!confirm("Remove this repo? The on-VM working tree stays; only the registry entry is deleted.")) return;
    setBusyId(id);
    try {
      await wsRequest("vps:git:repos:remove", { projectId, instanceId, id }, 60_000);
      if (selectedId === id) setSelectedId(null);
      await loadRepos();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [projectId, instanceId, loadRepos, selectedId]);

  const onAdded = useCallback(async () => {
    setShowAdd(false);
    await loadRepos();
  }, [loadRepos]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-overlay0">
        <Loader2 size={14} className="animate-spin" /> Loading repos…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <div className="text-red text-sm">{error}</div>}

      {/* Detected-but-unregistered repo: offer one-click adopt */}
      {repos.length === 0 && !showAdd && detected && (
        <div className="flex flex-col items-start gap-3 p-4 rounded-md bg-surface0/30 border border-blue">
          <div className="text-text flex items-center gap-1.5">
            <GitFork size={14} className="text-blue" />
            Existing git repo found at <code>{detected.repoPath}</code>.
          </div>
          <div className="text-overlay0 text-sm flex flex-col gap-0.5">
            {detected.remoteUrl
              ? <div>Remote: <code className="text-xs">{detected.remoteUrl}</code></div>
              : <div>No <code>origin</code> remote configured yet.</div>}
            {detected.branch && <div>Branch: <code className="text-xs">{detected.branch}</code></div>}
            <div className="mt-1">It isn’t registered here yet — register it to browse commits and enable auto-save.</div>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-mauve text-background hover:bg-lavender border-none cursor-pointer"
          >
            <Plus size={14} /> Register this repo
          </button>
        </div>
      )}

      {/* Empty state: offer one-click init (no pre-existing repo detected) */}
      {repos.length === 0 && !showAdd && !detected && (
        <div className="flex flex-col items-start gap-3 p-4 rounded-md bg-surface0/30 border border-surface0">
          <div className="text-text flex items-center gap-1.5">
            No git repos registered on this VM.
            {detecting && <Loader2 size={13} className="animate-spin text-overlay0" />}
          </div>
          <div className="text-overlay0 text-sm">
            Initialize <code>{DEFAULT_PATH}</code> as a new repo, or add an existing one.
          </div>
          <div className="flex gap-2">
            <button
              onClick={onInit}
              disabled={busyId !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-mauve text-background hover:bg-lavender border-none cursor-pointer disabled:opacity-50"
            >
              {busyId === "__init__" ? <Loader2 size={14} className="animate-spin" /> : <GitFork size={14} />}
              Init {DEFAULT_PATH}
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface0 text-text border-none cursor-pointer"
            >
              <Plus size={14} /> Add existing repo
            </button>
          </div>
        </div>
      )}

      {/* Repo list */}
      {repos.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-overlay0 text-sm">{repos.length} repo{repos.length === 1 ? "" : "s"}</div>
            <div className="flex gap-1">
              <button
                onClick={loadRepos}
                title="Refresh"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-transparent text-overlay0 hover:text-text hover:bg-surface0 border-none cursor-pointer"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-surface0 text-text border-none cursor-pointer"
              >
                <Plus size={14} /> Add
              </button>
            </div>
          </div>
          {repos.map((r) => (
            <RepoRow
              key={r.id}
              repo={r}
              busy={busyId === r.id}
              selected={selectedId === r.id}
              onSelect={() => setSelectedId(selectedId === r.id ? null : r.id)}
              onToggleAutoSave={(enabled) => onToggleAutoSave(r.id, enabled)}
              onRemove={() => onRemove(r.id)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <AddRepoForm
          projectId={projectId}
          instanceId={instanceId}
          initialRepoUrl={detected?.remoteUrl ?? ""}
          initialRepoPath={detected?.repoPath ?? DEFAULT_PATH}
          onCancel={() => setShowAdd(false)}
          onAdded={onAdded}
        />
      )}

      {selectedId && (
        <BrowsePanel
          projectId={projectId}
          instanceId={instanceId}
          repo={repos.find((r) => r.id === selectedId)!}
          onRepoChanged={loadRepos}
        />
      )}
    </div>
  );
}

interface RepoRowProps {
  repo: VpsGitRepoPublic;
  busy: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleAutoSave: (enabled: boolean) => void;
  onRemove: () => void;
}

function RepoRow({ repo, busy, selected, onSelect, onToggleAutoSave, onRemove }: RepoRowProps) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 flex flex-col gap-2",
        selected ? "border-blue bg-surface0/30" : "border-surface0 bg-mantle",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={onSelect}
          className="text-left bg-transparent border-none cursor-pointer p-0 flex-1 min-w-0"
        >
          <div className="text-text truncate">{repo.repoUrl}</div>
          <div className="text-overlay0 text-sm flex items-center gap-1.5 mt-0.5">
            <code className="text-xs">{repo.repoPath}</code>
            <span>·</span>
            <span>{repo.provider}</span>
            {repo.hasToken ? (
              <>
                <span>·</span>
                <KeyRound size={11} className="text-green" />
              </>
            ) : null}
          </div>
        </button>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-1.5 text-sm text-overlay0 cursor-pointer">
            <input
              type="checkbox"
              checked={repo.autoSave}
              disabled={busy || !repo.hasToken}
              onChange={(e) => onToggleAutoSave(e.target.checked)}
              title={repo.hasToken ? "Auto-commit every hour" : "Add a token before enabling auto-save"}
            />
            Auto-save
          </label>
          <button
            onClick={onRemove}
            disabled={busy}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-transparent text-overlay0 hover:text-red hover:bg-surface0 border-none cursor-pointer disabled:opacity-50"
            title="Remove"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        </div>
      </div>
      {repo.autoSave && (
        <div className="text-overlay0 text-base leading-relaxed border-t border-surface0 pt-2">
          A timer on the VM commits all changes in <code className="text-overlay1">{repo.repoPath}</code> and
          pushes them to the remote once an hour (author “Genie”). Uses the stored token; nothing is
          committed when there are no changes.
        </div>
      )}
    </div>
  );
}

interface AddRepoFormProps {
  projectId: string;
  instanceId: string;
  initialRepoUrl?: string;
  initialRepoPath?: string;
  onCancel: () => void;
  onAdded: () => void;
}

function AddRepoForm({ projectId, instanceId, initialRepoUrl = "", initialRepoPath = DEFAULT_PATH, onCancel, onAdded }: AddRepoFormProps) {
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl);
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [provider, setProvider] = useState<"github" | "gitlab" | "other">(
    initialRepoUrl.includes("gitlab") ? "gitlab" : "github",
  );
  const [token, setToken] = useState("");
  const [autoSave, setAutoSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    setSaving(true);
    try {
      await wsRequest("vps:git:repos:add", {
        projectId, instanceId,
        repoUrl: repoUrl.trim(),
        repoPath: repoPath.trim() || DEFAULT_PATH,
        provider,
        token: token.trim() || null,
        autoSave: autoSave && !!token.trim(),
      }, 60_000);
      onAdded();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-surface0 bg-mantle p-3 flex flex-col gap-2">
      <div className="text-text font-medium">Add repo</div>
      <input
        value={repoUrl}
        onChange={(e) => setRepoUrl(e.target.value)}
        placeholder="https://github.com/owner/repo.git"
        className="w-full px-2 py-1.5 rounded-md bg-base border border-surface0 text-text"
      />
      <input
        value={repoPath}
        onChange={(e) => setRepoPath(e.target.value)}
        placeholder={DEFAULT_PATH}
        className="w-full px-2 py-1.5 rounded-md bg-base border border-surface0 text-text"
      />
      <div className="flex gap-3 text-sm">
        {(["github", "gitlab", "other"] as const).map((p) => (
          <label key={p} className="flex items-center gap-1 cursor-pointer text-overlay0">
            <input type="radio" name="provider" checked={provider === p} onChange={() => setProvider(p)} />
            {p}
          </label>
        ))}
      </div>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Fine-grained access token (optional, required for push)"
        className="w-full px-2 py-1.5 rounded-md bg-base border border-surface0 text-text"
        autoComplete="new-password"
      />
      <label className="flex items-center gap-1.5 text-sm text-overlay0 cursor-pointer">
        <input
          type="checkbox"
          checked={autoSave}
          onChange={(e) => setAutoSave(e.target.checked)}
          disabled={!token.trim()}
        />
        Enable hourly auto-save (requires token)
      </label>
      {err && <div className="text-red text-sm">{err}</div>}
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={saving || !repoUrl.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-mauve text-background hover:bg-lavender border-none cursor-pointer disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded-md bg-surface0 text-text border-none cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  );
}

interface BrowsePanelProps {
  projectId: string;
  instanceId: string;
  repo: VpsGitRepoPublic;
  /** Reload the repo list after a reconcile changes the registered URL. */
  onRepoChanged: () => void;
}

/** Strip credentials, trailing `.git`, and trailing slashes so a DB url and the
 *  on-disk remote compare equal even when one carries an embedded token. */
function normalizeRemote(url: string | null | undefined): string {
  if (!url) return "";
  return url.trim()
    .replace(/^([a-z]+:\/\/)[^/@]+@/i, "$1") // drop user:pass@
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** Parse `git branch -a --format='%(refname:short) %(HEAD)'` into local branch
 *  names + the current one. Remote-tracking refs (origin/…) are excluded. */
function parseBranches(raw: string): { names: string[]; current: string | null } {
  const names: string[] = [];
  let current: string | null = null;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const [name, head] = t.split(/\s+/);
    if (!name || name.startsWith("origin/") || name.startsWith("remotes/")) continue;
    names.push(name);
    if (head === "*") current = name;
  }
  return { names: [...new Set(names)], current };
}

/** Parse `git status --porcelain -b` into changed files (skipping the `##` header). */
function parsePorcelain(raw: string): { code: string; path: string }[] {
  const out: { code: string; path: string }[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("##")) continue;
    out.push({ code: line.slice(0, 2), path: line.slice(3) });
  }
  return out;
}

function BrowsePanel({ projectId, instanceId, repo, onRepoChanged }: BrowsePanelProps) {
  const [log, setLog] = useState<string>("");
  const [branchesRaw, setBranchesRaw] = useState<string>("");
  const [status, setStatus] = useState<{ branch: string; ahead: number; behind: number } | null>(null);
  const [files, setFiles] = useState<{ code: string; path: string }[]>([]);
  const [lastCommit, setLastCommit] = useState<{ author: string; relative: string; subject: string } | null>(null);
  const [diskRemote, setDiskRemote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null); // which op is running
  const [actionOut, setActionOut] = useState<string>("");
  const [checkoutTo, setCheckoutTo] = useState<string>("");
  const [commitMsg, setCommitMsg] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [newBranchPush, setNewBranchPush] = useState(true);
  const [openDiff, setOpenDiff] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [logRes, brRes, stRes, lcRes, detRes] = await Promise.all([
        wsRequest<{ log?: string }>("git:log", { projectId, instanceId, folder: repo.repoPath, count: 30 }, 15_000),
        wsRequest<{ branches?: string }>("git:branches", { projectId, instanceId, folder: repo.repoPath }, 15_000),
        wsRequest<{ branch?: string; ahead?: number; behind?: number; porcelain?: string }>("git:status", { projectId, instanceId, folder: repo.repoPath }, 15_000).catch(() => ({} as { branch?: string; ahead?: number; behind?: number; porcelain?: string })),
        wsRequest<{ author?: string; relative?: string; subject?: string }>("git:last-commit", { projectId, instanceId, folder: repo.repoPath }, 15_000).catch(() => ({} as { author?: string; relative?: string; subject?: string })),
        wsRequest<DetectedRepo>("vps:git:repos:detect", { projectId, instanceId, repoPath: repo.repoPath }, 30_000).catch(() => null),
      ]);
      setLog(logRes.log ?? "");
      setBranchesRaw(brRes.branches ?? "");
      setStatus(stRes.branch ? { branch: stRes.branch, ahead: stRes.ahead ?? 0, behind: stRes.behind ?? 0 } : null);
      setFiles(parsePorcelain(stRes.porcelain ?? ""));
      setLastCommit(lcRes.relative ? { author: lcRes.author ?? "", relative: lcRes.relative, subject: lcRes.subject ?? "" } : null);
      setDiskRemote(detRes?.remoteUrl ?? null);
    } catch {
      // wsRequest rejects on timeout — leave previous content and let the user retry.
    } finally {
      setLoading(false);
    }
  }, [projectId, instanceId, repo.repoPath]);

  useEffect(() => { refresh(); setOpenDiff(null); }, [refresh]);

  const { names: branchNames, current } = parseBranches(branchesRaw);
  const dirty = files.length > 0;

  // Run a git command and surface its output inline.
  const runGit = useCallback(async (label: string, type: string, payload: Record<string, unknown>, done: string) => {
    setAction(label);
    setActionOut("");
    try {
      const res = await wsRequest<Record<string, string>>(type, { projectId, instanceId, folder: repo.repoPath, ...payload }, 90_000);
      setActionOut(res.output ?? done);
      await refresh();
    } catch (e) {
      setActionOut(e instanceof Error ? e.message : String(e));
    } finally {
      setAction(null);
    }
  }, [projectId, instanceId, repo.repoPath, refresh]);

  // Dirty-tree guard: switching branches or pulling onto uncommitted changes can
  // fail or clobber — confirm first.
  const guardedRun = useCallback((label: string, type: string, payload: Record<string, unknown>, done: string) => {
    if (dirty && !confirm("You have uncommitted changes. Continue anyway? (Consider committing or stashing first.)")) return;
    void runGit(label, type, payload, done);
  }, [dirty, runGit]);

  // Stage everything + commit (+ push). Multi-step, so not via runGit.
  const commit = useCallback(async (push: boolean) => {
    const message = commitMsg.trim();
    if (!message) return;
    setAction(push ? "commit-push" : "commit");
    setActionOut("");
    try {
      await wsRequest("git:stage", { projectId, instanceId, folder: repo.repoPath, files: ["."] }, 30_000);
      const res = await wsRequest<{ output?: string }>("git:commit", { projectId, instanceId, folder: repo.repoPath, message }, 30_000);
      let out = res.output ?? "committed";
      if (push) {
        const pr = await wsRequest<{ output?: string }>("git:push", { projectId, instanceId, folder: repo.repoPath }, 90_000);
        out += "\n" + (pr.output ?? "pushed");
      }
      setActionOut(out);
      setCommitMsg("");
      await refresh();
    } catch (e) {
      setActionOut(e instanceof Error ? e.message : String(e));
    } finally {
      setAction(null);
    }
  }, [commitMsg, projectId, instanceId, repo.repoPath, refresh]);

  const createBranch = useCallback(async () => {
    const branch = newBranch.trim();
    if (!branch) return;
    await runGit("newbranch", "git:checkout-b", { branch, push: newBranchPush }, "created");
    setNewBranch("");
  }, [newBranch, newBranchPush, runGit]);

  const toggleDiff = useCallback(async (path: string) => {
    if (openDiff === path) { setOpenDiff(null); return; }
    setOpenDiff(path);
    setDiffText("Loading…");
    try {
      const res = await wsRequest<{ diff?: string }>("git:diff", { projectId, instanceId, folder: repo.repoPath, file: path }, 20_000);
      setDiffText(res.diff || "(no diff — file may be untracked or staged)");
    } catch {
      setDiffText("Failed to load diff.");
    }
  }, [openDiff, projectId, instanceId, repo.repoPath]);

  // DB vs /opt/project mismatch on the origin remote.
  const dbUrl = repo.repoUrl;
  const mismatch = !!diskRemote && normalizeRemote(diskRemote) !== normalizeRemote(dbUrl);

  const reconcile = useCallback(async (direction: "db-to-disk" | "disk-to-db") => {
    setAction(direction);
    try {
      if (direction === "disk-to-db") {
        await wsRequest("vps:git:repos:update", { projectId, instanceId, id: repo.id, repoUrl: diskRemote }, 60_000);
      } else {
        await wsRequest("vps:git:repos:init", { projectId, instanceId, repoPath: repo.repoPath, repoUrl: dbUrl }, 60_000);
      }
      onRepoChanged();
      await refresh();
    } catch (e) {
      setActionOut(e instanceof Error ? e.message : String(e));
    } finally {
      setAction(null);
    }
  }, [projectId, instanceId, repo.id, repo.repoPath, diskRemote, dbUrl, onRepoChanged, refresh]);

  const busy = action !== null || loading;
  const autoSaved = lastCommit && /genie/i.test(lastCommit.author);

  return (
    <div className="rounded-md border border-surface0 bg-mantle p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-text font-medium truncate flex items-center gap-2">
          Browse <code className="text-sm">{repo.repoPath}</code>
          {status && (
            <span className="text-overlay0 text-sm font-normal inline-flex items-center gap-1">
              <GitBranch size={11} /> {status.branch}
              {status.ahead > 0 && <span className="text-green">↑{status.ahead}</span>}
              {status.behind > 0 && <span className="text-peach">↓{status.behind}</span>}
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-transparent text-overlay0 hover:text-text border-none cursor-pointer"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {/* Auto-save / last-commit line */}
      {lastCommit && (
        <div className="text-overlay0 text-xs flex items-center gap-1.5">
          <GitCommit size={11} className={cn(autoSaved && repo.autoSave ? "text-green" : "text-overlay0")} />
          {autoSaved && repo.autoSave ? "Auto-saved" : "Last commit"} {lastCommit.relative}
          <span className="text-overlay0/70">· {lastCommit.author}</span>
          <span className="truncate text-overlay1">— {lastCommit.subject}</span>
        </div>
      )}

      {/* DB vs /opt/project reconcile */}
      {mismatch && (
        <div className="rounded-md border border-peach/50 bg-peach/10 p-2.5 flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-1.5 text-peach">
            <AlertTriangle size={13} /> Registered URL doesn’t match the VM’s <code className="text-xs">origin</code>.
          </div>
          <div className="text-overlay1 text-xs flex flex-col gap-0.5">
            <div>Registry: <code>{dbUrl || "(none)"}</code></div>
            <div>On VM: <code>{diskRemote}</code></div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => reconcile("disk-to-db")} disabled={busy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-surface0 text-text border-none cursor-pointer disabled:opacity-50"
              title="Update the registry to the URL found on the VM">
              {action === "disk-to-db" ? <Loader2 size={12} className="animate-spin" /> : <ArrowLeftRight size={12} />} Use VM’s URL
            </button>
            <button onClick={() => reconcile("db-to-disk")} disabled={busy || !dbUrl}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-surface0 text-text border-none cursor-pointer disabled:opacity-50"
              title="Rewrite the VM's origin remote to the registered URL">
              {action === "db-to-disk" ? <Loader2 size={12} className="animate-spin" /> : <ArrowLeftRight size={12} />} Use registry URL
            </button>
          </div>
        </div>
      )}

      {/* Branch switch + new branch + stash + pull/push */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={checkoutTo || current || ""}
          onChange={(e) => setCheckoutTo(e.target.value)}
          disabled={busy || branchNames.length === 0}
          className="px-2 py-1 rounded-md bg-base border border-surface0 text-text text-sm font-mono"
        >
          {branchNames.length === 0 && <option value="">(no branches)</option>}
          {branchNames.map((b) => <option key={b} value={b}>{b}{b === current ? " (current)" : ""}</option>)}
        </select>
        <button
          onClick={() => guardedRun("checkout", "git:checkout", { branch: checkoutTo || current }, "switched")}
          disabled={busy || !checkoutTo || checkoutTo === current}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-surface0 text-text border-none cursor-pointer disabled:opacity-50"
          title="Switch branch (git checkout)"
        >
          {action === "checkout" ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />} Switch
        </button>
        <button
          onClick={() => runGit("stash", "git:stash", {}, "stashed")}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-surface0 text-text border-none cursor-pointer disabled:opacity-50"
          title="git stash (shelve uncommitted changes)"
        >
          {action === "stash" ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />} Stash
        </button>
        <button
          onClick={() => runGit("stash-pop", "git:stash-pop", {}, "restored")}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-transparent text-overlay1 hover:text-text border-none cursor-pointer disabled:opacity-50"
          title="git stash pop (restore the last stash)"
        >
          Pop
        </button>
        <div className="flex-1" />
        <button onClick={() => guardedRun("pull", "git:pull", {}, "pulled")} disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-surface0 text-text border-none cursor-pointer disabled:opacity-50" title="git pull">
          {action === "pull" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Pull
        </button>
        <button onClick={() => runGit("push", "git:push", {}, "pushed")} disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-mauve text-background hover:bg-lavender border-none cursor-pointer disabled:opacity-50" title="git push">
          {action === "push" ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Push
        </button>
      </div>

      {/* New branch */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          placeholder="new-branch-name"
          className="px-2 py-1 rounded-md bg-base border border-surface0 text-text text-sm font-mono w-48"
        />
        <label className="flex items-center gap-1 text-xs text-overlay0 cursor-pointer">
          <input type="checkbox" checked={newBranchPush} onChange={(e) => setNewBranchPush(e.target.checked)} /> push
        </label>
        <button
          onClick={createBranch}
          disabled={busy || !newBranch.trim()}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-surface0 text-text border-none cursor-pointer disabled:opacity-50"
          title="Create + switch to a new branch (git checkout -b)"
        >
          {action === "newbranch" ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} New branch
        </button>
      </div>

      {/* Uncommitted changes + commit */}
      <div>
        <div className="text-overlay0 text-sm mb-1 flex items-center gap-1">
          <FileDiff size={12} /> Changes {dirty ? `(${files.length})` : ""}
        </div>
        {!dirty ? (
          <div className="text-overlay0 text-xs">Working tree clean.</div>
        ) : (
          <>
            <div className="flex flex-col gap-0.5 max-h-48 overflow-auto rounded-md bg-base p-1.5">
              {files.map((f) => (
                <div key={f.path}>
                  <button
                    onClick={() => toggleDiff(f.path)}
                    className="w-full text-left flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-surface0 bg-transparent border-none cursor-pointer text-xs"
                  >
                    <span className={cn("font-mono shrink-0 w-6", /^\?\?/.test(f.code) ? "text-green" : f.code.includes("D") ? "text-red" : "text-peach")}>{f.code.trim() || "??"}</span>
                    <span className="text-text truncate">{f.path}</span>
                  </button>
                  {openDiff === f.path && (
                    <pre className="bg-mantle rounded-md p-2 text-xs whitespace-pre-wrap text-overlay1 max-h-56 overflow-auto my-1">{diffText}</pre>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <input
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                placeholder="Commit message…"
                className="flex-1 px-2 py-1 rounded-md bg-base border border-surface0 text-text text-sm"
              />
              <button onClick={() => commit(false)} disabled={busy || !commitMsg.trim()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-surface0 text-text border-none cursor-pointer disabled:opacity-50" title="git add -A && git commit">
                {action === "commit" ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />} Commit
              </button>
              <button onClick={() => commit(true)} disabled={busy || !commitMsg.trim()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-mauve text-background hover:bg-lavender border-none cursor-pointer disabled:opacity-50" title="commit + push">
                {action === "commit-push" ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Commit & Push
              </button>
            </div>
          </>
        )}
      </div>

      {actionOut && (
        <pre className="bg-base rounded-md p-2 text-xs whitespace-pre-wrap text-overlay1 max-h-32 overflow-auto">{actionOut}</pre>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-overlay0 text-sm mb-1 flex items-center gap-1">
            <GitBranch size={12} /> Branches
          </div>
          <pre className="bg-base rounded-md p-2 text-xs whitespace-pre-wrap text-text max-h-64 overflow-auto">
            {branchesRaw || "—"}
          </pre>
        </div>
        <div>
          <div className="text-overlay0 text-sm mb-1 flex items-center gap-1">
            <GitCommit size={12} /> Recent commits
          </div>
          <pre className="bg-base rounded-md p-2 text-xs whitespace-pre-wrap text-text max-h-64 overflow-auto">
            {log || "—"}
          </pre>
        </div>
      </div>
    </div>
  );
}
