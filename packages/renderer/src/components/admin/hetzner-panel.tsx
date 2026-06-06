"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSubject, useDeepSubject } from "subjecto/react";
import { Cloud, RefreshCw, Loader2, Pencil, Check, X, Plus, Lock, Unlock, RotateCw, Shield, MoreVertical, Search, Trash2, Terminal, Unlink } from "lucide-react";
import type { AdminHetznerServer, VpsDeployState, VpsMonitorState } from "@/store/types";
import { $admin, $auth, $manager, $projects, $vpsDeploy, $windowManager } from "@/store/subjects";
import { track } from "@/lib/analytics";
import { $orgSettings } from "@/store/subjects/org-settings";
import {
  addSshTerminalTab, disconnectVps, fetchVpsStats, focusWindow,
  loadAdminHetznerServers, loadAdminHetznerStats, lockAdminHetznerServer, openWindow,
  rebootAdminHetznerServer, registerWindow, renameAdminHetznerServer, startSecurityScan,
  switchNav, unlockAdminHetznerServer,
} from "@/store/actions";
import { wsRequest, wsSend } from "@/lib/ws";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { AttachVmToProject } from "@/components/project/attach-vm-to-project";
import { ServerDeleteConfirm } from "@/components/ui/server-delete-confirm";
import {
  ActionMenuBackdrop,
  ActionMenuDivider,
  ActionMenuItem,
  ActionMenuPanel,
} from "@/components/ui/action-menu";
import { cardStatusPill } from "@/components/admin/tazcloud-panel";
import { vpsStatsToBarStats, isPrivateHostAddress } from "@/components/project/vps-resource-gauges";
import { CloudVmResourceBlock } from "@/components/cloud/cloud-vm-resource-block";
import { findLinkedInstance, vpsMetricKey } from "@/lib/cloud-vm-metrics";
import { DeployVmModal } from "@/components/cloud/deploy-vm-modal";
import { ManageVmPopup, type ManageVm } from "@/components/tazcloud/manage-vm-popup";

type PendingDeleteId = number | null;

const HZ_STATS_POLL_MS = 60_000;

export function HetznerPanel({ monitor }: { monitor: VpsMonitorState }) {
  const admin = useDeepSubjectAll($admin);
  const vpsDeploy = useDeepSubjectAll<VpsDeployState>($vpsDeploy);
  const [auth] = useSubject($auth);
  const [projects] = useSubject($projects);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteId>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [actionMenuOpenFor, setActionMenuOpenFor] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const isSuperAdmin = auth.user?.role === "superadmin";
  // Privileged roles manage the whole account; everyone else gets a read-only
  // view of the servers they can access (backend scopes the list/stats).
  const canManage = isSuperAdmin || auth.user?.role === "admin" || auth.user?.role === "tazcloud";
  // Bare VMs (no project) are for privileged roles + org owners/admins; everyone
  // else deploys by attaching to a project they can access. Show the Deploy
  // button to anyone who can do either.
  const [orgMine] = useDeepSubject($orgSettings, "mine");
  const canBare = canManage || orgMine.length > 0;
  const canDeploy = canBare || projects.length > 0;
  const { servers, loading, error } = admin.hetzner;

  useEffect(() => {
    loadAdminHetznerServers();
  }, []);

  // Re-fire the one-shot list when the WS reconnects (dev manager restart).
  const [manager] = useSubject($manager);
  const wasManagerRunningRef = useRef<boolean>(manager.running);
  useEffect(() => {
    const wasRunning = wasManagerRunningRef.current;
    wasManagerRunningRef.current = manager.running;
    if (!wasRunning && manager.running) loadAdminHetznerServers();
  }, [manager.running]);

  // Poll stats for active servers.
  useEffect(() => {
    loadAdminHetznerStats();
    const t = window.setInterval(() => loadAdminHetznerStats(), HZ_STATS_POLL_MS);
    return () => window.clearInterval(t);
  }, []);

  function startRename(s: AdminHetznerServer) {
    setRenamingId(s.id);
    setRenameDraft(s.name);
  }

  function commitRename() {
    if (renamingId === null) return;
    const trimmed = renameDraft.trim();
    if (trimmed) renameAdminHetznerServer(renamingId, trimmed);
    setRenamingId(null);
    setRenameDraft("");
  }

  const q = search.trim().toLowerCase();
  const visible = q ? servers.filter((s) => s.name.toLowerCase().includes(q)) : servers;

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Cloud size={16} className="text-red" />
        <span className="text-md font-medium text-subtext0">Servers</span>
        <span className="text-md text-overlay0 font-mono">{servers.length}</span>
        <div className="relative ml-2">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-overlay0 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            spellCheck={false}
            className="bg-background border border-surface0 rounded-md pl-7 pr-2 py-1 text-md text-text outline-none focus:border-blue w-44"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-overlay0 hover:text-text" title="Clear">
              <X size={11} />
            </button>
          )}
        </div>
        <div className="flex-1" />
        {canDeploy && (
          <Button size="sm" variant="primary" onClick={() => setDeployModalOpen(true)}>
            <Plus size={14} className="mr-1" />
            Deploy Server
          </Button>
        )}
        <Button size="sm" onClick={() => loadAdminHetznerServers()} disabled={loading}>
          <RefreshCw size={14} className={cn("mr-1", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <DeployVmModal open={deployModalOpen} onClose={() => setDeployModalOpen(false)} provider="hetzner" canBare={canBare} />

      {admin.hetzner.createError && <div className="mb-3"><ErrorMessage variant="banner">Create failed: {admin.hetzner.createError}</ErrorMessage></div>}
      {error && <div className="mb-3"><ErrorMessage variant="banner">{error}</ErrorMessage></div>}

      <div>
        {(() => {
          if (loading && servers.length === 0) {
            return <div className="flex items-center justify-center text-overlay0 py-12"><Loader2 size={16} className="animate-spin mr-2" />Loading…</div>;
          }
          if (servers.length === 0 && !error) {
            return (
              <div className="text-center text-overlay0 py-12">
                <p className="text-base">No Hetzner servers.</p>
                <p className="text-md mt-1">Deploy a project with the Hetzner provider to see it here.</p>
              </div>
            );
          }
          if (visible.length === 0) {
            return <div className="text-center text-overlay0 py-12"><p className="text-md">No servers match &ldquo;{search}&rdquo;.</p></div>;
          }

          const renderRenameInput = () => (
            <div className="flex items-center gap-1 mb-1">
              <span className="text-md text-overlay0">Rename:</span>
              <input
                autoFocus
                type="text"
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  else if (e.key === "Escape") { setRenamingId(null); setRenameDraft(""); }
                }}
                className="bg-background border border-blue/40 rounded px-1.5 py-0.5 text-md font-mono outline-none flex-1 min-w-0"
              />
              <button onClick={commitRename} className="text-green hover:text-green/70 p-0.5" title="Save"><Check size={12} /></button>
              <button onClick={() => { setRenamingId(null); setRenameDraft(""); }} className="text-overlay0 hover:text-text p-0.5" title="Cancel"><X size={12} /></button>
            </div>
          );

          const renderSshButton = (s: AdminHetznerServer, isActive: boolean) => (
            <button
              onClick={async () => {
                if (!s.ip) return;
                try {
                  const res = await wsRequest<{ username: string | null; error?: string }>(
                    "admin:hetzner:resolve-ssh-user", { serverId: s.id },
                  );
                  const user = res.username ?? "root";
                  addSshTerminalTab({ host: s.ip, username: user, port: 22 }, `SSH ${user}@${s.name}`);
                } catch {
                  addSshTerminalTab({ host: s.ip, username: "root", port: 22 }, `SSH root@${s.name}`);
                }
              }}
              disabled={!isActive || !s.ip}
              className="text-overlay0 hover:text-blue transition-colors p-1 disabled:opacity-40 disabled:cursor-not-allowed"
              title={isActive && s.ip ? `SSH to ${s.ip}` : "Server is not active"}
            >
              <Terminal size={13} />
            </button>
          );

          const renderActionsMenu = (s: AdminHetznerServer, isActive: boolean, isRenaming: boolean) => {
            const rebootState = admin.hetzner.reboot[s.id];
            const rebooting = !!rebootState && !rebootState.done && !rebootState.error;
            return (
              // Stop menu clicks from bubbling to the card's row onClick (which
              // opens the Manage popup) — the flipped-up menu overlaps the card.
              <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setActionMenuOpenFor(actionMenuOpenFor === s.id ? null : s.id)}
                  className={cn("p-1 transition-colors", actionMenuOpenFor === s.id ? "text-blue" : "text-overlay0 hover:text-blue")}
                  title="More actions"
                >
                  <MoreVertical size={13} />
                </button>
                {actionMenuOpenFor === s.id && (
                  <>
                    <ActionMenuBackdrop onClose={() => setActionMenuOpenFor(null)} />
                    <ActionMenuPanel autoFlip className="absolute right-0">
                      {!isRenaming && (
                        <ActionMenuItem icon={Pencil} onClick={() => { setActionMenuOpenFor(null); startRename(s); }}>Rename</ActionMenuItem>
                      )}
                      {s.locked ? (
                        <ActionMenuItem icon={Unlock} iconClassName="text-red" title="Unlock (allow deletion)" onClick={() => { setActionMenuOpenFor(null); unlockAdminHetznerServer(s.id); }}>Unlock</ActionMenuItem>
                      ) : (
                        <ActionMenuItem icon={Lock} title="Lock this server to prevent accidental deletion" onClick={() => { setActionMenuOpenFor(null); lockAdminHetznerServer(s.id); }}>Lock (prevent deletion)</ActionMenuItem>
                      )}
                      <ActionMenuDivider />
                      <ActionMenuItem
                        icon={Shield}
                        iconClassName="text-mauve"
                        disabled={!isActive || !s.ip}
                        title={isActive && s.ip ? `Run security scan against ${s.ip}` : "Server is not active"}
                        onClick={() => { setActionMenuOpenFor(null); if (s.ip) { startSecurityScan(s.ip); switchNav("security"); } }}
                      >
                        Run security scan
                      </ActionMenuItem>
                      <ActionMenuItem
                        icon={rebooting ? Loader2 : RotateCw}
                        iconClassName="text-peach"
                        loading={rebooting}
                        disabled={!isActive || rebooting}
                        title={rebooting ? "Reboot in progress…" : isActive ? "Soft reboot via Hetzner" : "Server is not active"}
                        onClick={() => {
                          setActionMenuOpenFor(null);
                          if (window.confirm(`Reboot "${s.name}" now?\n\nThis issues a soft reboot via Hetzner. Open SSH sessions will drop.`)) {
                            rebootAdminHetznerServer(s.id);
                          }
                        }}
                      >
                        {rebooting ? "Restarting…" : "Restart server…"}
                      </ActionMenuItem>
                      {s.projectName && s.projectId && (
                        <ActionMenuItem
                          icon={Unlink}
                          title={`Remove the link to "${s.projectName}" without touching the server`}
                          onClick={() => {
                            setActionMenuOpenFor(null);
                            const project = projects.find((p) => p.id === s.projectId);
                            const instance = project?.vpsInstances.find((i) => i.hetzner?.serverId === s.id);
                            if (!instance) {
                              window.alert(`Could not find a matching vpsInstance on project "${s.projectName}". Refresh and try again.`);
                              return;
                            }
                            if (!window.confirm(`Detach "${s.name}" from project "${s.projectName}"?\n\nThe server keeps running — only the project↔server link in Genie is removed.`)) return;
                            disconnectVps(s.projectId!, instance.id);
                          }}
                        >
                          Detach from {s.projectName}
                        </ActionMenuItem>
                      )}
                      <ActionMenuDivider />
                      <ActionMenuItem icon={Trash2} variant="danger" title={s.locked ? "Locked — superadmin can still confirm" : "Delete this server"} onClick={() => { setActionMenuOpenFor(null); setPendingDelete(s.id); }}>Delete server…</ActionMenuItem>
                    </ActionMenuPanel>
                  </>
                )}
              </div>
            );
          };

          return (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {visible.map((s) => {
                const isActive = s.status === "active";
                const isPending = pendingDelete === s.id;
                const isRenaming = renamingId === s.id;
                const adminStats = isActive ? admin.hetzner.stats[s.id] : null;
                const link = findLinkedInstance(projects, { serverId: s.id });
                const streamStats = link ? vpsDeploy.instances[link.instanceId]?.stats ?? null : null;
                const streamError = link ? vpsDeploy.instances[link.instanceId]?.statsError ?? null : null;
                const stats = streamStats ?? adminStats;
                const statsError = streamStats ? null : streamError;
                const statsLoading = isActive && !stats && !statsError && !link;
                const historyKey = link ? vpsMetricKey(link.projectId, link.instanceId) : null;
                const rowOnClick = (e: React.MouseEvent) => {
                  if (!isActive || isRenaming || isPending) return;
                  const target = e.target as HTMLElement;
                  if (target.closest("button, a, input, select, textarea, label")) return;
                  openManageServerWindow(s);
                };
                const rowClass = cn(
                  "bg-mantle rounded-lg px-3 py-2 border border-overlay0/10",
                  isActive && !isRenaming && !isPending && "cursor-pointer hover:border-blue/30 transition-colors",
                  s.locked && "border-red/40 hover:border-red/60",
                );

                return (
                  <div key={s.id} onClick={rowOnClick} className={rowClass}>
                    {isRenaming ? renderRenameInput() : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-text truncate" title={s.name}>{s.name}</span>
                              {s.locked && (
                                <span className="shrink-0 text-red inline-flex" title="Locked: typed-name confirmation required to delete"><Lock size={11} /></span>
                              )}
                            </div>
                          </div>
                          {cardStatusPill(s.status)}
                        </div>

                        {isActive && s.ip && (
                          <CloudVmResourceBlock
                            host={s.ip}
                            isPrivateHost={isPrivateHostAddress(s.ip)}
                            stats={stats ? vpsStatsToBarStats(stats) : null}
                            statsLoading={statsLoading}
                            statsError={statsError ?? undefined}
                            onRefresh={() => { if (link) fetchVpsStats(link.projectId, link.instanceId); else loadAdminHetznerStats(); }}
                            refreshLoading={statsLoading}
                            history={historyKey ? monitor.history[historyKey] : undefined}
                            hours={monitor.hours}
                          />
                        )}

                        {!isActive && (
                          <div className="flex items-center justify-center mt-3 py-3 text-overlay0 text-xs bg-base/40 rounded-md">
                            Server is {s.status.toLowerCase()}
                          </div>
                        )}

                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 mt-3 text-xs">
                          <span className="text-overlay0">Location</span>
                          <span className="text-subtext0">{s.region}</span>
                          <span className="text-overlay0">Type</span>
                          <span className="text-subtext0">{s.size}</span>
                          <span className="text-overlay0">Project</span>
                          <span className="truncate">
                            <AttachVmToProject
                              provider="hetzner"
                              vmId={s.id}
                              current={link ? { projectId: link.projectId, projectName: s.projectName || "project", instanceId: link.instanceId } : null}
                            />
                          </span>
                          <span className="text-overlay0">ID</span>
                          <span className="text-subtext0 font-mono truncate" title={String(s.id)}>{String(s.id)}</span>
                        </div>

                        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-overlay0/10">
                          <div className="flex-1" />
                          {renderSshButton(s, isActive)}
                          {canManage && renderActionsMenu(s, isActive, isRenaming)}
                        </div>
                      </>
                    )}
                    {isPending && (
                      <ServerDeleteConfirm
                        name={s.name}
                        locked={s.locked}
                        canDeleteLocked={isSuperAdmin}
                        onConfirm={() => { wsSend("admin:hetzner:delete", { serverId: s.id }); setPendingDelete(null); }}
                        onCancel={() => setPendingDelete(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Floating Manage popup for Hetzner servers — reuses the generic ManageVmPopup.
// ──────────────────────────────────────────────────────────────────────────

const MANAGE_SERVER_WINDOW_PREFIX = "manage-hzserver-";

export function openManageServerWindow(s: { id: number; name: string }) {
  const wid = MANAGE_SERVER_WINDOW_PREFIX + s.id;
  registerWindow(wid, `Manage ${s.name}`, "settings");
  openWindow(wid);
  focusWindow(wid);
  track("manager.open", { provider: "hetzner" });
}

function ManageServerWindowInstance({ windowId }: { windowId: string }) {
  const [windowManager] = useSubject($windowManager);
  const servers = useDeepSubjectAll($admin).hetzner.servers;
  const [projects] = useSubject($projects);
  const windowState = windowManager.windows[windowId];
  const serverIdStr = windowId.slice(MANAGE_SERVER_WINDOW_PREFIX.length);
  const serverId = Number(serverIdStr);

  const adminServer = servers.find((s) => s.id === serverId) ?? null;
  const adminName = adminServer?.name ?? "";
  const adminIp = adminServer?.ip ?? "";
  const adminProjectId = adminServer?.projectId ?? null;

  let projInst: { label: string; ip: string; projectId: string } | null = null;
  if (!adminServer) {
    for (const p of projects) {
      const inst = p.vpsInstances.find((i) => i.hetzner?.serverId === serverId);
      if (inst && inst.hetzner) {
        projInst = { label: inst.label, ip: inst.hetzner.ipAddress || inst.connection.host, projectId: p.id };
        break;
      }
    }
  }
  const projLabel = projInst?.label ?? "";
  const projIp = projInst?.ip ?? "";
  const projProjectId = projInst?.projectId ?? null;

  const vm = useMemo<ManageVm | null>(() => {
    if (adminServer) {
      return { id: serverIdStr, name: adminName, host: adminIp, projectId: adminProjectId, provider: "hetzner" };
    }
    if (projInst) {
      return { id: serverIdStr, name: projLabel, host: projIp, projectId: projProjectId, provider: "hetzner" };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverIdStr, !!adminServer, adminName, adminIp, adminProjectId, !!projInst, projLabel, projIp, projProjectId]);

  const lastVmRef = useRef<ManageVm | null>(null);
  if (vm) lastVmRef.current = vm;
  const renderVm = vm ?? lastVmRef.current;

  if (!windowState || windowState.status !== "open" || !renderVm) return null;
  return <ManageVmPopup vm={renderVm} windowId={windowId} windowState={windowState} />;
}

export function ManageServerWindows() {
  const [windowManager] = useSubject($windowManager);
  const windowIds = Object.keys(windowManager.windows).filter((id) => id.startsWith(MANAGE_SERVER_WINDOW_PREFIX));
  return (
    <>
      {windowIds.map((id) => (
        <ManageServerWindowInstance key={id} windowId={id} />
      ))}
    </>
  );
}
