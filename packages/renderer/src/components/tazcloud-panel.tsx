"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { Cloud, RefreshCw, Loader2, Terminal, Plus, ChevronDown, Settings as SettingsIcon, Pencil, Check, X, Lock, Unlock, Shield, Bug, Globe, Camera, Trash2, MoreVertical, LayoutGrid, List as ListIcon, Search, ExternalLink, Minus, Maximize2, Minimize2, Rocket } from "lucide-react";
import { $admin, $auth, $windowManager } from "@/store/subjects";
import type { AdminTazVm, FloatingWindowState } from "@/store/types";
import { addSshTerminalTab, adminTazcloudExec, closeWindow, createAdminTazVm, createTazSnapshot, deleteAdminTazVm, deleteTazSnapshot, focusWindow, loadAdminTazVms, loadAdminTazcloudStats, loadTazSnapshots, lockAdminTazVm, minimizeWindow, openWindow, registerTazIngress, registerWindow, removeTazIngress, renameAdminTazVm, startSecurityScan, switchNav, unlockAdminTazVm, updateWindowPosition } from "@/store/actions";
import { useDraggable, useResizable } from "@/components/use-draggable";
import { VpsFirewall } from "@/components/project-detail";
import { AdminRecipesPanel } from "@/components/admin-recipes-panel";
import { AdminSystemPanel } from "@/components/admin-system-panel";
import { AttachVmToProject } from "@/components/attach-vm-to-project";
import { DropletInstanceBar } from "@/components/droplet-instance-bar";
import { ServerDeleteConfirm } from "@/components/server-delete-confirm";
import { CircularGauge } from "@/components/ui/circular-gauge";
import { CopyableIp } from "@/components/ui/copyable-ip";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ErrorMessage } from "@/components/ui/error-message";

function formatBytesShort(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)}G`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)}M`;
}

function cardStatusPill(status: string) {
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

/** SSH user the user probably wants for an interactive session. Genie's project-deploy
 *  flow creates a `genie` user; non-Genie-deployed VMs only have the image-default user.
 *  We can't distinguish those at list time (the API doesn't tell us), so we lean toward
 *  `genie` for project-linked VMs and image-default otherwise. Users can override via
 *  the dropdown if the heuristic is wrong. */
function defaultSshUserFor(vm: { image?: string; projectId: string | null }): string {
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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [deployOpen, setDeployOpen] = useState(false);
  const [vmName, setVmName] = useState(defaultVmName());
  const [vmImage, setVmImage] = useState("ubuntu-22");
  const [vmSize, setVmSize] = useState("small");
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
    // SSH-probing every VM is expensive; refresh on a slow cadence and let the
    // user hit Refresh for an immediate update.
    const id = setInterval(loadAdminTazcloudStats, 30_000);
    return () => clearInterval(id);
  }, [canAccess]);

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
    createAdminTazVm({ name: trimmed, image: vmImage, size: vmSize });
  }

  function toggleDeploy() {
    if (deployOpen) {
      setDeployOpen(false);
    } else {
      setVmName(defaultVmName());
      setDeployOpen(true);
    }
  }

  function openSshTerminal(vm: { id: string; name: string; ipv6: string; status: string; image?: string; projectId: string | null }, userOverride?: string) {
    if (!vm.ipv6 || vm.status !== "ACTIVE") return;
    const username = userOverride ?? defaultSshUserFor(vm);
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

      <ManageVmWindows vms={vms} />
    </div>
  );
}

const MANAGE_VM_WINDOW_PREFIX = "manage-vm-";
const MANAGE_VM_DEFAULT_W = 900;
const MANAGE_VM_DEFAULT_H = 600;
const MANAGE_VM_CASCADE_OFFSET = 30;

function openManageVmWindow(vm: { id: string; name: string }) {
  const wid = MANAGE_VM_WINDOW_PREFIX + vm.id;
  registerWindow(wid, `Manage ${vm.name}`, "settings");
  openWindow(wid);
  focusWindow(wid);
}

type ManageVm = { id: string; name: string; ipv6: string; image?: string; projectId: string | null };

/** Draggable popup wrapper around ManageVmInline. Replaces the modal so admins
 *  can keep multiple manage panels open side-by-side and still see the VM list
 *  beneath them. Uses the shared window-manager so it cascades against other
 *  popups and shows up in the window toolbar. */
function ManageVmPopup({ vm, windowId, windowState }: {
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

  return createPortal(
    <div
      ref={elRef}
      className={`fixed bg-mantle border border-surface0 shadow-2xl shadow-black/50 flex flex-col ${maximized ? "rounded-none" : "rounded-lg"}`}
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
        <div className="flex-1" />
        {vm.ipv6 && (() => {
          // Open an interactive SSH tab as the image-default user — matches the
          // user under which the "Operations run via SSH as …" exec helper below
          // already runs, so what you see in the modal == what you type into.
          const sshUser = imageDefaultUser(vm.image);
          return (
            <button
              onClick={(e) => {
                e.stopPropagation();
                addSshTerminalTab(
                  { host: vm.ipv6, port: 22, username: sshUser, privateKeyPath: "~/.genie/ssh/tazcloud_ed25519" },
                  `SSH ${sshUser}@${vm.name}`,
                );
              }}
              className="text-overlay1 hover:text-blue transition-colors bg-transparent border-none cursor-pointer p-1"
              title={`Open SSH terminal — ${sshUser}@${vm.ipv6}`}
            >
              <Terminal size={14} />
            </button>
          );
        })()}
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

function ManageVmWindowInstance({ windowId, vms }: { windowId: string; vms: AdminTazVm[] }) {
  const [windowManager] = useSubject($windowManager);
  const windowState = windowManager.windows[windowId];
  const vmId = windowId.slice(MANAGE_VM_WINDOW_PREFIX.length);
  const vm = vms.find((v) => v.id === vmId);
  if (!windowState || windowState.status !== "open" || !vm) return null;
  return <ManageVmPopup vm={vm} windowId={windowId} windowState={windowState} />;
}

function ManageVmWindows({ vms }: { vms: AdminTazVm[] }) {
  const [windowManager] = useSubject($windowManager);
  const windowIds = Object.keys(windowManager.windows).filter((id) => id.startsWith(MANAGE_VM_WINDOW_PREFIX));
  return (
    <>
      {windowIds.map((id) => (
        <ManageVmWindowInstance key={id} windowId={id} vms={vms} />
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
  vm: { id: string; name: string; ipv6: string; image?: string; projectId: string | null };
}

/** Inline "Manage" panel rendered under a VM row: shows firewall + services components
 *  bound to the admin-scoped exec helper (no project linkage required). */
function ManageVmInline({ vm }: ManageVmInlineProps) {
  // Use the image-default user for Manage operations. The `genie` user may not
  // exist (VMs created via the bare "Deploy VM" admin button skip the Genie
  // bootstrap), and image-default always exists + has sudo. The "Add genie user"
  // card lets you create it explicitly if you want SSH-as-genie elsewhere.
  const user = imageDefaultUser(vm.image);
  const exec = (command: string, onChunk?: (chunk: string) => void, signal?: AbortSignal) =>
    adminTazcloudExec(vm.id, user, command, vm.ipv6, onChunk, signal);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-overlay0">
        Operations run via SSH as <span className="font-mono text-overlay1">{user}@{vm.ipv6}</span>
      </p>
      <AdminRecipesPanel exec={exec} />
      <VpsFirewall exec={exec} />
      <AdminSystemPanel exec={exec} />
    </div>
  );
}
