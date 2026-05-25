"use client";

import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { useSubject } from "subjecto/react";
import { useDeepSubjectAll } from "@/lib/hooks";
import type { BaseImageTemplate, DeployLogEntry, ProjectCommand, ProjectDef, RecipeState, VpsDeployState, VpsInstance, VpsInstanceState, VpsProcessInfo, VpsServiceInfo, VpsStats } from "@/store/types";
import { $admin, $auth, $commandRunOutputs, $projects, $selectedProjectId, $vpsDeploy } from "@/store/subjects";
import { addSshTerminalTab, checkVpsRecipe, checkVpsStatus, clearVpsInstanceState, deployToDo, deployToProvider, disconnectVps, fetchVpsLogs, fetchVpsStats, hibernateVps, killVpsProcess, loadAdminTeams, loadBaseImageConfigs, loadDeployLogs, loadRecipes, openWindow, runProjectCommand, runVpsRecipe, startMcpTunnel, stopProjectCommand, teardownVps, uninstallVpsRecipe, vpsExec, wakeVps } from "@/store/actions";
import { useAllRecipes } from "@/components/use-all-recipes";
import { Button } from "@/components/ui/button";
import { CopyableIp } from "@/components/ui/copyable-ip";
import { ErrorMessage } from "@/components/ui/error-message";
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
  Package,
  Globe,
  Database,
  MessageSquare,
  Shield,
  RefreshCw,
  Lock,
  Moon,
  Sun,
  Cloud,
  Container,
  Bug,
  KeyRound,
  Sparkles,
  Layers,
} from "lucide-react";
import { ChatView } from "@/components/chat-view";
import { DbExplorer } from "@/components/db-explorer";
import { FileExplorer } from "@/components/vps-file-explorer";
import { ProjectFilesEditor } from "@/components/project-files-editor";

export function ClaudeLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 -.01 39.5 39.53" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="m7.75 26.27 7.77-4.36.13-.38-.13-.21h-.38l-1.3-.08-4.44-.12-3.85-.16-3.73-.2-.94-.2-.88-1.16.09-.58.79-.53 1.13.1 2.5.17 3.75.26 2.72.16 4.03.42h.64l.09-.26-.22-.16-.17-.16-3.88-2.63-4.2-2.78-2.2-1.6-1.19-.81-.6-.76-.26-1.66 1.08-1.19 1.45.1.37.1 1.47 1.13 3.14 2.43 4.1 3.02.6.5.24-.17.03-.12-.27-.45-2.23-4.03-2.38-4.1-1.06-1.7-.28-1.02c-.1-.42-.17-.77-.17-1.2l1.23-1.67.68-.22 1.64.22.69.6 1.02 2.33 1.65 3.67 2.56 4.99.75 1.48.4 1.37.15.42h.26v-.24l.21-2.81.39-3.45.38-4.44.13-1.25.62-1.5 1.23-.81.96.46.79 1.13-.11.73-.47 3.05-.92 4.78-.6 3.2h.35l.4-.4 1.62-2.15 2.72-3.4 1.2-1.35 1.4-1.49.9-.71h1.7l1.25 1.86-.56 1.92-1.75 2.22-1.45 1.88-2.08 2.8-1.3 2.24.12.18.31-.03 4.7-1 2.54-.46 3.03-.52 1.37.64.15.65-.54 1.33-3.24.8-3.8.76-5.66 1.34-.07.05.08.1 2.55.24 1.09.06h2.67l4.97.37 1.3.86.78 1.05-.13.8-2 1.02-2.7-.64-6.3-1.5-2.16-.54h-.3v.18l1.8 1.76 3.3 2.98 4.13 3.84.21.95-.53.75-.56-.08-3.63-2.73-1.4-1.23-3.17-2.67h-.21v.28l.73 1.07 3.86 5.8.2 1.78-.28.58-1 .35-1.1-.2-2.26-3.17-2.33-3.57-1.88-3.2-.23.13-1.11 11.95-.52.61-1.2.46-1-.76-.53-1.23.53-2.43.64-3.17.52-2.52.47-3.13.28-1.04-.02-.07-.23.03-2.36 3.24-3.59 4.85-2.84 3.04-.68.27-1.18-.61.11-1.09.66-.97 3.93-5 2.37-3.1 1.53-1.79-.01-.26h-.09l-10.44 6.78-1.86.24-.8-.75.1-1.23.38-.4 3.14-2.16z" fill="currentColor"/>
    </svg>
  );
}

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

import { DropletInstanceBar } from "@/components/droplet-instance-bar";
import { CircularGauge } from "@/components/ui/circular-gauge";
import { ProcessCity as IsometricProcessCity } from "@/components/process-city";
import type { ProcessInfo } from "@/store/types";
import { useNavigate } from "@/lib/navigation";
import type { ProjectTab } from "@/lib/routes";
import { openManageVmWindow } from "@/components/tazcloud-panel";


const BASE_PROJECT_TABS: { key: ProjectTab; label: string }[] = [
  { key: "deploy-history", label: "Deploy History" },
  { key: "settings", label: "Settings" },
];

const badgeCls = "ml-1 text-md bg-surface0 text-overlay1 px-1 py-0.5 rounded-full tabular-nums";

function buildProjectTabs(_project: ProjectDef, vpsDeploy: VpsDeployState): { key: ProjectTab; label: ReactNode }[] {
  const deployCount = vpsDeploy.deployLogs.length;

  return BASE_PROJECT_TABS.map((tab) => {
    if (tab.key === "deploy-history" && deployCount > 0) {
      return { ...tab, label: <>{tab.label}<span className={badgeCls}>{deployCount}</span></> };
    }
    return tab;
  });
}

export function ProjectDetail({ activeTab = "deploy-history" }: { activeTab?: ProjectTab }) {
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

      <ServersBar project={project} vpsDeploy={vpsDeploy} />

      <ViewTabs
        tabs={buildProjectTabs(project, vpsDeploy)}
        activeTab={activeTab}
        onTabChange={navigateToProjectTab}
      />

      {/* Tab content. Files were moved into the Manage popup's Files tab.
          Commands were moved into the Manage popup's Commands tab (so they
          can be run against a specific instance from one place). */}
      {activeTab === "deploy-history" && (
        <DeployHistoryTab project={project} vpsDeploy={vpsDeploy} />
      )}

      {activeTab === "settings" && (
        <ProjectSettingsTab project={project} />
      )}
    </div>
  );
}

/** Replaces the old "Cloud" tab. Renders a slim deploy + per-instance button row
 *  at the top of every project page. Clicking a TazCloud instance button opens
 *  the floating Manage popup (Manage / Files / DB tabs), the same one used by
 *  the TazCloud admin panel. */
function ServersBar({
  project,
  vpsDeploy,
}: {
  project: ProjectDef;
  vpsDeploy: VpsDeployState;
}) {
  const [deployLabel, setDeployLabel] = useState("");
  return (
    <div className="flex flex-col gap-2 mb-3 py-3 border-y border-surface0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-md text-overlay0 font-medium">Servers:</span>
        {project.vpsInstances.length === 0 && (
          <span className="text-md text-overlay0 italic">none yet</span>
        )}
        {project.vpsInstances.map((instance) => {
          const state = vpsDeploy.instances[instance.id];
          const isDeploying = state?.deploying;
          const isFailed = !!instance.deployFailed;
          const dotColor = isFailed ? "bg-red" : isDeploying ? "bg-yellow" : "bg-green";
          // Only TazCloud instances open the floating Manage popup; DigitalOcean
          // doesn't have an equivalent popup yet (the existing Manage UI is
          // inline). We disable the button for DO with a hint until that lands.
          const tazVmId = instance.tazcloud?.vmId;
          return (
            <button
              key={instance.id}
              onClick={() => {
                if (tazVmId) {
                  openManageVmWindow({ id: tazVmId, name: instance.label });
                }
              }}
              disabled={!tazVmId}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-md transition-colors border",
                "bg-mantle text-subtext0 border-surface0 hover:bg-surface0 hover:text-text",
                !tazVmId && "opacity-50 cursor-not-allowed hover:bg-mantle hover:text-subtext0",
              )}
              title={tazVmId
                ? "Open Manage popup"
                : "Manage popup is currently only available for TazCloud VMs"}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
              {instance.label}
              <span className="text-overlay0 text-xs">
                {instance.tazcloud ? "Taz" : instance.digitalocean ? "DO" : ""}
              </span>
            </button>
          );
        })}
        <div className="flex-1" />
        <input
          value={deployLabel}
          onChange={(e) => setDeployLabel(e.target.value)}
          placeholder="Label"
          className="bg-mantle text-text text-md rounded px-2 py-1 border border-surface0 focus:border-blue focus:outline-none font-mono w-32"
        />
        <Button
          size="sm"
          onClick={() => { deployToProvider(project.id, "digitalocean", deployLabel || undefined); setDeployLabel(""); }}
          title="Deploy a new DigitalOcean droplet for this project"
        >
          <Server size={12} className="mr-1 text-blue" /> + DO
        </Button>
        <Button
          size="sm"
          onClick={() => { deployToProvider(project.id, "tazcloud", deployLabel || undefined); setDeployLabel(""); }}
          title="Deploy a new TazCloud VM for this project"
        >
          <Cloud size={12} className="mr-1 text-blue" /> + Taz
        </Button>
      </div>
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
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      )}
    </div>
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
        {error && <ErrorMessage>{error}</ErrorMessage>}
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
        <ErrorMessage className="mt-2 font-mono">{error}</ErrorMessage>
      )}
    </div>
  );
}

interface RecipeCommand {
  name: string;
  command: string;
}

export interface RecipeOption {
  /** Env var name set when running the install script (e.g. `PG_VERSION`). */
  name: string;
  label: string;
  choices: { value: string; label: string }[];
  defaultValue: string;
}

/** A secret value the install script needs (e.g. a PAT). Collected from the
 *  user at apply-time via a modal — NOT stored anywhere (settings, DB, or local
 *  storage). Each Install / Re-apply requires the user to paste it again. */
export interface RecipeSecret {
  /** Env var name set in the install script's environment (e.g. `GIT_TOKEN`). */
  name: string;
  label: string;
  /** Placeholder text shown in the input. */
  placeholder?: string;
  /** Short description rendered under the field. May include hints/links. */
  description?: string;
  /** When true, the recipe will refuse to install with this field empty. */
  required?: boolean;
}

export interface VpsRecipeDef {
  id: string;
  label: string;
  icon: typeof Globe;
  description: string;
  port?: number;
  checkScript: string;
  installScript: string;
  uninstallScript: string;
  setupShSnippet: string;
  commands: RecipeCommand[];
  /** Optional pre-install options shown as a small form in the admin panel. */
  options?: RecipeOption[];
  /** Optional secrets prompted via modal on every Install / Re-apply. Required
   *  for recipes that consume sensitive values not safe to persist (PATs).
   *  Distinct from `options` in two ways:
   *    1. Modal-driven UX (not inline form) so the user can't mistakenly leave
   *       a token sitting in the page state across other actions.
   *    2. Each apply re-prompts — no auto-fill, no saved values.
   */
  secrets?: RecipeSecret[];
  /** Custom validation message for secrets — returned non-null to block submit.
   *  Use when at-least-one-of-several is required rather than per-field. */
  validateSecrets?: (values: Record<string, string>) => string | null;
}

/** Shared bash helpers for every Add-on install/uninstall script.
 *  - `log "msg"` — printf with [HH:MM:SS] prefix; visible in the streaming output pane.
 *  - `wait_apt` — block until no other process holds an apt/dpkg lock; logs a
 *    heartbeat every 10 s with the holder process name (unattended-upgrades, etc.).
 *
 *  Embedded into a JS template literal, so any `${...}` that should reach bash
 *  must be escaped as `\${...}` here.
 */
export const BASH_HELPERS = `log() { printf '[%s] %s\\n' "$(date '+%H:%M:%S')" "$*"; }
# Make glibc prefer IPv4 over IPv6 for DNS resolution, plus export NODE_OPTIONS
# for the current shell. TazCloud VMs have broken v6 routing to Cloudflare/Fastly
# CDNs (registry.npmjs.org, apt.postgresql.org, etc.) — see taz-ipv6-quirk.
# The gai.conf rule persists across the system; the env var covers the current
# script (which runs in a non-login shell, so /etc/profile.d isn't sourced).
force_ipv4_dns() {
  if ! grep -qE "^precedence ::ffff:0:0/96\\s+100" /etc/gai.conf 2>/dev/null; then
    echo 'precedence ::ffff:0:0/96  100' | sudo tee -a /etc/gai.conf > /dev/null
  fi
  export NODE_OPTIONS="\${NODE_OPTIONS:+\$NODE_OPTIONS }--dns-result-order=ipv4first"
}
wait_apt() {
  local i=0
  local LOCKS="/var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock"
  # Returns "<pid> <elapsed> <cmd>" lines for every PID holding any apt/dpkg lock.
  apt_lock_holder_details() {
    local pids
    pids=$(sudo fuser $LOCKS 2>/dev/null | tr -s ' \\t' '\\n' | sed '/^$/d' | sort -u)
    [ -z "$pids" ] && { echo "unknown"; return; }
    local out=""
    for pid in $pids; do
      local row
      row=$(ps -o pid=,etime=,args= -p "$pid" 2>/dev/null | sed 's/^ *//; s/ *$//; s/  */ /g')
      if [ -n "$row" ]; then
        # Truncate to keep heartbeat lines readable.
        out="$out\\n  $(echo "$row" | head -c 110)"
      fi
    done
    [ -z "$out" ] && { echo "unknown"; return; }
    printf '%b' "$out"
  }
  if ! sudo fuser $LOCKS >/dev/null 2>&1; then return; fi
  log "Waiting for apt lock — held by:$(apt_lock_holder_details)"
  while sudo fuser $LOCKS >/dev/null 2>&1; do
    i=$((i+1))
    [ "$i" -gt 600 ] && { log "Timeout waiting for apt lock (10min)"; exit 1; }
    if [ $((i % 10)) = 0 ]; then
      log "Still waiting (\${i}s) — held by:$(apt_lock_holder_details)"
    fi
    sleep 1
  done
  log "apt lock released after \${i}s."
}`;

export const VPS_RECIPES: VpsRecipeDef[] = [
  {
    id: "genie-standard",
    label: "Genie Standard Setup",
    icon: Sparkles,
    description: "Baseline Genie expects on every VPS: the 'genie' deploy user (passwordless sudo, same SSH key), Docker + compose, Node.js 20, Claude Code, /opt/project owned by genie.",
    // NOTE: we intentionally do NOT verify docker-group membership here.
    // `usermod -aG docker` only takes effect on the user's NEXT login, and
    // even a fresh SSH session can hold a stale group list (NSS cache,
    // systemd-logind, sshd PAM session reuse). That made the button report
    // NOT_INSTALLED for the first page load after a successful install,
    // which is exactly the bug "Genie button not active even though Genie
    // Standard Setup has been done". The docker group is a UX nicety (run
    // `docker` without sudo), not a marker of "is the recipe installed".
    // The authorized_keys check uses `sudo -n` because /home/genie/.ssh is mode
    // 700 (owned by genie); when the saved SSH connection user is the image
    // default (almalinux/ubuntu/debian) — typical when Standard Setup is run
    // after a bare VM deploy — a direct `[ -s ... ]` test silently fails on
    // the unreadable parent dir and reports NOT_INSTALLED on every refresh,
    // exactly the bug "Genie button not green after refresh". -n is safe: the
    // install script itself relies on passwordless sudo, so if install
    // succeeded, `sudo -n` works.
    checkScript: `if id genie >/dev/null 2>&1 && sudo -n test -s /home/genie/.ssh/authorized_keys && command -v docker > /dev/null 2>&1 && docker compose version > /dev/null 2>&1 && command -v node > /dev/null 2>&1 && command -v npm > /dev/null 2>&1 && command -v claude > /dev/null 2>&1 && [ -d /opt/project ] && [ "$(stat -c %U /opt/project 2>/dev/null || stat -f %Su /opt/project)" = "genie" ]; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
# Prefer IPv4 globally for the rest of this script. The NodeSource setup_20.x
# script runs its own apt-get update against deb.nodesource.com (Cloudflare-
# fronted), which stalls over IPv6 on Taz VMs — see taz-ipv6-quirk. The outer
# curl -4 only fixes the initial download, not what the script does internally,
# so we patch /etc/gai.conf to make all subsequent DNS prefer v4.
force_ipv4_dns
log "Applying Genie standard setup (Docker, Node 20, Claude Code, /opt/project)..."
if command -v apt-get > /dev/null 2>&1; then
  log "apt-get update..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
  log "apt-get install docker.io git curl ca-certificates..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq docker.io git curl ca-certificates > /dev/null
  # Always run NodeSource's setup — Ubuntu 22.04 ships nodejs 12 without npm,
  # so even when 'command -v node' succeeds we can't trust the version. NodeSource
  # installs a higher-priority apt pin so the subsequent 'apt install nodejs'
  # *replaces* Ubuntu's old package with v20 (which bundles npm).
  node_major=$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\\1/' || echo 0)
  if [ "$node_major" -lt 20 ] || ! command -v npm > /dev/null 2>&1; then
    log "Adding NodeSource repo (apt update inside — usually 30–60 s)..."
    curl -4 -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1 | sed 's/^/  /'
    log "Installing Node.js 20 (bundles npm)..."
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq nodejs 2>&1 | sed 's/^/  /'
  else
    log "Node.js \${node_major}.x with npm already present, skipping NodeSource."
  fi
elif command -v dnf > /dev/null 2>&1; then
  log "dnf install docker git curl..."
  sudo dnf install -y -q docker git curl > /dev/null
  node_major=$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\\1/' || echo 0)
  if [ "$node_major" -lt 20 ] || ! command -v npm > /dev/null 2>&1; then
    log "Adding NodeSource repo (dnf install inside)..."
    curl -4 -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - 2>&1 | sed 's/^/  /'
    log "Installing Node.js 20 (bundles npm)..."
    sudo dnf install -y -q nodejs 2>&1 | sed 's/^/  /'
  else
    log "Node.js \${node_major}.x with npm already present, skipping NodeSource."
  fi
else
  log "Unsupported package manager (need apt-get or dnf)"; exit 1
fi
log "Enabling and starting docker..."
sudo systemctl enable --now docker > /dev/null 2>&1 || true
# Docker Compose v2 is shipped by Ubuntu only on 24.04+, and the package name
# varies across distros (docker-compose-v2 / docker-compose-plugin / absent).
# Drop the CLI plugin binary directly from the official GitHub release — works
# on any apt or dnf distro and any arch we'd realistically see. Force IPv4 for
# Taz VMs (Fastly-fronted CDN is v6-flaky).
if ! docker compose version > /dev/null 2>&1; then
  COMPOSE_VER=v2.29.7
  ARCH=$(uname -m)
  log "Installing Docker Compose $COMPOSE_VER for $ARCH from GitHub..."
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  sudo curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \\
    "https://github.com/docker/compose/releases/download/$\{COMPOSE_VER}/docker-compose-linux-$\{ARCH}"
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
# Same v4 + retry workaround as the standalone claude-code recipe — registry.npmjs.org
# is Fastly-fronted and v6-broken from some Taz VMs.
log "Installing Claude Code globally (npm install -g @anthropic-ai/claude-code)..."
sudo -E NODE_OPTIONS="--dns-result-order=ipv4first" \\
  npm install -g \\
    --no-audit --no-fund \\
    --fetch-retries=2 --fetch-retry-mintimeout=5000 \\
    @anthropic-ai/claude-code 2>&1 | tail -10
# Create the 'genie' deploy user. We do this last so npm install of Claude
# Code (which can be flaky on Taz VMs) doesn't block the user creation step —
# but before the /opt/project chown so we can hand it to genie directly.
log "Creating 'genie' deploy user (idempotent)..."
sudo useradd -m -s /bin/bash genie 2>/dev/null || true
echo 'genie ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/genie > /dev/null
sudo chmod 440 /etc/sudoers.d/genie

# Copy the *calling* user's authorized_keys so the same SSH key (the one Genie
# uses to reach this VM) also lets us SSH in as 'genie' afterwards. /root may
# not have keys when the recipe runs as ubuntu/debian/almalinux, so source from
# $HOME and fail loudly if it's missing — silently skipping would create a user
# nobody can log into.
src_keys="$HOME/.ssh/authorized_keys"
if [ ! -s "$src_keys" ]; then
  log "ERROR: no $src_keys to copy from — cannot grant SSH access to the genie user."
  exit 1
fi
sudo mkdir -p /home/genie/.ssh
sudo cp "$src_keys" /home/genie/.ssh/authorized_keys
sudo chown -R genie:genie /home/genie/.ssh
sudo chmod 700 /home/genie/.ssh
sudo chmod 600 /home/genie/.ssh/authorized_keys

log "Ensuring /opt/project exists and is owned by genie..."
sudo mkdir -p /opt/project
sudo chown -R genie:genie /opt/project
log "Adding $(whoami) and genie to docker group (no-op if already there)..."
sudo usermod -aG docker "$(whoami)" 2>/dev/null || true
sudo usermod -aG docker genie 2>/dev/null || true
log "Versions:"
log "  Docker:  $(docker --version 2>/dev/null || echo MISSING)"
log "  Node:    $(node --version 2>/dev/null || echo MISSING)"
log "  Claude:  $(claude --version 2>&1 | head -1 || echo MISSING)"
log "Genie standard setup complete. SSH in as: ssh genie@$(hostname -I 2>/dev/null | awk '{print $1}')"
log "Note: @genie/vps-agent is uploaded on-demand by the manager — not installed here."`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Removing Claude Code (user-facing global)..."
sudo npm uninstall -g @anthropic-ai/claude-code 2>&1 | tail -3 || true
rm -rf "$HOME/.claude" 2>/dev/null || true
log "Note: Docker, Node.js, and /opt/project are left in place — uninstall those individually if needed."
log "Done."`,
    setupShSnippet: `# Genie standard setup: 'genie' user, Docker, Node 20, Claude Code, /opt/project
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq docker.io git curl ca-certificates > /dev/null
# Docker Compose v2 from GitHub release (apt has no consistent package across distros)
COMPOSE_VER=v2.29.7; ARCH=$(uname -m); mkdir -p /usr/local/lib/docker/cli-plugins
curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose "https://github.com/docker/compose/releases/download/$\{COMPOSE_VER}/docker-compose-linux-$\{ARCH}"
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
curl -4 -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
apt-get -o Acquire::ForceIPv4=true install -y -qq nodejs > /dev/null
systemctl enable --now docker
NODE_OPTIONS="--dns-result-order=ipv4first" npm install -g --no-audit --no-fund @anthropic-ai/claude-code
# 'genie' deploy user: passwordless sudo, same SSH key as root, owns /opt/project.
useradd -m -s /bin/bash genie 2>/dev/null || true
echo 'genie ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/genie
chmod 440 /etc/sudoers.d/genie
mkdir -p /home/genie/.ssh
cp /root/.ssh/authorized_keys /home/genie/.ssh/authorized_keys
chown -R genie:genie /home/genie/.ssh
chmod 700 /home/genie/.ssh && chmod 600 /home/genie/.ssh/authorized_keys
mkdir -p /opt/project && chown -R genie:genie /opt/project
usermod -aG docker genie 2>/dev/null || true`,
    commands: [
      { name: "Versions (all)", command: `echo "Docker:  $(docker --version 2>/dev/null || echo MISSING)"; echo "Node:    $(node --version 2>/dev/null || echo MISSING)"; echo "npm:     $(npm --version 2>/dev/null || echo MISSING)"; echo "Claude:  $(claude --version 2>&1 | head -1 || echo MISSING)"; echo "Agent:   $(command -v genie-agent 2>/dev/null || echo MISSING)"` },
      { name: "Show genie user", command: "id genie 2>/dev/null || echo '(no genie user)'" },
      { name: "Verify /opt/project ownership", command: "ls -ld /opt/project" },
      { name: "Test login as genie (whoami)", command: "sudo -H -u genie whoami" },
      { name: "Test sudo as genie (NOPASSWD)", command: "sudo -H -u genie sudo -n true && echo 'OK: genie has passwordless sudo' || echo 'FAIL: genie missing NOPASSWD sudo'" },
      { name: "Show genie authorized keys (fingerprints)", command: "sudo ssh-keygen -l -f /home/genie/.ssh/authorized_keys 2>/dev/null || echo '(no authorized_keys)'" },
      { name: "Verify user in docker group", command: `id -nG | tr ' ' '\\n' | grep -qx docker && echo "OK: $(whoami) is in docker group" || echo "NOT in docker group — log out + back in after install"` },
      { name: "Re-run setup (idempotent)", command: `sudo -E NODE_OPTIONS="--dns-result-order=ipv4first" npm install -g --no-audit --no-fund @anthropic-ai/claude-code 2>&1 | tail -5` },
      { name: "Docker info", command: "docker info 2>&1 | head -20" },
    ],
  },
  {
    id: "chrome",
    label: "Chrome",
    icon: Globe,
    description: "Install headless Chrome browser",
    port: 9222,
    checkScript: `if google-chrome-stable --version > /dev/null 2>&1; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
log "Installing Chrome dependencies..."
# ForceIPv4: apt iterates ALL configured sources during update; on Taz VMs the
# v6 path to Fastly-fronted repos (apt.postgresql.org) stalls — see taz-ipv6-quirk.
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq wget curl gnupg2 > /dev/null
log "Adding Chrome repository..."
# Ensure keyring dir exists and clear any stale keyring from a prior partial
# install — gpg --dearmor -o refuses to overwrite, which would close the pipe
# and surface as curl: (23) Failure writing output to destination. Don't
# suppress gpg stderr — when it fails, we want to see it in the recipe output.
sudo install -d -m 0755 /usr/share/keyrings
sudo rm -f /usr/share/keyrings/google-chrome.gpg
curl -4 -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list > /dev/null
log "Refreshing package list (with new Chrome repo)..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
log "Installing google-chrome-stable (download ~80MB, takes 1-2 min)..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq google-chrome-stable > /dev/null
log "Verifying..."
google-chrome-stable --version
log "Chrome installed successfully."`,
    uninstallScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
log "Removing Chrome..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 remove -y -qq google-chrome-stable > /dev/null 2>&1 || true
sudo rm -f /etc/apt/sources.list.d/google-chrome.list
sudo rm -f /usr/share/keyrings/google-chrome.gpg
log "Autoremove..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 autoremove -y -qq > /dev/null
log "Chrome removed."`,
    setupShSnippet: `# Install Chrome
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq wget gnupg2 > /dev/null
# Idempotency: ensure keyring dir exists + clear any stale keyring so the gpg
# --dearmor doesn't fail with "File exists" (which would close the pipe and
# surface as a broken-pipe error upstream). Mirrors the install script.
install -d -m 0755 /usr/share/keyrings
rm -f /usr/share/keyrings/google-chrome.gpg
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq google-chrome-stable > /dev/null`,
    commands: [
      { name: "Check version", command: "google-chrome-stable --version" },
      { name: "Launch headless", command: "google-chrome-stable --headless --no-sandbox --disable-gpu --remote-debugging-port=9222 &" },
      { name: "Launch with URL", command: "google-chrome-stable --headless --no-sandbox --disable-gpu --remote-debugging-port=9222 http://localhost:3000 &" },
      { name: "Screenshot a page", command: "google-chrome-stable --headless --no-sandbox --disable-gpu --screenshot=/tmp/screenshot.png --window-size=1280,720 http://localhost:3000" },
      { name: "Print page to PDF", command: "google-chrome-stable --headless --no-sandbox --disable-gpu --print-to-pdf=/tmp/page.pdf http://localhost:3000" },
      { name: "Kill all Chrome", command: "pkill -f google-chrome || true" },
    ],
  },
  {
    id: "postgres",
    label: "PostgreSQL",
    icon: Database,
    description: "Install and start PostgreSQL",
    port: 5432,
    checkScript: `command -v psql > /dev/null 2>&1 && echo "INSTALLED" || echo "NOT_INSTALLED"`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
PG_VERSION="\${PG_VERSION:-default}"
log "Installing PostgreSQL (version: $PG_VERSION)..."
if [ "$PG_VERSION" = "default" ]; then
  log "apt-get update..."
  wait_apt; sudo DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
  log "apt-get install postgresql (this can take 1-2 min)..."
  wait_apt; sudo DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq postgresql postgresql-contrib > /dev/null
  log "apt-get install done."
else
  # Add PGDG repository to get specific PG versions (Ubuntu/Debian only).
  # apt.postgresql.org and www.postgresql.org are Fastly-fronted; v6 egress to
  # Fastly hangs from some VMs (e.g. TazCloud), so force IPv4 for these fetches.
  log "Installing prereqs (curl, ca-certificates, lsb-release)..."
  wait_apt; sudo DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq curl ca-certificates lsb-release > /dev/null
  log "Adding PGDG repository key + source..."
  sudo install -d /etc/apt/keyrings
  curl -4 -fsSL --max-time 60 https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo tee /etc/apt/keyrings/postgresql.asc > /dev/null
  CODENAME=$(lsb_release -cs)
  echo "deb [signed-by=/etc/apt/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt $CODENAME-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
  log "Codename: $CODENAME — apt-get update (refresh PGDG)..."
  wait_apt; sudo DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
  log "apt-get install postgresql-$PG_VERSION (can take 1-3 min)..."
  wait_apt; sudo DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq postgresql-$PG_VERSION postgresql-contrib-$PG_VERSION > /dev/null
  log "apt-get install done."
fi
log "Starting PostgreSQL..."
# Prefer systemctl (modern Ubuntu/Debian/Almalinux); fall back to legacy 'service'.
if command -v systemctl >/dev/null 2>&1; then
  # Unmask in case a previous install/uninstall cycle left the unit masked
  # (postgresql.service is a Type=oneshot meta-unit; postgres-common postinst
  # can mask it under certain reinstall paths). systemctl start on a masked
  # unit exits 5 and the cluster never starts.
  if systemctl status postgresql 2>&1 | grep -q "Loaded: masked"; then
    log "postgresql.service is masked — unmasking..."
    sudo systemctl unmask postgresql 2>/dev/null || true
  fi
  # Also unmask the per-cluster instance unit (this is the one that actually
  # runs the postmaster — postgresql.service is just a oneshot dispatcher).
  if [ "$PG_VERSION" != "default" ] && systemctl status "postgresql@$PG_VERSION-main" 2>&1 | grep -q "Loaded: masked"; then
    log "postgresql@$PG_VERSION-main.service is masked — unmasking..."
    sudo systemctl unmask "postgresql@$PG_VERSION-main" 2>/dev/null || true
  fi
  sudo systemctl enable postgresql > /dev/null 2>&1 || true
  sudo systemctl start postgresql || sudo systemctl restart postgresql
else
  sudo service postgresql start
fi
# Wait for the postgres socket to actually accept connections — start may return
# before initdb-on-first-boot has finished creating the cluster.
log "Waiting for PostgreSQL to accept connections..."
for i in $(seq 1 30); do
  if sudo -i -u postgres psql -tAc "SELECT 1" > /dev/null 2>&1; then
    log "Connected after $i second(s)."
    break
  fi
  if [ "$i" = 5 ] || [ "$i" = 15 ] || [ "$i" = 25 ]; then log "Still waiting ($i s)..."; fi
  sleep 1
done
if ! sudo -i -u postgres psql -tAc "SELECT 1" > /dev/null 2>&1; then
  log "PostgreSQL did not become reachable within 30s. Diagnostics:"
  sudo systemctl status postgresql --no-pager 2>&1 | head -30 || true
  echo "--- last 50 lines of postgres log ---"
  sudo journalctl -u postgresql --no-pager -n 50 2>&1 || true
  exit 1
fi
log "Setting postgres password..."
sudo -i -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';" > /dev/null
INSTALLED_VERSION=$(sudo -i -u postgres psql -tAc "SHOW server_version" 2>/dev/null | head -1)
log "PostgreSQL ready (user: postgres, password: postgres, port: 5432, version: $INSTALLED_VERSION)"`,
    uninstallScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
log "Stopping PostgreSQL..."
sudo service postgresql stop 2>/dev/null || true
log "Removing PostgreSQL packages..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 remove -y -qq postgresql postgresql-contrib > /dev/null
log "Autoremove..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 autoremove -y -qq > /dev/null
log "PostgreSQL removed."`,
    setupShSnippet: `# Install and start PostgreSQL
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq postgresql postgresql-contrib > /dev/null
service postgresql start
cd / && su - postgres -c "psql -c \\"ALTER USER postgres PASSWORD 'postgres';\\""`,
    commands: [
      { name: "Start service", command: "sudo service postgresql start" },
      { name: "Stop service", command: "sudo service postgresql stop" },
      { name: "Restart service", command: "sudo service postgresql restart" },
      { name: "Check status", command: "sudo service postgresql status" },
      { name: "Connect as postgres", command: "sudo -i -u postgres psql" },
      { name: "List databases", command: "sudo -i -u postgres psql -l" },
      { name: "Create database", command: "sudo -i -u postgres createdb myapp" },
      { name: "Connection string", command: "echo 'postgresql://postgres:postgres@localhost:5432/postgres'" },
    ],
    options: [
      {
        name: "PG_VERSION",
        label: "Version",
        defaultValue: "default",
        choices: [
          { value: "default", label: "Ubuntu default (14 on 22.04, 16 on 24.04)" },
          { value: "14", label: "14" },
          { value: "15", label: "15" },
          { value: "16", label: "16" },
          { value: "17", label: "17 (latest)" },
        ],
      },
    ],
  },
  {
    id: "genie-browser",
    label: "Genie Browser",
    icon: Globe,
    description: "MCP browser automation via reverse SSH tunnel",
    port: 9877,
    checkScript: `curl -sf http://127.0.0.1:9877/mcp > /dev/null 2>&1 && echo "INSTALLED" || echo "NOT_INSTALLED"`,
    installScript: `set -e
${BASH_HELPERS}
log "Configuring genie-browser MCP..."
# /opt/project is created by the Genie project-deploy flow; for bare VMs we create it.
if [ ! -d /opt/project ]; then
  log "Creating /opt/project directory..."
  sudo mkdir -p /opt/project && sudo chown "$(whoami):$(whoami)" /opt/project
fi
if [ ! -f /opt/project/.mcp.json ]; then
  log "Seeding empty .mcp.json..."
  echo '{"mcpServers":{}}' > /opt/project/.mcp.json
fi
log "Merging genie-browser entry into .mcp.json..."
# Use jq if available, else fall back to node, else a python one-liner.
if command -v jq >/dev/null 2>&1; then
  tmp=$(mktemp)
  jq '.mcpServers["genie-browser"] = {"type":"http","url":"http://127.0.0.1:9877/mcp"}' /opt/project/.mcp.json > "$tmp" && mv "$tmp" /opt/project/.mcp.json
elif command -v node >/dev/null 2>&1; then
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('/opt/project/.mcp.json', 'utf8'));
    if (!cfg.mcpServers) cfg.mcpServers = {};
    cfg.mcpServers['genie-browser'] = { type: 'http', url: 'http://127.0.0.1:9877/mcp' };
    fs.writeFileSync('/opt/project/.mcp.json', JSON.stringify(cfg, null, 2));
  "
else
  python3 -c "
import json
with open('/opt/project/.mcp.json') as f: cfg = json.load(f)
cfg.setdefault('mcpServers', {})['genie-browser'] = {'type': 'http', 'url': 'http://127.0.0.1:9877/mcp'}
with open('/opt/project/.mcp.json', 'w') as f: json.dump(cfg, f, indent=2)
"
fi
log "genie-browser MCP configured in .mcp.json"
log "Note: the browser tunnel is established when the Chrome extension connects."`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Removing genie-browser from .mcp.json..."
if [ -f /opt/project/.mcp.json ]; then
  if command -v jq >/dev/null 2>&1; then
    tmp=$(mktemp); jq 'del(.mcpServers["genie-browser"])' /opt/project/.mcp.json > "$tmp" && mv "$tmp" /opt/project/.mcp.json
  elif command -v node >/dev/null 2>&1; then
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('/opt/project/.mcp.json', 'utf8'));
      delete cfg.mcpServers['genie-browser'];
      fs.writeFileSync('/opt/project/.mcp.json', JSON.stringify(cfg, null, 2));
    "
  fi
fi
log "genie-browser removed."`,
    setupShSnippet: `# Configure genie-browser MCP
if [ ! -f /opt/project/.mcp.json ]; then echo '{"mcpServers":{}}' > /opt/project/.mcp.json; fi
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('/opt/project/.mcp.json','utf8'));c.mcpServers=c.mcpServers||{};c.mcpServers['genie-browser']={type:'http',url:'http://127.0.0.1:9877/mcp'};fs.writeFileSync('/opt/project/.mcp.json',JSON.stringify(c,null,2));"`,
    commands: [
      { name: "Check tunnel status", command: "curl -sf http://127.0.0.1:9877/mcp && echo 'Tunnel active' || echo 'Tunnel not connected'" },
      { name: "View .mcp.json", command: "cat /opt/project/.mcp.json" },
      { name: "Test browser snapshot", command: `curl -s -X POST http://127.0.0.1:9877/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"browser_get_snapshot","arguments":{}}}'` },
    ],
  },
  {
    id: "navision",
    label: "Navision (BC)",
    icon: Package,
    description: "Microsoft Dynamics 365 Business Central (Navision) sandbox",
    port: 8080,
    checkScript: `docker ps --format "{{.Names}}" 2>/dev/null | grep -qx "bc-sandbox" && echo "INSTALLED" || echo "NOT_INSTALLED"`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
# Ensure Docker is installed — Navision depends on it.
if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found — installing first..."
  if command -v apt-get >/dev/null 2>&1; then
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq docker.io curl ca-certificates > /dev/null
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y -q docker curl > /dev/null
  else
    log "Unsupported package manager (need apt-get or dnf)"; exit 1
  fi
  sudo systemctl enable --now docker > /dev/null 2>&1
  sudo usermod -aG docker "$USER" 2>/dev/null || true
  # Cross-distro Compose v2 from official GitHub release.
  if ! docker compose version >/dev/null 2>&1; then
    COMPOSE_VER=v2.29.7; ARCH=$(uname -m)
    sudo mkdir -p /usr/local/lib/docker/cli-plugins
    sudo curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \\
      "https://github.com/docker/compose/releases/download/$\{COMPOSE_VER}/docker-compose-linux-$\{ARCH}"
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  fi
  log "Docker installed: $(docker --version)"
fi
log "Pulling Business Central image — ~5GB, takes several minutes..."
sudo docker pull mcr.microsoft.com/businesscentral:latest 2>&1 | while IFS= read -r line; do
  # Docker pull emits dozens of "Pulling fs layer / Downloading / Extracting" lines.
  # Surface only the high-signal ones so the panel doesn't spam.
  case "$line" in
    *"Pull complete"*|*"Status:"*|*"Digest:"*) log "$line" ;;
  esac
done
log "Creating BC sandbox container..."
sudo docker run -d --name bc-sandbox \\
  -e ACCEPT_EULA=Y \\
  -e USESSL=N \\
  -e USERNAME=admin \\
  -e PASSWORD=P@ssw0rd123! \\
  -p 8080:80 \\
  -p 7049:7049 \\
  -p 7048:7048 \\
  --memory=8g \\
  mcr.microsoft.com/businesscentral:latest > /dev/null
log "Waiting for BC to initialize (3-5 min)..."
for i in $(seq 1 60); do
  if sudo docker logs bc-sandbox 2>&1 | grep -q "Ready for connections"; then
    log "Business Central is ready!"
    log "Web Client: http://\$(hostname -I | awk '{print \$1}'):8080/BC/"
    log "Username: admin"
    log "Password: P@ssw0rd123!"
    log "OData:     http://\$(hostname -I | awk '{print \$1}'):7048/BC/ODataV4"
    log "Dev:       http://\$(hostname -I | awk '{print \$1}'):7049/BC"
    exit 0
  fi
  if [ $((i % 6)) = 0 ]; then log "Still initializing ($((i*5))s elapsed)..."; fi
  sleep 5
done
log "BC container started but still initializing. Check with: docker logs -f bc-sandbox"`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Stopping Business Central..."
sudo docker stop bc-sandbox 2>/dev/null || true
sudo docker rm bc-sandbox 2>/dev/null || true
log "Business Central removed."
log "Note: Docker image still cached. Run 'docker rmi mcr.microsoft.com/businesscentral:latest' to free disk space."`,
    setupShSnippet: `# Business Central (Navision) sandbox
docker pull mcr.microsoft.com/businesscentral:latest
docker run -d --name bc-sandbox \\
  -e ACCEPT_EULA=Y -e USESSL=N \\
  -e USERNAME=admin -e PASSWORD=\${BC_PASSWORD:-P@ssw0rd123!} \\
  -p 8080:80 -p 7049:7049 -p 7048:7048 \\
  --memory=8g \\
  mcr.microsoft.com/businesscentral:latest`,
    commands: [
      { name: "Web Client URL", command: `echo "http://$(hostname -I | awk '{print $1}'):8080/BC/"` },
      { name: "Container status", command: "docker ps --filter name=bc-sandbox --format 'table {{.Status}}\t{{.Ports}}'" },
      { name: "View logs", command: "docker logs --tail 50 bc-sandbox" },
      { name: "Follow logs", command: "docker logs -f bc-sandbox" },
      { name: "Restart BC", command: "docker restart bc-sandbox" },
      { name: "Stop BC", command: "docker stop bc-sandbox" },
      { name: "Start BC", command: "docker start bc-sandbox" },
      { name: "Check readiness", command: `docker logs bc-sandbox 2>&1 | grep -c "Ready for connections" > /dev/null && echo "BC is ready" || echo "BC still initializing..."` },
      { name: "OData endpoint", command: `echo "http://$(hostname -I | awk '{print $1}'):7048/BC/ODataV4"` },
      { name: "Dev endpoint", command: `echo "http://$(hostname -I | awk '{print $1}'):7049/BC"` },
      { name: "PowerShell into BC", command: "docker exec -it bc-sandbox powershell" },
      { name: "List extensions", command: `docker exec bc-sandbox powershell -Command "Get-NAVAppInfo -ServerInstance BC" 2>/dev/null || echo "BC still starting..."` },
    ],
  },
  {
    id: "docker",
    label: "Docker",
    icon: Container,
    description: "Container runtime (engine + compose)",
    checkScript: `if command -v docker > /dev/null 2>&1 && sudo systemctl is-active --quiet docker 2>/dev/null; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
if command -v apt-get > /dev/null 2>&1; then
  log "Installing Docker via apt..."
  log "apt-get update..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
  log "apt-get install docker.io (~250MB, 1-2 min)..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq docker.io curl ca-certificates > /dev/null
elif command -v dnf > /dev/null 2>&1; then
  log "Installing Docker via dnf..."
  sudo dnf install -y -q docker curl > /dev/null
else
  log "Unsupported package manager (need apt-get or dnf)"; exit 1
fi
log "Enabling and starting docker service..."
sudo systemctl enable --now docker > /dev/null 2>&1
sudo usermod -aG docker "$USER" 2>/dev/null || true
# Docker Compose v2 from GitHub release — package name is inconsistent across
# distros (docker-compose-v2 on Ubuntu 24.04+, docker-compose-plugin on
# docker-ce repos, absent on stock Ubuntu 22.04 / Debian 12). The plugin
# binary works on any distro and survives apt-get upgrades.
if ! docker compose version > /dev/null 2>&1; then
  COMPOSE_VER=v2.29.7
  ARCH=$(uname -m)
  log "Installing Docker Compose $COMPOSE_VER for $ARCH from GitHub..."
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  sudo curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \\
    "https://github.com/docker/compose/releases/download/$\{COMPOSE_VER}/docker-compose-linux-$\{ARCH}"
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
log "Docker installed: $(docker --version)"
log "Compose:          $(docker compose version 2>/dev/null || echo MISSING)"`,
    uninstallScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
log "Stopping Docker..."
sudo systemctl stop docker > /dev/null 2>&1 || true
sudo systemctl disable docker > /dev/null 2>&1 || true
if command -v apt-get > /dev/null 2>&1; then
  log "apt-get remove docker.io..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 remove -y -qq docker.io > /dev/null 2>&1 || true
  log "Autoremove..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 autoremove -y -qq > /dev/null
elif command -v dnf > /dev/null 2>&1; then
  log "dnf remove docker..."
  sudo dnf remove -y -q docker > /dev/null 2>&1 || true
fi
log "Removing Compose CLI plugin..."
sudo rm -f /usr/local/lib/docker/cli-plugins/docker-compose
log "Docker removed."`,
    setupShSnippet: `# Install Docker + Compose v2 (Compose binary from GitHub release for distro-independent install)
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get > /dev/null 2>&1; then
  apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq docker.io curl ca-certificates > /dev/null
elif command -v dnf > /dev/null 2>&1; then
  dnf install -y -q docker curl > /dev/null
fi
systemctl enable --now docker
if ! docker compose version > /dev/null 2>&1; then
  COMPOSE_VER=v2.29.7; ARCH=$(uname -m); mkdir -p /usr/local/lib/docker/cli-plugins
  curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose "https://github.com/docker/compose/releases/download/$\{COMPOSE_VER}/docker-compose-linux-$\{ARCH}"
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi`,
    commands: [
      { name: "Version", command: "docker --version && docker compose version 2>/dev/null || true" },
      { name: "List running containers", command: "docker ps" },
      { name: "List all containers", command: "docker ps -a" },
      { name: "List images", command: "docker images" },
      { name: "Disk usage", command: "docker system df" },
      { name: "Live stats", command: "docker stats --no-stream" },
      { name: "Prune (containers/images/volumes)", command: "docker system prune -f" },
      { name: "Service status", command: "sudo systemctl status docker --no-pager | head -10" },
      { name: "Restart Docker", command: "sudo systemctl restart docker && echo restarted" },
      { name: "Compose: up", command: "cd /opt/project && sudo docker compose up -d" },
      { name: "Compose: down", command: "cd /opt/project && sudo docker compose down" },
      { name: "Compose: ps", command: "cd /opt/project && sudo docker compose ps" },
      { name: "Compose: logs (tail 100)", command: "cd /opt/project && sudo docker compose logs --tail 100" },
    ],
  },
  {
    id: "rkhunter",
    label: "rkhunter",
    icon: Bug,
    description: "Rootkit Hunter — scan for rootkits, backdoors, local exploits",
    checkScript: `command -v rkhunter > /dev/null 2>&1 && echo "INSTALLED" || echo "NOT_INSTALLED"`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
if command -v apt-get > /dev/null 2>&1; then
  log "Installing rkhunter via apt..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq rkhunter > /dev/null
elif command -v dnf > /dev/null 2>&1; then
  log "Installing rkhunter via dnf (requires EPEL on AlmaLinux/RHEL)..."
  sudo dnf install -y -q epel-release > /dev/null 2>&1 || true
  sudo dnf install -y -q rkhunter > /dev/null
else
  log "Unsupported package manager (need apt-get or dnf)"; exit 1
fi
log "Updating rkhunter signature database..."
# --update fetches new rules; non-zero exit just means "no updates available", not failure.
sudo rkhunter --update --nocolors 2>&1 | tail -20 || true
log "Baselining file properties (rkhunter --propupd)..."
# Without a baseline, every subsequent --check reports thousands of "file properties
# changed" warnings. Running this once after install is the standard post-install step.
sudo rkhunter --propupd --nocolors > /dev/null
log "rkhunter installed: $(rkhunter --version 2>&1 | head -1)"`,
    uninstallScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
if command -v apt-get > /dev/null 2>&1; then
  log "apt-get remove rkhunter..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 remove -y -qq rkhunter > /dev/null 2>&1 || true
  log "Autoremove..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 autoremove -y -qq > /dev/null
elif command -v dnf > /dev/null 2>&1; then
  log "dnf remove rkhunter..."
  sudo dnf remove -y -q rkhunter > /dev/null 2>&1 || true
fi
log "Removing rkhunter data dirs..."
sudo rm -rf /var/lib/rkhunter /var/log/rkhunter.log /etc/rkhunter.conf 2>/dev/null || true
log "rkhunter removed."`,
    setupShSnippet: `# Install rkhunter
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq rkhunter > /dev/null
rkhunter --update --nocolors 2>&1 | tail -5 || true
rkhunter --propupd --nocolors > /dev/null`,
    commands: [
      { name: "Version", command: "rkhunter --version | head -1" },
      { name: "Full check (skip keypress prompts)", command: "sudo rkhunter --check --sk" },
      { name: "Rootkits only", command: "sudo rkhunter --check --sk --enable rootkits" },
      { name: "Update signatures", command: "sudo rkhunter --update --nocolors" },
      { name: "Re-baseline file properties", command: "sudo rkhunter --propupd --nocolors" },
      { name: "Show last warnings", command: "sudo grep -E 'Warning|Found' /var/log/rkhunter.log | tail -50" },
      { name: "List installed tests", command: "rkhunter --list tests" },
    ],
  },
  {
    id: "git-credentials",
    label: "Git Credentials",
    icon: KeyRound,
    description: "Configure git to clone private repos from github.com and/or gitlab.com. Tokens are prompted each apply — never stored.",
    secrets: [
      {
        name: "GIT_TOKEN",
        label: "GitHub token",
        placeholder: "ghp_… or github_pat_…",
        description: "Classic PAT with 'repo' scope (works for org repos), or a fine-grained PAT with read access. Pasted token is used once and discarded.",
      },
      {
        name: "GITLAB_TOKEN",
        label: "GitLab token",
        placeholder: "glpat-…",
        description: "GitLab personal access token with 'read_repository' (or broader) scope. Leave empty if you only use GitHub.",
      },
    ],
    validateSecrets: (v) =>
      (v.GIT_TOKEN?.trim() || v.GITLAB_TOKEN?.trim())
        ? null
        : "Provide at least one token (GitHub or GitLab).",
    checkScript: `set -e
# Treat the recipe as "installed" only if BOTH the credential.helper is set AND
# the .git-credentials file has at least one entry. That way removing the file
# (or wiping the helper) flips the check back to NOT_INSTALLED.
helper=$(git config --global --get credential.helper 2>/dev/null || true)
if [ "$helper" = "store" ] && [ -s "$HOME/.git-credentials" ]; then
  echo "INSTALLED"
else
  echo "NOT_INSTALLED"
fi`,
    installScript: `set -e
${BASH_HELPERS}
# Tokens are prompted via the Install / Re-apply modal in the admin panel, then
# passed as env vars for this one exec call. They are NOT stored anywhere — the
# user re-enters them each time.
if [ -z "$\{GIT_TOKEN:-}" ] && [ -z "$\{GITLAB_TOKEN:-}" ]; then
  log "ERROR: no token supplied. Click Install or Re-apply and paste at least one token in the dialog."
  exit 1
fi

# Write credential helper config + ~/.git-credentials for one target user.
# Uses sudo when the target isn't the current user so the admin-panel install
# path (which runs as ubuntu/debian/almalinux) can still configure the genie
# deploy account.
write_creds_for_user() {
  local target="$1"
  local home_dir
  home_dir=$(getent passwd "$target" | cut -d: -f6)
  if [ -z "$home_dir" ] || [ ! -d "$home_dir" ]; then
    log "  skip $target: no home directory"
    return 0
  fi

  local creds="$home_dir/.git-credentials"
  local run
  # -H resets $HOME to the target's home dir. Without it, 'git config --global'
  # writes credential.helper into the CALLER's ~/.gitconfig instead of the
  # target's — silently breaking the mirror.
  if [ "$target" = "$(id -un)" ]; then run=""; else run="sudo -H -u $target"; fi

  $run git config --global credential.helper store
  $run touch "$creds"
  $run chmod 600 "$creds"

  # Dedup-then-append per host so re-running with new tokens updates in place
  # rather than accumulating duplicates.
  if [ -n "$\{GIT_TOKEN:-}" ]; then
    $run bash -c "grep -v 'https://[^@]*@github\\.com' '$creds' > '$creds.tmp' || true; echo 'https://x-access-token:$\{GIT_TOKEN}@github.com' >> '$creds.tmp'; mv '$creds.tmp' '$creds'; chmod 600 '$creds'"
  fi
  if [ -n "$\{GITLAB_TOKEN:-}" ]; then
    $run bash -c "grep -v 'https://[^@]*@gitlab\\.com' '$creds' > '$creds.tmp' || true; echo 'https://oauth2:$\{GITLAB_TOKEN}@gitlab.com' >> '$creds.tmp'; mv '$creds.tmp' '$creds'; chmod 600 '$creds'"
  fi
  log "  $target → $creds"
}

current_user=$(id -un)
log "Configuring git credentials for $current_user..."
write_creds_for_user "$current_user"

# Mirror to the 'genie' deploy account so private clones inside setup.sh /
# project containers / per-project recipes also work. The admin "Manage VM"
# panel runs recipes as the image-default user (ubuntu/debian/almalinux), so
# without this mirror, a clone-as-genie later would still prompt.
if [ "$current_user" != "genie" ] && id genie >/dev/null 2>&1; then
  log "Mirroring credentials to the 'genie' deploy account..."
  write_creds_for_user "genie"
fi

log "Done. Try: git clone https://github.com/<org>/<private-repo>.git"`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Removing stored git credentials for $(id -un)..."
rm -f "$HOME/.git-credentials"
git config --global --unset credential.helper 2>/dev/null || true

# Also clean up the mirror on the genie account if we created it.
if [ "$(id -un)" != "genie" ] && id genie >/dev/null 2>&1; then
  log "Removing mirrored credentials for genie..."
  sudo rm -f /home/genie/.git-credentials
  sudo -H -u genie git config --global --unset credential.helper 2>/dev/null || true
fi
log "Removed."`,
    setupShSnippet: `# Git Credentials — adds GIT_TOKEN / GITLAB_TOKEN entries to ~/.git-credentials
# so private repos can be cloned over HTTPS. The runner injects the tokens; you
# don't need to put them in setup.sh in plaintext.
git config --global credential.helper store
: "$\{GIT_TOKEN:?GIT_TOKEN env var is required for this snippet}"
echo "https://x-access-token:$\{GIT_TOKEN}@github.com" >> "$HOME/.git-credentials"
if [ -n "$\{GITLAB_TOKEN:-}" ]; then
  echo "https://oauth2:$\{GITLAB_TOKEN}@gitlab.com" >> "$HOME/.git-credentials"
fi
chmod 600 "$HOME/.git-credentials"`,
    commands: [
      { name: "Show configured hosts (masked)", command: "sed 's#https://[^@]*@#https://***@#' $HOME/.git-credentials 2>/dev/null || echo '(no .git-credentials yet)'" },
      { name: "Show credential helper", command: "git config --global --get credential.helper" },
      { name: "Show genie mirror (masked)", command: "sudo -H -u genie sed 's#https://[^@]*@#https://***@#' /home/genie/.git-credentials 2>/dev/null || echo '(no /home/genie/.git-credentials yet)'" },
      { name: "Show genie credential.helper", command: "sudo -H -u genie git config --global --get credential.helper || echo '(not set for genie)'" },
      { name: "Test github clone", command: "git ls-remote https://github.com/anthropics/anthropic-sdk-typescript.git HEAD" },
      { name: "Test github clone (as genie)", command: "sudo -H -u genie git ls-remote https://github.com/anthropics/anthropic-sdk-typescript.git HEAD" },
    ],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    icon: Sparkles,
    description: "Install the Claude Code CLI (Anthropic) — installs Node.js 20 first if missing",
    checkScript: `if command -v claude > /dev/null 2>&1; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
${BASH_HELPERS}

# 1. Ensure Node.js (the CLI is npm-distributed). Anything ≥18 works.
if ! command -v node > /dev/null 2>&1; then
  log "Node.js not found — installing Node 20 via NodeSource..."
  if command -v apt-get > /dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    # Same v4-forcing pattern as the bootstrap — Fastly-fronted nodesource is
    # v6-flaky from some Taz VMs.
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq curl ca-certificates > /dev/null
    curl -4 -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null 2>&1
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq nodejs > /dev/null
  elif command -v dnf > /dev/null 2>&1; then
    sudo dnf install -y -q curl > /dev/null
    curl -4 -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - > /dev/null 2>&1
    sudo dnf install -y -q nodejs > /dev/null
  else
    log "ERROR: no supported package manager (need apt-get or dnf) and Node.js is missing."
    exit 1
  fi
fi
log "Node: $(node --version), npm: $(npm --version)"

# 2. Install Claude Code globally via npm. Two Taz-specific workarounds:
#    - NODE_OPTIONS=--dns-result-order=ipv4first forces Node's resolver to try
#      IPv4 first; registry.npmjs.org is Fastly-fronted and v6-broken from
#      Taz VMs, so without this npm hangs ~30s per package fetch.
#    - --fetch-retries=2 --fetch-retry-mintimeout=5000 keeps a single failed
#      tarball download from stalling the install for minutes.
#    Dropped --silent so the progress is visible (the tail -3 hid the hang).
log "Installing @anthropic-ai/claude-code (npm install -g)..."
sudo -E NODE_OPTIONS="--dns-result-order=ipv4first" \
  npm install -g \
    --no-audit --no-fund \
    --fetch-retries=2 --fetch-retry-mintimeout=5000 \
    @anthropic-ai/claude-code 2>&1 | tail -20

# 3. Verify.
if command -v claude > /dev/null 2>&1; then
  log "Installed: $(claude --version 2>&1 | head -1)"
else
  log "ERROR: 'claude' is not on PATH after install — check 'npm root -g' and ensure it's in PATH."
  exit 1
fi

log "Claude Code installed. Run 'claude' on the VM to authenticate (interactive)."`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Uninstalling Claude Code..."
sudo npm uninstall -g @anthropic-ai/claude-code 2>&1 | tail -3 || true
# Defensive cleanup of the user-local config (only this user's; doesn't touch others).
rm -rf "$HOME/.claude" 2>/dev/null || true
log "Removed."`,
    setupShSnippet: `# Install Claude Code CLI (assumes Node.js already present from Genie bootstrap)
sudo -E NODE_OPTIONS="--dns-result-order=ipv4first" npm install -g @anthropic-ai/claude-code 2>&1 | tail -3`,
    commands: [
      { name: "Version", command: "claude --version" },
      { name: "Help", command: "claude --help | head -40" },
      { name: "Where installed", command: "command -v claude && ls -la $(command -v claude)" },
      { name: "Update", command: "sudo -E NODE_OPTIONS=--dns-result-order=ipv4first npm install -g @anthropic-ai/claude-code 2>&1 | tail -5" },
    ],
  },
  {
    id: "nextjs",
    label: "Next.js (latest)",
    icon: Layers,
    description: "Scaffold a default Next.js (latest) app at /opt/project and run 'npm run dev' as the 'nextjs-dev' systemd service. Logs append to /var/log/nextjs-dev.log (see CLAUDE.md → VPS Service Logs).",
    port: 3000,
    checkScript: `if [ -f /opt/project/package.json ] && grep -q '"next"' /opt/project/package.json && systemctl is-enabled --quiet nextjs-dev 2>/dev/null; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
${BASH_HELPERS}
# Log path is the convention in CLAUDE.md → VPS Service Logs. Keep these in sync.
LOG_FILE=/var/log/nextjs-dev.log
force_ipv4_dns

# Prereqs (provided by 'Genie Standard Setup'): node, npm, the 'genie' user, /opt/project.
if ! command -v node > /dev/null 2>&1 || ! command -v npm > /dev/null 2>&1; then
  log "ERROR: node/npm missing — install 'Genie Standard Setup' first."; exit 1
fi
if ! id genie > /dev/null 2>&1; then
  log "ERROR: 'genie' user missing — install 'Genie Standard Setup' first."; exit 1
fi
if [ ! -d /opt/project ]; then
  sudo mkdir -p /opt/project && sudo chown -R genie:genie /opt/project
fi
log "Node: $(node --version), npm: $(npm --version)"

# Scaffold only when /opt/project isn't already a Next.js app. create-next-app
# refuses to write into a non-empty dir, so bail loudly rather than clobber.
if [ -f /opt/project/package.json ] && grep -q '"next"' /opt/project/package.json; then
  log "Next.js already initialized at /opt/project — skipping create-next-app."
else
  if [ -n "$(ls -A /opt/project 2>/dev/null)" ]; then
    log "ERROR: /opt/project not empty and not a Next.js app — refusing to overwrite."; exit 1
  fi
  log "Scaffolding Next.js (latest) at /opt/project (1-3 min)..."
  sudo -H -u genie bash -lc 'cd /opt/project && NODE_OPTIONS="--dns-result-order=ipv4first" npx --yes create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes' 2>&1 | sed 's/^/  /'
fi

# systemd 'append:' requires the file to be writable by the service User. genie
# can't create files in /var/log, so we pre-create + chown here.
log "Preparing log file $LOG_FILE..."
sudo touch "$LOG_FILE"
sudo chown genie:genie "$LOG_FILE"
sudo chmod 644 "$LOG_FILE"

# Resolve npm path now (systemd units don't inherit interactive PATH).
NPM_PATH=$(command -v npm)
log "Writing /etc/systemd/system/nextjs-dev.service (ExecStart=$NPM_PATH run dev)..."
sudo tee /etc/systemd/system/nextjs-dev.service > /dev/null <<UNIT
[Unit]
Description=Next.js dev server (Genie)
After=network.target

[Service]
Type=simple
User=genie
WorkingDirectory=/opt/project
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
Environment=PORT=3000
ExecStart=$NPM_PATH run dev
Restart=on-failure
RestartSec=5
KillMode=mixed
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=multi-user.target
UNIT

log "Reloading systemd and starting nextjs-dev..."
sudo systemctl daemon-reload
# 'restart' (not 'start') so a re-run picks up unit-file changes; --now on enable
# is intentionally left off so we control the wait/poll below.
sudo systemctl enable nextjs-dev > /dev/null 2>&1 || true
sudo systemctl restart nextjs-dev

# 1. Wait for systemd to report the service active. 'next dev' takes a few
#    seconds to fork before systemd marks it active (Type=simple).
log "Waiting for nextjs-dev to become active..."
for i in $(seq 1 30); do
  if sudo systemctl is-active --quiet nextjs-dev; then
    log "  systemd: active after \${i}s."
    break
  fi
  sleep 1
done
if ! sudo systemctl is-active --quiet nextjs-dev; then
  log "ERROR: nextjs-dev failed to reach active state. Recent status:"
  sudo systemctl status nextjs-dev --no-pager 2>&1 | head -30 || true
  log "Recent log lines ($LOG_FILE):"
  sudo tail -n 50 "$LOG_FILE" 2>/dev/null || true
  exit 1
fi

# 2. Wait for port 3000 to actually serve HTTP. First request triggers Next's
#    on-demand compile (5-30 s on a small VM), so this poll is the real
#    confirmation the user can hit the app — not just that npm spawned.
log "Waiting for HTTP on port 3000 (Next.js first-request compile can take 30s)..."
ready=0
for i in $(seq 1 60); do
  code=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/ 2>/dev/null || echo 000)
  if [ "$code" != "000" ] && [ "$code" != "502" ] && [ "$code" != "503" ]; then
    log "  HTTP \${code} from http://127.0.0.1:3000/ after \${i}s — server is up."
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  log "WARNING: service is active but port 3000 did not respond in 60s. Recent log lines:"
  sudo tail -n 50 "$LOG_FILE" 2>/dev/null || true
  log "Check 'sudo journalctl -u nextjs-dev -n 100' and $LOG_FILE for compile errors."
  exit 1
fi

sudo systemctl status nextjs-dev --no-pager 2>&1 | head -10 || true
log "Done. Service: nextjs-dev   Port: 3000 (responding)   Logs: $LOG_FILE"`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Stopping and disabling nextjs-dev.service..."
sudo systemctl disable --now nextjs-dev 2>/dev/null || true
sudo rm -f /etc/systemd/system/nextjs-dev.service
sudo systemctl daemon-reload
log "Note: /opt/project source and /var/log/nextjs-dev.log are left in place — remove manually if desired."
log "Done."`,
    setupShSnippet: `# Next.js (latest) at /opt/project + nextjs-dev systemd service (logs → /var/log/nextjs-dev.log)
LOG_FILE=/var/log/nextjs-dev.log
if [ ! -f /opt/project/package.json ] || ! grep -q '"next"' /opt/project/package.json; then
  sudo -H -u genie bash -lc 'cd /opt/project && NODE_OPTIONS="--dns-result-order=ipv4first" npx --yes create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes' 2>&1 | tail -10
fi
touch "$LOG_FILE" && chown genie:genie "$LOG_FILE" && chmod 644 "$LOG_FILE"
NPM_PATH=$(command -v npm)
cat > /etc/systemd/system/nextjs-dev.service <<UNIT
[Unit]
Description=Next.js dev server (Genie)
After=network.target
[Service]
Type=simple
User=genie
WorkingDirectory=/opt/project
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
Environment=PORT=3000
ExecStart=$NPM_PATH run dev
Restart=on-failure
RestartSec=5
KillMode=mixed
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now nextjs-dev`,
    commands: [
      { name: "Service status", command: "sudo systemctl status nextjs-dev --no-pager 2>&1 | head -25" },
      { name: "Tail logs (last 80)", command: "sudo tail -n 80 /var/log/nextjs-dev.log" },
      { name: "Follow logs (5s)", command: "sudo timeout 5 tail -n 30 -f /var/log/nextjs-dev.log || true" },
      { name: "Restart service", command: "sudo systemctl restart nextjs-dev && sleep 2 && sudo systemctl status nextjs-dev --no-pager 2>&1 | head -10" },
      { name: "Stop service", command: "sudo systemctl stop nextjs-dev" },
      { name: "Start service", command: "sudo systemctl start nextjs-dev" },
      { name: "Next.js version", command: "cd /opt/project && node -e 'console.log(require(\"./package.json\").dependencies.next)'" },
      { name: "Clear log file", command: "sudo truncate -s 0 /var/log/nextjs-dev.log && echo 'cleared'" },
      { name: "Hit local URL", command: "curl -fsS -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\\n' http://127.0.0.1:3000/ || echo 'not reachable yet'" },
    ],
  },
];

function JsonSyntax({ text }: { text: string }) {
  // Colorize JSON tokens
  const colored = text
    .replace(/("(?:\\.|[^"\\])*")\s*:/g, '<span class="text-blue">$1</span>:')  // keys
    .replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span class="text-green">$1</span>') // string values
    .replace(/:\s*(true|false)/g, ': <span class="text-peach">$1</span>')         // booleans
    .replace(/:\s*(\d+\.?\d*)/g, ': <span class="text-peach">$1</span>')          // numbers
    .replace(/:\s*(null)/g, ': <span class="text-overlay0">$1</span>');            // null
  return <pre className="text-md font-mono text-text whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: colored }} />;
}

function CommandPill({
  cmd,
  projectId,
  instanceId,
}: {
  cmd: RecipeCommand;
  projectId: string;
  instanceId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const [projects] = useSubject($projects);
  const project = projects.find((p) => p.id === projectId);
  const instance = project?.vpsInstances.find((v) => v.id === instanceId);

  async function handleClick() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    setLoading(true);
    setOutput(null);
    const result = await vpsExec(projectId, instanceId, cmd.command);
    setOutput(result.output);
    setIsError(!!result.error);
    setLoading(false);
  }

  function handleRunInTerminal() {
    if (!instance) return;
    const { host, port, username, privateKeyPath } = instance.connection;
    addSshTerminalTab({ host, port, username, privateKeyPath }, cmd.name, cmd.command);
  }

  // Try to detect and format JSON
  const isJson = output && (() => {
    const trimmed = output.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try { JSON.parse(trimmed); return true; } catch { return false; }
    }
    return false;
  })();

  const formattedJson = isJson ? JSON.stringify(JSON.parse(output!.trim()), null, 2) : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <button
          onClick={handleClick}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md text-md transition-colors",
            expanded ? "bg-surface1 text-text" : "bg-surface0 text-subtext0 hover:bg-surface1 hover:text-text",
          )}
          title={cmd.command}
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <ChevronRight size={11} className={cn("transition-transform", expanded && "rotate-90")} />}
          {cmd.name}
        </button>
        <button
          onClick={handleRunInTerminal}
          className="p-1 text-overlay0 hover:text-green transition-colors rounded"
          title="Run in SSH terminal"
        >
          <TerminalSquare size={13} />
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(cmd.command)}
          className="p-1 text-overlay0 hover:text-text transition-colors rounded"
          title="Copy command"
        >
          <Copy size={13} />
        </button>
      </div>
      {expanded && (
        <div className="mt-1 ml-2 bg-crust rounded-md p-2 max-h-[200px] overflow-auto scrollbar-thin">
          {loading && <span className="text-md text-overlay0">Running...</span>}
          {output !== null && !loading && (
            <>
              {formattedJson ? (
                <JsonSyntax text={formattedJson} />
              ) : (
                <pre className={cn("text-md font-mono whitespace-pre-wrap", isError ? "text-red" : "text-text")}>{output}</pre>
              )}
              {output && (
                <button
                  onClick={() => navigator.clipboard.writeText(formattedJson || output)}
                  className="mt-1 text-[11px] text-overlay0 hover:text-text transition-colors"
                >
                  Copy output
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RecipeCommands({
  commands,
  projectId,
  instanceId,
}: {
  commands: RecipeCommand[];
  projectId: string;
  instanceId: string;
}) {
  return (
    <div className="mb-2">
      <span className="text-md font-medium text-subtext0 mb-1 block">Commands</span>
      <div className="flex flex-wrap gap-1">
        {commands.map((cmd) => (
          <CommandPill
            key={cmd.name}
            cmd={cmd}
            projectId={projectId}
            instanceId={instanceId}
          />
        ))}
      </div>
    </div>
  );
}

function VpsRecipes({
  projectId,
  instanceId,
  recipes,
}: {
  projectId: string;
  instanceId: string;
  recipes: Record<string, RecipeState>;
}) {
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ recipeId: string; x: number; y: number } | null>(null);
  const allRecipes = useAllRecipes();

  // User recipes (Node.js LTS, Playwright, etc.) live in the $recipes store and
  // load async. The Manage panel may be the first place anyone touches them.
  useEffect(() => { loadRecipes(); }, []);

  // Per-id auto-check so user recipes that arrive after mount also get checked.
  // Mirrors the admin Manage panel's pattern.
  const autoCheckedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const recipe of allRecipes) {
      const key = `${instanceId}:${recipe.id}`;
      if (autoCheckedRef.current.has(key)) continue;
      autoCheckedRef.current.add(key);
      checkVpsRecipe(projectId, instanceId, recipe.id, recipe.checkScript);
    }
  }, [projectId, instanceId, allRecipes.length]);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  function handleAddToSetup(recipe: VpsRecipeDef) {
    wsSend("project:setup-snippet:add", { projectId, recipeId: recipe.id, snippet: recipe.setupShSnippet });
  }

  function handleUninstall(recipe: VpsRecipeDef) {
    uninstallVpsRecipe(projectId, instanceId, recipe.id, recipe.uninstallScript);
    setExpandedRecipe(recipe.id);
    setContextMenu(null);
  }

  return (
    <div className="mb-3">
      <span className="text-md font-medium text-subtext0 mb-2 flex items-center gap-1.5">
        <Package size={12} />
        Add Services
      </span>
      <div className="flex flex-wrap gap-2 mt-1">
        {allRecipes.map((recipe) => {
          const state = recipes[recipe.id];
          const checking = state?.checking ?? false;
          const installed = state?.installed ?? null;
          const running = state?.running ?? false;
          const failed = !!state?.error;
          const expanded = expandedRecipe === recipe.id;
          const Icon = recipe.icon;

          return (
            <div key={recipe.id} className="flex flex-col relative">
              <button
                disabled={running || checking}
                onClick={() => {
                  if (checking) return;
                  if (installed === null) {
                    // Re-check if state is unknown
                    checkVpsRecipe(projectId, instanceId, recipe.id, recipe.checkScript);
                  } else if (installed) {
                    setExpandedRecipe(expanded ? null : recipe.id);
                  } else if (failed) {
                    setExpandedRecipe(expanded ? null : recipe.id);
                  } else {
                    runVpsRecipe(projectId, instanceId, recipe.id, recipe.installScript);
                    setExpandedRecipe(recipe.id);
                  }
                }}
                onContextMenu={(e) => {
                  if (installed && !running) {
                    e.preventDefault();
                    setContextMenu({ recipeId: recipe.id, x: e.clientX, y: e.clientY });
                  }
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-md transition-colors",
                  checking && "bg-surface0 text-overlay0 cursor-wait",
                  running && "bg-blue/10 text-blue cursor-wait",
                  installed && !running && "bg-green/10 text-green hover:bg-green/20",
                  failed && "bg-red/10 text-red hover:bg-red/20",
                  installed === false && !running && !failed && "bg-surface0 text-text hover:bg-surface1",
                  installed === null && !checking && "bg-surface0 text-overlay0",
                )}
                title={recipe.description}
              >
                {(running || checking) ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
                {recipe.label}
                {installed && !running && recipe.port && <span className="text-[11px] font-mono opacity-70">:{recipe.port}</span>}
                {installed && !running && <Check size={12} />}
                {failed && <X size={12} />}
              </button>

              {/* Right-click context menu */}
              {contextMenu?.recipeId === recipe.id && (
                <div
                  className="fixed z-50 bg-mantle border border-surface0 rounded-lg shadow-lg py-1 min-w-[140px]"
                  style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                  <button
                    onClick={() => handleAddToSetup(recipe)}
                    className="w-full text-left px-3 py-1.5 text-md text-text hover:bg-surface0 flex items-center gap-2"
                  >
                    <Plus size={12} />
                    Add to setup.sh
                  </button>
                  <button
                    onClick={() => handleUninstall(recipe)}
                    className="w-full text-left px-3 py-1.5 text-md text-red hover:bg-red/10 flex items-center gap-2"
                  >
                    <Trash2 size={12} />
                    Uninstall
                  </button>
                </div>
              )}

              {expanded && (
                <div className="mt-1 bg-background rounded-lg p-2 max-w-[480px]">
                  {/* Progress log (install/uninstall output) */}
                  {state && state.progress.length > 0 && (
                    <div className="max-h-[150px] overflow-y-auto scrollbar-thin mb-2">
                      {state.progress.map((line, i) => (
                        <div key={i} className="text-md text-overlay1 font-mono whitespace-pre-wrap">{line}</div>
                      ))}
                    </div>
                  )}
                  {state?.error && <ErrorMessage className="font-mono mb-2">{state.error}</ErrorMessage>}

                  {/* Commands manual */}
                  {installed && !running && recipe.commands.length > 0 && (
                    <RecipeCommands
                      commands={recipe.commands}
                      projectId={projectId}
                      instanceId={instanceId}
                    />
                  )}

                  <div className="flex items-center gap-2 pt-1 border-t border-surface0">
                    {failed && (
                      <button
                        onClick={() => { runVpsRecipe(projectId, instanceId, recipe.id, recipe.installScript); }}
                        className="text-md text-blue hover:underline"
                      >
                        Retry
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedRecipe(null)}
                      className="text-md text-overlay0 hover:underline ml-auto"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Run Commands Section ---

function VpsRunCommands({ project, instanceId }: { project: ProjectDef; instanceId: string }) {
  const [commandRunOutputs] = useSubject($commandRunOutputs);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [commandRunOutputs, expandedId]);

  if (project.commands.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-2">
        <Play size={12} className="text-green" />
        <span className="text-md font-medium text-subtext0">Run Commands</span>
      </div>
      <div className="flex flex-col gap-1">
        {project.commands.map((cmd) => {
          const key = `${project.id}:${cmd.id}`;
          const runState = commandRunOutputs[key];
          const isRunning = runState?.running ?? false;
          const isExpanded = expandedId === cmd.id && runState;

          return (
            <div key={cmd.id} className="bg-background rounded overflow-hidden">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  onClick={() => {
                    if (cmd.mode === "terminal") {
                      const inst = project.vpsInstances.find((v) => v.id === instanceId);
                      if (inst) {
                        const { username, host, port, privateKeyPath } = inst.connection;
                        // Use setsid for nohup commands so they survive PTY close
                        let termCmd = cmd.command;
                        if (termCmd.includes("nohup ")) {
                          const clean = termCmd.replace(/\s*&\s*$/, "");
                          termCmd = `setsid ${clean} &`;
                        }
                        addSshTerminalTab({ host, port, username, privateKeyPath }, cmd.name, termCmd);
                      }
                    } else {
                      runProjectCommand(project.id, cmd.id, instanceId);
                      setExpandedId(cmd.id);
                    }
                  }}
                  disabled={isRunning}
                  className={cn(
                    "p-0.5 rounded transition-colors",
                    isRunning ? "text-overlay0" : "text-green hover:bg-green/10"
                  )}
                  title={isRunning ? "Running..." : "Run"}
                >
                  {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                </button>
                {isRunning && (
                  <button
                    onClick={() => stopProjectCommand(project.id, cmd.id)}
                    className="p-0.5 rounded text-red hover:bg-red/10 transition-colors"
                    title="Stop"
                  >
                    <Square size={12} />
                  </button>
                )}
                <span className="text-md text-text font-medium shrink-0">{cmd.name}</span>
                <span className="text-[11px] text-overlay0">—</span>
                <span className="text-md text-overlay0 font-mono truncate">{cmd.command}</span>
                {cmd.mode === "terminal" && (
                  <span className="text-[11px] px-1 py-0.5 rounded bg-surface0 text-overlay0">terminal</span>
                )}
                {runState && (
                  <button
                    onClick={() => setExpandedId(expandedId === cmd.id ? null : cmd.id)}
                    className="text-overlay0 hover:text-text transition-colors p-0.5"
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                )}
              </div>
              {isExpanded && (
                <div className="px-2 pb-2 max-h-[200px] overflow-y-auto scrollbar-thin">
                  <pre className="text-md font-mono text-overlay1 whitespace-pre-wrap break-words">
                    {runState.output || (isRunning ? "Running..." : "")}
                  </pre>
                  <div ref={outputEndRef} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Firewall Section ---

interface UfwRule {
  num: number;
  to: string;
  action: string;
  direction: string;
  from: string;
}

interface RuleForm {
  port: string;
  ip: string;
  action: "allow" | "deny";
  direction: "in" | "out";
}

const EMPTY_RULE_FORM: RuleForm = { port: "", ip: "", action: "allow", direction: "in" };

function buildUfwCmd(form: RuleForm): string {
  const parts = ["sudo ufw", form.action, form.direction === "out" ? "out" : "in"];
  if (form.ip.trim()) parts.push(`from ${form.ip.trim()}`);
  parts.push("to any", `port ${form.port.trim()}`, "proto tcp");
  return parts.join(" ");
}

function deleteUfwCmd(rule: UfwRule): string {
  const parts = ["sudo ufw delete", rule.action.toLowerCase(), rule.direction.toLowerCase() === "out" ? "out" : "in"];
  const from = rule.from.trim();
  if (from && from !== "Anywhere" && from !== "Anywhere (v6)") parts.push(`from ${from}`);
  parts.push(`to any port ${rule.to.replace(/\/.*/, "")}`, "proto tcp");
  return parts.join(" ");
}

function isCriticalSshRule(rule: UfwRule): boolean {
  const port = rule.to.replace(/\/.*/, "").trim();
  return port === "22" && rule.action === "ALLOW" && rule.direction === "IN" && rule.from !== "Anywhere" && rule.from !== "Anywhere (v6)";
}

/** Function-shaped SSH exec — lets VpsFirewall be reused across project-based and
 *  admin-context VMs by swapping the actual exec function. */
type VpsExecFn = (command: string) => Promise<{ output: string; error?: boolean }>;

export function VpsFirewall({ exec }: { exec: VpsExecFn }) {
  const [rules, setRules] = useState<UfwRule[]>([]);
  const [active, setActive] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<RuleForm>(EMPTY_RULE_FORM);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<RuleForm>(EMPTY_RULE_FORM);

  const fetchStatus = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await exec("sudo ufw status numbered 2>/dev/null || echo 'UFW_NOT_INSTALLED'");
      if (res.error || res.output.includes("UFW_NOT_INSTALLED")) {
        setActive(false);
        setRules([]);
        return;
      }
      const lines = res.output.split("\n");
      const statusLine = lines.find((l) => l.startsWith("Status:"));
      setActive(/\bactive\b/.test(statusLine ?? ""));

      const parsed: UfwRule[] = [];
      for (const line of lines) {
        const m = line.match(/\[\s*(\d+)\]\s+(.+?)\s+(ALLOW|DENY|REJECT|LIMIT)\s+(IN|OUT)\s+(.+)/);
        if (m) {
          parsed.push({ num: parseInt(m[1]), to: m[2].trim(), action: m[3].trim(), direction: m[4].trim(), from: m[5].trim() });
        }
      }
      setRules(parsed);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRefreshing(false);
      setInitialLoading(false);
    }
  }, [exec]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const execAndRefresh = useCallback(async (cmd: string) => {
    setActionLoading(true);
    setError(null);
    const res = await exec(cmd);
    if (res.error) setError(res.output);
    await fetchStatus();
    setActionLoading(false);
  }, [exec, fetchStatus]);

  const enableFirewall = useCallback(() => {
    execAndRefresh("sudo ufw default deny incoming && sudo ufw default allow outgoing && sudo ufw --force enable");
  }, [execAndRefresh]);

  const disableFirewall = useCallback(() => {
    execAndRefresh("sudo ufw --force disable");
  }, [execAndRefresh]);

  const addRule = useCallback(() => {
    if (!addForm.port.trim()) return;
    execAndRefresh(buildUfwCmd(addForm));
    setAddForm(EMPTY_RULE_FORM);
  }, [addForm, execAndRefresh]);

  const deleteRule = useCallback((rule: UfwRule) => {
    if (isCriticalSshRule(rule)) return;
    execAndRefresh(deleteUfwCmd(rule));
  }, [execAndRefresh]);

  const startEdit = useCallback((idx: number) => {
    const rule = rules[idx];
    if (isCriticalSshRule(rule)) return;
    const from = rule.from.trim();
    setEditingIdx(idx);
    setEditForm({
      port: rule.to.replace(/\/.*/, ""),
      ip: from === "Anywhere" || from === "Anywhere (v6)" ? "" : from,
      action: rule.action.toLowerCase() as "allow" | "deny",
      direction: rule.direction.toLowerCase() as "in" | "out",
    });
  }, [rules]);

  const saveEdit = useCallback(async () => {
    if (editingIdx === null || !editForm.port.trim()) return;
    const oldRule = rules[editingIdx];
    if (isCriticalSshRule(oldRule)) return;
    await execAndRefresh(`${deleteUfwCmd(oldRule)} && ${buildUfwCmd(editForm)}`);
    setEditingIdx(null);
  }, [editingIdx, editForm, rules, execAndRefresh]);

  const inputCls = "bg-background text-text text-md rounded px-2 py-1 border border-surface0 focus:border-blue focus:outline-none font-mono";
  const selectCls = "bg-background text-text text-md rounded px-1.5 py-1 border border-surface0 focus:border-blue focus:outline-none";

  const renderRuleForm = (form: RuleForm, setForm: (f: RuleForm) => void, onSubmit: () => void, submitLabel: string, onCancel?: () => void) => (
    <div className="flex items-center gap-1.5 flex-wrap">
      <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as "allow" | "deny" })} className={selectCls}>
        <option value="allow">Allow</option>
        <option value="deny">Deny</option>
      </select>
      <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as "in" | "out" })} className={selectCls}>
        <option value="in">In</option>
        <option value="out">Out</option>
      </select>
      <input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} onKeyDown={(e) => e.key === "Enter" && onSubmit()} placeholder="Port" className={cn(inputCls, "w-20")} />
      <input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} onKeyDown={(e) => e.key === "Enter" && onSubmit()} placeholder="IP (any)" className={cn(inputCls, "w-36")} />
      <button onClick={onSubmit} disabled={actionLoading || !form.port.trim()} className="text-md text-green hover:bg-green/10 px-2 py-1 rounded transition-colors disabled:opacity-50 flex items-center gap-1">
        {submitLabel}
      </button>
      {onCancel && (
        <button onClick={onCancel} className="text-md text-overlay0 hover:text-text px-1.5 py-1 rounded transition-colors">Cancel</button>
      )}
    </div>
  );

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-2">
        <Shield size={12} className="text-yellow" />
        <span className="text-md font-medium text-subtext0">Firewall</span>
        <span className={cn(
          "text-[11px] px-1.5 py-0.5 rounded font-medium",
          active ? "bg-green/15 text-green" : "bg-overlay0/15 text-overlay0"
        )}>
          {initialLoading ? "..." : active ? "Active" : "Inactive"}
        </span>
        <div className="flex-1" />
        {!initialLoading && (
          <button
            onClick={active ? disableFirewall : enableFirewall}
            disabled={actionLoading || refreshing}
            className={cn(
              "text-md px-2 py-0.5 rounded transition-colors",
              active ? "text-red hover:bg-red/10" : "text-green hover:bg-green/10"
            )}
          >
            {actionLoading ? "..." : active ? "Disable" : "Enable"}
          </button>
        )}
        <button onClick={fetchStatus} disabled={refreshing} className="text-overlay0 hover:text-text transition-colors p-0.5">
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {error && <div className="text-md text-red mb-2">{error}</div>}

      {active && rules.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {rules.map((rule, i) => (
            editingIdx === i ? (
              <div key={i} className="bg-surface0/50 rounded px-2 py-1.5">
                {renderRuleForm(editForm, setEditForm, saveEdit, "Save", () => setEditingIdx(null))}
              </div>
            ) : (
              <div key={i} className="flex items-center gap-2 bg-background rounded px-2 py-1 group">
                <span className={cn(
                  "text-[11px] px-1 py-0.5 rounded font-medium",
                  rule.action === "ALLOW" ? "bg-green/15 text-green" : "bg-red/15 text-red"
                )}>
                  {rule.action}
                </span>
                <span className={cn(
                  "text-[11px] px-1 py-0.5 rounded font-medium",
                  rule.direction === "IN" ? "bg-blue/15 text-blue" : "bg-peach/15 text-peach"
                )}>
                  {rule.direction}
                </span>
                <span className="text-md text-text font-mono">{rule.to}</span>
                <span className="text-md text-overlay0">from</span>
                <span className="text-md text-overlay1 font-mono">{rule.from}</span>
                {isCriticalSshRule(rule) ? (
                  <span className="ml-auto flex items-center gap-1 text-overlay0" title="Critical SSH rule — cannot be modified">
                    <Lock size={11} />
                  </span>
                ) : (
                  <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(i)} disabled={actionLoading} className="text-overlay0 hover:text-text transition-colors p-0.5" title="Edit rule">
                      <Pencil size={11} />
                    </button>
                    <button onClick={() => deleteRule(rule)} disabled={actionLoading} className="text-overlay0 hover:text-red transition-colors p-0.5" title="Delete rule">
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>
            )
          ))}
        </div>
      )}

      {active && rules.length === 0 && !initialLoading && (
        <div className="text-md text-overlay0 mb-2">No rules — all incoming connections denied.</div>
      )}

      {active && editingIdx === null && renderRuleForm(addForm, setAddForm, addRule, "+ Add")}
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

export function CommandsTab({ project }: { project: ProjectDef }) {
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
          No VPS instances deployed. Use the "+ DO" or "+ Taz" buttons in the Servers bar above to deploy one.
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
  const [teamId, setTeamId] = useState<string | null>(project.teamId ?? null);

  const adminState = useDeepSubjectAll($admin);
  const baseImageTemplates = adminState.baseImage.templates;
  const teamList = adminState.teams.list;

  const [auth] = useSubject($auth);
  // Owning-team transfer is admin-only — server enforces this too (project:update drops
  // the teamId field for non-admins), but we hide the control to make that explicit.
  const canChangeTeam = auth.user?.role === "admin" || auth.user?.role === "superadmin";

  useEffect(() => {
    loadBaseImageConfigs();
    if (canChangeTeam) loadAdminTeams();
  }, [canChangeTeam]);

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
    setTeamId(project.teamId ?? null);
  }, [project.id]);

  const [saved, setSaved] = useState(false);

  function handleSave() {
    const trimName = name.trim();
    if (!trimName) return;

    const payload: Record<string, unknown> = {
      id: project.id,
      name: trimName,
      vpsRegion,
      vpsSize,
      vpsBaseImageConfigName: vpsBaseImageConfigName || undefined,
      doToken: doToken || undefined,
      gitlabDeployKey: gitlabDeployKey || undefined,
      dbUrl: dbUrl || undefined,
      gitFolders,
    };
    // Only send teamId when the operator is permitted to change it. The server
    // also drops the field for non-admins, but this keeps the wire payload honest.
    if (canChangeTeam) payload.teamId = teamId;
    wsSend("project:update", payload);
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

      {canChangeTeam && (
        <div className="flex flex-col gap-1">
          <label className="text-md font-semibold text-subtext0">Owning Team</label>
          <select
            value={teamId ?? ""}
            onChange={(e) => setTeamId(e.target.value || null)}
            className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans focus:border-mauve"
          >
            <option value="">No team (admin-only)</option>
            {teamList.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <p className="text-md text-overlay0">
            Normal users only see projects whose team they belong to. Projects with no team are hidden from non-admins.
          </p>
        </div>
      )}

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
