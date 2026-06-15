"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { Cloud, RefreshCw, Loader2, Terminal, Plus, ChevronDown, Settings as SettingsIcon, Pencil, Check, X, Lock, Unlock, Shield, Bug, Globe, Camera, Trash2, MoreVertical, Search, ExternalLink, Minus, Maximize2, Minimize2, Rocket, Unlink, Activity, Plug, Moon } from "lucide-react";
import { $admin, $auth, $manager, $persistedTerminals, $ssh, $vpsDeploy, $windowManager } from "@/store/subjects";
import type { AdminTazVm, FloatingWindowState, PersistedTerminalSession, VpsDeployState, VpsMonitorState } from "@/store/types";
import { addSshTerminalTab, adminDropletExec, adminTazcloudExec, closeWindow, createAdminTazVm, createTazProject, createTazSnapshot, deleteAdminTazVm, deleteTazProject, deleteTazSnapshot, disconnectVps, fetchVpsStats, focusWindow, hibernateVps, killPersistedTerminal, loadAdminTazVms, loadAdminTazcloudStats, loadPersistedTerminals, loadTazCapabilities, loadTazProjects, loadTazSnapshots, lockAdminTazVm, minimizeWindow, openWindow, reattachPersistedTerminal, registerTazIngress, registerWindow, removeTazIngress, renameAdminTazVm, startSecurityScan, switchNav, unlockAdminTazVm, updateWindowPosition, vpsExec } from "@/store/actions";
import { useDraggable, useResizable } from "@/hooks/use-draggable";
import { ClaudeLogo, VpsFirewall } from "@/components/project/project-detail";
import { AdminRecipesPanel } from "@/components/admin/admin-recipes-panel";
import { AdminSystemPanel, VpsProcessesPanel } from "@/components/admin/admin-system-panel";
import { vpsStatsToBarStats, isPrivateHostAddress } from "@/components/project/vps-resource-gauges";
import { AttachVmToProject } from "@/components/project/attach-vm-to-project";
import { CloudVmResourceBlock } from "@/components/cloud/cloud-vm-resource-block";
import { findLinkedInstance, vpsMetricKey } from "@/lib/cloud-vm-metrics";
import { ServerDeleteConfirm } from "@/components/ui/server-delete-confirm";
import { FileExplorer } from "@/components/project/vps-file-explorer";
import { DbExplorer } from "@/components/admin/db-explorer";
import { CommandsTab } from "@/components/project/project-detail";
import { $projects } from "@/store/subjects";
import { FolderTree, Database as DatabaseIcon, PlayCircle, Network, Cpu } from "lucide-react";
import { useDeepSubjectAll, useIsWindowFocused } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ErrorMessage } from "@/components/ui/error-message";
import { IMAGES, SIZES, TAZ_NAME_RE, defaultSshUserFor, defaultVmBootSource, defaultVmName, imageDefaultUser, parseVmBootSource, validateTazVmName } from "../tazcloud/helpers";
import { TazSnapshotsSection } from "../tazcloud/taz-snapshots-section";
import { openManageVmWindow } from "../tazcloud/manage-vm-popup";
import { ServerTunnelIndicator } from "../tazcloud/server-tunnel-indicator";
import { VM_HOST_SSH_REFRESH_MS } from "../tazcloud/vm-host-connections-panel";
import { loadSshSessions } from "@/store/actions/ssh";

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
/** Panel-wide stats poll. SSH sessions are cached server-side; 60s keeps Taz
 *  bastion rate-limits happy vs the old 30s cadence. */
const TAZ_STATS_POLL_MS = 60_000;

// IMAGES / SIZES / imageDefaultUser / defaultSshUserFor / defaultVmName /
// validateTazVmName moved to ./tazcloud/helpers.ts so taz-snapshots-section.tsx
// and the manage popup cluster can reuse them without re-importing the whole
// panel.

export function TazCloudPanel({ monitor }: { monitor: VpsMonitorState }) {
  const admin = useDeepSubjectAll($admin);
  const vpsDeploy = useDeepSubjectAll<VpsDeployState>($vpsDeploy);
  const [auth] = useSubject($auth);
  const [ssh] = useSubject($ssh);
  // Used by the per-row "Detach from project" action to resolve the project's
  // internal vpsInstance id (which the server's `vps:disconnect` handler needs)
  // from the admin-view `vm.id` (which is the TazCloud-side VM id).
  const [projects] = useSubject($projects);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [deployOpen, setDeployOpen] = useState(false);
  const [vmName, setVmName] = useState(defaultVmName());
  const [vmBootSource, setVmBootSource] = useState(defaultVmBootSource());
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
  // The SSH registry (ssh:list) is the manager's global, cross-tenant connection
  // pool — admin-only by ACL. tazcloud can use this panel but must NOT poll it,
  // or every tick is rejected with an `error:forbidden`.
  const canViewSshRegistry = role === "admin" || role === "superadmin";

  const baseImages = useMemo(
    () => (admin.tazcloud.capabilityImages.length > 0 ? admin.tazcloud.capabilityImages : IMAGES),
    [admin.tazcloud.capabilityImages],
  );
  const bootSnapshots = useMemo(
    () => admin.tazcloud.snapshots.filter((s) => s.status === "active"),
    [admin.tazcloud.snapshots],
  );

  useEffect(() => {
    if (!canAccess) return;
    loadAdminTazVms();
    loadTazSnapshots();
    loadTazCapabilities();
    // v2.0.0: projects are mandatory. Empty list on legacy v6 tenants — handled
    // gracefully in the UI (the Projects section just doesn't render).
    loadTazProjects();
  }, [canAccess]);

  // Live SSH registry — drives per-VM tunnel icon on each card. Admin-only: the
  // registry is the global cross-tenant SSH pool, so tazcloud doesn't poll it
  // (the icon just won't reflect tunnel state for them).
  useEffect(() => {
    if (!canViewSshRegistry) return;
    loadSshSessions();
    const id = window.setInterval(() => loadSshSessions({ silent: true }), VM_HOST_SSH_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [canViewSshRegistry]);

  // Linked VMs: live gauges via daemon postback (useCloudsMonitor → watchVpsStats).
  // Unlinked VMs: no fleet SSH probe unless NEXT_PUBLIC_GENIE_SSH_STATS_PROBE=1.

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
      loadTazSnapshots();
      loadTazProjects();
      loadTazCapabilities();
      if (canViewSshRegistry) loadSshSessions();
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

  const vxlanVmGroups = useMemo(() => {
    const projects = admin.tazcloud.projects;
    if (projects.length === 0) return null;

    const q = vmSearch.trim().toLowerCase();
    const filtered = q ? vms.filter((v) => v.name.toLowerCase().includes(q)) : vms;
    const byVxlan = new Map<string, AdminTazVm[]>();
    const unassigned: AdminTazVm[] = [];

    for (const vm of filtered) {
      if (vm.tazProjectId) {
        const list = byVxlan.get(vm.tazProjectId) ?? [];
        list.push(vm);
        byVxlan.set(vm.tazProjectId, list);
      } else {
        unassigned.push(vm);
      }
    }

    type VmGroup = { id: string; name: string; subnetCidr?: string; vms: AdminTazVm[] };
    const groups: VmGroup[] = [];

    for (const p of projects) {
      if (!q || (byVxlan.get(p.id)?.length ?? 0) > 0) {
        groups.push({
          id: p.id,
          name: p.name,
          subnetCidr: p.subnetCidr,
          vms: byVxlan.get(p.id) ?? [],
        });
      }
      byVxlan.delete(p.id);
    }

    for (const [id, sectionVms] of byVxlan) {
      if (sectionVms.length > 0) {
        groups.push({ id, name: id.slice(0, 8), vms: sectionVms });
      }
    }

    if (unassigned.length > 0) {
      groups.push({ id: "__unassigned", name: "Unassigned", vms: unassigned });
    }

    return groups;
  }, [admin.tazcloud.projects, vms, vmSearch]);

  function confirmDelete(vmId: string) {
    setPendingDelete(vmId);
  }

  function submitCreate() {
    const trimmed = vmName.trim();
    if (validateTazVmName(trimmed)) return;
    const source = parseVmBootSource(vmBootSource);
    if (!source) return;
    createAdminTazVm({
      name: trimmed,
      size: vmSize,
      ...(source.kind === "snapshot"
        ? { snapshot_id: source.snapshotId }
        : { image: source.image }),
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
      setVmBootSource(defaultVmBootSource(baseImages));
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
        <div className="flex-1" />
        <Button size="sm" variant={deployOpen ? "active" : "primary"} onClick={toggleDeploy}>
          <Plus size={14} className="mr-1" />
          {deployOpen ? "Cancel" : "Deploy VM"}
        </Button>
        <Button size="sm" onClick={() => loadAdminTazVms()} disabled={loading}>
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
            <Select
              value={vmBootSource}
              onChange={(e) => setVmBootSource(e.target.value)}
              disabled={creating}
              className="py-1.5 text-md font-sans"
            >
              <optgroup label="Base images">
                {baseImages.map((img) => (
                  <option key={img} value={`base:${img}`}>{img}</option>
                ))}
              </optgroup>
              {bootSnapshots.length > 0 && (
                <optgroup label="Snapshots">
                  {bootSnapshots.map((s) => (
                    <option key={s.id} value={`snapshot:${s.id}`}>{s.name}</option>
                  ))}
                </optgroup>
              )}
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
              const vmCount = p.vmCount ?? vms.filter((v) => v.tazProjectId === p.id).length;
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
          const flatVisibleVms = q ? vms.filter((v) => v.name.toLowerCase().includes(q)) : vms;
          const visibleVmCount = vxlanVmGroups
            ? vxlanVmGroups.reduce((n, g) => n + g.vms.length, 0)
            : flatVisibleVms.length;
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
          if (visibleVmCount === 0) {
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
          const renderVmCard = (vm: AdminTazVm) => {
              const isActive = vm.status === "ACTIVE";
              const isPending = pendingDelete === vm.id;
              const isDeleting = deleting.has(vm.id);
              const isRenaming = renamingId === vm.id;
              const adminStats = isActive ? admin.tazcloud.vmStats[vm.id] : null;
              const adminStatsError = isActive ? admin.tazcloud.vmStatsErrors[vm.id] : null;
              const link = findLinkedInstance(projects, { tazVmId: vm.id });
              const streamStats = link ? vpsDeploy.instances[link.instanceId]?.stats ?? null : null;
              const streamError = link ? vpsDeploy.instances[link.instanceId]?.statsError ?? null : null;
              const vmStats = streamStats ?? adminStats;
              const vmStatsError = streamStats ? null : (streamError ?? adminStatsError);
              const vmStatsLoading = isActive && !vmStats && !vmStatsError;
              const historyKey = link ? vpsMetricKey(link.projectId, link.instanceId) : null;
              const cardOnClick = (e: React.MouseEvent) => {
                if (!isActive || isRenaming || isPending || isDeleting) return;
                const target = e.target as HTMLElement;
                if (target.closest("button, a, input, select, textarea, label")) return;
                openManageVmWindow(vm);
              };
              const cardClass = cn(
                "bg-mantle rounded-lg px-3 py-2 border border-overlay0/10 transition-colors",
                isActive && !isRenaming && !isPending && !isDeleting
                  && "cursor-pointer hover:border-blue/30",
                vm.locked && "border-red/40 hover:border-red/60",
              );

              return (
                <div key={vm.id} onClick={cardOnClick} className={cardClass}>
                  {isRenaming ? renderRenameInput() : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-text truncate" title={vm.name}>{vm.name}</span>
                            {isActive && vm.ipv6 && (
                              <ServerTunnelIndicator
                                host={vm.ipv6}
                                sessions={ssh.sessions}
                                loading={ssh.loading && ssh.sessions.length === 0}
                              />
                            )}
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
                        </div>
                        {cardStatusPill(vm.status)}
                      </div>

                      {isActive && vm.ipv6 && (
                        <CloudVmResourceBlock
                          host={vm.ipv6}
                          ipv6
                          isPrivateHost={vm.isPrivateHost ?? isPrivateHostAddress(vm.ipv6)}
                          domain={
                            vm.ingress
                              ? { name: vm.ingress.domain, url: vm.ingress.url }
                              : null
                          }
                          stats={vmStats ? vpsStatsToBarStats(vmStats) : null}
                          statsLoading={vmStatsLoading}
                          statsError={vmStatsError ?? undefined}
                          onRefresh={() => {
                            if (link) fetchVpsStats(link.projectId, link.instanceId);
                            else loadAdminTazcloudStats();
                          }}
                          refreshLoading={vmStatsLoading}
                          history={historyKey ? monitor.history[historyKey] : undefined}
                          hours={monitor.hours}
                        />
                      )}

                      {!isActive && (
                        <div className="flex items-center justify-center mt-3 py-3 text-overlay0 text-xs bg-base/40 rounded-md">
                          VM is {vm.status.toLowerCase()}
                        </div>
                      )}

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
                        <span className="text-overlay0">Genie</span>
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

                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-overlay0/10">
                        <div className="flex-1" />
                        {isDeleting ? (
                          <span className="inline-flex items-center gap-1 text-overlay0 text-xs">
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
          };
          const renderVmGrid = (vmList: AdminTazVm[]) => (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {vmList.map(renderVmCard)}
            </div>
          );
          if (vxlanVmGroups) {
            return (
              <div className="space-y-5">
                {vxlanVmGroups.map((group) => (
                  <section key={group.id}>
                    <div className="flex items-center gap-2 mb-2 px-0.5">
                      <Network size={13} className="text-blue shrink-0" />
                      <span className="text-md font-medium text-text">{group.name}</span>
                      {group.subnetCidr && (
                        <span className="text-overlay0 font-mono text-xs">{group.subnetCidr}</span>
                      )}
                      <span className="text-xs text-overlay0">
                        {group.vms.length} VM{group.vms.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {group.vms.length === 0 ? (
                      <div className="text-md text-overlay0 italic py-4 px-1 border border-dashed border-overlay0/20 rounded-lg">
                        No VMs in this VXLAN.
                      </div>
                    ) : (
                      renderVmGrid(group.vms)
                    )}
                  </section>
                ))}
              </div>
            );
          }
          return renderVmGrid(flatVisibleVms);
        })()}
      </div>

      <TazSnapshotsSection vms={vms} />

      {/* ManageVmWindows is mounted globally in app/[[...slug]]/page.tsx so the
          popup persists across navigation and can be opened from project pages. */}
    </div>
  );
}

