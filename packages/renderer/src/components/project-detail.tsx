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
import { openManageVmWindow } from "@/components/tazcloud/manage-vm-popup";
import { openManageDropletWindow } from "@/components/digitalocean-panel";
import { ProjectMembersTab } from "@/components/project-members-tab";
import { DeployHistoryPanel, DeployHistoryTab } from "@/components/project/deploy-history";
import { VpsRecipes, VpsRunCommands } from "@/components/project/vps-recipes";
// Re-export the recipe type interfaces so external imports (default-recipes.ts
// catalog, admin recipes panel) keep working with their `@/components/project-detail`
// import paths unchanged.
export type { RecipeOption, RecipeSecret, VpsRecipeDef } from "@/components/project/vps-recipes";


const BASE_PROJECT_TABS: { key: ProjectTab; label: string }[] = [
  { key: "deploy-history", label: "Deploy History" },
  { key: "members", label: "Members" },
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

      {activeTab === "members" && (
        <ProjectMembersTab project={project} />
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
          // Both TazCloud VMs and DigitalOcean droplets open the floating
          // Manage popup — they go through different open* helpers (and
          // therefore different window-id prefixes) but render via the same
          // generic ManageVmPopup machinery.
          const tazVmId = instance.tazcloud?.vmId;
          const doDropletId = instance.digitalocean?.dropletId;
          const canManage = !!tazVmId || !!doDropletId;
          // Show the server's address in the button so multiple instances are
          // distinguishable at a glance (and duplicate records pointing at the
          // same droplet are obvious — they'll show the same IP).
          const host = instance.digitalocean?.ipAddress || instance.tazcloud?.ipv6 || instance.connection.host;
          return (
            <button
              key={instance.id}
              onClick={() => {
                if (tazVmId) {
                  openManageVmWindow({ id: tazVmId, name: instance.label });
                } else if (doDropletId) {
                  openManageDropletWindow({ id: doDropletId, name: instance.label });
                }
              }}
              disabled={!canManage}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-md transition-colors border",
                "bg-mantle text-subtext0 border-surface0 hover:bg-surface0 hover:text-text",
                !canManage && "opacity-50 cursor-not-allowed hover:bg-mantle hover:text-subtext0",
              )}
              title={canManage
                ? "Open Manage popup"
                : "This instance is not linked to a supported provider"}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
              {/* Baseline-align the text so the smaller IP/provider tags read on
                  the same line as the label instead of floating optically high. */}
              <span className="inline-flex items-baseline gap-1.5">
                <span>{instance.label}</span>
                {host && host !== "unknown" && (
                  <span className="text-overlay0 text-xs font-mono">{host}</span>
                )}
                <span className="text-overlay0 text-xs">
                  {instance.tazcloud ? "Taz" : instance.digitalocean ? "DO" : ""}
                </span>
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

// DeployLog / DeployProgressLog moved to ./project/deploy-history.tsx

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
    // Order matters: whitelist SSH on **both** IPv4 and IPv6 before flipping
    // the default-deny + enabling UFW, otherwise the very next packet (the
    // active SSH session re-auth) gets dropped and the user is locked out.
    // `ufw allow 22/tcp` installs one v4 rule and one v6 rule, but only when
    // /etc/default/ufw has IPV6=yes — which it does on stock Ubuntu/Debian/
    // AlmaLinux, but we set it explicitly here to be safe (idempotent if it
    // is already yes; harmless on images where /etc/default/ufw is missing).
    execAndRefresh([
      "sudo test -f /etc/default/ufw && sudo sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw || true",
      "sudo ufw allow 22/tcp",
      "sudo ufw default deny incoming",
      "sudo ufw default allow outgoing",
      "sudo ufw --force enable",
    ].join(" && "));
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

// timeAgo / formatDuration moved to ./project/deploy-history.tsx (only callers
// were DeployHistoryPanel / DeployHistoryTab, which moved with them).

// DeployHistoryPanel / DeployHistoryTab moved to ./project/deploy-history.tsx

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
