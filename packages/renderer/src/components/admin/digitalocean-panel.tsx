"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { Cloud, RefreshCw, Loader2, Settings as SettingsIcon, Pencil, Check, X, Moon, Sun, Plus, Lock, Unlock, Shield, Maximize2, Unlink, MoreVertical, Search, Trash2, Terminal, ExternalLink } from "lucide-react";
import type { AdminDroplet, VpsDeployState, VpsMonitorState } from "@/store/types";
import { $admin, $auth, $manager, $projects, $vpsDeploy, $windowManager } from "@/store/subjects";
import { addSshTerminalTab, createAdminDroplet, disconnectVps, fetchVpsStats, focusWindow, loadAdminDropletStats, loadAdminDroplets, lockAdminDroplet, openWindow, registerWindow, renameAdminDroplet, resizeAdminDroplet, startSecurityScan, switchNav, unlockAdminDroplet, wakeVps } from "@/store/actions";
import { wsRequest } from "@/lib/ws";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ErrorMessage } from "@/components/ui/error-message";
import { AttachVmToProject } from "@/components/project/attach-vm-to-project";
import { ServerDeleteConfirm } from "@/components/ui/server-delete-confirm";
import { cardStatusPill } from "@/components/admin/tazcloud-panel";
import { VpsResourceBar, vpsStatsToBarStats, isPrivateHostAddress } from "@/components/project/vps-resource-gauges";
import { CloudMetricSparklines } from "@/components/cloud/cloud-metric-sparklines";
import { findLinkedInstance, vpsMetricKey } from "@/lib/cloud-vm-metrics";
import { ManageVmPopup, type ManageVm } from "@/components/tazcloud/manage-vm-popup";

// Confirmation type for the inline delete UI on each row.
type PendingDeleteId = number | null;

// Common DO option slugs. Static lists keep the form self-contained — the DO
// account is the source of truth at create-time and will reject anything invalid.
const REGIONS = ["nyc1", "nyc3", "sfo2", "sfo3", "ams3", "fra1", "lon1", "sgp1", "tor1", "blr1", "syd1"];
const SIZES = ["s-1vcpu-1gb", "s-1vcpu-2gb", "s-2vcpu-2gb", "s-2vcpu-4gb", "s-4vcpu-8gb"];
const IMAGES = ["ubuntu-22-04-x64", "ubuntu-24-04-x64", "debian-12-x64", "almalinux-9-x64"];
// Slugs offered in the per-row resize form. DO rejects cross-family moves
// (s-* ↔ c-* ↔ m-*) so we stick to the s-* tier here.
const RESIZE_SIZES = ["s-1vcpu-1gb", "s-1vcpu-2gb", "s-2vcpu-2gb", "s-2vcpu-4gb", "s-4vcpu-8gb", "s-8vcpu-16gb"];

function defaultDropletName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
  const rand = Math.random().toString(36).slice(2, 5);
  return `do-${ts}-${rand}`;
}

/** Row shape for hibernated instances — flattened from project.vpsInstances[].hibernate. */
interface HibernatedRow {
  projectId: string;
  projectName: string;
  instanceId: string;
  label: string;
  snapshotId: number;
  snapshotName: string;
  region: string;
  size: string;
  hibernatedAt: string;
}

const DO_STATS_POLL_MS = 60_000;

export function DigitalOceanPanel({ monitor }: { monitor: VpsMonitorState }) {
  const admin = useDeepSubjectAll($admin);
  const vpsDeploy = useDeepSubjectAll<VpsDeployState>($vpsDeploy);
  const [auth] = useSubject($auth);
  const [projects] = useSubject($projects);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteId>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deployOpen, setDeployOpen] = useState(false);
  const [dropletName, setDropletName] = useState(defaultDropletName());
  const [dropletRegion, setDropletRegion] = useState("nyc1");
  const [dropletSize, setDropletSize] = useState("s-1vcpu-1gb");
  const [dropletImage, setDropletImage] = useState("ubuntu-22-04-x64");
  // Per-row resize form state: dropletId → draft. `null` means the form is closed
  // for that row. Disk-grow is opt-in (the default is reversible CPU/RAM only).
  const [resizeDraftFor, setResizeDraftFor] = useState<number | null>(null);
  const [resizeSize, setResizeSize] = useState<string>("");
  const [resizeDisk, setResizeDisk] = useState(false);
  // Per-row overflow menu — matches TazCloud's pattern so the per-row controls
  // don't span the full width of the row.
  const [actionMenuOpenFor, setActionMenuOpenFor] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  // Walk projects to find DO instances that have been hibernated. These don't
  // appear in DO's droplet list (no live droplet) — only in our DB as a snapshot ref.
  const hibernated: HibernatedRow[] = projects.flatMap((p) =>
    p.vpsInstances
      .filter((i) => i.hibernate && !i.tazcloud)
      .map((i) => ({
        projectId: p.id,
        projectName: p.name,
        instanceId: i.id,
        label: i.label,
        snapshotId: i.hibernate!.snapshotId,
        snapshotName: i.hibernate!.snapshotName,
        region: i.hibernate!.region,
        size: i.hibernate!.size,
        hibernatedAt: i.hibernate!.hibernatedAt,
      })),
  );

  const isSuperAdmin = auth.user?.role === "superadmin";

  useEffect(() => {
    if (!isSuperAdmin) return;
    loadAdminDroplets();
    loadAdminDropletStats();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      loadAdminDropletStats();
    }, DO_STATS_POLL_MS);
    return () => window.clearInterval(id);
  }, [isSuperAdmin]);

  // Re-fire the one-shot droplet list when the WS reconnects (typically
  // because `tsx watch` restarted the dev manager). Without this the panel
  // would sit on a stale list until the user manually hits Refresh — the 10s
  // stats poll self-heals, but the droplet enumeration itself wouldn't.
  // Mirrors the same pattern in tazcloud-panel.tsx.
  const [manager] = useSubject($manager);
  const wasManagerRunningRef = useRef<boolean>(manager.running);
  useEffect(() => {
    if (!isSuperAdmin) return;
    const wasRunning = wasManagerRunningRef.current;
    wasManagerRunningRef.current = manager.running;
    if (!wasRunning && manager.running) {
      loadAdminDroplets();
      loadAdminDropletStats();
    }
  }, [manager.running, isSuperAdmin]);

  // Auto-close the deploy form when create succeeds (creating: true → false, no error).
  const prevCreatingRef = useRef(false);
  useEffect(() => {
    if (prevCreatingRef.current && !admin.dropletsCreating && !admin.dropletsCreateError) {
      setDeployOpen(false);
    }
    prevCreatingRef.current = admin.dropletsCreating;
  }, [admin.dropletsCreating, admin.dropletsCreateError]);

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center text-overlay0">
        <div className="text-center">
          <p className="text-base">DigitalOcean admin is restricted to super admin users.</p>
          <button onClick={() => switchNav("projects")} className="mt-3 text-blue hover:underline text-md">
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  const { droplets, dropletsLoading: loading, dropletsError: error, dropletsCreating: creating, dropletsCreateError: createError } = admin;

  function toggleDeploy() {
    if (deployOpen) {
      setDeployOpen(false);
    } else {
      setDropletName(defaultDropletName());
      setDeployOpen(true);
    }
  }

  function submitCreate() {
    const trimmed = dropletName.trim();
    if (!trimmed) return;
    createAdminDroplet({ name: trimmed, region: dropletRegion, size: dropletSize, image: dropletImage });
  }

  function confirmDelete(id: number) {
    setPendingDelete(id);
  }

  function startRename(d: AdminDroplet) {
    setRenamingId(d.id);
    setRenameDraft(d.name);
  }

  function commitRename() {
    if (renamingId === null) return;
    const trimmed = renameDraft.trim();
    if (trimmed) renameAdminDroplet(renamingId, trimmed);
    setRenamingId(null);
    setRenameDraft("");
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Cloud size={16} className="text-blue" />
        <span className="text-md font-medium text-subtext0">Droplets</span>
        <span className="text-md text-overlay0 font-mono">{droplets.length}</span>
        {hibernated.length > 0 && (
          <span className="text-md text-blue font-mono">+ {hibernated.length} hibernated</span>
        )}
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
            <button
              onClick={() => setSearch("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-overlay0 hover:text-text"
              title="Clear"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div className="flex-1" />
        <Button size="sm" variant={deployOpen ? "active" : "primary"} onClick={toggleDeploy}>
          <Plus size={14} className="mr-1" />
          {deployOpen ? "Cancel" : "Deploy Droplet"}
        </Button>
        <Button size="sm" onClick={() => loadAdminDroplets()} disabled={loading}>
          <RefreshCw size={14} className={cn("mr-1", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {deployOpen && (
        <div className="mb-3 px-3 py-3 border border-overlay0/20 rounded-lg bg-mantle/60 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <label className="text-md text-overlay0">Name</label>
            <input
              type="text"
              value={dropletName}
              onChange={(e) => setDropletName(e.target.value)}
              spellCheck={false}
              disabled={creating}
              className="bg-background border border-surface0 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono focus:border-blue disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-md text-overlay0">Region</label>
            <Select value={dropletRegion} onChange={(e) => setDropletRegion(e.target.value)} disabled={creating} className="py-1.5 text-md font-sans">
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-md text-overlay0">Size</label>
            <Select value={dropletSize} onChange={(e) => setDropletSize(e.target.value)} disabled={creating} className="py-1.5 text-md font-sans">
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-md text-overlay0">Image</label>
            <Select value={dropletImage} onChange={(e) => setDropletImage(e.target.value)} disabled={creating} className="py-1.5 text-md font-sans">
              {IMAGES.map((img) => <option key={img} value={img}>{img}</option>)}
            </Select>
          </div>
          <Button variant="primary" size="sm" onClick={submitCreate} disabled={creating || !dropletName.trim()}>
            {creating ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
            {creating ? "Creating…" : "Create"}
          </Button>
          <p className="basis-full text-xs text-overlay0 italic">
            Creates a bare DigitalOcean droplet via the API — no Genie setup.sh run. The genie SSH key is uploaded and authorized.
          </p>
        </div>
      )}

      {createError && (
        <div className="mb-3">
          <ErrorMessage variant="banner">Create failed: {createError}</ErrorMessage>
        </div>
      )}

      {error && (
        <div className="mb-3">
          <ErrorMessage variant="banner">{error}</ErrorMessage>
        </div>
      )}

      <div>
        {(() => {
          const q = search.trim().toLowerCase();
          const visibleDroplets = q ? droplets.filter((d) => d.name.toLowerCase().includes(q)) : droplets;
          if (loading && droplets.length === 0) {
            return (
              <div className="flex items-center justify-center text-overlay0 py-12">
                <Loader2 size={16} className="animate-spin mr-2" />
                Loading…
              </div>
            );
          }
          if (droplets.length === 0 && !error) {
            return (
              <div className="text-center text-overlay0 py-12">
                <p className="text-base">No DigitalOcean droplets.</p>
                <p className="text-md mt-1">Deploy a project with the DigitalOcean provider to see it here.</p>
              </div>
            );
          }
          if (visibleDroplets.length === 0) {
            return (
              <div className="text-center text-overlay0 py-12">
                <p className="text-md">No droplets match &ldquo;{search}&rdquo;.</p>
              </div>
            );
          }

          // Per-row rename input — shared between list + card layouts.
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
              <button onClick={commitRename} className="text-green hover:text-green/70 p-0.5" title="Save">
                <Check size={12} />
              </button>
              <button onClick={() => { setRenamingId(null); setRenameDraft(""); }} className="text-overlay0 hover:text-text p-0.5" title="Cancel">
                <X size={12} />
              </button>
            </div>
          );

          // SSH button. Project-attached droplets have `genie`; bare droplets
          // from admin:droplets:create only have `root` (no Genie setup.sh
          // runs). Ask the manager which one actually works before opening the
          // terminal, otherwise we get auth-failed on every fresh droplet.
          const renderSshButton = (d: AdminDroplet, isActive: boolean) => (
            <button
              onClick={async () => {
                if (!d.ip) return;
                try {
                  const res = await wsRequest<{ username: string | null; error?: string }>(
                    "admin:droplets:resolve-ssh-user",
                    { dropletId: d.id },
                  );
                  const user = res.username ?? "root";
                  addSshTerminalTab({ host: d.ip, username: user, port: 22 }, `SSH ${user}@${d.name}`);
                } catch {
                  // resolve timed out (manager busy / droplet just booting) —
                  // fall back to root since that's the only user a bare
                  // droplet has, and project droplets recover by retrying.
                  addSshTerminalTab({ host: d.ip, username: "root", port: 22 }, `SSH root@${d.name}`);
                }
              }}
              disabled={!isActive || !d.ip}
              className="text-overlay0 hover:text-blue transition-colors p-1 disabled:opacity-40 disabled:cursor-not-allowed"
              title={isActive && d.ip ? `SSH to ${d.ip}` : "Droplet is not active"}
            >
              <Terminal size={13} />
            </button>
          );

          // Overflow menu — mirrors TazCloud's, minus snapshot/ingress/rkhunter
          // (no DO API equivalents) and plus Resize (DO-specific).
          const renderActionsMenu = (d: AdminDroplet, isActive: boolean, isRenaming: boolean) => {
            const resizeState = admin.dropletResize[d.id];
            const resizing = !!resizeState && !resizeState.done && !resizeState.error;
            return (
              <div className="relative inline-flex items-center">
                <button
                  onClick={() => setActionMenuOpenFor(actionMenuOpenFor === d.id ? null : d.id)}
                  className={cn(
                    "p-1 transition-colors",
                    actionMenuOpenFor === d.id ? "text-blue" : "text-overlay0 hover:text-blue",
                  )}
                  title="More actions"
                >
                  <MoreVertical size={13} />
                </button>
                {actionMenuOpenFor === d.id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActionMenuOpenFor(null)} />
                    <div className="absolute right-0 top-full mt-1 z-20 bg-mantle border border-overlay0/30 rounded-md shadow-lg py-1 min-w-[220px]">
                      {!isRenaming && (
                        <button
                          onClick={() => { setActionMenuOpenFor(null); startRename(d); }}
                          className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2"
                        >
                          <Pencil size={12} className="text-overlay0" />
                          Rename
                        </button>
                      )}
                      {d.locked ? (
                        <button
                          onClick={() => { setActionMenuOpenFor(null); unlockAdminDroplet(d.id); }}
                          className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2"
                          title="Unlock (allow deletion)"
                        >
                          <Unlock size={12} className="text-red" />
                          Unlock
                        </button>
                      ) : (
                        <button
                          onClick={() => { setActionMenuOpenFor(null); lockAdminDroplet(d.id); }}
                          className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2"
                          title="Lock this droplet to prevent accidental deletion"
                        >
                          <Lock size={12} className="text-overlay0" />
                          Lock (prevent deletion)
                        </button>
                      )}
                      <button
                        onClick={() => { setActionMenuOpenFor(null); openManageDropletWindow(d); }}
                        disabled={!isActive}
                        className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <SettingsIcon size={12} className="text-overlay0" />
                        Manage firewall &amp; services…
                      </button>
                      <div className="my-1 border-t border-overlay0/15" />
                      <button
                        onClick={() => { setActionMenuOpenFor(null); if (d.ip) { startSecurityScan(d.ip); switchNav("security"); } }}
                        disabled={!isActive || !d.ip}
                        className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={isActive && d.ip ? `Run security scan against ${d.ip}` : "Droplet is not active"}
                      >
                        <Shield size={12} className="text-mauve" />
                        Run security scan
                      </button>
                      <button
                        onClick={() => {
                          setActionMenuOpenFor(null);
                          setResizeDraftFor(d.id);
                          setResizeSize(d.size);
                          setResizeDisk(false);
                        }}
                        disabled={resizing}
                        className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={resizing ? "Resize in progress…" : "Resize droplet (powers off briefly)"}
                      >
                        <Maximize2 size={12} className="text-blue" />
                        Resize droplet…
                      </button>
                      {d.projectName && d.projectId && (
                        <button
                          onClick={() => {
                            setActionMenuOpenFor(null);
                            const project = projects.find((p) => p.id === d.projectId);
                            const instance = project?.vpsInstances.find((i) => i.digitalocean?.dropletId === d.id);
                            if (!instance) {
                              window.alert(`Could not find a matching vpsInstance on project "${d.projectName}". The project list may be stale — refresh and try again.`);
                              return;
                            }
                            if (!window.confirm(`Detach "${d.name}" from project "${d.projectName}"?\n\nThe droplet keeps running and its files are untouched — only the project↔droplet link in Genie is removed.`)) {
                              return;
                            }
                            disconnectVps(d.projectId!, instance.id);
                          }}
                          className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2"
                          title={`Remove the link to "${d.projectName}" without touching the droplet`}
                        >
                          <Unlink size={12} className="text-overlay0" />
                          Detach from {d.projectName}
                        </button>
                      )}
                      <div className="my-1 border-t border-overlay0/15" />
                      <button
                        onClick={() => { setActionMenuOpenFor(null); confirmDelete(d.id); }}
                        className="w-full text-left px-3 py-1.5 text-md hover:bg-red/10 text-red flex items-center gap-2"
                        title={d.locked ? "Locked — superadmin can still confirm" : "Delete this droplet"}
                      >
                        <Trash2 size={12} className="text-red" />
                        Delete droplet…
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          };

          return (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {visibleDroplets.map((d) => {
                const isActive = d.status === "active";
                const isPending = pendingDelete === d.id;
                const isRenaming = renamingId === d.id;
                const resizeState = admin.dropletResize[d.id];
                const resizing = !!resizeState && !resizeState.done && !resizeState.error;
                const resizeFormOpen = resizeDraftFor === d.id;
                const adminStats = isActive ? admin.dropletStats[d.id] : null;
                const link = findLinkedInstance(projects, { dropletId: d.id });
                const streamStats = link ? vpsDeploy.instances[link.instanceId]?.stats ?? null : null;
                const streamError = link ? vpsDeploy.instances[link.instanceId]?.statsError ?? null : null;
                const dropletStats = streamStats ?? adminStats;
                const dropletStatsError = streamStats ? null : streamError;
                const dropletStatsLoading = isActive && !dropletStats && !dropletStatsError && !link;
                const historyKey = link ? vpsMetricKey(link.projectId, link.instanceId) : null;
                const rowOnClick = (e: React.MouseEvent) => {
                  if (!isActive || isRenaming || isPending || resizeFormOpen) return;
                  const target = e.target as HTMLElement;
                  if (target.closest("button, a, input, select, textarea, label")) return;
                  openManageDropletWindow(d);
                };
                const rowClass = cn(
                  "bg-mantle rounded-lg px-3 py-2 border border-overlay0/10",
                  isActive && !isRenaming && !isPending && !resizeFormOpen
                    && "cursor-pointer hover:border-blue/30 transition-colors",
                  d.locked && "border-red/40 hover:border-red/60",
                );

                const renderResizeBlocks = () => (
                  <>
                    {resizeFormOpen && !resizing && (
                      <div className="mt-2 border border-blue/30 rounded-md bg-mantle/60 px-3 py-2">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-overlay0">New size</label>
                            <Select value={resizeSize} onChange={(e) => setResizeSize(e.target.value)} className="py-1 text-md font-mono">
                              {RESIZE_SIZES.map((s) => (
                                <option key={s} value={s}>{s}{s === d.size ? " (current)" : ""}</option>
                              ))}
                            </Select>
                          </div>
                          <label className="flex items-center gap-1.5 text-md text-overlay1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={resizeDisk}
                              onChange={(e) => setResizeDisk(e.target.checked)}
                            />
                            Grow disk (permanent)
                          </label>
                          <div className="flex-1" />
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={!resizeSize || resizeSize === d.size}
                            onClick={() => {
                              resizeAdminDroplet(d.id, resizeSize, resizeDisk);
                              setResizeDraftFor(null);
                            }}
                          >
                            Resize
                          </Button>
                          <Button size="sm" onClick={() => setResizeDraftFor(null)}>Cancel</Button>
                        </div>
                        <p className="mt-1.5 text-xs text-overlay0 italic">
                          The droplet will be powered off, resized, and powered back on. CPU/RAM-only resizes are reversible; disk growth is permanent. Typically 2–5 minutes.
                        </p>
                      </div>
                    )}
                    {resizeState && (
                      <div className={cn(
                        "mt-2 px-3 py-2 rounded-md text-md font-mono whitespace-pre-wrap",
                        resizeState.error ? "bg-red/10 text-red border border-red/30"
                          : resizeState.done ? "bg-green/10 text-green border border-green/30"
                          : "bg-blue/10 text-blue border border-blue/30",
                      )}>
                        <div className="flex items-center gap-2 mb-1">
                          {!resizeState.done && !resizeState.error && <Loader2 size={12} className="animate-spin" />}
                          <span className="font-semibold">
                            {resizeState.error ? `Resize failed: ${resizeState.error}`
                              : resizeState.done ? `Resize complete → ${resizeState.targetSize}`
                              : `Resizing → ${resizeState.targetSize}`}
                          </span>
                        </div>
                        {resizeState.messages.slice(-4).map((m, i) => (
                          <div key={i} className="text-overlay1 text-xs">{m}</div>
                        ))}
                      </div>
                    )}
                  </>
                );

                return (
                  <div key={d.id} onClick={rowOnClick} className={rowClass}>
                    {isRenaming ? renderRenameInput() : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-text truncate" title={d.name}>{d.name}</span>
                              {d.locked && (
                                <span
                                  className="shrink-0 text-red inline-flex"
                                  title="Locked: typed-name confirmation required to delete"
                                >
                                  <Lock size={11} />
                                </span>
                              )}
                            </div>
                          </div>
                          {cardStatusPill(d.status)}
                        </div>

                        {isActive && d.ip && (
                          <VpsResourceBar
                            className="mt-3"
                            host={d.ip}
                            isPrivateHost={isPrivateHostAddress(d.ip)}
                            stats={dropletStats ? vpsStatsToBarStats(dropletStats) : null}
                            statsLoading={dropletStatsLoading}
                            statsError={dropletStatsError ?? undefined}
                            onRefresh={() => {
                              if (link) fetchVpsStats(link.projectId, link.instanceId);
                              else loadAdminDropletStats();
                            }}
                            refreshLoading={dropletStatsLoading}
                          />
                        )}

                        {isActive && historyKey && (
                          <CloudMetricSparklines
                            history={monitor.history[historyKey]}
                            hours={monitor.hours}
                          />
                        )}

                        {!isActive && (
                          <div className="flex items-center justify-center mt-3 py-3 text-overlay0 text-xs bg-base/40 rounded-md">
                            Droplet is {d.status.toLowerCase()}
                          </div>
                        )}

                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 mt-3 text-xs">
                          <span className="text-overlay0">Region</span>
                          <span className="text-subtext0">{d.region}</span>
                          <span className="text-overlay0">Size</span>
                          <span className="text-subtext0">{d.size}</span>
                          <span className="text-overlay0">Project</span>
                          <span className="truncate">
                            {d.projectName ? (
                              <span className="text-blue">{d.projectName}</span>
                            ) : (
                              <AttachVmToProject provider="digitalocean" vmId={d.id} />
                            )}
                          </span>
                          <span className="text-overlay0">ID</span>
                          <span className="text-subtext0 font-mono truncate" title={String(d.id)}>{String(d.id).slice(0, 8)}…</span>
                        </div>

                        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-overlay0/10">
                          <div className="flex-1" />
                          {renderSshButton(d, isActive)}
                          {renderActionsMenu(d, isActive, isRenaming)}
                        </div>
                      </>
                    )}
                    {renderResizeBlocks()}
                    {isPending && (
                      <ServerDeleteConfirm
                        name={d.name}
                        locked={d.locked}
                        canDeleteLocked={isSuperAdmin}
                        onConfirm={() => { wsDeleteDroplet(d.id); setPendingDelete(null); }}
                        onCancel={() => setPendingDelete(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {hibernated.length > 0 && (
          <div className="mt-6">
            <h2 className="text-md font-medium text-subtext0 mb-2 flex items-center gap-1.5">
              <Moon size={12} className="text-blue" />
              Hibernated
              <span className="text-overlay0 font-mono">{hibernated.length}</span>
            </h2>
            <div className="overflow-x-auto rounded-lg border border-overlay0/20 bg-mantle">
              <table className="w-full text-md font-mono">
                <thead className="bg-surface0 text-overlay1 text-left">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Label</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Region</th>
                    <th className="px-3 py-2 font-semibold">Size</th>
                    <th className="px-3 py-2 font-semibold">Snapshot</th>
                    <th className="px-3 py-2 font-semibold">Project</th>
                    <th className="px-3 py-2 font-semibold">Hibernated</th>
                    <th className="px-3 py-2 font-semibold w-0">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {hibernated.map((h) => (
                    <tr key={h.instanceId} className="border-t border-overlay0/10 hover:bg-surface0/40">
                      <td className="px-3 py-2 text-text">{h.label}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-md bg-blue/15 text-blue">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue" />
                          hibernated
                        </span>
                      </td>
                      <td className="px-3 py-2 text-overlay1">{h.region || "—"}</td>
                      <td className="px-3 py-2 text-overlay1">{h.size || "—"}</td>
                      <td className="px-3 py-2 text-overlay1 select-text">{h.snapshotName}</td>
                      <td className="px-3 py-2 text-blue">{h.projectName}</td>
                      <td className="px-3 py-2 text-overlay0">
                        {new Date(h.hibernatedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => wakeVps(h.projectId, h.instanceId)}
                          className="inline-flex items-center gap-1 text-md text-blue hover:underline"
                          title="Restore: create a new droplet from this snapshot"
                        >
                          <Sun size={12} /> Wake
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Local helper to dispatch droplet deletion via the existing admin:droplets:delete handler.
function wsDeleteDroplet(dropletId: number) {
  // Use the renderer's wsSend directly to avoid coupling to a new store action.
  import("@/lib/ws").then(({ wsSend }) => wsSend("admin:droplets:delete", { dropletId }));
}

// ──────────────────────────────────────────────────────────────────────────
// Floating Manage popup for DigitalOcean droplets.
//
// Reuses the generic ManageVmPopup (tabs, drag/resize, recipes, firewall,
// ports, sessions, files, db) from tazcloud-panel.tsx. A distinct window-id
// prefix keeps DO popups separate from Taz popups in the window manager and
// lets each panel mount its own resolver below.
// ──────────────────────────────────────────────────────────────────────────

const MANAGE_DROPLET_WINDOW_PREFIX = "manage-droplet-";

/** Open the floating Manage popup for a DigitalOcean droplet. Cascades against
 *  other open popups via the window-manager (same UX as TazCloud). */
export function openManageDropletWindow(d: { id: number; name: string }) {
  const wid = MANAGE_DROPLET_WINDOW_PREFIX + d.id;
  registerWindow(wid, `Manage ${d.name}`, "settings");
  openWindow(wid);
  focusWindow(wid);
}

function ManageDropletWindowInstance({ windowId }: { windowId: string }) {
  const [windowManager] = useSubject($windowManager);
  const adminDroplets = useDeepSubjectAll($admin).droplets;
  const [projects] = useSubject($projects);
  const windowState = windowManager.windows[windowId];
  const dropletIdStr = windowId.slice(MANAGE_DROPLET_WINDOW_PREFIX.length);
  const dropletId = Number(dropletIdStr);

  // Primary source: the admin droplets list (when the user is on the Clouds
  // panel). Fallback: a project-attached droplet — lets the popup open from a
  // project page without needing the admin list to be loaded.
  const adminDroplet = adminDroplets.find((d) => d.id === dropletId) ?? null;
  const adminName = adminDroplet?.name ?? "";
  const adminIp = adminDroplet?.ip ?? "";
  const adminProjectId = adminDroplet?.projectId ?? null;

  let projInst: { label: string; ip: string; projectId: string } | null = null;
  if (!adminDroplet) {
    for (const p of projects) {
      const inst = p.vpsInstances.find((i) => i.digitalocean?.dropletId === dropletId);
      if (inst && inst.digitalocean) {
        projInst = {
          label: inst.label,
          ip: inst.digitalocean.ipAddress || inst.connection.host,
          projectId: p.id,
        };
        break;
      }
    }
  }
  const projLabel = projInst?.label ?? "";
  const projIp = projInst?.ip ?? "";
  const projProjectId = projInst?.projectId ?? null;

  // Stable identity — see the parallel comment in ManageVmWindowInstance about
  // depending on primitives, not arrays, to avoid resetting child effects on
  // every WS broadcast.
  const vm = useMemo<ManageVm | null>(() => {
    if (adminDroplet) {
      return {
        id: dropletIdStr,
        name: adminName,
        host: adminIp,
        projectId: adminProjectId,
        provider: "do",
      };
    }
    if (projInst) {
      return {
        id: dropletIdStr,
        name: projLabel,
        host: projIp,
        projectId: projProjectId,
        provider: "do",
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropletIdStr, !!adminDroplet, adminName, adminIp, adminProjectId, !!projInst, projLabel, projIp, projProjectId]);

  const lastVmRef = useRef<ManageVm | null>(null);
  if (vm) lastVmRef.current = vm;
  const renderVm = vm ?? lastVmRef.current;

  if (!windowState || windowState.status !== "open" || !renderVm) return null;
  return <ManageVmPopup vm={renderVm} windowId={windowId} windowState={windowState} />;
}

export function ManageDropletWindows() {
  const [windowManager] = useSubject($windowManager);
  const windowIds = Object.keys(windowManager.windows).filter((id) => id.startsWith(MANAGE_DROPLET_WINDOW_PREFIX));
  return (
    <>
      {windowIds.map((id) => (
        <ManageDropletWindowInstance key={id} windowId={id} />
      ))}
    </>
  );
}
