"use client";

import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { useSubject } from "subjecto/react";
import { useDeepSubjectAll } from "@/lib/hooks";
import {
  $projects,
  $selectedProjectId,
  $vpsDeploy,
  $admin,
  $commandRunOutputs,
  addSshTerminalTab,
  deployToDo,
  checkVpsStatus,
  teardownVps,
  disconnectVps,
  fetchVpsLogs,
  fetchVpsStats,
  killVpsProcess,
  clearVpsInstanceState,
  loadDeployLogs,
  openWindow,
  loadBaseImageConfigs,
  runProjectCommand,
  stopProjectCommand,
  type ProjectDef,
  type ProjectCommand,
  type VpsDeployState,
  type VpsInstanceState,
  type VpsInstance,
  type DeployLogEntry,
  type VpsStats,
  type VpsProcessInfo,
  type VpsServiceInfo,
  type BaseImageTemplate,
} from "@/store";
import { Button } from "@/components/ui/button";
import { CopyableIp } from "@/components/ui/copyable-ip";
import { wsSend } from "@/lib/ws";
import { cn, parseDockerPorts } from "@/lib/utils";
import { ViewHeader } from "@/components/view-header";
import { ViewTabs } from "@/components/view-tabs";
import {
  TerminalSquare,
  CloudOff,
  Loader2,
  Check,
  X,
  FileText,
  Server,
  ExternalLink,
  History,
  ChevronDown,
  ChevronRight,
  Activity,
  Search,
  ArrowUpDown,
  Skull,
  ArrowLeft,
  Plus,
  Copy,
  Play,
  Square,
  Pencil,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { ProjectFilesEditor } from "@/components/project-files-editor";
import { DropletInstanceBar } from "@/components/droplet-instance-bar";
import { CircularGauge } from "@/components/ui/circular-gauge";
import { ProcessCity as IsometricProcessCity } from "@/components/process-city";
import type { ProcessInfo } from "@/store";
import { useNavigate } from "@/lib/navigation";
import type { ProjectTab } from "@/lib/routes";


const BASE_PROJECT_TABS: { key: ProjectTab; label: string }[] = [
  { key: "files", label: "Files" },
  { key: "commands", label: "Commands" },
  { key: "cloud", label: "Cloud" },
  { key: "deploy-history", label: "Deploy History" },
  { key: "settings", label: "Settings" },
];

const badgeCls = "ml-1 text-md bg-surface0 text-overlay1 px-1 py-0.5 rounded-full tabular-nums";

function buildProjectTabs(project: ProjectDef, vpsDeploy: VpsDeployState): { key: ProjectTab; label: ReactNode }[] {
  const instanceCount = project.vpsInstances.length;
  const deployCount = vpsDeploy.deployLogs.length;

  return BASE_PROJECT_TABS.map((tab) => {
    if (tab.key === "commands" && project.commands.length > 0) {
      return { ...tab, label: <>{tab.label}<span className={badgeCls}>{project.commands.length}</span></> };
    }
    if (tab.key === "cloud" && instanceCount > 0) {
      return { ...tab, label: <>{tab.label}<span className={badgeCls}>{instanceCount}</span></> };
    }
    if (tab.key === "deploy-history" && deployCount > 0) {
      return { ...tab, label: <>{tab.label}<span className={badgeCls}>{deployCount}</span></> };
    }
    return tab;
  });
}

export function ProjectDetail({ activeTab = "files" }: { activeTab?: ProjectTab }) {
  const { navigateToNav, navigateToProjectTab } = useNavigate();
  const [projects] = useSubject($projects);
  const [selectedProjectId] = useSubject($selectedProjectId);

  // Subscribe to vpsDeploy state (DeepSubject – listen to all nested changes)
  const vpsDeployState = useDeepSubjectAll<VpsDeployState>($vpsDeploy);
  const { instances: vpsInstances, activeDeploys: vpsActiveDeploys, testResult: vpsTestResult, deployLogs: vpsDeployLogs } = vpsDeployState;
  const vpsDeploy: VpsDeployState = {
    instances: vpsInstances,
    activeDeploys: vpsActiveDeploys,
    testResult: vpsTestResult,
    deployLogs: vpsDeployLogs,
  };

  const project = projects.find((p) => p.id === selectedProjectId);

  if (!project) return null;

  function handleRemove() {
    wsSend("project:remove", { id: project!.id });
    navigateToNav("projects");
  }

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-y-auto">
      <ViewHeader
        title={project.name}
        subtitle={undefined}
        actions={
          <Button size="sm" variant="danger" onClick={handleRemove}>
            Remove
          </Button>
        }
      />

      <ViewTabs
        tabs={buildProjectTabs(project, vpsDeploy)}
        activeTab={activeTab}
        onTabChange={navigateToProjectTab}
      />

      {/* Tab content */}
      {activeTab === "files" && (
        <div className="py-4">
          <ProjectFilesEditor projectId={project.id} />
        </div>
      )}

      {activeTab === "commands" && (
        <CommandsTab project={project} />
      )}

      {activeTab === "cloud" && (
        <CloudSection project={project} vpsDeploy={vpsDeploy} />
      )}

      {activeTab === "deploy-history" && (
        <DeployHistoryTab project={project} vpsDeploy={vpsDeploy} />
      )}

      {activeTab === "settings" && (
        <ProjectSettingsTab project={project} />
      )}
    </div>
  );
}

function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.floor((now - startedAt) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return <span className="text-md text-overlay0 font-mono">{m}:{String(s).padStart(2, "0")}</span>;
}

function StaticElapsed({ startedAt, endedAt }: { startedAt: number; endedAt: number }) {
  const secs = Math.floor((endedAt - startedAt) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return <span className="text-md text-overlay0 font-mono">in {m}:{String(s).padStart(2, "0")}</span>;
}

function DeployLog({ progress, error, deploying }: { progress: string[]; error: string | null; deploying: boolean }) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [progress, error]);

  return (
    <div
      ref={logRef}
      className="bg-background rounded p-3 max-h-96 overflow-y-auto font-mono text-base select-text scrollbar-thin"
    >
      {progress.map((line, i) => (
        <div key={i} className="flex items-start gap-1.5 py-0.5">
          <Check size={12} className="text-green shrink-0 mt-0.5" />
          <span className="text-overlay1">{line}</span>
        </div>
      ))}
      {deploying && (
        <div className="flex items-center gap-1.5 py-0.5 text-blue">
          <Loader2 size={12} className="animate-spin shrink-0" />
          <span>Waiting...</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-1.5 py-0.5">
          <X size={12} className="text-red shrink-0 mt-0.5" />
          <span className="text-red">{error}</span>
        </div>
      )}
    </div>
  );
}

function CloudSection({
  project,
  vpsDeploy,
}: {
  project: ProjectDef;
  vpsDeploy: VpsDeployState;
}) {
  // Show only the current project's cloud details
  return (
    <ProjectCloudDetail
      project={project}
      vpsDeploy={vpsDeploy}
    />
  );
}

function DeployProgressLog({ progress, error, deploying }: { progress: string[]; error: string | null; deploying: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [progress.length]);
  const fullText = [...progress, ...(error ? [error] : [])].join("\n");
  return (
    <div className="border-t border-surface0 relative">
      <button
        onClick={() => { navigator.clipboard.writeText(fullText); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute top-1.5 right-2 p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors z-10"
        title="Copy logs"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <div className="px-3 py-2 max-h-[200px] overflow-auto font-mono text-md select-text">
        {progress.map((msg, i) => (
          <div key={i} className="text-overlay1 leading-relaxed">{msg}</div>
        ))}
        {error && <div className="text-red leading-relaxed">{error}</div>}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function CloudDashboardGrid({
  projects,
  currentProjectId,
  vpsDeploy,
  onSelectProject,
}: {
  projects: ProjectDef[];
  currentProjectId: string;
  vpsDeploy: VpsDeployState;
  onSelectProject: (id: string) => void;
}) {
  const allDroplets = projects.flatMap((p) =>
    p.vpsInstances.map((inst) => ({ project: p, instance: inst }))
  );

  return (
    <div className="py-4 flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {allDroplets.map(({ project, instance }) => (
          <DropletCard
            key={instance.id}
            project={project}
            instance={instance}
            isCurrent={project.id === currentProjectId}
            instanceState={vpsDeploy.instances[instance.id] || null}
            onClick={() => onSelectProject(project.id)}
          />
        ))}
        <NewDeployCard projects={projects} vpsDeploy={vpsDeploy} />
      </div>
    </div>
  );
}

function DropletCard({
  project,
  instance: inst,
  isCurrent,
  instanceState,
  onClick,
}: {
  project: ProjectDef;
  instance: VpsInstance;
  isCurrent: boolean;
  instanceState: VpsInstanceState | null;
  onClick: () => void;
}) {
  const stats = instanceState?.stats ?? null;
  const unreachable = !!instanceState?.statsError;
  const doInfo = inst.digitalocean;

  useEffect(() => {
    fetchVpsStats(project.id, inst.id);
    const interval = setInterval(() => fetchVpsStats(project.id, inst.id), 15_000);
    return () => clearInterval(interval);
  }, [project.id, inst.id]);

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col gap-3 p-5 rounded-lg text-left transition-colors cursor-pointer",
        "bg-mantle border hover:bg-surface0/50",
        isCurrent ? "border-blue/30" : "border-surface0 hover:border-blue/50",
      )}
    >
      {/* Project name */}
      <span className="text-md text-overlay0 truncate">{project.name}</span>

      {/* Instance header */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "w-2.5 h-2.5 rounded-full shrink-0",
            !stats && !unreachable && "bg-overlay0",
            stats && "bg-green shadow-[0_0_4px_var(--color-green)]",
            unreachable && "bg-red",
          )}
        />
        <span className="text-md font-semibold text-text truncate">{inst.label}</span>
        <CopyableIp ip={inst.connection.host} className="text-md text-overlay0 truncate" />
        <a
          href={`http://${inst.connection.host}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-overlay0 hover:text-blue transition-colors shrink-0"
          title="Open in browser"
        >
          <ExternalLink size={12} />
        </a>
      </div>

      {/* Info chips */}
      {doInfo && (
        <div className="flex items-center gap-2 flex-nowrap overflow-hidden">
          <span className="text-md bg-surface0 text-subtext0 px-2 py-0.5 rounded font-mono whitespace-nowrap">
            {parseVcpus(doInfo.size)} vCPU
          </span>
          <span className="text-md bg-surface0 text-subtext0 px-2 py-0.5 rounded font-mono whitespace-nowrap">
            {regionLabel(doInfo.region)}
          </span>
          <span className="text-md bg-surface0 text-subtext0 px-2 py-0.5 rounded font-mono whitespace-nowrap">
            {doInfo.size.split("-").pop()?.toUpperCase()}
          </span>
          {stats && (
            <span className="text-md bg-surface0 text-subtext0 px-2 py-0.5 rounded font-mono whitespace-nowrap">
              {formatBytes(stats.diskTotalBytes)} SSD
            </span>
          )}
        </div>
      )}

      {/* Circular gauges */}
      {stats && (
        <div className="flex items-center justify-around pt-1">
          <CircularGauge label="CPU" percent={stats.cpuPercent} size={52} strokeWidth={4} showPercentSign valueFontSize={13} valueClassName="text-text font-semibold" labelClassName="text-md text-overlay0" />
          <CircularGauge label="MEM" percent={stats.memPercent} size={52} strokeWidth={4} showPercentSign valueFontSize={13} valueClassName="text-text font-semibold" labelClassName="text-md text-overlay0" />
          <CircularGauge label="DISK" percent={stats.diskPercent} size={52} strokeWidth={4} showPercentSign valueFontSize={13} valueClassName="text-text font-semibold" labelClassName="text-md text-overlay0" />
        </div>
      )}

      {/* Loading / unreachable */}
      {!stats && !unreachable && (
        <div className="flex items-center gap-2 text-md text-overlay0">
          <Loader2 size={12} className="animate-spin" />
          Checking...
        </div>
      )}
      {unreachable && (
        <div className="flex items-center gap-1.5 text-md text-red">
          <CloudOff size={12} />
          Unreachable
        </div>
      )}
    </button>
  );
}

function NewDeployCard({
  projects,
  vpsDeploy,
}: {
  projects: ProjectDef[];
  vpsDeploy: VpsDeployState;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [label, setLabel] = useState("");

  if (!expanded) {
    return (
      <button
        onClick={() => {
          setExpanded(true);
          if (projects.length > 0 && !selectedProjectId) setSelectedProjectId(projects[0].id);
        }}
        className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg border border-dashed border-surface1 text-overlay0 hover:text-text hover:border-blue/50 transition-colors cursor-pointer min-h-[100px]"
      >
        <Plus size={20} />
        <span className="text-md font-medium">New Deploy</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-dashed border-surface1 bg-mantle">
      <span className="text-base font-semibold text-text">New Deploy</span>
      <select
        value={selectedProjectId}
        onChange={(e) => setSelectedProjectId(e.target.value)}
        className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-md text-text outline-none focus:border-blue"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (e.g. production, staging)"
        className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-md text-text outline-none font-mono focus:border-blue placeholder:text-overlay0"
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!selectedProjectId}
          onClick={() => {
            deployToDo(selectedProjectId, label || undefined);
            setLabel("");
            setExpanded(false);
          }}
        >
          Deploy
        </Button>
        <button
          onClick={() => { setExpanded(false); setLabel(""); }}
          className="text-md text-overlay0 hover:text-text transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ProjectCloudDetail({
  project,
  vpsDeploy,
  onBack,
}: {
  project: ProjectDef;
  vpsDeploy: VpsDeployState;
  onBack?: () => void;
}) {
  const [deployLabel, setDeployLabel] = useState("");

  return (
    <div className="py-4 flex flex-col gap-2">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-md text-overlay0 hover:text-text transition-colors mb-1 self-start"
        >
          <ArrowLeft size={14} />
          All Deployments
        </button>
      )}

      <span className="text-base font-semibold text-text mb-1">{project.name}</span>

      {/* Deploy controls */}
      <div className="flex items-center gap-2">
        <input
          value={deployLabel}
          onChange={(e) => setDeployLabel(e.target.value)}
          placeholder="Label (e.g. production, staging)"
          className="bg-mantle text-text text-md rounded px-2.5 py-1.5 border border-surface0 focus:border-blue focus:outline-none font-mono w-64"
        />
        <button
          onClick={() => { deployToDo(project.id, deployLabel || undefined); setDeployLabel(""); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-mantle rounded-lg hover:bg-surface0 transition-colors text-left"
        >
          <Server size={16} className="text-blue" />
          <span className="text-md font-medium text-text">Deploy DigitalOcean Droplet</span>
        </button>
      </div>

      {/* Deployed instances */}
      {project.vpsInstances.map((instance) => (
        <VpsInstanceCard
          key={instance.id}
          project={project}
          instance={instance}
          instanceState={vpsDeploy.instances[instance.id] || null}
        />
      ))}
    </div>
  );
}

/* ---- VPS sub-components ---- */

function parseVcpus(sizeSlug: string): string {
  const match = sizeSlug.match(/(\d+)vcpu/);
  return match ? match[1] : "?";
}

function regionLabel(region: string): string {
  const map: Record<string, string> = {
    nyc1: "NYC", nyc3: "NYC", sfo3: "SFO", ams3: "AMS",
    lon1: "LON", fra1: "FRA", sgp1: "SGP", blr1: "BLR", syd1: "SYD",
    tor1: "TOR",
  };
  return map[region] || region.toUpperCase();
}


function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

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
        <div className="mt-2 text-md text-red font-mono">{error}</div>
      )}
    </div>
  );
}

function VpsInstanceCard({
  project,
  instance,
  instanceState,
}: {
  project: ProjectDef;
  instance: VpsInstance;
  instanceState: VpsInstanceState | null;
}) {
  const [confirmTeardown, setConfirmTeardown] = useState(false);
  const [viewingLogs, setViewingLogs] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const stats = instanceState?.stats ?? null;
  const statsError = instanceState?.statsError ?? null;
  const checking = !stats && !statsError;
  const unreachable = !!statsError;
  const tearingDown = instanceState?.tearingDown ?? false;
  const teardownProgress = instanceState?.progress ?? [];
  const teardownError = instanceState?.error ?? null;

  // Fetch stats on mount and every 5s for real-time data (skip for failed deploys)
  useEffect(() => {
    if (instance.deployFailed) return;
    fetchVpsStats(project.id, instance.id);
    const interval = setInterval(() => fetchVpsStats(project.id, instance.id), 5_000);
    return () => clearInterval(interval);
  }, [project.id, instance.id, instance.deployFailed]);

  const vpsIp = instance.digitalocean?.ipAddress ?? instance.connection.host;

  const isFailed = instance.deployFailed;

  return (
    <div className={cn("bg-mantle rounded-lg p-3", isFailed && "border border-peach/30")}>
      {/* Instance header bar */}
      <div className="mb-3">
        <DropletInstanceBar
          name={instance.label}
          status={isFailed ? "unreachable" : unreachable ? "unreachable" : checking ? "checking" : "active"}
          ip={instance.connection.host}
          region={instance.digitalocean?.region}
          sizeSlug={instance.digitalocean?.size}
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
            {instance.deployError && (
              <p className="text-overlay1 mt-0.5">{instance.deployError}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => { deployToDo(project.id, instance.label, instance.id); }}
              className="px-2 py-1 rounded text-md text-blue hover:bg-blue/10 transition-colors font-medium"
            >
              Retry
            </button>
            <button
              onClick={() => { teardownVps(project.id, instance.id); }}
              className="flex items-center gap-1 px-2 py-1 rounded text-md text-red hover:bg-red/10 transition-colors"
            >
              <Trash2 size={12} />
              Destroy
            </button>
          </div>
        </div>
      )}

      {/* Unreachable banner */}
      {!isFailed && unreachable && (
        <div className="flex items-center gap-2 mb-3 py-2 px-3 bg-red/10 rounded-lg text-md text-red">
          <CloudOff size={12} />
          Server is not responding. It may have been destroyed or is temporarily offline.
        </div>
      )}

      {/* --- 3-column layout: Containers | Processes | Process City --- */}
      {!isFailed && !unreachable && !checking && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            {/* Column 1: Docker Containers */}
            <div className="flex flex-col gap-1">
              <span className="text-md font-medium text-subtext0 mb-1 flex items-center gap-1.5">
                <Server size={12} />
                Containers ({instance.services.length})
              </span>
              {instance.services.length > 0 ? (
                <div className="flex flex-col gap-1 overflow-y-auto max-h-[320px] scrollbar-thin">
                  {instance.services.map((svc) => {
                    const ports = parseDockerPorts(svc.ports);
                    const uptimeMatch = svc.status?.match(/Up\s+(.+)/i);
                    const uptime = uptimeMatch ? uptimeMatch[1] : null;
                    return (
                      <div
                        key={svc.name}
                        className="bg-background rounded px-2 py-1.5 flex flex-col gap-0.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full shrink-0",
                              svc.state === "running" && "bg-green shadow-[0_0_3px_var(--color-green)]",
                              svc.state === "exited" && "bg-red",
                              svc.state !== "running" && svc.state !== "exited" && "bg-overlay0",
                            )}
                          />
                          <span className="text-md text-text truncate flex-1 font-medium">
                            {svc.service || svc.name}
                          </span>
                          <span
                            className={cn(
                              "text-[11px] px-1 py-0.5 rounded font-medium leading-none",
                              svc.state === "running" && "bg-green/15 text-green",
                              svc.state === "exited" && "bg-red/15 text-red",
                              svc.state !== "running" && svc.state !== "exited" && "bg-overlay0/15 text-overlay0",
                            )}
                          >
                            {svc.state}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {uptime && <span className="text-[11px] text-overlay0">Up {uptime}</span>}
                          {ports.length > 0 && ports.map((p) => (
                            <a
                              key={p.hostPort}
                              href={`http://${vpsIp}:${p.hostPort}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-blue hover:underline font-mono flex items-center gap-0.5"
                            >
                              :{p.hostPort}<ExternalLink size={9} />
                            </a>
                          ))}
                          <button
                            onClick={() => {
                              setViewingLogs(true);
                              fetchVpsLogs(project.id, instance.id, svc.service || undefined);
                            }}
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

            {/* Column 2: Processes */}
            <div className="flex flex-col gap-1">
              <span className="text-md font-medium text-subtext0 mb-1 flex items-center gap-1.5">
                <Activity size={12} />
                Processes ({stats?.processes.length ?? 0})
              </span>
              {stats && stats.processes.length > 0 ? (
                <VpsProcessTable processes={stats.processes} projectId={project.id} instanceId={instance.id} />
              ) : (
                <div className="text-md text-overlay0">No processes.</div>
              )}
            </div>

            {/* Column 3: Process City */}
            <div className="flex flex-col gap-1">
              <span className="text-md font-medium text-subtext0 mb-1 flex items-center gap-1.5">
                <Activity size={12} />
                Process City
              </span>
              {stats && stats.processes.length > 0 ? (
                <div className="bg-background rounded-lg p-2 flex-1 min-h-[120px] flex flex-col">
                  <VpsProcessCity processes={stats.processes} />
                </div>
              ) : (
                <div className="bg-background rounded-lg p-2 flex items-center justify-center text-md text-overlay0 min-h-[120px]">
                  No data
                </div>
              )}
            </div>
          </div>

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
            <button
              onClick={() => {
                setViewingLogs(true);
                fetchVpsLogs(project.id, instance.id);
              }}
              className="text-md text-blue hover:underline flex items-center gap-1"
            >
              <FileText size={10} />
              View all logs
            </button>
            <button
              onClick={() => {
                const next = !showHistory;
                setShowHistory(next);
                if (next) loadDeployLogs(project.id);
              }}
              className="text-md text-peach hover:underline flex items-center gap-1"
            >
              <History size={10} />
              Deploy History
            </button>
          </div>

          {/* Deploy History */}
          {showHistory && (
            <DeployHistoryPanel
              logs={instanceState?.deployLogs ?? []}
              onClose={() => setShowHistory(false)}
            />
          )}

          {/* Logs viewer */}
          {viewingLogs && (
            <VpsLogViewer
              projectId={project.id}
              instanceId={instance.id}
              logs={instanceState?.logs ?? null}
              onClose={() => setViewingLogs(false)}
            />
          )}

          {/* Teardown */}
          {tearingDown ? (
            <TeardownProgress progress={teardownProgress} error={teardownError} />
          ) : !confirmTeardown ? (
            <button
              onClick={() => setConfirmTeardown(true)}
              className="flex items-center gap-1.5 text-md text-red/70 hover:text-red transition-colors"
            >
              <CloudOff size={12} />
              Teardown
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-md text-red">
                {instance.digitalocean ? "Destroy droplet and remove deployment?" : "Remove from VPS?"}
              </span>
              <Button size="sm" variant="danger" onClick={() => { teardownVps(project.id, instance.id); setConfirmTeardown(false); }}>
                Confirm
              </Button>
              <Button size="sm" onClick={() => setConfirmTeardown(false)}>
                Cancel
              </Button>
            </div>
          )}
        </>
      )}

      {/* --- When unreachable: offer to remove stale config --- */}
      {!isFailed && unreachable && (
        <>
          {!confirmTeardown ? (
            <Button size="sm" variant="danger" onClick={() => setConfirmTeardown(true)}>
              <CloudOff size={12} />
              Remove Cloud Config
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-md text-red">
                Clear VPS configuration so you can deploy again?
              </span>
              <Button size="sm" variant="danger" onClick={() => { disconnectVps(project.id, instance.id); setConfirmTeardown(false); }}>
                Confirm
              </Button>
              <Button size="sm" onClick={() => setConfirmTeardown(false)}>
                Cancel
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "...";
  const secs = Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function DeployHistoryPanel({
  logs,
  onClose,
}: {
  logs: DeployLogEntry[];
  onClose: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-md font-medium text-subtext0">Deploy History</span>
        <button onClick={onClose} className="text-md text-overlay0 hover:text-text">
          Close
        </button>
      </div>
      {logs.length === 0 ? (
        <div className="text-md text-overlay0 bg-background rounded p-3">No deploy history found.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {logs.map((entry) => {
            const isExpanded = expandedId === entry.id;
            return (
              <div key={entry.id} className="bg-background rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface0/50 transition-colors text-left"
                >
                  {entry.status === "success" && <Check size={12} className="text-green shrink-0" />}
                  {entry.status === "error" && <X size={12} className="text-red shrink-0" />}
                  {entry.status === "running" && <Loader2 size={12} className="text-blue animate-spin shrink-0" />}
                  <span className="text-md text-overlay0 flex-1">
                    {timeAgo(entry.startedAt)}
                  </span>
                  <span className="text-md text-overlay0 font-mono">
                    {formatDuration(entry.startedAt, entry.endedAt)}
                  </span>
                  {isExpanded ? <ChevronDown size={12} className="text-overlay0" /> : <ChevronRight size={12} className="text-overlay0" />}
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3">
                    <DeployLog
                      progress={entry.progress}
                      error={entry.error}
                      deploying={entry.status === "running"}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DeployHistoryTab({
  project,
  vpsDeploy,
}: {
  project: ProjectDef;
  vpsDeploy: VpsDeployState;
}) {
  useEffect(() => {
    loadDeployLogs(project.id);
  }, [project.id]);

  // Active deploys for this project
  const projectDeploys = Object.values(vpsDeploy.activeDeploys).filter(
    (d) => d.projectId === project.id
  );

  return (
    <div className="py-4">
      {projectDeploys.length > 0 && (
        <div className="flex flex-col gap-1 mb-3">
          {projectDeploys.map((d) => (
            <button
              key={d.instanceId}
              onClick={() => {
                openWindow("deploy-" + d.instanceId);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 bg-background rounded-lg hover:bg-surface0/50 transition-colors text-left"
            >
              {d.deploying && <Loader2 size={12} className="text-blue animate-spin shrink-0" />}
              {!d.deploying && !d.error && <Check size={12} className="text-green shrink-0" />}
              {!d.deploying && d.error && <X size={12} className="text-red shrink-0" />}
              <span className="text-md text-text flex-1">
                {d.deploying ? "Deploying..." : d.error ? "Failed" : "Complete"}
              </span>
              <span className="text-md text-overlay0">
                Open window
              </span>
              <ExternalLink size={10} className="text-overlay0" />
            </button>
          ))}
        </div>
      )}
      <DeployHistoryPanel
        logs={vpsDeploy.deployLogs}
        onClose={() => {}}
      />
    </div>
  );
}

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

function CommandsTab({ project }: { project: ProjectDef }) {
  const [commandRunOutputs] = useSubject($commandRunOutputs);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCommand, setFormCommand] = useState("");
  const [formMode, setFormMode] = useState<"inline" | "terminal">("inline");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    project.vpsInstances.length === 1 ? project.vpsInstances[0].id : null,
  );
  const [expandedCommandId, setExpandedCommandId] = useState<string | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (project.vpsInstances.length === 1) {
      setSelectedInstanceId(project.vpsInstances[0].id);
    }
  }, [project.vpsInstances.length]);

  // Auto-scroll output
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [commandRunOutputs, expandedCommandId]);

  function saveCommands(newCommands: ProjectCommand[]) {
    wsSend("project:update", { id: project.id, commands: newCommands });
  }

  function handleAdd() {
    if (!formName.trim() || !formCommand.trim()) return;
    const newCmd: ProjectCommand = {
      id: crypto.randomUUID(),
      name: formName.trim(),
      command: formCommand.trim(),
      mode: formMode,
    };
    saveCommands([...project.commands, newCmd]);
    setFormName("");
    setFormCommand("");
    setFormMode("inline");
    setShowAddForm(false);
  }

  function handleEdit(cmd: ProjectCommand) {
    setEditingId(cmd.id);
    setFormName(cmd.name);
    setFormCommand(cmd.command);
    setFormMode(cmd.mode || "inline");
  }

  function handleSaveEdit(cmdId: string) {
    if (!formName.trim() || !formCommand.trim()) return;
    const updated = project.commands.map((c) =>
      c.id === cmdId ? { ...c, name: formName.trim(), command: formCommand.trim(), mode: formMode } : c,
    );
    saveCommands(updated);
    setEditingId(null);
    setFormName("");
    setFormCommand("");
    setFormMode("inline");
  }

  function handleDelete(cmdId: string) {
    saveCommands(project.commands.filter((c) => c.id !== cmdId));
  }

  function handleRun(cmd: ProjectCommand) {
    if (!selectedInstanceId) return;
    if (cmd.mode !== "terminal") {
      setExpandedCommandId(cmd.id);
    }
    runProjectCommand(project.id, cmd.id, selectedInstanceId);
  }

  function handleStop(cmd: ProjectCommand) {
    stopProjectCommand(project.id, cmd.id);
  }

  const noInstances = project.vpsInstances.length === 0;

  return (
    <div className="py-4 flex flex-col gap-3">
      {/* Instance selector */}
      {project.vpsInstances.length > 1 && (
        <div className="flex items-center gap-2 mb-1">
          <label className="text-md text-overlay0">Target instance:</label>
          <select
            value={selectedInstanceId || ""}
            onChange={(e) => setSelectedInstanceId(e.target.value || null)}
            className="bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-sans focus:border-mauve"
          >
            <option value="">Select instance...</option>
            {project.vpsInstances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.label} ({inst.connection.host})
              </option>
            ))}
          </select>
        </div>
      )}

      {noInstances && (
        <div className="text-md text-overlay0 bg-surface0 rounded-md px-3 py-2">
          No VPS instances deployed. Deploy an instance from the Cloud tab to run commands.
        </div>
      )}

      {/* Command list */}
      {project.commands.map((cmd) => {
        const key = `${project.id}:${cmd.id}`;
        const runState = commandRunOutputs[key];
        const isRunning = runState?.running ?? false;
        const isEditing = editingId === cmd.id;
        const isExpanded = expandedCommandId === cmd.id && runState;

        if (isEditing) {
          return (
            <div key={cmd.id} className="bg-mantle border border-surface0 rounded-lg p-3 flex flex-col gap-2">
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Command name"
                className="bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve"
              />
              <input
                type="text"
                value={formCommand}
                onChange={(e) => setFormCommand(e.target.value)}
                placeholder="e.g. docker compose restart"
                className="bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono placeholder:text-overlay0 focus:border-mauve"
              />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-md text-overlay1 cursor-pointer">
                  <input
                    type="radio"
                    checked={formMode === "inline"}
                    onChange={() => setFormMode("inline")}
                    className="accent-mauve"
                  />
                  Inline output
                </label>
                <label className="flex items-center gap-1.5 text-md text-overlay1 cursor-pointer">
                  <input
                    type="radio"
                    checked={formMode === "terminal"}
                    onChange={() => setFormMode("terminal")}
                    className="accent-mauve"
                  />
                  Open in Terminal
                </label>
              </div>
              <div className="flex gap-1.5 justify-end">
                <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setFormName(""); setFormCommand(""); setFormMode("inline"); }}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" onClick={() => handleSaveEdit(cmd.id)}>
                  Save
                </Button>
              </div>
            </div>
          );
        }

        return (
          <div key={cmd.id} className="bg-mantle border border-surface0 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-md font-semibold text-text truncate">{cmd.name}</span>
                  <span className={cn(
                    "text-md px-1.5 py-0.5 rounded",
                    cmd.mode === "terminal"
                      ? "bg-blue/10 text-blue"
                      : "bg-surface0 text-overlay0",
                  )}>
                    {cmd.mode === "terminal" ? "Terminal" : "Inline"}
                  </span>
                </div>
                <div className="text-md text-overlay0 font-mono truncate mt-0.5">{cmd.command}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isRunning ? (
                  <button
                    onClick={() => handleStop(cmd)}
                    className="p-1.5 rounded hover:bg-surface0 text-red transition-colors"
                    title="Stop"
                  >
                    <Square size={14} />
                  </button>
                ) : (
                  <button
                    onClick={() => handleRun(cmd)}
                    disabled={noInstances || !selectedInstanceId}
                    className="p-1.5 rounded hover:bg-surface0 text-green transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Run"
                  >
                    <Play size={14} />
                  </button>
                )}
                <button
                  onClick={() => handleEdit(cmd)}
                  className="p-1.5 rounded hover:bg-surface0 text-overlay0 hover:text-text transition-colors"
                  title="Edit"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => handleDelete(cmd.id)}
                  className="p-1.5 rounded hover:bg-surface0 text-overlay0 hover:text-red transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
                {runState && cmd.mode !== "terminal" && (
                  <button
                    onClick={() => setExpandedCommandId(isExpanded ? null : cmd.id)}
                    className="p-1.5 rounded hover:bg-surface0 text-overlay0 hover:text-text transition-colors"
                    title={isExpanded ? "Collapse output" : "Expand output"}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                )}
              </div>
            </div>

            {/* Inline output panel */}
            {isExpanded && (
              <div className="border-t border-surface0 bg-background px-3 py-2 max-h-[300px] overflow-auto font-mono text-md select-text scrollbar-thin">
                {runState.output ? (
                  <pre className="whitespace-pre-wrap text-overlay1">{runState.output}</pre>
                ) : isRunning ? (
                  <div className="flex items-center gap-1.5 text-blue">
                    <Loader2 size={12} className="animate-spin" />
                    <span>Running...</span>
                  </div>
                ) : (
                  <span className="text-overlay0">(no output)</span>
                )}
                {!isRunning && runState.exitCode !== null && (
                  <div className={cn("mt-1", runState.exitCode === 0 ? "text-green" : "text-red")}>
                    Exit code: {runState.exitCode}
                  </div>
                )}
                <div ref={outputEndRef} />
              </div>
            )}
          </div>
        );
      })}

      {/* Add command form */}
      {showAddForm ? (
        <div className="bg-mantle border border-surface0 rounded-lg p-3 flex flex-col gap-2">
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="Command name"
            autoFocus
            className="bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve"
          />
          <input
            type="text"
            value={formCommand}
            onChange={(e) => setFormCommand(e.target.value)}
            placeholder="e.g. docker compose restart"
            className="bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono placeholder:text-overlay0 focus:border-mauve"
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-md text-overlay1 cursor-pointer">
              <input
                type="radio"
                checked={formMode === "inline"}
                onChange={() => setFormMode("inline")}
                className="accent-mauve"
              />
              Inline output
            </label>
            <label className="flex items-center gap-1.5 text-md text-overlay1 cursor-pointer">
              <input
                type="radio"
                checked={formMode === "terminal"}
                onChange={() => setFormMode("terminal")}
                className="accent-mauve"
              />
              Open in Terminal
            </label>
          </div>
          <div className="flex gap-1.5 justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setShowAddForm(false); setFormName(""); setFormCommand(""); setFormMode("inline"); }}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={handleAdd}>
              Add
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1.5 text-md text-overlay0 hover:text-text transition-colors py-2"
        >
          <Plus size={14} />
          Add Command
        </button>
      )}
    </div>
  );
}

function ProjectSettingsTab({ project }: { project: ProjectDef }) {
  const [name, setName] = useState(project.name);
  const [vpsRegion, setVpsRegion] = useState(project.vpsRegion || "nyc1");
  const [vpsSize, setVpsSize] = useState(project.vpsSize || "s-2vcpu-4gb");
  const [vpsBaseImageConfigName, setVpsBaseImageConfigName] = useState(project.vpsBaseImageConfigName || "");
  const [doToken, setDoToken] = useState(project.doToken || "");
  const [gitlabDeployKey, setGitlabDeployKey] = useState(project.gitlabDeployKey || "");
  const [dbUrl, setDbUrl] = useState(project.dbUrl || "");
  const [gitFolders, setGitFolders] = useState<string[]>(project.gitFolders || []);
  const [newGitFolder, setNewGitFolder] = useState("");

  const adminState = useDeepSubjectAll($admin);
  const baseImageTemplates = adminState.baseImage.templates;

  useEffect(() => {
    loadBaseImageConfigs();
  }, []);

  // Reset form when project changes
  useEffect(() => {
    setName(project.name);
    setVpsRegion(project.vpsRegion || "nyc1");
    setVpsSize(project.vpsSize || "s-2vcpu-4gb");
    setVpsBaseImageConfigName(project.vpsBaseImageConfigName || "");
    setDoToken(project.doToken || "");
    setGitlabDeployKey(project.gitlabDeployKey || "");
    setDbUrl(project.dbUrl || "");
    setGitFolders(project.gitFolders || []);
    setNewGitFolder("");
  }, [project.id]);

  const [saved, setSaved] = useState(false);

  function handleSave() {
    const trimName = name.trim();
    if (!trimName) return;

    wsSend("project:update", {
      id: project.id,
      name: trimName,
      vpsRegion,
      vpsSize,
      vpsBaseImageConfigName: vpsBaseImageConfigName || undefined,
      doToken: doToken || undefined,
      gitlabDeployKey: gitlabDeployKey || undefined,
      dbUrl: dbUrl || undefined,
      gitFolders,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="py-4 flex flex-col gap-3.5 max-w-[560px]">
      <div className="flex flex-col gap-1">
        <label className="text-md font-semibold text-subtext0">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Project"
          className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-md font-semibold text-subtext0">VPS Configuration</label>
        <div className="flex gap-2">
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-md text-overlay0">Region</label>
            <select
              value={vpsRegion}
              onChange={(e) => setVpsRegion(e.target.value)}
              className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans focus:border-mauve"
            >
              <option value="nyc1">NYC 1 (New York)</option>
              <option value="sfo3">SFO 3 (San Francisco)</option>
              <option value="ams3">AMS 3 (Amsterdam)</option>
              <option value="lon1">LON 1 (London)</option>
              <option value="fra1">FRA 1 (Frankfurt)</option>
              <option value="sgp1">SGP 1 (Singapore)</option>
              <option value="blr1">BLR 1 (Bangalore)</option>
              <option value="syd1">SYD 1 (Sydney)</option>
            </select>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-md text-overlay0">Droplet Size</label>
            <select
              value={vpsSize}
              onChange={(e) => setVpsSize(e.target.value)}
              className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans focus:border-mauve"
            >
              <option value="s-1vcpu-1gb">1 vCPU / 1 GB</option>
              <option value="s-1vcpu-2gb">1 vCPU / 2 GB</option>
              <option value="s-2vcpu-2gb">2 vCPU / 2 GB</option>
              <option value="s-2vcpu-4gb">2 vCPU / 4 GB</option>
              <option value="s-4vcpu-8gb">4 vCPU / 8 GB</option>
              <option value="s-8vcpu-16gb">8 vCPU / 16 GB</option>
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-md text-overlay0">Template</label>
          <select
            value={vpsBaseImageConfigName}
            onChange={(e) => setVpsBaseImageConfigName(e.target.value)}
            className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans focus:border-mauve"
          >
            <option value="">Default</option>
            {Object.keys(baseImageTemplates).filter((n) => n !== "default").map((tplName) => (
              <option key={tplName} value={tplName}>{tplName}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-md text-overlay0">DO API Token</label>
          <input
            type="password"
            value={doToken}
            onChange={(e) => setDoToken(e.target.value)}
            placeholder="Leave blank to use global default from Settings"
            className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve font-mono"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-md text-overlay0">Deploy Key</label>
          <textarea
            value={gitlabDeployKey}
            onChange={(e) => setGitlabDeployKey(e.target.value)}
            placeholder="Leave blank to use global default from Settings"
            spellCheck={false}
            className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve font-mono resize-y min-h-[60px] max-h-[120px]"
            rows={2}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-md font-semibold text-subtext0">Database</label>
        <div className="flex flex-col gap-1">
          <label className="text-md text-overlay0">PostgreSQL URL</label>
          <input
            type="text"
            value={dbUrl}
            onChange={(e) => setDbUrl(e.target.value)}
            placeholder="postgres://user:pass@localhost:5432/dbname"
            spellCheck={false}
            className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve font-mono"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-md font-semibold text-subtext0">Git Folders</label>
        <p className="text-overlay0" style={{ fontSize: 12 }}>Paths on the VPS to manage with the Git tab (e.g. /opt/project)</p>
        {gitFolders.map((folder, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="text"
              value={folder}
              onChange={(e) => {
                const next = [...gitFolders];
                next[i] = e.target.value;
                setGitFolders(next);
              }}
              className="flex-1 bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve font-mono"
            />
            <button
              onClick={() => setGitFolders(gitFolders.filter((_, j) => j !== i))}
              className="text-overlay0 hover:text-red transition-colors p-1"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={newGitFolder}
            onChange={(e) => setNewGitFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newGitFolder.trim()) {
                setGitFolders([...gitFolders, newGitFolder.trim()]);
                setNewGitFolder("");
              }
            }}
            placeholder="/opt/project"
            className="flex-1 bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve font-mono"
          />
          <button
            onClick={() => {
              if (newGitFolder.trim()) {
                setGitFolders([...gitFolders, newGitFolder.trim()]);
                setNewGitFolder("");
              }
            }}
            className="text-overlay0 hover:text-green transition-colors p-1"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 items-center justify-end pt-1">
        {saved && <span className="text-green" style={{ fontSize: 13 }}>Settings saved</span>}
        <Button variant="primary" onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
