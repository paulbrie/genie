"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowUpDown, ChevronDown, CloudOff, Database, ExternalLink,
  FileText, History, Loader2, MessageSquare, Moon, Play, Search, Server, Shield,
  Skull, Sun, TerminalSquare, Trash2,
} from "lucide-react";
import type {
  ProcessInfo, ProjectDef, VpsDeployState, VpsInstance, VpsInstanceState, VpsProcessInfo,
} from "@/store/types";
import { $vpsDeploy } from "@/store/subjects";
import {
  addSshTerminalTab, checkVpsStatus, deployToProvider, disconnectVps, fetchVpsLogs,
  fetchVpsStats, hibernateVps, killVpsProcess, loadDeployLogs, startMcpTunnel,
  teardownVps, vpsExec, wakeVps,
} from "@/store/actions";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn, parseDockerPorts } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { ChatView } from "@/components/chat/chat-view";
import { DbExplorer } from "@/components/admin/db-explorer";
import { FileExplorer } from "@/components/project/vps-file-explorer";
import { DropletInstanceBar } from "@/components/project/droplet-instance-bar";
import { ProcessCity as IsometricProcessCity } from "@/components/ui/process-city";
import { ClaudeLogo, VpsFirewall } from "@/components/project/project-detail";
import { DeployHistoryPanel } from "./deploy-history";
import { VpsRecipes, VpsRunCommands } from "./vps-recipes";

/** Claude Terminal launch button used inside VpsInstanceCard. Probes for Genie
 *  Standard Setup so the terminal opens as `genie` when the deploy user has been
 *  installed; falls back to the saved (image-default) connection username
 *  otherwise. Disabled while the genie-standard recipe check is in flight to
 *  avoid spawning a terminal under the wrong user. */
function ClaudeTerminalButton({ projectId, instance }: { projectId: string; instance: { id: string; label?: string; connection: { username: string; host: string; port: number; privateKeyPath: string } } }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const vpsDeployState = useDeepSubjectAll<VpsDeployState>($vpsDeploy);
  const recipeState = vpsDeployState.instances[instance.id]?.recipes?.["genie-standard"];
  // Genie Standard Setup installs `claude` globally + creates the `genie` user.
  // When it's installed, launch the terminal as `genie` so claude has its own
  // home/config/scope, even if the saved connection still uses the image-default
  // user (almalinux/ubuntu/debian) from a bare VM deploy.
  const genieInstalled = recipeState?.installed === true;
  // Gate the button until the genie-standard check has resolved (true|false).
  // Without this, clicking too early would launch as the saved (non-genie) user
  // even on a VM where genie *is* installed — wrong SSH user → no $HOME/.claude.
  const checkPending = typeof recipeState?.installed !== "boolean";

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const launch = (resume: boolean) => {
    if (checkPending) return;
    setOpen(false);
    const { host, port, privateKeyPath } = instance.connection;
    const username = genieInstalled ? "genie" : instance.connection.username;
    startMcpTunnel(projectId, instance.id);
    const cmd = resume ? "claude --dangerously-skip-permissions --resume" : "claude --dangerously-skip-permissions";
    const label = resume ? `Claude (resume) @ ${instance.label || host}` : `Claude @ ${instance.label || host}`;
    addSshTerminalTab({ host, port, username, privateKeyPath }, label, cmd);
  };

  const disabledTitle = checkPending ? "Checking Genie Standard Setup… terminal will launch as the correct user once the check resolves." : undefined;

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center">
        <button
          onClick={() => launch(false)}
          disabled={checkPending}
          title={disabledTitle}
          className="text-md text-peach hover:underline flex items-center gap-1 disabled:opacity-40 disabled:cursor-wait disabled:no-underline"
        >
          {checkPending ? <Loader2 size={12} className="animate-spin" /> : <ClaudeLogo size={12} />}
          Claude Terminal
        </button>
        <button
          onClick={() => setOpen(!open)}
          disabled={checkPending}
          title={disabledTitle}
          className="text-peach hover:text-peach/80 bg-transparent border-none cursor-pointer p-0 ml-0.5 disabled:opacity-40 disabled:cursor-wait"
        >
          <ChevronDown size={11} />
        </button>
      </div>
      {open && !checkPending && (
        <div className="absolute top-full left-0 mt-1 bg-mantle border border-surface0 rounded-lg shadow-lg py-1 min-w-[140px] z-50">
          <button
            onClick={() => launch(false)}
            className="flex items-center gap-2 w-full px-3 py-1.5 bg-transparent border-none cursor-pointer text-md text-text hover:bg-surface0 transition-colors text-left"
          >
            <Play size={11} className="text-green" />
            New
          </button>
          <button
            onClick={() => launch(true)}
            className="flex items-center gap-2 w-full px-3 py-1.5 bg-transparent border-none cursor-pointer text-md text-text hover:bg-surface0 transition-colors text-left"
          >
            <History size={11} className="text-blue" />
            Resume
          </button>
        </div>
      )}
    </div>
  );
}

/** Isometric process-city visualization, wired into the project page. Wraps
 *  the generic IsometricProcessCity with the per-instance `processes` array
 *  and a stable Set of pids so React can short-circuit re-renders. */
function VpsProcessCity({ processes }: { processes: VpsProcessInfo[] }) {
  const mapped: ProcessInfo[] = useMemo(
    () => processes.map((p) => ({ ...p, ppid: p.ppid ?? 0 })),
    [processes],
  );
  const allPids = useMemo(() => new Set(mapped.map((p) => p.pid)), [mapped]);
  const emptySet = useMemo(() => new Set<number>(), []);
  const [neighborhoodMode, setNeighborhoodMode] = useState<"user" | "process-tree">("user");

  return (
    <IsometricProcessCity
      processes={mapped}
      geniePids={emptySet}
      layoutMode="stable"
      neighborhoodMode={neighborhoodMode}
      onNeighborhoodModeChange={setNeighborhoodMode}
      visibleProcessIds={allPids}
      filterActive={false}
      showLegend={false}
    />
  );
}

/** Streaming progress bar for an in-flight teardown. Shared between the
 *  inline destroy flow and the unreachable-fallback "Remove Cloud Config"
 *  action — both write to instanceState.progress so the same render works. */
function TeardownProgress({ progress, error }: { progress: string[]; error: string | null }) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progress]);

  return (
    <div className="bg-red/5 border border-red/20 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <Loader2 size={14} className={cn("text-red", !error && "animate-spin")} />
        <span className="text-md font-medium text-red">
          {error ? "Teardown failed" : "Tearing down..."}
        </span>
      </div>
      {progress.length > 0 && (
        <div
          ref={logRef}
          className="max-h-32 overflow-y-auto scrollbar-thin bg-crust rounded p-2"
        >
          {progress.map((msg, i) => (
            <div key={i} className="text-md font-mono text-overlay1">{msg}</div>
          ))}
        </div>
      )}
      {error && (
        <ErrorMessage className="mt-2 font-mono">{error}</ErrorMessage>
      )}
    </div>
  );
}

/** Polling log viewer: fetches the instance's logs every 5s while open and
 *  follows the tail by default. Auto-follow disengages when the user scrolls
 *  away from the bottom; re-engages via the "Following" toggle. */
function VpsLogViewer({
  projectId,
  instanceId,
  logs,
  onClose,
}: {
  projectId: string;
  instanceId: string;
  logs: { serviceName?: string | null; logs: string } | null;
  onClose: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  // Poll logs every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchVpsLogs(projectId, instanceId, logs?.serviceName || undefined);
    }, 5000);
    return () => clearInterval(interval);
  }, [projectId, instanceId, logs?.serviceName]);

  // Auto-scroll when following
  useEffect(() => {
    if (following && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs?.logs, following]);

  // Detect user scroll to toggle follow mode
  function handleScroll() {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setFollowing(atBottom);
  }

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-md font-medium text-subtext0">
          Logs{logs?.serviceName ? `: ${logs.serviceName}` : ""}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setFollowing(!following);
              if (!following && logRef.current) {
                logRef.current.scrollTop = logRef.current.scrollHeight;
              }
            }}
            className={cn(
              "text-md px-1.5 py-0.5 rounded transition-colors",
              following ? "text-blue bg-blue/15" : "text-overlay0 hover:text-text"
            )}
          >
            {following ? "Following" : "Follow"}
          </button>
          <button onClick={onClose} className="text-md text-overlay0 hover:text-text">
            Close
          </button>
        </div>
      </div>
      <div
        ref={logRef}
        onScroll={handleScroll}
        className="bg-background rounded p-2 max-h-64 overflow-y-auto font-mono text-md text-overlay0 whitespace-pre-wrap scrollbar-thin"
      >
        {logs ? (logs.logs || "No logs available") : "Loading..."}
      </div>
    </div>
  );
}

/** Sortable + filterable process list. Right-click a row to surface the Kill
 *  Process action. Highlights suspicious paths (/tmp, /dev/shm, /var/tmp) in
 *  red — common malware staging dirs. */
function VpsProcessTable({
  processes,
  projectId,
  instanceId,
}: {
  processes: VpsProcessInfo[];
  projectId: string;
  instanceId: string;
}) {
  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState<"cpu" | "mem">("cpu");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; proc: VpsProcessInfo } | null>(null);

  const filtered = processes
    .filter((p) => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.user.toLowerCase().includes(q) ||
        String(p.pid).includes(q)
      );
    })
    .sort((a, b) => (sortBy === "cpu" ? b.cpu - a.cpu : b.mem - a.mem));

  const isSuspicious = (p: VpsProcessInfo) =>
    p.name.startsWith("/tmp/") || p.name.startsWith("/dev/shm/") || p.name.startsWith("/var/tmp/");

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  return (
    <div className="bg-background rounded-lg p-2">
      {/* Filter + sort controls */}
      <div className="flex items-center gap-1 mb-1.5">
        <div className="flex items-center gap-1 flex-1 bg-mantle rounded px-1.5 py-0.5">
          <Search size={10} className="text-overlay0 shrink-0" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className="bg-transparent text-md text-text outline-none w-full placeholder:text-overlay0"
          />
        </div>
        <button
          onClick={() => setSortBy(sortBy === "cpu" ? "mem" : "cpu")}
          className="flex items-center gap-0.5 text-md text-overlay0 hover:text-text transition-colors px-1 py-0.5 rounded hover:bg-mantle"
        >
          <ArrowUpDown size={9} />
          {sortBy === "cpu" ? "CPU" : "MEM"}
        </button>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[40px_1fr_40px_40px] gap-1 px-1 mb-0.5 text-[11px] text-overlay0 font-medium uppercase tracking-wide">
        <span>PID</span>
        <span>Name</span>
        <span className="text-right">CPU</span>
        <span className="text-right">MEM</span>
      </div>

      {/* Table body */}
      <div className="max-h-[280px] overflow-y-auto scrollbar-thin">
        {filtered.map((p) => (
          <div
            key={p.pid}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, proc: p });
            }}
            className={cn(
              "grid grid-cols-[40px_1fr_40px_40px] gap-1 px-1 py-0.5 text-md font-mono rounded hover:bg-mantle/50 cursor-default",
              isSuspicious(p) && "bg-red/10 text-red",
            )}
          >
            <span className="text-overlay0 truncate">{p.pid}</span>
            <span className={cn("truncate", isSuspicious(p) ? "text-red font-semibold" : "text-text")}>
              {p.name}
              {isSuspicious(p) && <Skull size={10} className="inline ml-1 text-red" />}
            </span>
            <span className={cn("text-right", p.cpu >= 80 ? "text-red" : p.cpu >= 50 ? "text-peach" : "text-overlay1")}>
              {p.cpu.toFixed(1)}
            </span>
            <span className="text-right text-overlay1">{p.mem.toFixed(1)}</span>
          </div>
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-surface0 rounded-lg shadow-lg border border-surface1 py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              killVpsProcess(projectId, instanceId, contextMenu.proc.pid);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-md text-red hover:bg-surface1 transition-colors flex items-center gap-2"
          >
            <Skull size={12} />
            Kill process {contextMenu.proc.pid}
          </button>
        </div>
      )}
    </div>
  );
}

type InstanceTab = "main" | "processes" | "files" | "db" | "containers" | "chat";

const INSTANCE_TABS: { key: InstanceTab; label: string; icon: typeof Server }[] = [
  { key: "main", label: "Main", icon: Server },
  { key: "processes", label: "Processes", icon: Activity },
  { key: "files", label: "Files", icon: FileText },
  { key: "db", label: "DB", icon: Database },
  { key: "containers", label: "Containers", icon: Server },
  { key: "chat", label: "Chat", icon: MessageSquare },
];

/** Per-VPS-instance card. Top-level project page renders one of these for
 *  each `project.vpsInstances` entry — handles status banner, stats polling,
 *  tab strip, all action buttons (SSH, Claude, logs, history, rkhunter,
 *  hibernate, teardown), and the per-tab content (Main / Processes /
 *  Containers / Files / DB / Chat). */
export function VpsInstanceCard({
  project,
  instance,
  instanceState,
}: {
  project: ProjectDef;
  instance: VpsInstance;
  instanceState: VpsInstanceState | null;
}) {
  const [confirmTeardown, setConfirmTeardown] = useState(false);
  const [confirmHibernate, setConfirmHibernate] = useState(false);
  const [viewingLogs, setViewingLogs] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<InstanceTab>("main");

  const isHibernated = !!instance.hibernate;
  const hibernating = instanceState?.hibernating ?? false;
  const wakingUp = instanceState?.wakingUp ?? false;

  const stats = instanceState?.stats ?? null;
  const statsError = instanceState?.statsError ?? null;
  const checking = !isHibernated && !stats && !statsError;
  const unreachable = !isHibernated && !!statsError;
  const tearingDown = instanceState?.tearingDown ?? false;
  const teardownProgress = instanceState?.progress ?? [];
  const teardownError = instanceState?.error ?? null;

  const vpsIp = instance.digitalocean?.ipAddress ?? instance.connection.host;
  const isFailed = !isHibernated && instance.deployFailed;
  const isReady = !isHibernated && !isFailed && !unreachable && !checking;

  // Fetch stats on mount and every 5s for real-time data (skip for failed/hibernated)
  useEffect(() => {
    if (instance.deployFailed || isHibernated) return;
    fetchVpsStats(project.id, instance.id);
    const interval = setInterval(() => fetchVpsStats(project.id, instance.id), 5_000);
    return () => clearInterval(interval);
  }, [project.id, instance.id, instance.deployFailed, isHibernated]);

  return (
    <div className={cn("bg-mantle rounded-lg p-3 flex flex-col", isFailed && "border border-peach/30")}>
      {/* Instance header bar */}
      <div className="mb-2">
        <DropletInstanceBar
          name={instance.label}
          status={isHibernated ? "hibernated" : isFailed ? "unreachable" : unreachable ? "unreachable" : checking ? "checking" : "active"}
          ip={instance.connection.host}
          region={instance.digitalocean?.region}
          sizeSlug={instance.digitalocean?.size ?? instance.tazcloud?.size}
          provider={instance.tazcloud ? "tazcloud" : "digitalocean"}
          stats={stats}
          statsLoading={isFailed ? false : checking}
          statsError={isFailed ? null : statsError}
          onRefresh={isFailed ? undefined : () => { checkVpsStatus(project.id, instance.id); fetchVpsStats(project.id, instance.id); }}
        />
      </div>

      {/* Deploy failed banner */}
      {isFailed && (
        <div className="flex items-start gap-2 mb-3 py-2 px-3 bg-peach/10 rounded-lg text-md text-peach">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-medium">Deployment failed</span>
            {instance.deployError && <p className="text-overlay1 mt-0.5">{instance.deployError}</p>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => deployToProvider(project.id, (project.vpsProvider || "digitalocean") as "digitalocean" | "tazcloud", instance.label, instance.id)} className="px-2 py-1 rounded text-md text-blue hover:bg-blue/10 transition-colors font-medium">Retry</button>
            <button onClick={() => teardownVps(project.id, instance.id)} className="flex items-center gap-1 px-2 py-1 rounded text-md text-red hover:bg-red/10 transition-colors"><Trash2 size={12} /> Destroy</button>
          </div>
        </div>
      )}

      {/* Hibernated banner */}
      {isHibernated && !hibernating && !wakingUp && (
        <div className="flex items-center gap-2 mb-3 py-2 px-3 bg-blue/10 rounded-lg text-md text-blue">
          <Moon size={14} className="shrink-0" />
          <div className="flex-1">
            <span className="font-medium">Hibernated</span>
            <p className="text-overlay1 mt-0.5">
              Snapshot saved on {new Date(instance.hibernate!.hibernatedAt).toLocaleDateString()}
              {" "}({instance.hibernate!.region}, {instance.hibernate!.size})
            </p>
          </div>
          <button
            onClick={() => wakeVps(project.id, instance.id)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-md text-green bg-green/10 hover:bg-green/20 transition-colors font-medium"
          >
            <Sun size={12} /> Wake Up
          </button>
        </div>
      )}

      {/* Hibernating progress */}
      {hibernating && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={14} className="text-blue animate-spin" />
            <span className="text-md font-medium text-blue">Hibernating...</span>
          </div>
          {teardownProgress.length > 0 && (
            <div className="max-h-[150px] overflow-y-auto scrollbar-thin bg-crust rounded-lg p-2">
              {teardownProgress.map((line, i) => (
                <div key={i} className="text-md text-overlay1 font-mono whitespace-pre-wrap">{line}</div>
              ))}
            </div>
          )}
          {teardownError && <div className="text-md text-red mt-1">{teardownError}</div>}
        </div>
      )}

      {/* Waking up progress */}
      {wakingUp && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={14} className="text-green animate-spin" />
            <span className="text-md font-medium text-green">Waking up...</span>
          </div>
          {teardownProgress.length > 0 && (
            <div className="max-h-[150px] overflow-y-auto scrollbar-thin bg-crust rounded-lg p-2">
              {teardownProgress.map((line, i) => (
                <div key={i} className="text-md text-overlay1 font-mono whitespace-pre-wrap">{line}</div>
              ))}
            </div>
          )}
          {teardownError && <div className="text-md text-red mt-1">{teardownError}</div>}
        </div>
      )}

      {/* Unreachable banner */}
      {!isFailed && !isHibernated && unreachable && (
        <div className="flex items-center gap-2 mb-3 py-2 px-3 bg-red/10 rounded-lg text-md text-red">
          <CloudOff size={12} />
          Server is not responding. It may have been destroyed or is temporarily offline.
        </div>
      )}

      {/* Tab bar */}
      {isReady && (
        <div className="flex items-center gap-1 mb-3 border-b border-surface0 pb-2">
          {INSTANCE_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-md transition-colors border-none cursor-pointer",
                  activeTab === tab.key
                    ? "bg-surface0 text-text font-medium"
                    : "bg-transparent text-overlay0 hover:text-text hover:bg-surface0/50"
                )}
              >
                <Icon size={12} />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Tab content */}
      {isReady && activeTab === "main" && (
        <>
          {/* Recipes / Add Services */}
          <VpsRecipes projectId={project.id} instanceId={instance.id} recipes={instanceState?.recipes ?? {}} />

          {/* Firewall */}
          <VpsFirewall exec={(cmd) => vpsExec(project.id, instance.id, cmd)} />

          {/* Run Commands */}
          <VpsRunCommands project={project} instanceId={instance.id} />

          {/* Action buttons */}
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => {
                const { username, host, port, privateKeyPath } = instance.connection;
                addSshTerminalTab({ host, port, username, privateKeyPath }, `SSH ${host}`);
              }}
              className="text-md text-green hover:underline flex items-center gap-1"
            >
              <TerminalSquare size={10} />
              SSH Terminal
            </button>
            <ClaudeTerminalButton projectId={project.id} instance={instance} />
            <button
              onClick={() => { setViewingLogs(true); fetchVpsLogs(project.id, instance.id); }}
              className="text-md text-blue hover:underline flex items-center gap-1"
            >
              <FileText size={10} />
              View all logs
            </button>
            <button
              onClick={() => { const next = !showHistory; setShowHistory(next); if (next) loadDeployLogs(project.id); }}
              className="text-md text-peach hover:underline flex items-center gap-1"
            >
              <History size={10} />
              Deploy History
            </button>
            <button
              onClick={() => {
                const { username, host, port, privateKeyPath } = instance.connection;
                addSshTerminalTab({ host, port, username, privateKeyPath }, `rkhunter @ ${instance.label || host}`, "sudo rkhunter --check --sk");
              }}
              className="text-md text-yellow hover:underline flex items-center gap-1"
            >
              <Shield size={10} />
              Run rkhunter
            </button>
          </div>

          {showHistory && <DeployHistoryPanel logs={instanceState?.deployLogs ?? []} onClose={() => setShowHistory(false)} />}
          {viewingLogs && <VpsLogViewer projectId={project.id} instanceId={instance.id} logs={instanceState?.logs ?? null} onClose={() => setViewingLogs(false)} />}

          {/* Hibernate */}
          {instance.digitalocean && !tearingDown && (
            <div className="border border-blue/20 rounded-lg px-3 py-2">
              {!confirmHibernate ? (
                <button onClick={() => setConfirmHibernate(true)} className="flex items-center gap-1.5 text-md text-blue/70 hover:text-blue transition-colors">
                  <Moon size={12} /> Hibernate
                  <span className="text-overlay0 font-normal ml-1">— snapshot &amp; stop to save costs</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <Moon size={12} className="text-blue shrink-0" />
                  <span className="text-md text-blue">Snapshot and destroy droplet? You can wake it up later.</span>
                  <Button size="sm" onClick={() => { hibernateVps(project.id, instance.id); setConfirmHibernate(false); }}>Confirm</Button>
                  <Button size="sm" onClick={() => setConfirmHibernate(false)}>Cancel</Button>
                </div>
              )}
            </div>
          )}

          {/* Teardown */}
          <div className="border border-red/20 rounded-lg px-3 py-2">
            {tearingDown ? (
              <TeardownProgress progress={teardownProgress} error={teardownError} />
            ) : !confirmTeardown ? (
              <button onClick={() => setConfirmTeardown(true)} className="flex items-center gap-1.5 text-md text-red/70 hover:text-red transition-colors">
                <CloudOff size={12} /> Teardown
                <span className="text-overlay0 font-normal ml-1">— permanently destroy</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <CloudOff size={12} className="text-red shrink-0" />
                <span className="text-md text-red">{instance.digitalocean ? "Destroy droplet and remove deployment?" : "Remove from VPS?"}</span>
                <Button size="sm" variant="danger" onClick={() => { teardownVps(project.id, instance.id); setConfirmTeardown(false); }}>Confirm</Button>
                <Button size="sm" onClick={() => setConfirmTeardown(false)}>Cancel</Button>
              </div>
            )}
          </div>
        </>
      )}

      {isReady && activeTab === "processes" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-md font-medium text-subtext0 mb-1 flex items-center gap-1.5">
              <Activity size={12} /> Processes ({stats?.processes.length ?? 0})
            </span>
            {stats && stats.processes.length > 0 ? (
              <VpsProcessTable processes={stats.processes} projectId={project.id} instanceId={instance.id} />
            ) : (
              <div className="text-md text-overlay0">No processes.</div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-md font-medium text-subtext0 mb-1 flex items-center gap-1.5">
              <Activity size={12} /> Process City
            </span>
            {stats && stats.processes.length > 0 ? (
              <div className="bg-background rounded-lg p-2 flex-1 min-h-[120px] flex flex-col">
                <VpsProcessCity processes={stats.processes} />
              </div>
            ) : (
              <div className="bg-background rounded-lg p-2 flex items-center justify-center text-md text-overlay0 min-h-[120px]">No data</div>
            )}
          </div>
        </div>
      )}

      {isReady && activeTab === "containers" && (
        <div className="flex flex-col gap-1">
          <span className="text-md font-medium text-subtext0 mb-1 flex items-center gap-1.5">
            <Server size={12} /> Containers ({instance.services.length})
          </span>
          {instance.services.length > 0 ? (
            <div className="flex flex-col gap-1 overflow-y-auto max-h-[400px] scrollbar-thin">
              {instance.services.map((svc) => {
                const ports = parseDockerPorts(svc.ports);
                const uptimeMatch = svc.status?.match(/Up\s+(.+)/i);
                const uptime = uptimeMatch ? uptimeMatch[1] : null;
                return (
                  <div key={svc.name} className="bg-background rounded px-2 py-1.5 flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("w-2 h-2 rounded-full shrink-0", svc.state === "running" && "bg-green shadow-[0_0_3px_var(--color-green)]", svc.state === "exited" && "bg-red", svc.state !== "running" && svc.state !== "exited" && "bg-overlay0")} />
                      <span className="text-md text-text truncate flex-1 font-medium">{svc.service || svc.name}</span>
                      <span className={cn("text-[11px] px-1 py-0.5 rounded font-medium leading-none", svc.state === "running" && "bg-green/15 text-green", svc.state === "exited" && "bg-red/15 text-red", svc.state !== "running" && svc.state !== "exited" && "bg-overlay0/15 text-overlay0")}>{svc.state}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {uptime && <span className="text-[11px] text-overlay0">Up {uptime}</span>}
                      {ports.length > 0 && ports.map((p) => (
                        <a key={p.hostPort} href={`http://${vpsIp}:${p.hostPort}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue hover:underline font-mono flex items-center gap-0.5">
                          :{p.hostPort}<ExternalLink size={9} />
                        </a>
                      ))}
                      <button
                        onClick={() => { setViewingLogs(true); fetchVpsLogs(project.id, instance.id, svc.service || undefined); setActiveTab("main"); }}
                        className="ml-auto p-0.5 text-overlay0 hover:text-text transition-colors"
                        title="View Logs"
                      >
                        <FileText size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-md text-overlay0">No containers found.</div>
          )}
        </div>
      )}

      {isReady && activeTab === "files" && (
        <div className="min-h-[400px] border border-surface0 rounded-lg overflow-hidden flex flex-col">
          <FileExplorer project={project} />
        </div>
      )}

      {isReady && activeTab === "db" && (
        <div className="min-h-[400px] border border-surface0 rounded-lg overflow-hidden flex flex-col">
          <DbExplorer project={project} />
        </div>
      )}

      {isReady && activeTab === "chat" && (
        <div className="min-h-[400px] border border-surface0 rounded-lg overflow-hidden flex flex-col">
          <ChatView />
        </div>
      )}

      {/* When unreachable: offer to remove stale config */}
      {!isFailed && unreachable && (
        <>
          {!confirmTeardown ? (
            <Button size="sm" variant="danger" onClick={() => setConfirmTeardown(true)}>
              <CloudOff size={12} /> Remove Cloud Config
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-md text-red">Clear VPS configuration so you can deploy again?</span>
              <Button size="sm" variant="danger" onClick={() => { disconnectVps(project.id, instance.id); setConfirmTeardown(false); }}>Confirm</Button>
              <Button size="sm" onClick={() => setConfirmTeardown(false)}>Cancel</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
