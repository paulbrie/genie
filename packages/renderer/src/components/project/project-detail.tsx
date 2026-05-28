"use client";

import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { useSubject, useDeepSubject } from "subjecto/react";
import { useDeepSubjectAll } from "@/lib/hooks";
import type { BaseImageTemplate, DeployLogEntry, ProjectCommand, ProjectDef, RecipeState, VpsDeployState, VpsInstance, VpsInstanceState, VpsProcessInfo, VpsServiceInfo, VpsStats } from "@/store/types";
import { $admin, $auth, $commandRunOutputs, $projects, $selectedProjectId, $vpsDeploy } from "@/store/subjects";
import { $orgSettings } from "@/store/subjects/org-settings";
import { addSshTerminalTab, checkVpsRecipe, checkVpsStatus, clearVpsInstanceState, deployToDo, deployToProvider, disconnectVps, fetchVpsLogs, fetchVpsStats, hibernateVps, killVpsProcess, loadAdminTeams, loadBaseImageConfigs, loadDeployLogs, loadRecipes, openWindow, runProjectCommand, runVpsRecipe, startMcpTunnel, stopProjectCommand, teardownVps, unwatchVpsStats, uninstallVpsRecipe, vpsExec, watchVpsStats, wakeVps } from "@/store/actions";
import { useAllRecipes } from "@/hooks/use-all-recipes";
import { Button } from "@/components/ui/button";
import { CopyableIp } from "@/components/ui/copyable-ip";
import { ErrorMessage } from "@/components/ui/error-message";
import { wsSend } from "@/lib/ws";
import { cn, parseDockerPorts } from "@/lib/utils";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewTabs } from "@/components/ui/view-tabs";
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
import { DbExplorer } from "@/components/admin/db-explorer";
import { FileExplorer } from "@/components/project/vps-file-explorer";
import { ProjectFilesEditor } from "@/components/project/project-files-editor";

export function ClaudeLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 -.01 39.5 39.53" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="m7.75 26.27 7.77-4.36.13-.38-.13-.21h-.38l-1.3-.08-4.44-.12-3.85-.16-3.73-.2-.94-.2-.88-1.16.09-.58.79-.53 1.13.1 2.5.17 3.75.26 2.72.16 4.03.42h.64l.09-.26-.22-.16-.17-.16-3.88-2.63-4.2-2.78-2.2-1.6-1.19-.81-.6-.76-.26-1.66 1.08-1.19 1.45.1.37.1 1.47 1.13 3.14 2.43 4.1 3.02.6.5.24-.17.03-.12-.27-.45-2.23-4.03-2.38-4.1-1.06-1.7-.28-1.02c-.1-.42-.17-.77-.17-1.2l1.23-1.67.68-.22 1.64.22.69.6 1.02 2.33 1.65 3.67 2.56 4.99.75 1.48.4 1.37.15.42h.26v-.24l.21-2.81.39-3.45.38-4.44.13-1.25.62-1.5 1.23-.81.96.46.79 1.13-.11.73-.47 3.05-.92 4.78-.6 3.2h.35l.4-.4 1.62-2.15 2.72-3.4 1.2-1.35 1.4-1.49.9-.71h1.7l1.25 1.86-.56 1.92-1.75 2.22-1.45 1.88-2.08 2.8-1.3 2.24.12.18.31-.03 4.7-1 2.54-.46 3.03-.52 1.37.64.15.65-.54 1.33-3.24.8-3.8.76-5.66 1.34-.07.05.08.1 2.55.24 1.09.06h2.67l4.97.37 1.3.86.78 1.05-.13.8-2 1.02-2.7-.64-6.3-1.5-2.16-.54h-.3v.18l1.8 1.76 3.3 2.98 4.13 3.84.21.95-.53.75-.56-.08-3.63-2.73-1.4-1.23-3.17-2.67h-.21v.28l.73 1.07 3.86 5.8.2 1.78-.28.58-1 .35-1.1-.2-2.26-3.17-2.33-3.57-1.88-3.2-.23.13-1.11 11.95-.52.61-1.2.46-1-.76-.53-1.23.53-2.43.64-3.17.52-2.52.47-3.13.28-1.04-.02-.07-.23.03-2.36 3.24-3.59 4.85-2.84 3.04-.68.27-1.18-.61.11-1.09.66-.97 3.93-5 2.37-3.1 1.53-1.79-.01-.26h-.09l-10.44 6.78-1.86.24-.8-.75.1-1.23.38-.4 3.14-2.16z" fill="currentColor"/>
    </svg>
  );
}


import { DropletInstanceBar } from "@/components/project/droplet-instance-bar";
import { CircularGauge } from "@/components/ui/circular-gauge";
import { ProcessCity as IsometricProcessCity } from "@/components/ui/process-city";
import type { ProcessInfo } from "@/store/types";
import { useNavigate } from "@/lib/navigation";
import type { ProjectTab } from "@/lib/routes";
import { openManageVmWindow } from "@/components/tazcloud/manage-vm-popup";
import { openManageDropletWindow } from "@/components/admin/digitalocean-panel";
import { ConnectServerForm } from "@/components/project/connect-server-form";
import { ProjectMembersTab } from "@/components/project/project-members-tab";
import { DeployHistoryPanel, DeployHistoryTab } from "@/components/project/deploy-history";
import { VpsRecipes, VpsRunCommands } from "@/components/project/vps-recipes";
// Re-export the recipe type interfaces so external imports (default-recipes.ts
// catalog, admin recipes panel) keep working with their `@/components/project-detail`
// import paths unchanged.
export type { RecipeOption, RecipeSecret, VpsRecipeDef } from "@/components/project/vps-recipes";
// VpsInstanceCard / VpsLogViewer / VpsProcessTable / VpsProcessCity /
// TeardownProgress / ClaudeTerminalButton all moved into vps-instance-card.tsx.
// Nothing in this file currently calls VpsInstanceCard (the project page renders
// ServersBar instead), but the export is preserved so future callers don't
// have to re-add it.
export { VpsInstanceCard } from "@/components/project/vps-instance-card";


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
  const [connectOpen, setConnectOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 mb-3 py-3 border-y border-surface0">
      {connectOpen && <ConnectServerForm projectId={project.id} onClose={() => setConnectOpen(false)} />}
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
          const isSsh = !!instance.ssh;
          const canManage = !!tazVmId || !!doDropletId || isSsh;
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
                } else if (isSsh) {
                  // Generic servers reuse the Manage popup, keyed by instance id.
                  openManageVmWindow({ id: instance.id, name: instance.label });
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
                  {instance.tazcloud ? "Taz" : instance.digitalocean ? "DO" : instance.ssh ? "SSH" : ""}
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
        <Button
          size="sm"
          onClick={() => setConnectOpen(true)}
          title="Connect an existing SSH server (any cloud / on-prem) — no provisioning"
        >
          <Server size={12} className="mr-1 text-blue" /> + Server
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
    watchVpsStats(project.id, inst.id);
    return () => unwatchVpsStats(project.id, inst.id);
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
      // SSH-layer failure (handshake timeout, key rejected, host unreachable):
      // the exec never reached `ufw`. Surface the error instead of misreporting
      // "Inactive" — otherwise users see a false-negative firewall state with
      // no hint that the connection itself is broken.
      if (res.error) {
        setError(res.output || "SSH exec failed");
        return;
      }
      if (res.output.includes("UFW_NOT_INSTALLED")) {
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
          error ? "bg-red/15 text-red"
            : active ? "bg-green/15 text-green"
            : "bg-overlay0/15 text-overlay0"
        )}>
          {initialLoading ? "..." : error ? "Unknown" : active ? "Active" : "Inactive"}
        </span>
        <div className="flex-1" />
        {!initialLoading && !error && (
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
  const [teamId, setTeamId] = useState<string | null>(project.teamId ?? null);

  const [adminTeams] = useDeepSubject($admin, "teams");
  const adminTeamList = adminTeams.list;
  const [orgTeamList] = useDeepSubject($orgSettings, "myTeams");
  const [orgMine] = useDeepSubject($orgSettings, "mine");

  const [auth] = useSubject($auth);
  const isAdmin = auth.user?.role === "admin" || auth.user?.role === "superadmin";
  // Org admins (anyone with ≥1 manageable org) can also set the team — limited
  // to teams in their own orgs. Server re-checks: project:update for non-system-
  // admins drops teamId unless the target team is in a manageable org.
  const canChangeTeam = isAdmin || orgMine.length > 0;

  // Build the team picker's option list. Admins see everything (admin:teams:list);
  // org admins see only teams in their orgs (org:list-mine payload).
  const teamOptions = useMemo(() => {
    if (isAdmin) return adminTeamList.map((t) => ({ id: t.id, label: t.name }));
    return orgTeamList.map((t) => ({ id: t.id, label: `${t.name} (${t.orgName})` }));
  }, [isAdmin, adminTeamList, orgTeamList]);

  useEffect(() => {
    if (isAdmin) loadAdminTeams();
    // org-admin team list arrives via $orgSettings, loaded by the Sidebar mount.
  }, [isAdmin]);

  // Reset form when project changes
  useEffect(() => {
    setName(project.name);
    setTeamId(project.teamId ?? null);
  }, [project.id]);

  const [saved, setSaved] = useState(false);

  function handleSave() {
    const trimName = name.trim();
    if (!trimName) return;

    const payload: Record<string, unknown> = {
      id: project.id,
      name: trimName,
    };
    // Only send teamId when the operator is permitted to change it. The server
    // re-checks: for org admins it accepts only team ids belonging to one of
    // their manageable orgs.
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
            <option value="">{isAdmin ? "No team (admin-only)" : "— Select a team —"}</option>
            {teamOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <p className="text-md text-overlay0">
            {isAdmin
              ? "Normal users only see projects whose team they belong to. Projects with no team are hidden from non-admins."
              : "Teams from organizations you administer. Members of the selected team will see this project."}
          </p>
        </div>
      )}

      <div className="text-xs text-overlay0 border-t border-surface0 pt-3 mt-1">
        Servers, deploy keys, database URLs and git folders are now managed in{" "}
        <span className="text-subtext0 font-mono">/clouds</span> — provision a VM there and attach it to this project from the Servers panel above.
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
