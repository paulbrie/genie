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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue text-base border-none cursor-pointer"
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue text-base border-none cursor-pointer disabled:opacity-50"
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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue text-base border-none cursor-pointer disabled:opacity-50"
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
}

function BrowsePanel({ projectId, instanceId, repo }: BrowsePanelProps) {
  const [log, setLog] = useState<string>("");
  const [branches, setBranches] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [logRes, brRes] = await Promise.all([
        wsRequest<{ log?: string }>("git:log", { projectId, instanceId, folder: repo.repoPath, count: 30 }, 15_000),
        wsRequest<{ branches?: string }>("git:branches", { projectId, instanceId, folder: repo.repoPath }, 15_000),
      ]);
      setLog(logRes.log ?? "");
      setBranches(brRes.branches ?? "");
    } catch {
      // wsRequest rejects on timeout — leave previous content and let the user retry.
    } finally {
      setLoading(false);
    }
  }, [projectId, instanceId, repo.repoPath]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="rounded-md border border-surface0 bg-mantle p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-text font-medium truncate">
          Browse <code className="text-sm">{repo.repoPath}</code>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-transparent text-overlay0 hover:text-text border-none cursor-pointer"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-overlay0 text-sm mb-1 flex items-center gap-1">
            <GitBranch size={12} /> Branches
          </div>
          <pre className="bg-base rounded-md p-2 text-xs whitespace-pre-wrap text-text max-h-64 overflow-auto">
            {branches || "—"}
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
