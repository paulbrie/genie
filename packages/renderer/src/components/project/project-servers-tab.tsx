"use client";

import { useState } from "react";
import { Cloud, Loader2, MoreVertical, Server, Terminal, Trash2, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionMenuBackdrop,
  ActionMenuDivider,
  ActionMenuItem,
  ActionMenuPanel,
} from "@/components/ui/action-menu";
import { ConnectServerForm } from "@/components/project/connect-server-form";
import { CloudVmResourceBlock } from "@/components/cloud/cloud-vm-resource-block";
import { cardStatusPill } from "@/components/admin/tazcloud-panel";
import { isPrivateHostAddress, vpsStatsToBarStats } from "@/components/project/vps-resource-gauges";
import { openManageVmWindow } from "@/components/tazcloud/manage-vm-popup";
import { openManageDropletWindow } from "@/components/admin/digitalocean-panel";
import { openManageServerWindow } from "@/components/admin/hetzner-panel";
import { useCloudsMonitor } from "@/hooks/use-clouds-monitor";
import { vpsMetricKey } from "@/lib/cloud-vm-metrics";
import {
  addSshTerminalTab,
  deployToProvider,
  disconnectVps,
  fetchVpsStats,
} from "@/store/actions";
import type { ProjectDef, VpsDeployState, VpsInstance } from "@/store/types";

interface ProjectServersTabProps {
  project: ProjectDef;
  vpsDeploy: VpsDeployState;
  canManage: boolean;
}

export function ProjectServersTab({ project, vpsDeploy, canManage }: ProjectServersTabProps) {
  const [deployLabel, setDeployLabel] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const [actionMenuOpenFor, setActionMenuOpenFor] = useState<string | null>(null);
  const { monitor } = useCloudsMonitor(true);
  const instances = project.vpsInstances;

  return (
    <div className="py-4 flex flex-col gap-3">
      {connectOpen && <ConnectServerForm projectId={project.id} onClose={() => setConnectOpen(false)} />}

      {canManage && (
        <div className="flex items-center gap-2 flex-wrap">
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
      )}

      {instances.length === 0 ? (
        <div className="text-center text-overlay0 py-12">
          <p className="text-base">No servers attached to this project.</p>
          <p className="text-md mt-1">
            {canManage ? "Use the deploy buttons above to add one." : "Ask a project owner to add one."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {instances.map((instance) => (
            <ProjectServerCard
              key={instance.id}
              project={project}
              instance={instance}
              vpsDeploy={vpsDeploy}
              monitor={monitor}
              canManage={canManage}
              actionMenuOpen={actionMenuOpenFor === instance.id}
              onToggleActionMenu={() =>
                setActionMenuOpenFor((cur) => (cur === instance.id ? null : instance.id))
              }
              onCloseActionMenu={() => setActionMenuOpenFor(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ProjectServerCardProps {
  project: ProjectDef;
  instance: VpsInstance;
  vpsDeploy: VpsDeployState;
  monitor: ReturnType<typeof useCloudsMonitor>["monitor"];
  canManage: boolean;
  actionMenuOpen: boolean;
  onToggleActionMenu: () => void;
  onCloseActionMenu: () => void;
}

function ProjectServerCard({
  project,
  instance,
  vpsDeploy,
  monitor,
  canManage,
  actionMenuOpen,
  onToggleActionMenu,
  onCloseActionMenu,
}: ProjectServerCardProps) {
  const state = vpsDeploy.instances[instance.id];
  const stats = state?.stats ?? null;
  const statsError = state?.statsError ?? null;
  const isDeploying = !!state?.deploying;
  const isFailed = !!instance.deployFailed;
  const isHibernated = !!instance.hibernate;

  const tazVmId = instance.tazcloud?.vmId;
  const doDropletId = instance.digitalocean?.dropletId;
  const hzServerId = instance.hetzner?.serverId;
  const isSsh = !!instance.ssh;
  const supportsManage = !!tazVmId || !!doDropletId || !!hzServerId || isSsh;

  const host = instance.digitalocean?.ipAddress
    || instance.hetzner?.ipAddress
    || instance.tazcloud?.ipv6
    || instance.connection.host;
  const provider = instance.tazcloud ? "Taz"
    : instance.digitalocean ? "DO"
    : instance.hetzner ? "HZ"
    : isSsh ? "SSH" : "";
  const location = instance.digitalocean?.region
    || instance.hetzner?.location
    || (instance.tazcloud ? "tazcloud" : "")
    || "";
  const sizeLabel = instance.digitalocean?.size
    || instance.hetzner?.serverType
    || instance.tazcloud?.size
    || "";

  const statusText = isFailed ? "failed"
    : isDeploying ? "provisioning"
    : isHibernated ? "hibernated"
    : stats ? "active"
    : "unknown";

  const historyKey = vpsMetricKey(project.id, instance.id);
  const showResourceBlock = !isFailed && !isHibernated && !!host && host !== "unknown";

  const openManage = () => {
    if (tazVmId) openManageVmWindow({ id: tazVmId, name: instance.label });
    else if (doDropletId) openManageDropletWindow({ id: doDropletId, name: instance.label });
    else if (hzServerId) openManageServerWindow({ id: hzServerId, name: instance.label });
    else if (isSsh) openManageVmWindow({ id: instance.id, name: instance.label });
  };

  const openSshTab = () => {
    if (!host || host === "unknown") return;
    // Taz unified every VM onto a `genie` user — default to it rather than the
    // stored sshUser (which may be a stale image default and gets auth-rejected).
    const username = instance.tazcloud ? "genie" : (instance.connection.username || "root");
    const port = instance.connection.port || 22;
    addSshTerminalTab({ host, username, port }, `SSH ${username}@${instance.label}`);
  };

  const rowOnClick = (e: React.MouseEvent) => {
    if (!supportsManage) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, label")) return;
    openManage();
  };

  return (
    <div
      onClick={rowOnClick}
      className={cn(
        "bg-mantle rounded-lg px-3 py-2 border border-overlay0/10",
        supportsManage && "cursor-pointer hover:border-blue/30 transition-colors",
        isFailed && "border-red/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-text truncate" title={instance.label}>{instance.label}</span>
            {provider && (
              <span className="shrink-0 text-[10px] uppercase tracking-wide px-1 py-0.5 rounded bg-surface0 text-overlay0">
                {provider}
              </span>
            )}
          </div>
        </div>
        {cardStatusPill(statusText)}
      </div>

      {showResourceBlock && (
        <CloudVmResourceBlock
          host={host}
          domain={instance.domain ? { name: instance.domain, url: instance.domainUrl } : null}
          isPrivateHost={isPrivateHostAddress(host)}
          stats={stats ? vpsStatsToBarStats(stats) : null}
          statsLoading={!stats && !statsError && !isFailed}
          statsError={statsError ?? undefined}
          onRefresh={() => fetchVpsStats(project.id, instance.id)}
          refreshLoading={!stats && !statsError}
          history={monitor.history[historyKey]}
          hours={monitor.hours}
        />
      )}

      {isFailed && (
        <div className="flex items-center justify-center mt-3 py-3 text-red text-xs bg-red/10 rounded-md">
          {state?.error || instance.deployError || "Deploy failed"}
        </div>
      )}

      {isHibernated && (
        <div className="flex items-center justify-center mt-3 py-3 text-blue text-xs bg-blue/10 rounded-md">
          Hibernated — snapshot {instance.hibernate?.snapshotName}
        </div>
      )}

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 mt-3 text-xs">
        {location && (
          <>
            <span className="text-overlay0">Location</span>
            <span className="text-subtext0">{location}</span>
          </>
        )}
        {sizeLabel && (
          <>
            <span className="text-overlay0">Type</span>
            <span className="text-subtext0">{sizeLabel}</span>
          </>
        )}
        <span className="text-overlay0">Host</span>
        <span className="text-subtext0 font-mono truncate" title={host}>{host}</span>
        <span className="text-overlay0">ID</span>
        <span className="text-subtext0 font-mono truncate" title={instance.id}>{instance.id}</span>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-overlay0/10">
        <div className="flex-1" />
        {isDeploying && (
          <span className="inline-flex items-center gap-1 text-xs text-overlay0">
            <Loader2 size={11} className="animate-spin" />
            Provisioning
          </span>
        )}
        <button
          onClick={openSshTab}
          disabled={!host || host === "unknown" || isFailed || isHibernated}
          className="text-overlay0 hover:text-blue transition-colors p-1 disabled:opacity-40 disabled:cursor-not-allowed"
          title={host ? `SSH to ${host}` : "Server has no reachable host"}
        >
          <Terminal size={13} />
        </button>
        {canManage && (
          <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onToggleActionMenu}
              className={cn(
                "p-1 transition-colors",
                actionMenuOpen ? "text-blue" : "text-overlay0 hover:text-blue",
              )}
              title="More actions"
            >
              <MoreVertical size={13} />
            </button>
            {actionMenuOpen && (
              <>
                <ActionMenuBackdrop onClose={onCloseActionMenu} />
                <ActionMenuPanel autoFlip className="absolute right-0">
                  <ActionMenuItem
                    icon={Server}
                    disabled={!supportsManage}
                    onClick={() => { onCloseActionMenu(); openManage(); }}
                  >
                    Open Manage popup…
                  </ActionMenuItem>
                  <ActionMenuDivider />
                  <ActionMenuItem
                    icon={Unlink}
                    title="Remove the project↔server link without touching the server"
                    onClick={() => {
                      onCloseActionMenu();
                      if (!window.confirm(`Detach "${instance.label}" from this project?\n\nThe server keeps running — only the link in Genie is removed.`)) return;
                      disconnectVps(project.id, instance.id);
                    }}
                  >
                    Detach from project
                  </ActionMenuItem>
                  <ActionMenuItem
                    icon={Trash2}
                    variant="danger"
                    title="Detach the server and remove the record"
                    onClick={() => {
                      onCloseActionMenu();
                      if (!window.confirm(`Detach "${instance.label}" from this project?\n\nThe server itself is not destroyed — to delete it, do so from /clouds.`)) return;
                      disconnectVps(project.id, instance.id);
                    }}
                  >
                    Remove…
                  </ActionMenuItem>
                </ActionMenuPanel>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
