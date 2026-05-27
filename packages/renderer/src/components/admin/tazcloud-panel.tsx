"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { Cloud, RefreshCw, Loader2, Terminal, Plus, ChevronDown, Settings as SettingsIcon, Pencil, Check, X, Lock, Unlock, Shield, Bug, Globe, Camera, Trash2, MoreVertical, LayoutGrid, List as ListIcon, Search, ExternalLink, Minus, Maximize2, Minimize2, Rocket, Unlink, Activity, Plug, Moon } from "lucide-react";
import { $admin, $auth, $manager, $persistedTerminals, $vpsDeploy, $windowManager } from "@/store/subjects";
import type { AdminTazVm, FloatingWindowState, PersistedTerminalSession, VpsDeployState } from "@/store/types";
import { addSshTerminalTab, adminDropletExec, adminTazcloudExec, closeWindow, createAdminTazVm, createTazProject, createTazSnapshot, deleteAdminTazVm, deleteTazProject, deleteTazSnapshot, disconnectVps, focusWindow, hibernateVps, killPersistedTerminal, loadAdminTazVms, loadAdminTazcloudStats, loadPersistedTerminals, loadTazProjects, loadTazSnapshots, lockAdminTazVm, minimizeWindow, openWindow, reattachPersistedTerminal, registerTazIngress, registerWindow, removeTazIngress, renameAdminTazVm, startSecurityScan, switchNav, unlockAdminTazVm, updateWindowPosition, vpsExec } from "@/store/actions";
import { useDraggable, useResizable } from "@/hooks/use-draggable";
import { ClaudeLogo, VpsFirewall } from "@/components/project/project-detail";
import { AdminRecipesPanel } from "@/components/admin/admin-recipes-panel";
import { AdminSystemPanel, VpsProcessesPanel } from "@/components/admin/admin-system-panel";
import { VpsResourceGauges } from "@/components/project/vps-resource-gauges";
import { AttachVmToProject } from "@/components/project/attach-vm-to-project";
import { DropletInstanceBar } from "@/components/project/droplet-instance-bar";
import { ServerDeleteConfirm } from "@/components/ui/server-delete-confirm";
import { FileExplorer } from "@/components/project/vps-file-explorer";
import { DbExplorer } from "@/components/admin/db-explorer";
import { CommandsTab } from "@/components/project/project-detail";
import { $projects } from "@/store/subjects";
import { FolderTree, Database as DatabaseIcon, PlayCircle, Network, Cpu } from "lucide-react";
import { CircularGauge } from "@/components/ui/circular-gauge";
import { CopyableIp } from "@/components/ui/copyable-ip";
import { useDeepSubjectAll, useIsWindowFocused } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ErrorMessage } from "@/components/ui/error-message";
import { IMAGES, SIZES, TAZ_NAME_RE, defaultSshUserFor, defaultVmName, imageDefaultUser, validateTazVmName } from "../tazcloud/helpers";
import { TazSnapshotsSection } from "../tazcloud/taz-snapshots-section";
import { openManageVmWindow } from "../tazcloud/manage-vm-popup";

export function formatBytesShort(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)}G`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)}M`;
}

export function cardStatusPill(status: string) {
  const s = status.toLowerCase();
  const isActive = s === "active";
  const isHibernated = s === "hibernated";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium px-1.5 py-0.5 rounded shrink-0",
        isActive ? "bg-green/15 text-green" : isHibernated ? "bg-blue/15 text-blue" : "bg-overlay0/15 text-overlay0",
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          isActive && "bg-green shadow-[0_0_3px_var(--color-green)]",
          isHibernated && "bg-blue shadow-[0_0_3px_var(--color-blue)]",
          !isActive && !isHibernated && "bg-overlay0",
        )}
      />
      {s}
    </span>
  );
}

// Ingress is locked to the Genie-owned zone — a wildcard A record covers it
// at the DNS level, so attaching a new VM is a one-field operation.
const INGRESS_DOMAIN_SUFFIX = "cloud.teleporthq.ai";
const INGRESS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// IMAGES / SIZES / imageDefaultUser / defaultSshUserFor / defaultVmName /
// validateTazVmName moved to ./tazcloud/helpers.ts so taz-snapshots-section.tsx
// and the manage popup cluster can reuse them without re-importing the whole
// panel.

export function TazCloudPanel() {
  const admin = useDeepSubjectAll($admin);
  const [auth] = useSubject($auth);
  // Used by the per-row "Detach from project" action to resolve the project's
  // internal vpsInstance id (which the server's `vps:disconnect` handler needs)
  // from the admin-view `vm.id` (which is the TazCloud-side VM id).
  const [projects] = useSubject($projects);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [deployOpen, setDeployOpen] = useState(false);
  const [vmName, setVmName] = useState(defaultVmName());
  const [vmImage, setVmImage] = useState("ubuntu-22");
  const [vmSize, setVmSize] = useState("small");
  /** v2.0.0 only — selected Taz project for the create form. Empty string means
   *  "let the server auto-pick" (works when the tenant has exactly one project). */
  const [vmProjectId, setVmProjectId] = useState<string>("");
  /** Inline "Create project" form state. Toggled from the Projects section. */
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [pendingProjectDelete, setPendingProjectDelete] = useState<string | null>(null);
  const [userMenuOpenFor, setUserMenuOpenFor] = useState<string | null>(null);
  /** Per-row overflow menu. Collapses the rename/lock/security/rkhunter/snapshot/
   *  ingress/manage/delete cluster so the row isn't visually swamped. */
  const [actionMenuOpenFor, setActionMenuOpenFor] = useState<string | null>(null);
  /** VM-list view mode + search query. Persisted to localStorage so the user
   *  doesn't have to re-toggle on every visit. Search is case-insensitive,
   *  applied to vm.name (the field admins actually scan by). */
  const [vmViewMode, setVmViewMode] = useState<"list" | "cards">(() => {
    if (typeof window === "undefined") return "list";
    return (window.localStorage.getItem("genie.tazcloud.vmViewMode") as "list" | "cards") || "list";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("genie.tazcloud.vmViewMode", vmViewMode);
  }, [vmViewMode]);
  const [vmSearch, setVmSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Which VM has its inline snapshot form open, and the draft form state.
  const [snapshotFormFor, setSnapshotFormFor] = useState<string | null>(null);
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshotStopFirst, setSnapshotStopFirst] = useState(true);
  // Inline "Attach domain" form (TazCloud Ingress).
  const [ingressFormFor, setIngressFormFor] = useState<string | null>(null);
  // User picks only the leftmost subdomain label; the full FQDN is built as
  // `${label}.${INGRESS_DOMAIN_SUFFIX}`.
  const [ingressLabel, setIngressLabel] = useState("");
  const [ingressAppPort, setIngressAppPort] = useState("3000");

  function startRename(vm: { id: string; name: string }) {
    setRenamingId(vm.id);
    setRenameDraft(vm.name);
  }

  function commitRename() {
    if (!renamingId) return;
    const trimmed = renameDraft.trim();
    if (trimmed) renameAdminTazVm(renamingId, trimmed);
    setRenamingId(null);
    setRenameDraft("");
  }

  const role = auth.user?.role;
  const canAccess = role === "superadmin" || role === "tazcloud";
  const isSuperAdmin = role === "superadmin";

  useEffect(() => {
    if (!canAccess) return;
    loadAdminTazVms();
    loadAdminTazcloudStats();
    loadTazSnapshots();
    // v2.0.0: projects are mandatory. Empty list on legacy v6 tenants — handled
    // gracefully in the UI (the Projects section just doesn't render).
    loadTazProjects();
    // SSH-probing every VM is expensive; refresh on a slow cadence and let the
    // user hit Refresh for an immediate update.
    const id = setInterval(loadAdminTazcloudStats, 30_000);
    return () => clearInterval(id);
  }, [canAccess]);

  // Re-fire the one-shot loads when the WS reconnects (typically because
  // `tsx watch` restarted the dev manager). Without this the VM/snapshot/
  // project lists stay frozen on whatever they had pre-restart — the user
  // would see the panel "stuck" until they manually hit Refresh. The 5s gauges
  // poll already self-heals; this brings the static lists in line.
  const [manager] = useSubject($manager);
  const wasRunningRef = useRef<boolean>(manager.running);
  useEffect(() => {
    if (!canAccess) return;
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = manager.running;
    // Only re-fire on a false→true transition. Skip the initial true state
    // (that's the first mount, already handled by the effect above) and skip
    // the true→false drop (close handlers already drained pending promises).
    if (!wasRunning && manager.running) {
      loadAdminTazVms();
      loadAdminTazcloudStats();
      loadTazSnapshots();
      loadTazProjects();
    }
  }, [manager.running, canAccess]);

  // Snapshots transition pending → active in 1-5 min. Poll while any pending one
  // exists so the row's status badge flips without manual refresh. Stops when
  // none are pending (no wasted requests on steady state).
  const pendingSnapshotCount = admin.tazcloud.snapshots.filter((s) => s.status === "pending").length;
  useEffect(() => {
    if (pendingSnapshotCount === 0) return;
    const id = setInterval(loadTazSnapshots, 10_000);
    return () => clearInterval(id);
  }, [pendingSnapshotCount]);

  // Close the deploy form when a creation completes successfully (creating: true → false, no error).
  const prevCreatingRef = useRef(false);
  useEffect(() => {
    if (prevCreatingRef.current && !admin.tazcloud.creating && !admin.tazcloud.createError) {
      setDeployOpen(false);
    }
    prevCreatingRef.current = admin.tazcloud.creating;
  }, [admin.tazcloud.creating, admin.tazcloud.createError]);

  if (!canAccess) {
    return (
      <div className="flex-1 flex items-center justify-center text-overlay0">
        <div className="text-center">
          <p className="text-base">TazCloud admin is restricted to super admin and tazcloud users.</p>
          <button onClick={() => switchNav("projects")} className="mt-3 text-blue hover:underline text-md">
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  const { vms, loading, error, creating, createError } = admin.tazcloud;

  function confirmDelete(vmId: string) {
    setPendingDelete(vmId);
  }

  function submitCreate() {
    const trimmed = vmName.trim();
    if (validateTazVmName(trimmed)) return;
    createAdminTazVm({
      name: trimmed,
      image: vmImage,
      size: vmSize,
      // Omit `project_id` when blank — the server auto-picks the only project,
      // or errors with the list of available IDs on multi-project tenants.
      ...(vmProjectId ? { project_id: vmProjectId } : {}),
    });
  }

  function submitCreateProject() {
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    createTazProject(trimmed);
    setNewProjectName("");
    setProjectFormOpen(false);
  }

  function toggleDeploy() {
    if (deployOpen) {
      setDeployOpen(false);
    } else {
      setVmName(defaultVmName());
      setDeployOpen(true);
    }
  }

  function openSshTerminal(vm: { id: string; name: string; ipv6: string; status: string; image?: string; projectId: string | null; isPrivateHost?: boolean }, userOverride?: string) {
    if (!vm.ipv6 || vm.status !== "ACTIVE") return;
    const username = userOverride ?? defaultSshUserFor(vm);
    // v2.0.0: ipv6 here is actually the private 10.128.x.y address — the
    // manager reaches it directly over the WireGuard tunnel (wireguard.md).
    addSshTerminalTab(
      {
        host: vm.ipv6,
        port: 22,
        username,
        privateKeyPath: "~/.genie/ssh/tazcloud_ed25519",
      },
      `SSH ${username}@${vm.name}`,
    );
  }

  function openSnapshotForm(vm: { id: string; name: string }) {
    setSnapshotFormFor(vm.id);
    // Pre-fill with a sensible default the user can keep or replace.
    // Format: <vm>-YYYYMMDD-HHMM — matches the TazCloud name regex.
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    setSnapshotName(`${vm.name}-${ts}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
    setSnapshotStopFirst(true);
  }

  function submitSnapshot(vmId: string) {
    const name = snapshotName.trim();
    if (validateTazVmName(name) !== null) return;
    createTazSnapshot(vmId, name, snapshotStopFirst);
    setSnapshotFormFor(null);
  }

  function openIngressForm(vmId: string) {
    setIngressFormFor(vmId);
    setIngressLabel("");
    setIngressAppPort("3000");
  }

  function submitIngress(vmId: string) {
    const label = ingressLabel.trim().toLowerCase();
    if (!INGRESS_LABEL_RE.test(label)) return;
    const fqdn = `${label}.${INGRESS_DOMAIN_SUFFIX}`;
    const port = parseInt(ingressAppPort, 10);
    registerTazIngress(vmId, fqdn, Number.isFinite(port) && port > 0 ? port : undefined);
    setIngressFormFor(null);
  }

  function executeDelete(vmId: string) {
    setDeleting((prev) => new Set(prev).add(vmId));
    deleteAdminTazVm(vmId);
    setPendingDelete(null);
    // The server pushes admin:tazcloud:deleted which removes the row; clear the
    // local "deleting" flag after a short delay in case the response is fast.
    setTimeout(() => {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(vmId);
        return next;
      });
    }, 4000);
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Cloud size={16} className="text-blue" />
        <span className="text-md font-medium text-subtext0">VMs</span>
        <span className="text-md text-overlay0 font-mono">{vms.length}</span>
        <div className="relative ml-2">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-overlay0 pointer-events-none" />
          <input
            type="text"
            value={vmSearch}
            onChange={(e) => setVmSearch(e.target.value)}
            placeholder="Search by name…"
            spellCheck={false}
            className="bg-background border border-surface0 rounded-md pl-7 pr-2 py-1 text-md text-text outline-none focus:border-blue w-44"
          />
          {vmSearch && (
            <button
              onClick={() => setVmSearch("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-overlay0 hover:text-text"
              title="Clear"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div className="inline-flex rounded-md border border-surface0 bg-background overflow-hidden">
          <button
            onClick={() => setVmViewMode("list")}
            className={cn(
              "px-1.5 py-1 transition-colors",
              vmViewMode === "list" ? "bg-surface0 text-blue" : "text-overlay0 hover:text-text",
            )}
            title="List view"
          >
            <ListIcon size={13} />
          </button>
          <button
            onClick={() => setVmViewMode("cards")}
            className={cn(
              "px-1.5 py-1 transition-colors border-l border-surface0",
              vmViewMode === "cards" ? "bg-surface0 text-blue" : "text-overlay0 hover:text-text",
            )}
            title="Card view"
          >
            <LayoutGrid size={13} />
          </button>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant={deployOpen ? "active" : "primary"} onClick={toggleDeploy}>
          <Plus size={14} className="mr-1" />
          {deployOpen ? "Cancel" : "Deploy VM"}
        </Button>
        <Button size="sm" onClick={() => { loadAdminTazVms(); loadAdminTazcloudStats(); }} disabled={loading}>
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
              value={vmName}
              onChange={(e) => setVmName(e.target.value)}
              spellCheck={false}
              disabled={creating}
              className="bg-background border border-surface0 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono focus:border-blue disabled:opacity-50"
            />
            {(() => {
              const err = validateTazVmName(vmName.trim());
              return err ? <p className="text-xs text-red italic">{err}</p> : null;
            })()}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-md text-overlay0">Image</label>
            <Select value={vmImage} onChange={(e) => setVmImage(e.target.value)} disabled={creating} className="py-1.5 text-md font-sans">
              {IMAGES.map((img) => <option key={img} value={img}>{img}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-md text-overlay0">Size</label>
            <Select value={vmSize} onChange={(e) => setVmSize(e.target.value)} disabled={creating} className="py-1.5 text-md font-sans">
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          {admin.tazcloud.projects.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-md text-overlay0">VXLAN</label>
              <Select value={vmProjectId} onChange={(e) => setVmProjectId(e.target.value)} disabled={creating} className="py-1.5 text-md font-sans">
                <option value="">
                  {admin.tazcloud.projects.length === 1 ? `auto (${admin.tazcloud.projects[0].name})` : "Select a VXLAN…"}
                </option>
                {admin.tazcloud.projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.subnetCidr})</option>
                ))}
              </Select>
            </div>
          )}
          <Button variant="primary" size="sm" onClick={submitCreate} disabled={creating || validateTazVmName(vmName.trim()) !== null}>
            {creating ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
            {creating ? "Creating…" : "Create"}
          </Button>
          <p className="basis-full text-xs text-overlay0 italic">
            Creates a bare TazCloud VM via the API — no Genie setup.sh run. To deploy a project, use the per-project Deploy button.
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

      {admin.tazcloud.ingressError && (
        <div className="mb-3">
          <ErrorMessage variant="banner">Ingress: {admin.tazcloud.ingressError}</ErrorMessage>
        </div>
      )}

      {/* v2.0.0 VXLANs (isolated tenant networks; called "projects" in the
          TazCloud API but renamed in the UI to avoid colliding with Genie's
          own "Project" concept). Hidden on legacy v6 tenants — the server
          returns an empty list there. */}
      {(admin.tazcloud.projects.length > 0 || admin.tazcloud.projectsLoading || projectFormOpen) && (
        <div className="mb-3 border border-overlay0/15 rounded-lg bg-mantle/40">
          <div className="px-3 py-2 flex items-center gap-2 border-b border-overlay0/10">
            <Network size={13} className="text-blue" />
            <span className="text-md font-medium text-text">VXLANs</span>
            <span className="text-xs text-overlay0">isolated tenant networks · v2.0.0</span>
            <div className="flex-1" />
            <Button size="sm" variant={projectFormOpen ? "active" : "ghost"} onClick={() => setProjectFormOpen((o) => !o)}>
              <Plus size={12} className="mr-1" />
              {projectFormOpen ? "Cancel" : "New VXLAN"}
            </Button>
          </div>

          {admin.tazcloud.projectError && (
            <div className="px-3 pt-2">
              <ErrorMessage variant="banner">{admin.tazcloud.projectError}</ErrorMessage>
            </div>
          )}

          {projectFormOpen && (
            <div className="px-3 py-2 flex items-end gap-2 border-b border-overlay0/10 bg-background/50">
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-xs text-overlay0">VXLAN name (lowercase, 3–63 chars)</label>
                <input
                  autoFocus
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitCreateProject(); else if (e.key === "Escape") { setProjectFormOpen(false); setNewProjectName(""); } }}
                  placeholder="acme-prod"
                  spellCheck={false}
                  disabled={admin.tazcloud.projectCreating}
                  className="bg-background border border-surface0 rounded-md px-2 py-1 text-md text-text outline-none font-mono focus:border-blue disabled:opacity-50"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={submitCreateProject}
                disabled={admin.tazcloud.projectCreating || !newProjectName.trim()}
              >
                {admin.tazcloud.projectCreating ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
                Create VXLAN
              </Button>
            </div>
          )}

          <div className="divide-y divide-overlay0/10">
            {admin.tazcloud.projects.length === 0 && !admin.tazcloud.projectsLoading && (
              <div className="px-3 py-3 text-md text-overlay0 italic">
                No VXLANs yet. Create one — every VM must belong to a VXLAN on v2.0.0.
              </div>
            )}
            {admin.tazcloud.projects.map((p) => {
              const vmCount = p.vmCount ?? vms.filter((v) => v.projectId === p.id).length;
              const isPending = pendingProjectDelete === p.id;
              return (
                <div key={p.id} className="px-3 py-2 flex items-center gap-3 text-md">
                  <span className="text-text font-medium">{p.name}</span>
                  <span className="text-overlay0 font-mono text-xs">{p.subnetCidr}</span>
                  <span className="text-overlay0 text-xs">{vmCount} VM{vmCount === 1 ? "" : "s"}</span>
                  <span className="text-overlay0 text-xs font-mono" title={p.id}>{p.id.slice(0, 8)}</span>
                  <div className="flex-1" />
                  {isPending ? (
                    <>
                      <span className="text-xs text-red">Delete this VXLAN?</span>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => { deleteTazProject(p.id); setPendingProjectDelete(null); }}
                        disabled={vmCount > 0}
                        title={vmCount > 0 ? "Delete all VMs in this VXLAN first" : "Delete VXLAN"}
                      >
                        Confirm
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPendingProjectDelete(null)}>Cancel</Button>
                    </>
                  ) : (
                    <button
                      onClick={() => setPendingProjectDelete(p.id)}
                      disabled={vmCount > 0}
                      className="text-overlay0 hover:text-red transition-colors p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={vmCount > 0 ? `Cannot delete — ${vmCount} VM(s) still in this VXLAN` : "Delete VXLAN"}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        {(() => {
          const q = vmSearch.trim().toLowerCase();
          const visibleVms = q ? vms.filter((v) => v.name.toLowerCase().includes(q)) : vms;
          if (loading && vms.length === 0) {
            return (
              <div className="flex items-center justify-center text-overlay0 py-12">
                <Loader2 size={16} className="animate-spin mr-2" />
                Loading…
              </div>
            );
          }
          if (vms.length === 0 && !error) {
            return (
              <div className="text-center text-overlay0 py-12">
                <p className="text-base">No TazCloud VMs.</p>
                <p className="text-md mt-1">Deploy a project with the TazCloud provider to see it here.</p>
              </div>
            );
          }
          if (visibleVms.length === 0) {
            return (
              <div className="text-center text-overlay0 py-12">
                <p className="text-md">No VMs match &ldquo;{vmSearch}&rdquo;.</p>
              </div>
            );
          }
          // Shared SSH split-button (terminal + user-override dropdown).
          // Rendered inside both card and list layouts, closures over local state.
          const renderSshControls = (vm: AdminTazVm, isActive: boolean) => (
            <div className="relative inline-flex items-center">
              <button
                onClick={() => openSshTerminal(vm)}
                disabled={!isActive || !vm.ipv6}
                className="text-overlay0 hover:text-blue transition-colors p-1 disabled:opacity-40 disabled:cursor-not-allowed"
                title={isActive ? `SSH to ${defaultSshUserFor(vm)}@${vm.ipv6}` : "VM is not active"}
              >
                <Terminal size={13} />
              </button>
              <button
                onClick={() => setUserMenuOpenFor(userMenuOpenFor === vm.id ? null : vm.id)}
                disabled={!isActive || !vm.ipv6}
                className="text-overlay0 hover:text-blue transition-colors py-1 -ml-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Choose SSH user"
              >
                <ChevronDown size={11} />
              </button>
              {userMenuOpenFor === vm.id && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpenFor(null)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-mantle border border-overlay0/30 rounded-md shadow-lg py-1 min-w-[140px]">
                    {["genie", "ubuntu", "debian", "almalinux"].map((u) => {
                      const isDefault = u === defaultSshUserFor(vm);
                      return (
                        <button
                          key={u}
                          onClick={() => { setUserMenuOpenFor(null); openSshTerminal(vm, u); }}
                          className="w-full text-left px-3 py-1 text-md hover:bg-surface0 font-mono flex items-center gap-2"
                        >
                          {u}
                          {isDefault && <span className="text-overlay0 text-xs">default</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
          const renderActionsMenu = (vm: AdminTazVm, isActive: boolean, isRenaming: boolean) => (
            <div className="relative inline-flex items-center">
              <button
                onClick={() => setActionMenuOpenFor(actionMenuOpenFor === vm.id ? null : vm.id)}
                className={cn(
                  "p-1 transition-colors",
                  actionMenuOpenFor === vm.id ? "text-blue" : "text-overlay0 hover:text-blue",
                )}
                title="More actions"
              >
                <MoreVertical size={13} />
              </button>
              {actionMenuOpenFor === vm.id && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setActionMenuOpenFor(null)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-mantle border border-overlay0/30 rounded-md shadow-lg py-1 min-w-[220px]">
                    {!isRenaming && (
                      <button
                        onClick={() => { setActionMenuOpenFor(null); startRename(vm); }}
                        className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2"
                      >
                        <Pencil size={12} className="text-overlay0" />
                        Rename
                      </button>
                    )}
                    {vm.locked ? (
                      <button
                        onClick={() => { setActionMenuOpenFor(null); unlockAdminTazVm(vm.id); }}
                        disabled={!isSuperAdmin}
                        className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={isSuperAdmin ? "Unlock (allow deletion)" : "Only a superadmin can unlock"}
                      >
                        <Unlock size={12} className="text-red" />
                        Unlock
                      </button>
                    ) : (
                      <button
                        onClick={() => { setActionMenuOpenFor(null); lockAdminTazVm(vm.id); }}
                        className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2"
                        title="Lock this VM to prevent accidental deletion"
                      >
                        <Lock size={12} className="text-overlay0" />
                        Lock (prevent deletion)
                      </button>
                    )}
                    <button
                      onClick={() => { setActionMenuOpenFor(null); openManageVmWindow(vm); }}
                      disabled={!isActive}
                      className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <SettingsIcon size={12} className="text-overlay0" />
                      Manage firewall &amp; services…
                    </button>
                    <div className="my-1 border-t border-overlay0/15" />
                    <button
                      onClick={() => { setActionMenuOpenFor(null); startSecurityScan(vm.ipv6); switchNav("security"); }}
                      disabled={!isActive || !vm.ipv6}
                      className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      title={isActive && vm.ipv6 ? `Run security scan against ${vm.ipv6}` : "VM is not active"}
                    >
                      <Shield size={12} className="text-mauve" />
                      Run security scan
                    </button>
                    <button
                      onClick={() => {
                        setActionMenuOpenFor(null);
                        const username = defaultSshUserFor(vm);
                        addSshTerminalTab(
                          { host: vm.ipv6, port: 22, username, privateKeyPath: "~/.genie/ssh/tazcloud_ed25519" },
                          `rkhunter @ ${vm.name}`,
                          "sudo rkhunter --check --sk",
                        );
                      }}
                      disabled={!isActive || !vm.ipv6}
                      className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      title={isActive && vm.ipv6 ? `Run rkhunter on ${vm.name}` : "VM is not active"}
                    >
                      <Bug size={12} className="text-yellow" />
                      Run rkhunter
                    </button>
                    <button
                      onClick={() => { setActionMenuOpenFor(null); openSnapshotForm(vm); }}
                      disabled={!isActive || !!admin.tazcloud.snapshotCreating[vm.id]}
                      className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      title={isActive ? `Snapshot ${vm.name}` : "VM is not active"}
                    >
                      {admin.tazcloud.snapshotCreating[vm.id]
                        ? <Loader2 size={12} className="animate-spin text-teal" />
                        : <Camera size={12} className="text-teal" />}
                      Create snapshot…
                    </button>
                    {!vm.ingress && (
                      <button
                        onClick={() => { setActionMenuOpenFor(null); openIngressForm(vm.id); }}
                        disabled={!isActive || !!admin.tazcloud.ingressBusy[vm.id]}
                        className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={isActive ? "Attach a domain (HTTPS via TazCloud ingress)" : "VM is not active"}
                      >
                        {admin.tazcloud.ingressBusy[vm.id]
                          ? <Loader2 size={12} className="animate-spin text-mauve" />
                          : <Globe size={12} className="text-mauve" />}
                        Attach domain…
                      </button>
                    )}
                    {vm.projectId && vm.projectName && (
                      <button
                        onClick={() => {
                          setActionMenuOpenFor(null);
                          // Resolve the project's vpsInstance id from the client-cached
                          // $projects state — the server's vps:disconnect handler needs
                          // (projectId, instanceId), not the tazcloud-side vm.id.
                          const project = projects.find((p) => p.id === vm.projectId);
                          const instance = project?.vpsInstances.find((i) => i.tazcloud?.vmId === vm.id);
                          if (!instance) {
                            window.alert(`Could not find a matching vpsInstance on project "${vm.projectName}". The project list may be stale — refresh and try again.`);
                            return;
                          }
                          if (!window.confirm(`Detach "${vm.name}" from project "${vm.projectName}"?\n\nThe VM keeps running and its files (including /opt/project) are untouched — only the project↔VM link in Genie is removed.`)) {
                            return;
                          }
                          disconnectVps(vm.projectId!, instance.id);
                        }}
                        className="w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2"
                        title={`Remove the link to "${vm.projectName}" without touching the VM`}
                      >
                        <Unlink size={12} className="text-overlay0" />
                        Detach from {vm.projectName}
                      </button>
                    )}
                    <div className="my-1 border-t border-overlay0/15" />
                    <button
                      onClick={() => { setActionMenuOpenFor(null); confirmDelete(vm.id); }}
                      className="w-full text-left px-3 py-1.5 text-md hover:bg-red/10 text-red flex items-center gap-2"
                      title={vm.locked ? "Locked — superadmin can still confirm" : "Delete this VM"}
                    >
                      <Trash2 size={12} className="text-red" />
                      Delete VM…
                    </button>
                  </div>
                </>
              )}
            </div>
          );
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
          const renderIngressBadge = (vm: AdminTazVm) => (
            <span className="inline-flex items-center gap-1">
              <a
                href={vm.ingress!.url || `https://${vm.ingress!.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-mauve/15 text-mauve hover:bg-mauve/25 transition-colors font-mono text-xs"
                title={`Ingress attached — ${vm.ingress!.domain}${vm.ingress!.status ? ` (${vm.ingress!.status})` : ""}. ${vm.ingress!.dnsAction || `Add A record: ${vm.ingress!.domain} -> ${vm.ingress!.ip || "188.213.48.229"}`}. Remove the ingress before deleting this VM.`}
              >
                <Globe size={11} /> {vm.ingress!.domain}
              </a>
              <button
                onClick={() => {
                  if (confirm(`Remove ingress "${vm.ingress!.domain}" from ${vm.name}?\n\nThe VM keeps running; the domain stops routing here.`)) {
                    removeTazIngress(vm.id);
                  }
                }}
                disabled={!!admin.tazcloud.ingressBusy[vm.id]}
                className="text-mauve/70 hover:text-red transition-colors p-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Remove ingress"
              >
                {admin.tazcloud.ingressBusy[vm.id] ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
              </button>
            </span>
          );
          const renderSnapshotForm = (vmId: string) => (
            <div className="mt-3 border-t border-overlay0/10 pt-3 flex items-end gap-2 flex-wrap">
              <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
                <label className="text-md text-overlay0">Snapshot name</label>
                <input
                  type="text"
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitSnapshot(vmId); if (e.key === "Escape") setSnapshotFormFor(null); }}
                  spellCheck={false}
                  autoFocus
                  className="bg-background border border-surface0 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono focus:border-blue"
                />
                {snapshotName && !TAZ_NAME_RE.test(snapshotName.trim()) && (
                  <span className="text-xs text-red">Must match {String(TAZ_NAME_RE)} (lowercase, 3–63 chars).</span>
                )}
              </div>
              <label className="flex items-center gap-1.5 text-md text-text mb-1.5" title="Stops the VM before snapshotting for disk consistency; auto-restarts after.">
                <input
                  type="checkbox"
                  checked={snapshotStopFirst}
                  onChange={(e) => setSnapshotStopFirst(e.target.checked)}
                  className="accent-blue"
                />
                stop_first
              </label>
              <Button size="sm" variant="primary" onClick={() => submitSnapshot(vmId)} disabled={!snapshotName.trim() || !TAZ_NAME_RE.test(snapshotName.trim())}>
                <Camera size={14} className="mr-1" /> Snapshot
              </Button>
              <Button size="sm" onClick={() => setSnapshotFormFor(null)}>
                Cancel
              </Button>
            </div>
          );
          const renderIngressForm = (vmId: string) => {
            const label = ingressLabel.trim().toLowerCase();
            const labelValid = INGRESS_LABEL_RE.test(label);
            return (
              <div className="mt-3 border-t border-overlay0/10 pt-3 flex flex-col gap-2">
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="flex flex-col gap-1 flex-1 min-w-[260px]">
                    <label className="text-md text-overlay0">Subdomain</label>
                    <div className="flex items-stretch font-mono text-md">
                      <input
                        type="text"
                        value={ingressLabel}
                        onChange={(e) => setIngressLabel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") submitIngress(vmId); if (e.key === "Escape") setIngressFormFor(null); }}
                        placeholder="genie"
                        spellCheck={false}
                        autoFocus
                        className="flex-1 min-w-0 bg-background border border-surface0 rounded-l-md border-r-0 px-2.5 py-1.5 text-text outline-none focus:border-blue"
                      />
                      <span className="inline-flex items-center px-2.5 py-1.5 bg-surface0 border border-surface0 rounded-r-md text-overlay1 select-none">
                        .{INGRESS_DOMAIN_SUFFIX}
                      </span>
                    </div>
                    {ingressLabel && !labelValid && (
                      <span className="text-xs text-red italic">
                        Lowercase letters, digits, and hyphens only (1–63 chars, must start and end alphanumeric).
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 w-[120px]">
                    <label className="text-md text-overlay0">App port</label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={ingressAppPort}
                      onChange={(e) => setIngressAppPort(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitIngress(vmId); if (e.key === "Escape") setIngressFormFor(null); }}
                      className="bg-background border border-surface0 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono focus:border-blue"
                    />
                  </div>
                  <Button size="sm" variant="primary" onClick={() => submitIngress(vmId)} disabled={!labelValid || !!admin.tazcloud.ingressBusy[vmId]}>
                    {admin.tazcloud.ingressBusy[vmId] ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Globe size={14} className="mr-1" />}
                    Attach
                  </Button>
                  <Button size="sm" onClick={() => setIngressFormFor(null)}>
                    Cancel
                  </Button>
                </div>
                <p className="text-xs text-overlay0 italic">
                  A wildcard A record <span className="font-mono text-overlay1">*.{INGRESS_DOMAIN_SUFFIX}</span> at{" "}
                  <span className="font-mono text-overlay1">188.213.48.229</span> covers this — TLS is issued by Let's Encrypt within ~60s of attaching.
                </p>
              </div>
            );
          };
          return (
          <div
            className={cn(
              vmViewMode === "cards"
                ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2"
                : "flex flex-col gap-2",
            )}
          >
            {visibleVms.map((vm) => {
              const isActive = vm.status === "ACTIVE";
              const isPending = pendingDelete === vm.id;
              const isDeleting = deleting.has(vm.id);
              const isRenaming = renamingId === vm.id;
              const stats = admin.tazcloud.vmStats[vm.id];
              const statsLoading = isActive && !stats && admin.tazcloud.vmStatsLoading;
              // vCPU label from size slug if present (DO format); TazCloud sizes are word
              // labels (small/medium/...) so this gracefully no-ops.
              const vcpuMatch = vm.size?.match(/(\d+)vcpu/);
              const vcpuLabel = vcpuMatch ? `${vcpuMatch[1]}v` : undefined;
              const cardOnClick = (e: React.MouseEvent) => {
                if (vmViewMode !== "cards") return;
                if (!isActive || isRenaming || isPending || isDeleting) return;
                const target = e.target as HTMLElement;
                if (target.closest("button, a, input, select, textarea, label")) return;
                openManageVmWindow(vm);
              };
              const cardClass = cn(
                "bg-mantle rounded-lg px-3 py-2 border border-overlay0/10 transition-colors",
                vmViewMode === "cards" && isActive && !isRenaming && !isPending && !isDeleting
                  && "cursor-pointer hover:border-blue/30",
                // Locked → red-tinted border so the state is visible at a glance,
                // even before the user notices the lock badge.
                vm.locked && "border-red/40 hover:border-red/60",
              );

              // Card-mode layout: vertical sections (header / stats / meta / footer)
              // instead of the cramped horizontal flex-wrap row used for list rows.
              if (vmViewMode === "cards") {
                return (
                  <div key={vm.id} onClick={cardOnClick} className={cardClass}>
                    {isRenaming ? renderRenameInput() : (
                      <>
                        {/* Header: name (+lock) on the left, status pill on the right. */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-text truncate" title={vm.name}>{vm.name}</span>
                              {vm.locked && (
                                <span
                                  className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red/15 text-red border border-red/30"
                                  title={isSuperAdmin
                                    ? "Locked: typed-name confirmation required to delete; click the unlock icon to clear"
                                    : "Locked: only a superadmin can delete or unlock this VM"}
                                >
                                  <Lock size={10} /> locked
                                </span>
                              )}
                            </div>
                            {vm.ipv6 && (
                              <div className="flex items-center gap-1 mt-0.5 min-w-0">
                                <span className="min-w-0 truncate">
                                  <CopyableIp ip={vm.ipv6} className="text-xs text-overlay0 font-mono" />
                                </span>
                                <a
                                  href={`http://[${vm.ipv6}]`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-overlay0 hover:text-blue transition-colors shrink-0"
                                  title="Open in browser"
                                >
                                  <ExternalLink size={10} />
                                </a>
                              </div>
                            )}
                          </div>
                          {cardStatusPill(vm.status)}
                        </div>

                        {/* Stats: 3 circular gauges, evenly spread, with byte totals as subtitles. */}
                        {stats && (
                          <div className="flex items-center justify-around gap-2 mt-3 py-2 bg-base/40 rounded-md">
                            <CircularGauge
                              size={44}
                              label="CPU"
                              percent={stats.cpuPercent}
                              showPercentSign
                              subtitle={vcpuLabel}
                            />
                            <CircularGauge
                              size={44}
                              label="MEM"
                              percent={stats.memPercent}
                              showPercentSign
                              subtitle={`${formatBytesShort(stats.memUsedBytes)} / ${formatBytesShort(stats.memTotalBytes)}`}
                            />
                            <CircularGauge
                              size={44}
                              label="DISK"
                              percent={stats.diskPercent}
                              showPercentSign
                              subtitle={`${formatBytesShort(stats.diskUsedBytes)} / ${formatBytesShort(stats.diskTotalBytes)}`}
                            />
                          </div>
                        )}
                        {!stats && statsLoading && (
                          <div className="flex items-center justify-center gap-2 mt-3 py-3 text-overlay0 text-xs bg-base/40 rounded-md">
                            <Loader2 size={12} className="animate-spin" />
                            Checking stats…
                          </div>
                        )}
                        {!stats && !statsLoading && !isActive && (
                          <div className="flex items-center justify-center mt-3 py-3 text-overlay0 text-xs bg-base/40 rounded-md">
                            VM is {vm.status.toLowerCase()}
                          </div>
                        )}

                        {/* Metadata grid: label → value pairs, label-aligned column. */}
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 mt-3 text-xs">
                          {vm.image && (
                            <>
                              <span className="text-overlay0">Image</span>
                              <span className="text-subtext0 truncate">{vm.image}</span>
                            </>
                          )}
                          {vm.size && (
                            <>
                              <span className="text-overlay0">Size</span>
                              <span className="text-subtext0">{vm.size}</span>
                            </>
                          )}
                          <span className="text-overlay0">Project</span>
                          <span className="truncate">
                            {vm.projectName ? (
                              <span className="text-blue">{vm.projectName}</span>
                            ) : (
                              <AttachVmToProject provider="tazcloud" vmId={vm.id} />
                            )}
                          </span>
                          <span className="text-overlay0">ID</span>
                          <span className="text-subtext0 font-mono truncate" title={vm.id}>{vm.id.slice(0, 8)}…</span>
                          {vm.ingress && (
                            <>
                              <span className="text-overlay0">Ingress</span>
                              <span className="min-w-0">{renderIngressBadge(vm)}</span>
                            </>
                          )}
                        </div>

                        {/* Footer: ports on the left, action cluster on the right. */}
                        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-overlay0/10">
                          {stats && stats.externalPorts.length > 0 ? (
                            <div className="flex items-center gap-1 flex-wrap min-w-0">
                              {stats.externalPorts.map((port) => {
                                const url = `http://[${vm.ipv6}]:${port}`;
                                return (
                                  <a
                                    key={port}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-peach/20 text-peach text-xs font-mono hover:bg-peach/30 transition-colors"
                                    title={`Open ${url}`}
                                  >
                                    {port}<ExternalLink size={9} />
                                  </a>
                                );
                              })}
                            </div>
                          ) : <div />}
                          <div className="flex-1" />
                          {isDeleting ? (
                            <span className="inline-flex items-center gap-1 text-overlay0 text-xs">
                              <Loader2 size={12} className="animate-spin" />
                              Deleting…
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => { loadAdminTazVms(); loadAdminTazcloudStats(); }}
                                className="p-1 text-overlay0 hover:text-text transition-colors"
                                title="Refresh"
                              >
                                <RefreshCw size={13} />
                              </button>
                              {renderSshControls(vm, isActive)}
                              {renderActionsMenu(vm, isActive, isRenaming)}
                            </>
                          )}
                        </div>
                      </>
                    )}
                    {isPending && (
                      <ServerDeleteConfirm
                        name={vm.name}
                        locked={vm.locked}
                        canDeleteLocked={isSuperAdmin}
                        onConfirm={() => executeDelete(vm.id)}
                        onCancel={() => setPendingDelete(null)}
                      />
                    )}
                    {snapshotFormFor === vm.id && renderSnapshotForm(vm.id)}
                    {ingressFormFor === vm.id && renderIngressForm(vm.id)}
                  </div>
                );
              }

              // List-mode layout (unchanged): single horizontal flex-wrap row.
              return (
                <div key={vm.id} onClick={cardOnClick} className={cardClass}>
                  {isRenaming ? renderRenameInput() : (
                    <DropletInstanceBar
                      name={vm.name}
                      status={vm.status.toLowerCase()}
                      ip={vm.ipv6}
                      sizeSlug={vm.size}
                      provider="tazcloud"
                      stats={stats ?? null}
                      statsLoading={statsLoading}
                      onRefresh={() => { loadAdminTazVms(); loadAdminTazcloudStats(); }}
                      onDelete={vm.ingress ? undefined : () => confirmDelete(vm.id)}
                    />
                  )}
                  <div className="flex items-center gap-3 mt-1 text-md text-overlay0 flex-wrap">
                    {vm.image && <span>Image: <span className="text-subtext0">{vm.image}</span></span>}
                    <span>
                      Project:{" "}
                      {vm.projectName ? (
                        <span className="text-blue">{vm.projectName}</span>
                      ) : (
                        <AttachVmToProject provider="tazcloud" vmId={vm.id} />
                      )}
                    </span>
                    <span>ID: <span className="text-subtext0 font-mono">{vm.id.slice(0, 8)}…</span></span>
                    {vm.locked && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red/15 text-red border border-red/30"
                        title={isSuperAdmin
                          ? "Locked: typed-name confirmation required to delete; click the unlock icon to clear"
                          : "Locked: only a superadmin can delete or unlock this VM"}
                      >
                        <Lock size={10} /> locked
                      </span>
                    )}
                    {vm.ingress && renderIngressBadge(vm)}
                    <div className="flex-1" />
                    {isDeleting ? (
                      <span className="inline-flex items-center gap-1 text-overlay0">
                        <Loader2 size={12} className="animate-spin" />
                        Deleting…
                      </span>
                    ) : (
                      <>
                        {renderSshControls(vm, isActive)}
                        {renderActionsMenu(vm, isActive, isRenaming)}
                      </>
                    )}
                  </div>
                  {isPending && (
                    <ServerDeleteConfirm
                      name={vm.name}
                      locked={vm.locked}
                      canDeleteLocked={isSuperAdmin}
                      onConfirm={() => executeDelete(vm.id)}
                      onCancel={() => setPendingDelete(null)}
                    />
                  )}
                  {snapshotFormFor === vm.id && renderSnapshotForm(vm.id)}
                  {ingressFormFor === vm.id && renderIngressForm(vm.id)}
                </div>
              );
            })}
          </div>
          );
        })()}
      </div>

      <TazSnapshotsSection vms={vms} />

      {/* ManageVmWindows is mounted globally in app/[[...slug]]/page.tsx so the
          popup persists across navigation and can be opened from project pages. */}
    </div>
  );
}

