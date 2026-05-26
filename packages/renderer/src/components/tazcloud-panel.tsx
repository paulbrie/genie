"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { Cloud, RefreshCw, Loader2, Terminal, Plus, ChevronDown, Settings as SettingsIcon, Pencil, Check, X, Lock, Unlock, Shield, Bug, Globe, Camera, Trash2, MoreVertical, LayoutGrid, List as ListIcon, Search, ExternalLink, Minus, Maximize2, Minimize2, Rocket, Unlink, Activity, Plug, Moon } from "lucide-react";
import { $admin, $auth, $manager, $persistedTerminals, $vpsDeploy, $windowManager } from "@/store/subjects";
import type { AdminTazVm, FloatingWindowState, PersistedTerminalSession, VpsDeployState } from "@/store/types";
import { addSshTerminalTab, adminDropletExec, adminTazcloudExec, closeWindow, createAdminTazVm, createTazProject, createTazSnapshot, deleteAdminTazVm, deleteTazProject, deleteTazSnapshot, disconnectVps, focusWindow, hibernateVps, killPersistedTerminal, loadAdminTazVms, loadAdminTazcloudStats, loadPersistedTerminals, loadTazProjects, loadTazSnapshots, lockAdminTazVm, minimizeWindow, openWindow, reattachPersistedTerminal, registerTazIngress, registerWindow, removeTazIngress, renameAdminTazVm, startSecurityScan, switchNav, unlockAdminTazVm, updateWindowPosition, vpsExec } from "@/store/actions";
import { useDraggable, useResizable } from "@/components/use-draggable";
import { ClaudeLogo, VpsFirewall } from "@/components/project-detail";
import { AdminRecipesPanel } from "@/components/admin-recipes-panel";
import { AdminSystemPanel, VpsProcessesPanel } from "@/components/admin-system-panel";
import { VpsResourceGauges } from "@/components/vps-resource-gauges";
import { AttachVmToProject } from "@/components/attach-vm-to-project";
import { DropletInstanceBar } from "@/components/droplet-instance-bar";
import { ServerDeleteConfirm } from "@/components/server-delete-confirm";
import { FileExplorer } from "@/components/vps-file-explorer";
import { DbExplorer } from "@/components/db-explorer";
import { CommandsTab } from "@/components/project-detail";
import { $projects } from "@/store/subjects";
import { FolderTree, Database as DatabaseIcon, PlayCircle, Network, Cpu } from "lucide-react";
import { CircularGauge } from "@/components/ui/circular-gauge";
import { CopyableIp } from "@/components/ui/copyable-ip";
import { useDeepSubjectAll, useIsWindowFocused } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ErrorMessage } from "@/components/ui/error-message";

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

const IMAGES = ["ubuntu-22", "ubuntu-24", "debian-12", "almalinux-9"];
const SIZES = ["small", "medium", "large", "xlarge"];

// Ingress is locked to the Genie-owned zone — a wildcard A record covers it
// at the DNS level, so attaching a new VM is a one-field operation.
const INGRESS_DOMAIN_SUFFIX = "cloud.teleporthq.ai";
const INGRESS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Image-default SSH user — the one TazCloud injects the key into. Always exists,
 *  regardless of whether Genie's bootstrap has run on this VM. */
function imageDefaultUser(image?: string): string {
  switch (image) {
    case "ubuntu-22":
    case "ubuntu-24": return "ubuntu";
    case "debian-12": return "debian";
    case "almalinux-9": return "almalinux";
    default: return "ubuntu";  // best guess when image is unknown (listVms doesn't return it)
  }
}

/** SSH user the user probably wants for an interactive session. Order of
 *  inference:
 *    1. v2.0.0 vxlan-bastion VMs (`sshBastion` set) — `genie` is the **only**
 *       user; image-default users don't exist there.
 *    2. Project-linked VMs (any provider/mode) — Genie's deploy flow creates
 *       a `genie` user.
 *    3. Otherwise — image-default user (legacy v6 bare VMs).
 *  Users can override via the dropdown if the heuristic is wrong. */
function defaultSshUserFor(vm: { image?: string; projectId: string | null; sshBastion?: string | null }): string {
  if (vm.sshBastion) return "genie";
  if (vm.projectId) return "genie";
  return imageDefaultUser(vm.image);
}

function defaultVmName(): string {
  // taz-<yyyymmddhhmm>-<3-char-random>
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
  const rand = Math.random().toString(36).slice(2, 5);
  return `taz-${ts}-${rand}`;
}

// Must match the API's rule: starts lowercase letter, ends lowercase letter or
// digit, body of lowercase letters/digits/hyphens, total length 3–63.
const TAZ_NAME_RE = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/;

function validateTazVmName(name: string): string | null {
  if (!name) return "Name is required.";
  if (name.length < 3) return "Name must be at least 3 characters.";
  if (name.length > 63) return "Name must be at most 63 characters.";
  if (!TAZ_NAME_RE.test(name)) {
    return "Name must be lowercase, start with a letter, end with a letter or digit, and contain only letters, digits, and hyphens.";
  }
  return null;
}

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

  function openSshTerminal(vm: { id: string; name: string; ipv6: string; status: string; image?: string; projectId: string | null; sshBastion?: string | null }, userOverride?: string) {
    if (!vm.ipv6 || vm.status !== "ACTIVE") return;
    const username = userOverride ?? defaultSshUserFor(vm);
    // v2.0.0: ipv6 here is actually the private 10.128.x.y address — only
    // reachable via ProxyJump through `sshBastion`. Without this, the terminal
    // would try a direct connection to the VLAN address and time out.
    const bastion = vm.sshBastion ? parseBastion(vm.sshBastion) : undefined;
    addSshTerminalTab(
      {
        host: vm.ipv6,
        port: 22,
        username,
        privateKeyPath: "~/.genie/ssh/tazcloud_ed25519",
        ...(bastion ? { bastion } : {}),
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
    if (!name || !TAZ_NAME_RE.test(name)) return;
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
                "bg-mantle rounded-lg px-3 py-2 border border-overlay0/10",
                vmViewMode === "cards" && isActive && !isRenaming && !isPending && !isDeleting
                  && "cursor-pointer hover:border-blue/30 transition-colors",
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
                                  className="shrink-0 text-red inline-flex"
                                  title={isSuperAdmin
                                    ? "Locked: typed-name confirmation required to delete"
                                    : "Locked: only a superadmin can delete or unlock this VM"}
                                >
                                  <Lock size={11} />
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
                        className="inline-flex items-center gap-1 text-red"
                        title={isSuperAdmin
                          ? "Locked: typed-name confirmation required to delete; click the unlock icon to clear"
                          : "Locked: only a superadmin can delete or unlock this VM"}
                      >
                        <Lock size={11} /> locked
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

const MANAGE_VM_WINDOW_PREFIX = "manage-vm-";
/** Default size + cascade offset for any Manage popup variant. Exported so the
 *  DO panel (and any future provider) can keep its popup consistent with Taz. */
export const MANAGE_VM_DEFAULT_W = 900;
export const MANAGE_VM_DEFAULT_H = 600;
export const MANAGE_VM_CASCADE_OFFSET = 30;

/** Open the Manage popup for a TazCloud VM. Exported so project pages can
 *  trigger the same popup with data derived from a project's VpsInstance —
 *  the popup itself looks up vm details from `$admin.tazcloud.vms` first and
 *  falls back to `$projects` (see ManageVmWindowInstance). */
export function openManageVmWindow(vm: { id: string; name: string }) {
  const wid = MANAGE_VM_WINDOW_PREFIX + vm.id;
  registerWindow(wid, `Manage ${vm.name}`, "settings");
  openWindow(wid);
  focusWindow(wid);
}

export type ManageVmProvider = "tazcloud" | "do";

/** Provider-agnostic shape consumed by ManageVmInline + the floating popup.
 *  `host` is whatever address SSH should target — IPv6 for legacy TazCloud
 *  VMs, IPv4 for DigitalOcean droplets, and a private 10.x for Taz vxlan-
 *  bastion VMs (in which case `sshBastion` is set and the manager opens the
 *  SSH session via ProxyJump). */
export interface ManageVm {
  id: string;
  name: string;
  host: string;
  image?: string;
  projectId: string | null;
  provider: ManageVmProvider;
  ingress?: { domain: string; url?: string } | null;
  /** True when `host` is an RFC1918 address — UI suppresses the unreachable
   *  http://host:port link in that case. */
  isPrivateHost?: boolean;
  /** "user@host" form of the ProxyJump bastion. Present on Taz vxlan-bastion
   *  VMs. Required for the manager to reach the VM at all. */
  sshBastion?: string | null;
}

/** Human-readable cloud provider name, shown in the Manage popup title bar. */
function providerLabel(provider: ManageVmProvider): string {
  return provider === "do" ? "DigitalOcean" : "TazCloud";
}

/** SSH key file used to log in to a provider's VMs. The manager rolls a
 *  separate key per provider so a TazCloud key compromise doesn't trample DO. */
function sshKeyPathFor(provider: ManageVmProvider): string {
  return provider === "tazcloud" ? "~/.genie/ssh/tazcloud_ed25519" : "~/.genie/ssh/genie_ed25519";
}

/** Default SSH user candidates shown in the SSH split-button dropdown. */
function sshUserChoicesFor(vm: ManageVm): string[] {
  if (vm.provider === "do") return ["genie", "root"];
  return ["genie", "ubuntu", "debian", "almalinux", "root"];
}

/** Bind an exec function to this VM. Hides the provider-specific WS call shape
 *  so child panels (recipes, system, firewall) can just call `exec(cmd)`.
 *  Passes `vm.sshBastion` straight through so the server can skip the per-call
 *  `/v1/vm/{id}` round-trip used to discover the bastion. */
function makeVmExec(vm: ManageVm, sshUser: string) {
  if (vm.provider === "tazcloud") {
    return (command: string, onChunk?: (chunk: string) => void, signal?: AbortSignal) =>
      adminTazcloudExec(vm.id, sshUser, command, vm.host, onChunk, signal, vm.sshBastion);
  }
  // DigitalOcean: exec runs as `genie` server-side; the username is fixed and
  // the dropletId is a number, so we ignore sshUser and stringify back to int.
  return (command: string, onChunk?: (chunk: string) => void, signal?: AbortSignal) =>
    adminDropletExec(Number(vm.id), command, onChunk, signal);
}

/** Claude Terminal button for the Manage tab. For TazCloud VMs we probe whether
 *  the genie deploy user is set up before deciding which SSH user to run as —
 *  on a fresh VM, only the image-default user exists. DigitalOcean droplets are
 *  provisioned by Genie itself with the genie user, so no probe is needed there. */
function ClaudeManageButton({ vm }: { vm: ManageVm }) {
  // v2.0.0 vxlan-bastion VMs ship with `genie` baked into the image and no
  // image-default user — so we both know the right SSH user up-front (genie)
  // and must probe AS genie. Probing as `ubuntu`/`debian` would auth-fail
  // before the script runs.
  const isV2 = !!vm.sshBastion;
  // `null` while probing; `true` if genie is ready; `false` otherwise. For DO,
  // we know the user is provisioned so we skip the probe entirely.
  const [genieReady, setGenieReady] = useState<boolean | null>(vm.provider === "do" ? true : null);

  useEffect(() => {
    if (vm.provider === "do") { setGenieReady(true); return; }
    let cancelled = false;
    const probeUser = isV2 ? "genie" : imageDefaultUser(vm.image);
    // -n: non-interactive sudo so it fails fast if a password is required.
    // The /home/genie/.ssh dir is mode 700, hence the sudo.
    const script = `if id genie >/dev/null 2>&1 && sudo -n test -s /home/genie/.ssh/authorized_keys && command -v claude >/dev/null 2>&1; then echo "GENIE_READY"; else echo "NO_GENIE"; fi`;
    adminTazcloudExec(vm.id, probeUser, script, vm.host).then((res) => {
      if (cancelled) return;
      const last = res.output.trim().split("\n").pop()?.trim();
      setGenieReady(last === "GENIE_READY");
    });
    return () => { cancelled = true; };
  }, [vm.id, vm.image, vm.host, vm.provider, isV2]);

  const pending = genieReady === null;
  // On v2, fall back to `genie` even if the probe failed — `imageDefault` users
  // (ubuntu/debian/almalinux) don't exist there at all.
  const sshUser = genieReady ? "genie" : (isV2 ? "genie" : imageDefaultUser(vm.image));

  const launch = () => {
    if (pending) return;
    addSshTerminalTab(
      {
        host: vm.host,
        port: 22,
        username: sshUser,
        privateKeyPath: sshKeyPathFor(vm.provider),
        ...(vm.sshBastion ? { bastion: parseBastion(vm.sshBastion) } : {}),
      },
      `Claude ${sshUser}@${vm.name}`,
      // Start in /opt/project — that's the canonical project root that
      // Genie Standard Setup chowns to genie and that every recipe (Next.js
      // scaffold, MCP config, .git-credentials target) operates on. Without
      // the cd, claude opens in the SSH user's home (/home/genie) and any
      // /init produces a CLAUDE.md in the wrong place.
      "cd /opt/project && claude --dangerously-skip-permissions",
    );
  };

  return (
    <button
      onClick={launch}
      disabled={pending}
      className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-peach/30 text-md text-peach hover:bg-peach/10 transition-colors disabled:opacity-40 disabled:cursor-wait"
      title={pending ? "Checking Genie Setup…" : `Launch Claude Terminal — ${sshUser}@${vm.host}`}
    >
      {pending ? <Loader2 size={11} className="animate-spin" /> : <ClaudeLogo size={11} />}
      Claude
    </button>
  );
}

/** Parse Taz's "user@host" bastion string into the SshConfig.bastion shape.
 *  Honours the username the API returns (`almalinux@188.213.48.230` today).
 *  Authentication is via the per-customer key set in the manager env as
 *  `TAZCLOUD_BASTION_PRIVATE_KEY`. */
function parseBastion(b: string): { host: string; port?: number; username: string } | undefined {
  const m = b.match(/^([^@]+)@(.+)$/);
  if (!m) return undefined;
  return { username: m[1], host: m[2], port: 22 };
}

/** SSH-launch split-button for the Manage tab. Click the body → open a terminal
 *  as `genie` (the deploy user); click the chevron → pick a different login. */
function SshLaunchButton({ vm }: { vm: ManageVm }) {
  const [menuOpen, setMenuOpen] = useState(false);
  if (!vm.host) return null;
  const openSsh = (user: string) => {
    addSshTerminalTab(
      {
        host: vm.host,
        port: 22,
        username: user,
        privateKeyPath: sshKeyPathFor(vm.provider),
        ...(vm.sshBastion ? { bastion: parseBastion(vm.sshBastion) } : {}),
      },
      `SSH ${user}@${vm.name}`,
    );
  };
  const defaultUser = "genie";
  const imageDefault = imageDefaultUser(vm.image);
  const userChoices = sshUserChoicesFor(vm);
  return (
    <div className="relative inline-flex items-stretch">
      <button
        onClick={() => openSsh(defaultUser)}
        className="flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-l border border-r-0 border-blue/30 text-md text-blue hover:bg-blue/10 transition-colors"
        title={`Open SSH terminal — ${defaultUser}@${vm.host}`}
      >
        <Terminal size={11} />
        SSH
      </button>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center px-1 rounded-r border border-blue/30 text-blue hover:bg-blue/10 transition-colors"
        title="Choose SSH user"
      >
        <ChevronDown size={11} />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-mantle border border-overlay0/30 rounded-md shadow-lg py-1 min-w-[160px]">
            {userChoices.map((u) => {
              const isDefault = u === defaultUser;
              const isImage = u === imageDefault;
              return (
                <button
                  key={u}
                  onClick={() => { setMenuOpen(false); openSsh(u); }}
                  className="w-full text-left px-3 py-1 text-md hover:bg-surface0 font-mono flex items-center gap-2"
                >
                  <span>{u}</span>
                  {isDefault && <span className="text-overlay0 text-xs">default</span>}
                  {!isDefault && isImage && <span className="text-overlay0 text-xs">image</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Draggable popup wrapper around ManageVmInline. Replaces the modal so admins
 *  can keep multiple manage panels open side-by-side and still see the VM list
 *  beneath them. Uses the shared window-manager so it cascades against other
 *  popups and shows up in the window toolbar. */
export function ManageVmPopup({ vm, windowId, windowState }: {
  vm: ManageVm;
  windowId: string;
  windowState: FloatingWindowState;
}) {
  const [maximized, setMaximized] = useState(false);
  const [windowManager] = useSubject($windowManager);
  const allWindows = windowManager.windows;
  const storedPos = windowState.position;

  const initial = useMemo(() => {
    if (storedPos.x >= 0 && storedPos.y >= 0) return storedPos;
    const takenPositions = Object.values(allWindows)
      .filter((w) => w.id !== windowId && w.status === "open" && w.position.x >= 0)
      .map((w) => w.position);
    let pos = {
      x: Math.max(window.innerWidth / 2 - MANAGE_VM_DEFAULT_W / 2, 20),
      y: Math.max(window.innerHeight / 2 - MANAGE_VM_DEFAULT_H / 2, 20),
    };
    while (takenPositions.some((p) => Math.abs(p.x - pos.x) < 20 && Math.abs(p.y - pos.y) < 20)) {
      pos = { x: pos.x + MANAGE_VM_CASCADE_OFFSET, y: pos.y + MANAGE_VM_CASCADE_OFFSET };
    }
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (storedPos.x < 0 || storedPos.y < 0) updateWindowPosition(windowId, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragEnd = useCallback(
    (pos: { x: number; y: number }) => updateWindowPosition(windowId, pos),
    [windowId]
  );

  const { elRef, onPointerDown } = useDraggable(initial, handleDragEnd);
  const { onResizePointerDown } = useResizable(elRef, { w: MANAGE_VM_DEFAULT_W, h: MANAGE_VM_DEFAULT_H });

  const containerStyle: React.CSSProperties = maximized
    ? { left: 0, top: 0, width: "100vw", height: "100vh", zIndex: windowState.zIndex }
    : { left: initial.x, top: initial.y, width: MANAGE_VM_DEFAULT_W, height: MANAGE_VM_DEFAULT_H, zIndex: windowState.zIndex };

  // Focus is implicit: the open window with the highest zIndex is on top.
  // Visually highlight it so the user can tell which popup their keystrokes
  // and actions target when several popups are stacked.
  const isFocused = useIsWindowFocused(windowState);

  return createPortal(
    <div
      ref={elRef}
      className={cn(
        "fixed bg-mantle border flex flex-col transition-[border-color,box-shadow] duration-150 overflow-hidden",
        maximized ? "rounded-none" : "rounded-lg",
        isFocused
          ? "border-blue/60 shadow-2xl shadow-blue/20"
          : "border-surface0 shadow-2xl shadow-black/50",
      )}
      style={containerStyle}
      onPointerDown={() => focusWindow(windowId)}
    >
      <div
        className="flex items-center gap-2 px-4 py-3 border-b border-surface0 cursor-grab active:cursor-grabbing select-none shrink-0"
        onPointerDown={maximized ? undefined : onPointerDown}
      >
        <SettingsIcon size={14} className="text-blue shrink-0" />
        <span className="text-text font-medium text-md">Manage</span>
        <span className="text-overlay0 text-md font-mono truncate">{vm.name}</span>
        <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-medium bg-surface0 text-subtext0">{providerLabel(vm.provider)}</span>
        <div className="flex-1" />
        <button onClick={() => minimizeWindow(windowId)} className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer p-1" title="Minimize">
          <Minus size={14} />
        </button>
        <button onClick={() => setMaximized((v) => !v)} className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer p-1" title={maximized ? "Restore" : "Maximize"}>
          {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button onClick={() => closeWindow(windowId)} className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer p-1" title="Close">
          <X size={14} />
        </button>
      </div>
      <div className="overflow-y-auto px-4 py-3 flex-1">
        <ManageVmInline vm={vm} />
      </div>
      {!maximized && (
        <div
          className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
          onPointerDown={onResizePointerDown}
        />
      )}
    </div>,
    document.body
  );
}

function ManageVmWindowInstance({ windowId }: { windowId: string }) {
  const [windowManager] = useSubject($windowManager);
  const adminVms = useDeepSubjectAll($admin).tazcloud.vms;
  const [projects] = useSubject($projects);
  const windowState = windowManager.windows[windowId];
  const vmId = windowId.slice(MANAGE_VM_WINDOW_PREFIX.length);

  // Try admin source first (TazCloud panel context). If not found there, derive
  // a ManageVm shape from a project-attached instance — lets the same popup
  // open from project pages without re-implementing the window machinery.
  //
  // CAREFUL: dep on primitive fields, NOT on the source arrays. The $projects
  // / $admin subjects emit new array references on every WS broadcast (stats
  // pings every few seconds), so depending on the arrays would mint a new `vm`
  // each tick, which propagates as a prop change to ManageVmInline and resets
  // its child effects (re-running recipe checks, etc.). The primitive deps
  // ensure a stable identity until the actual data changes.
  const adminVm = adminVms.find((v) => v.id === vmId) ?? null;
  const adminName = adminVm?.name ?? "";
  const adminIpv6 = adminVm?.ipv6 ?? "";
  const adminImage = adminVm?.image;
  const adminProjectId = adminVm?.projectId ?? null;
  const adminIngressDomain = adminVm?.ingress?.domain ?? null;
  const adminIngressUrl = adminVm?.ingress?.url ?? null;
  const adminIsPrivateHost = adminVm?.isPrivateHost === true;
  const adminSshBastion = adminVm?.sshBastion ?? null;

  let projInst: { label: string; ipv6: string; image?: string; projectId: string } | null = null;
  if (!adminVm) {
    for (const p of projects) {
      const inst = p.vpsInstances.find((i) => i.tazcloud?.vmId === vmId);
      if (inst && inst.tazcloud) {
        projInst = {
          label: inst.label,
          ipv6: inst.tazcloud.ipv6 || inst.connection.host,
          image: inst.tazcloud.image,
          projectId: p.id,
        };
        break;
      }
    }
  }
  const projLabel = projInst?.label ?? "";
  const projIpv6 = projInst?.ipv6 ?? "";
  const projImage = projInst?.image;
  const projProjectId = projInst?.projectId ?? null;

  const vm = useMemo<ManageVm | null>(() => {
    if (adminVm) {
      return {
        id: vmId,
        name: adminName,
        host: adminIpv6,
        image: adminImage,
        projectId: adminProjectId,
        provider: "tazcloud",
        ingress: adminIngressDomain
          ? { domain: adminIngressDomain, url: adminIngressUrl ?? undefined }
          : null,
        isPrivateHost: adminIsPrivateHost,
        sshBastion: adminSshBastion,
      };
    }
    if (projInst) {
      return { id: vmId, name: projLabel, host: projIpv6, image: projImage, projectId: projProjectId, provider: "tazcloud" };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmId, !!adminVm, adminName, adminIpv6, adminImage, adminProjectId, adminIngressDomain, adminIngressUrl, adminIsPrivateHost, adminSshBastion, !!projInst, projLabel, projIpv6, projImage, projProjectId]);

  // Defensive cache: if `vm` momentarily resolves to null (e.g. while the admin
  // VM list is being refreshed after a stale broadcast on navigation), keep the
  // last known shape so the popup doesn't unmount its children. Unmount/remount
  // would reset all per-mount state inside ManageVmInline — recipe auto-checks,
  // VpsResourceGauges polling, etc. — which the user perceives as the popup
  // being "reset" every time the URL changes.
  const lastVmRef = useRef<ManageVm | null>(null);
  if (vm) lastVmRef.current = vm;
  const renderVm = vm ?? lastVmRef.current;

  if (!windowState || windowState.status !== "open" || !renderVm) return null;
  return <ManageVmPopup vm={renderVm} windowId={windowId} windowState={windowState} />;
}

export function ManageVmWindows() {
  const [windowManager] = useSubject($windowManager);
  const windowIds = Object.keys(windowManager.windows).filter((id) => id.startsWith(MANAGE_VM_WINDOW_PREFIX));
  return (
    <>
      {windowIds.map((id) => (
        <ManageVmWindowInstance key={id} windowId={id} />
      ))}
    </>
  );
}


/** List of all TazCloud snapshots — across every VM, since the API doesn't
 *  scope listSnapshots() per VM. Source VM names resolved from the current VM
 *  list when possible (snapshot's source VM may have been deleted). */
function TazSnapshotsSection({ vms }: { vms: AdminTazVm[] }) {
  const admin = useDeepSubjectAll($admin);
  const { snapshots, snapshotsLoading, snapshotsError, snapshotCreateError, creating, createError } = admin.tazcloud;
  const vmNameById = new Map(vms.map((v) => [v.id, v.name]));

  // Per-row "boot from snapshot" form state.
  const [bootFormFor, setBootFormFor] = useState<string | null>(null);
  const [bootVmName, setBootVmName] = useState("");
  const [bootVmSize, setBootVmSize] = useState("small");
  const submittingRef = useRef(false);

  // Auto-close the boot form when the create completes successfully.
  // `creating` is shared with the deploy form at the top of the page, so we
  // gate on `submittingRef` to only react when *this* form initiated it.
  const prevCreatingRef = useRef(false);
  useEffect(() => {
    if (prevCreatingRef.current && !creating && submittingRef.current) {
      submittingRef.current = false;
      if (!createError) {
        setBootFormFor(null);
      }
    }
    prevCreatingRef.current = creating;
  }, [creating, createError]);

  function openBootForm(snapshotId: string) {
    setBootVmName(defaultVmName());
    setBootVmSize("small");
    setBootFormFor(snapshotId);
  }

  function submitBoot(snapshotId: string) {
    const trimmed = bootVmName.trim();
    if (validateTazVmName(trimmed)) return;
    submittingRef.current = true;
    createAdminTazVm({ name: trimmed, size: bootVmSize, snapshot_id: snapshotId });
  }

  if (snapshots.length === 0 && !snapshotsLoading && !snapshotsError && !snapshotCreateError) {
    return null;  // nothing to show — keep the page clean until the user creates one
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <Camera size={16} className="text-teal" />
        <span className="text-md font-medium text-subtext0">Snapshots</span>
        <span className="text-md text-overlay0 font-mono">{snapshots.length}</span>
        <div className="flex-1" />
        <Button size="sm" onClick={loadTazSnapshots} disabled={snapshotsLoading}>
          <RefreshCw size={14} className={cn("mr-1", snapshotsLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>
      {snapshotCreateError && (
        <ErrorMessage className="mb-2">{snapshotCreateError}</ErrorMessage>
      )}
      {snapshotsError && (
        <ErrorMessage className="mb-2">{snapshotsError}</ErrorMessage>
      )}
      {snapshots.length > 0 && (
        <div className="border border-overlay0/20 rounded-lg overflow-hidden">
          <table className="w-full text-md">
            <thead className="bg-surface0/40 text-overlay1 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Source VM</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium w-0"></th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => {
                const sourceName = vmNameById.get(s.sourceVmId);
                const bootOpen = bootFormFor === s.id;
                const bootNameErr = validateTazVmName(bootVmName.trim());
                return (
                  <Fragment key={s.id}>
                    <tr className="border-t border-overlay0/10">
                      <td className="px-3 py-2 font-mono text-text">{s.name}</td>
                      <td className="px-3 py-2 text-overlay1 font-mono text-xs">
                        {sourceName ? <span>{sourceName}</span> : s.sourceVmId ? <span title={s.sourceVmId} className="text-overlay0">(deleted: {s.sourceVmId.slice(0, 8)}…)</span> : <span className="text-overlay0">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium",
                          s.status === "active" && "bg-green/15 text-green",
                          s.status === "pending" && "bg-yellow/15 text-yellow",
                          s.status === "error" && "bg-red/15 text-red",
                        )}>
                          {s.status === "pending" && <Loader2 size={10} className="animate-spin" />}
                          {s.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-overlay1">{s.sizeGb} GB</td>
                      <td className="px-3 py-2 text-overlay1 text-xs">{new Date(s.created).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => bootOpen ? setBootFormFor(null) : openBootForm(s.id)}
                            disabled={s.status !== "active"}
                            className={cn(
                              "p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                              bootOpen ? "text-blue" : "text-overlay0 hover:text-blue",
                            )}
                            title={s.status !== "active" ? "Snapshot must be active to boot a VM" : "Boot a new VM from this snapshot"}
                          >
                            <Rocket size={13} />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete snapshot "${s.name}"? VMs already booted from it are unaffected.`)) deleteTazSnapshot(s.id); }}
                            disabled={s.status === "pending"}
                            className="p-1 text-overlay0 hover:text-red transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title={s.status === "pending" ? "Cannot delete a pending snapshot" : "Delete snapshot"}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {bootOpen && (
                      <tr className="border-t border-overlay0/10 bg-surface0/20">
                        <td colSpan={6} className="px-3 py-3">
                          <div className="flex items-end gap-2 flex-wrap">
                            <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
                              <label className="text-md text-overlay0">New VM name</label>
                              <input
                                type="text"
                                value={bootVmName}
                                onChange={(e) => setBootVmName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") submitBoot(s.id); if (e.key === "Escape") setBootFormFor(null); }}
                                spellCheck={false}
                                autoFocus
                                disabled={creating}
                                className="bg-background border border-surface0 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono focus:border-blue disabled:opacity-50"
                              />
                              {bootNameErr && <span className="text-xs text-red italic">{bootNameErr}</span>}
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-md text-overlay0">Size</label>
                              <Select value={bootVmSize} onChange={(e) => setBootVmSize(e.target.value)} disabled={creating} className="py-1.5 text-md font-sans">
                                {SIZES.map((sz) => <option key={sz} value={sz}>{sz}</option>)}
                              </Select>
                            </div>
                            <Button size="sm" variant="primary" onClick={() => submitBoot(s.id)} disabled={creating || bootNameErr !== null}>
                              {creating && submittingRef.current ? <Loader2 size={14} className="animate-spin mr-1" /> : <Rocket size={14} className="mr-1" />}
                              {creating && submittingRef.current ? "Booting…" : "Boot VM"}
                            </Button>
                            <Button size="sm" onClick={() => setBootFormFor(null)} disabled={creating && submittingRef.current}>
                              Cancel
                            </Button>
                            <p className="basis-full text-xs text-overlay0 italic">
                              Boots a new VM from snapshot <span className="font-mono">{s.name}</span>. SSH user matches the snapshot's source image. Firewall preset is not applied — the snapshot keeps its existing rules.
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface ManageVmInlineProps {
  vm: ManageVm;
}

type ManageTab = "manage" | "firewall" | "ports" | "processes" | "sessions" | "files" | "db" | "commands";

/** Inline "Manage" panel rendered under a VM row. Tabs:
 *  - Manage:   recipes + system (always available, runs as image-default sudo user)
 *  - Firewall: ufw rules editor (always available)
 *  - Files:    full file explorer (requires the VM to be linked to a project)
 *  - DB:       postgres browser (same project-linkage requirement)
 *  - Commands: project commands list, can be run against this VM (requires
 *              project linkage). Lives here so users have one place to drive
 *              a server; the project page no longer has a Commands tab. */
function ManageVmInline({ vm }: ManageVmInlineProps) {
  // Admin exec messages (`admin:*:exec`) require tazcloud+ at the WS ACL —
  // plain "user" callers get silently dropped and would stall on the 15-min
  // client timeout. Non-admin callers route through user-level `vps:exec`.
  const [auth] = useSubject($auth);
  const canUseAdminExec = (auth.user?.role ?? "user") !== "user";

  // Probe whether the 'genie' deploy user is set up (created + SSH key + sudo)
  // and prefer it over the image-default user. This matters because recipes
  // like "Next.js (latest)" write to /opt/project, which Genie Standard Setup
  // chowns to genie — running them as `ubuntu` then `sudo -u genie` is fragile
  // (login-shell quirks, npm cache paths, etc). Same probe + fallback pattern
  // ClaudeManageButton uses. DigitalOcean droplets are provisioned with genie
  // from the start, so we skip the probe and pin the user there.
  const imageDefault = imageDefaultUser(vm.image);
  // v2.0.0 vxlan-bastion: only `genie` exists on the image (no ubuntu/debian/
  // almalinux user). Probing as `imageDefault` would auth-fail before the probe
  // script runs, falling back to a username that can't log in at all — that's
  // what surfaces as "trying to access the internal VLAN address" in the UI.
  const isV2 = !!vm.sshBastion;
  // Initialize synchronously for branches where we know the answer without a
  // probe: skips the brief "Detecting SSH user…" flash on first render.
  const [resolvedUser, setResolvedUser] = useState<string | null>(() => {
    if (!canUseAdminExec) return imageDefault;
    if (vm.provider === "do") return "genie";
    if (isV2) return "genie";
    return null;
  });

  useEffect(() => {
    if (!canUseAdminExec) { setResolvedUser(imageDefault); return; }
    if (vm.provider === "do") { setResolvedUser("genie"); return; }
    if (isV2) { setResolvedUser("genie"); return; }
    let cancelled = false;
    const probe = `if id genie >/dev/null 2>&1 && sudo -n test -s /home/genie/.ssh/authorized_keys; then echo "GENIE"; else echo "DEFAULT"; fi`;
    adminTazcloudExec(vm.id, imageDefault, probe, vm.host).then((res) => {
      if (cancelled) return;
      const last = res.output.trim().split("\n").pop()?.trim();
      setResolvedUser(last === "GENIE" ? "genie" : imageDefault);
    }).catch(() => {
      if (!cancelled) setResolvedUser(imageDefault);
    });
    return () => { cancelled = true; };
  }, [vm.id, vm.host, vm.provider, imageDefault, canUseAdminExec, isV2]);

  const user = resolvedUser ?? imageDefault;

  const [tab, setTab] = useState<ManageTab>("manage");
  const [projects] = useSubject($projects);
  // Find the project + VPS instance this VM is attached to, if any. The Files
  // and DB panels delegate to server-side `vps:fs:*` / `vps:db:*` handlers that
  // require a real (projectId, instanceId) pair to resolve an SSH connection.
  const linked = useMemo(() => {
    if (!vm.projectId) return null;
    const project = projects.find((p) => p.id === vm.projectId);
    if (!project) return null;
    const instance = project.vpsInstances.find((i) =>
      vm.provider === "tazcloud"
        ? i.tazcloud?.vmId === vm.id
        : i.digitalocean?.dropletId === Number(vm.id),
    );
    if (!instance) return null;
    return { project, instance };
  }, [projects, vm.projectId, vm.id, vm.provider]);

  const hasProject = !!linked;

  // `vps:exec` resolves the SSH connection from the project, so it needs
  // linkage; without it we have no choice but the admin path even for "user".
  const exec = !canUseAdminExec && linked
    ? (command: string) => vpsExec(linked.project.id, linked.instance.id, command)
    : makeVmExec(vm, user);

  const tabs: { key: ManageTab; label: string; icon: typeof SettingsIcon; enabled: boolean; reason?: string }[] = [
    { key: "manage", label: "Manage", icon: SettingsIcon, enabled: true },
    { key: "firewall", label: "Firewall", icon: Shield, enabled: true },
    { key: "ports", label: "Ports", icon: Network, enabled: true },
    { key: "processes", label: "Processes", icon: Cpu, enabled: true },
    { key: "sessions", label: "Sessions", icon: Activity, enabled: true },
    { key: "commands", label: "Commands", icon: PlayCircle, enabled: hasProject, reason: "Attach this VM to a project to manage commands" },
    { key: "files", label: "Files", icon: FolderTree, enabled: hasProject, reason: "Attach this VM to a project to browse files" },
    { key: "db", label: "DB", icon: DatabaseIcon, enabled: hasProject, reason: "Attach this VM to a project to browse the database" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 border-b border-surface0 pb-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => t.enabled && setTab(t.key)}
              disabled={!t.enabled}
              title={t.enabled ? undefined : t.reason}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-md rounded-md border-none cursor-pointer transition-colors",
                isActive ? "bg-surface0 text-text" : "bg-transparent text-overlay0 hover:text-subtext0 hover:bg-mantle",
                !t.enabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-overlay0",
              )}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {resolvedUser === null ? (
        <div className="flex items-center gap-2 text-overlay0 text-md py-4">
          <Loader2 size={14} className="animate-spin" /> Detecting SSH user…
        </div>
      ) : (
        <>
          {tab === "manage" && (() => {
            // Display the bastion in the form we actually connect with — see
            // `parseBastion` above for why the API's `almalinux@…` becomes
            // `genie@…`. Without this rewrite the popup would advertise a
            // login that doesn't actually authenticate.
            const bastionParsed = vm.sshBastion ? parseBastion(vm.sshBastion) : undefined;
            const bastionDisplay = bastionParsed ? `${bastionParsed.username}@${bastionParsed.host}` : null;
            return (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-overlay0">
                  Operations run via SSH as <span className="font-mono text-overlay1">{user}@{vm.host}</span>
                  {bastionDisplay && (
                    <span className="ml-1">via <span className="font-mono text-overlay1">{bastionDisplay}</span></span>
                  )}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <ClaudeManageButton vm={vm} />
                  <SshLaunchButton vm={vm} />
                </div>
              </div>
              {vm.provider === "do" && linked && (
                <DropletSleepControl projectId={linked.project.id} instanceId={linked.instance.id} />
              )}
              {bastionDisplay && (
                <div className="text-xs text-yellow bg-yellow/10 border border-yellow/30 rounded px-3 py-2">
                  This VM is on a vxlan-bastion tenant — the manager reaches it via{" "}
                  <span className="font-mono">{bastionDisplay}</span>. If recipes time out with
                  &ldquo;SSH connection failed&rdquo;, the bastion isn&rsquo;t accepting the manager&rsquo;s
                  key — set <span className="font-mono">TAZCLOUD_BASTION_PRIVATE_KEY</span> in the
                  manager env (or have your Tazcloud account upload the existing key to the bastion).
                </div>
              )}
              <VpsResourceGauges
                exec={exec}
                host={vm.host}
                domain={vm.ingress ? { name: vm.ingress.domain, url: vm.ingress.url } : null}
                isPrivateHost={vm.isPrivateHost}
              />
              <AdminRecipesPanel exec={exec} />
              <AdminSystemPanel exec={exec} view="services" />
            </div>
            );
          })()}

          {tab === "firewall" && (
            <VpsFirewall exec={exec} />
          )}

          {tab === "ports" && (
            <AdminSystemPanel exec={exec} view="ports" />
          )}

          {tab === "processes" && (
            <VpsProcessesPanel exec={exec} />
          )}

          {tab === "sessions" && (
            <VmSessionsTab vmHost={vm.host} />
          )}
        </>
      )}

      {tab === "commands" && linked && (
        <CommandsTab project={linked.project} />
      )}

      {tab === "files" && linked && (
        <div className="h-[600px]">
          <FileExplorer project={linked.project} />
        </div>
      )}

      {tab === "db" && linked && (
        <div className="h-[600px]">
          <DbExplorer project={linked.project} />
        </div>
      )}
    </div>
  );
}

/** "Sleep" (hibernate) control for a DigitalOcean droplet linked to a project.
 *  Snapshots the droplet, then destroys it to stop billing — the instance can
 *  be woken later from the snapshot. Mirrors the Hibernate box on the project
 *  page; only rendered for `provider === "do"` VMs that are project-attached
 *  (the server-side `vps:hibernate` handler resolves the droplet via the
 *  project's vpsInstance). Subscribes to $vpsDeploy for live progress. */
function DropletSleepControl({ projectId, instanceId }: { projectId: string; instanceId: string }) {
  const vpsDeploy = useDeepSubjectAll<VpsDeployState>($vpsDeploy);
  const inst = vpsDeploy.instances[instanceId];
  const hibernating = inst?.hibernating ?? false;
  const progress = inst?.progress ?? [];
  const error = inst?.error ?? null;
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="border border-blue/20 rounded-lg px-3 py-2">
      {hibernating ? (
        <div>
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="text-blue animate-spin" />
            <span className="text-md font-medium text-blue">Hibernating…</span>
          </div>
          {progress.length > 0 && (
            <div className="max-h-[150px] overflow-y-auto scrollbar-thin bg-crust rounded-lg p-2 mt-2">
              {progress.map((line, i) => (
                <div key={i} className="text-md text-overlay1 font-mono whitespace-pre-wrap">{line}</div>
              ))}
            </div>
          )}
        </div>
      ) : confirm ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Moon size={12} className="text-blue shrink-0" />
          <span className="text-md text-blue">Snapshot and destroy this droplet? You can wake it up later.</span>
          <Button size="sm" onClick={() => { hibernateVps(projectId, instanceId); setConfirm(false); }}>Confirm</Button>
          <Button size="sm" onClick={() => setConfirm(false)}>Cancel</Button>
        </div>
      ) : (
        <button onClick={() => setConfirm(true)} className="flex items-center gap-1.5 text-md text-blue/70 hover:text-blue transition-colors">
          <Moon size={12} /> Sleep
          <span className="text-overlay0 font-normal ml-1">— snapshot &amp; stop the droplet to save costs</span>
        </button>
      )}
      {error && !hibernating && <div className="text-md text-red mt-1">{error}</div>}
    </div>
  );
}

const SESSION_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function formatLastActivity(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Lists persistent tmux/PTY sessions registered against this VM, and lets the
 *  user kill stale ones. Kill ≠ forget: kill SSHs to the VM and runs
 *  `tmux kill-session`, then drops the registry row. Superadmin sees every
 *  user's sessions on the host; everyone else sees only their own. */
function VmSessionsTab({ vmHost }: { vmHost: string }) {
  const [auth] = useSubject($auth);
  const [pt] = useSubject($persistedTerminals);
  const isSuperAdmin = auth.user?.role === "superadmin";

  const refresh = useCallback(() => {
    loadPersistedTerminals({
      vpsHost: vmHost,
      // Reset other filters so a previous History-panel scope doesn't bleed in.
      projectId: null,
      instanceId: null,
      // null = all users (superadmin); undefined = scoped to caller for others.
      ownerId: isSuperAdmin ? null : undefined,
    });
  }, [vmHost, isSuperAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  // Client-side filter as well — the singleton subject is shared with the
  // History panel, so its last load could have a different scope.
  const sessions = useMemo<PersistedTerminalSession[]>(
    () => pt.sessions.filter((s) => s.vpsHost === vmHost),
    [pt.sessions, vmHost],
  );

  const now = Date.now();
  const staleSessions = sessions.filter((s) => now - new Date(s.lastActivity).getTime() > SESSION_STALE_MS);

  const clearStale = useCallback(() => {
    for (const s of staleSessions) killPersistedTerminal(s.id);
  }, [staleSessions]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-overlay0 max-w-2xl">
          Persistent terminal sessions registered for <span className="font-mono text-overlay1">{vmHost}</span>.
          Killing a session terminates the tmux process on the VM and removes the registry row.
          {!isSuperAdmin && " You see only your own sessions."}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {staleSessions.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearStale} title={`Kill ${staleSessions.length} session(s) inactive for >7d`}>
              <Trash2 size={13} className="mr-1" />
              Clear {staleSessions.length} stale
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={refresh} disabled={pt.loading} title="Refresh">
            {pt.loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </Button>
        </div>
      </div>

      {pt.loading && sessions.length === 0 ? (
        <div className="flex items-center gap-2 text-overlay0 text-md py-4">
          <Loader2 size={14} className="animate-spin" /> Loading sessions…
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-overlay0 text-md py-6 text-center border border-surface0 rounded">
          No registered sessions on this VM.
        </div>
      ) : (
        <ul className="divide-y divide-surface0 border border-surface0 rounded overflow-hidden">
          {sessions.map((s) => {
            const age = now - new Date(s.lastActivity).getTime();
            const stale = age > SESSION_STALE_MS;
            const title = s.commandLabel || (s.kind === "claude" ? "Claude" : "Shell");
            return (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surface0/40 transition-colors">
                <Terminal size={14} className={cn("shrink-0", s.kind === "claude" ? "text-mauve" : "text-overlay1")} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-text font-medium truncate" style={{ fontSize: 13 }}>{title}</span>
                    <span className="font-mono text-overlay0 shrink-0" style={{ fontSize: 11 }}>{s.id}</span>
                    {stale && (
                      <span className="px-1.5 py-0.5 rounded bg-peach/15 text-peach shrink-0" style={{ fontSize: 10 }}>
                        stale
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-overlay0 mt-0.5 flex-wrap" style={{ fontSize: 11 }}>
                    {isSuperAdmin && <span className="font-mono">user {s.ownerId.slice(0, 8)}</span>}
                    <span>last active {formatLastActivity(s.lastActivity)}</span>
                  </div>
                </div>
                <button
                  onClick={() => reattachPersistedTerminal(s)}
                  title="Reattach to this terminal in the bottom panel"
                  className="flex items-center gap-1 px-2 py-1 rounded bg-mauve/20 text-mauve hover:bg-mauve/30 transition-colors"
                  style={{ fontSize: 11 }}
                >
                  <Plug size={11} />
                  Resume
                </button>
                <button
                  onClick={() => killPersistedTerminal(s.id)}
                  title="Kill the tmux session on the VPS and remove from the registry"
                  className="p-1.5 rounded hover:bg-red/20 text-overlay0 hover:text-red transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
