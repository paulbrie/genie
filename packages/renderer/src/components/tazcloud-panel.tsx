"use client";

import { useEffect, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { Cloud, RefreshCw, Loader2, Terminal, Plus, ChevronDown, Settings as SettingsIcon, Pencil, Check, X, Lock, Unlock, Shield, Bug, Globe, Camera, Trash2, MoreVertical, LayoutGrid, List as ListIcon, Search } from "lucide-react";
import { $admin, $auth } from "@/store/subjects";
import type { AdminTazVm } from "@/store/types";
import { addSshTerminalTab, adminTazcloudExec, createAdminTazVm, createTazSnapshot, deleteAdminTazVm, deleteTazSnapshot, loadAdminTazVms, loadAdminTazcloudStats, loadTazSnapshots, lockAdminTazVm, registerTazIngress, removeTazIngress, renameAdminTazVm, startSecurityScan, switchNav, unlockAdminTazVm } from "@/store/actions";
import { VpsFirewall } from "@/components/project-detail";
import { AdminRecipesPanel } from "@/components/admin-recipes-panel";
import { AdminSystemPanel } from "@/components/admin-system-panel";
import { AttachVmToProject } from "@/components/attach-vm-to-project";
import { DropletInstanceBar } from "@/components/droplet-instance-bar";
import { ServerDeleteConfirm } from "@/components/server-delete-confirm";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ErrorMessage } from "@/components/ui/error-message";

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
  const [manageExpanded, setManageExpanded] = useState<string | null>(null);
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
              return (
                <div
                  key={vm.id}
                  onClick={(e) => {
                    // Cards-mode only: clicking the card opens the manage modal. Skip
                    // when the click landed on an interactive descendant (button, link,
                    // input, etc.), or when the row is mid-rename / mid-delete.
                    if (vmViewMode !== "cards") return;
                    if (!isActive || isRenaming || isPending || isDeleting) return;
                    const target = e.target as HTMLElement;
                    if (target.closest("button, a, input, select, textarea, label")) return;
                    setManageExpanded(vm.id);
                  }}
                  className={cn(
                    "bg-mantle rounded-lg px-3 py-2 border border-overlay0/10",
                    vmViewMode === "cards" && isActive && !isRenaming && !isPending && !isDeleting
                      && "cursor-pointer hover:border-blue/30 transition-colors",
                  )}
                >
                  {isRenaming ? (
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
                        className="bg-background border border-blue/40 rounded px-1.5 py-0.5 text-md font-mono outline-none"
                      />
                      <button onClick={commitRename} className="text-green hover:text-green/70 p-0.5" title="Save">
                        <Check size={12} />
                      </button>
                      <button onClick={() => { setRenamingId(null); setRenameDraft(""); }} className="text-overlay0 hover:text-text p-0.5" title="Cancel">
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <DropletInstanceBar
                      name={vm.name}
                      status={vm.status.toLowerCase()}
                      ip={vm.ipv6}
                      sizeSlug={vm.size}
                      provider="tazcloud"
                      stats={stats ?? null}
                      statsLoading={isActive && !stats && admin.tazcloud.vmStatsLoading}
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
                    {vm.ingress && (
                      <span className="inline-flex items-center gap-1">
                        <a
                          href={vm.ingress.url || `https://${vm.ingress.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-mauve/15 text-mauve hover:bg-mauve/25 transition-colors font-mono"
                          title={`Ingress attached — ${vm.ingress.domain}${vm.ingress.status ? ` (${vm.ingress.status})` : ""}. ${vm.ingress.dnsAction || `Add A record: ${vm.ingress.domain} -> ${vm.ingress.ip || "188.213.48.229"}`}. Remove the ingress before deleting this VM.`}
                        >
                          <Globe size={11} /> ingress · {vm.ingress.domain}
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
                    )}
                    <div className="flex-1" />
                    {isDeleting ? (
                      <span className="inline-flex items-center gap-1 text-overlay0">
                        <Loader2 size={12} className="animate-spin" />
                        Deleting…
                      </span>
                    ) : (
                      <>
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
                                  onClick={() => { setActionMenuOpenFor(null); setManageExpanded(vm.id); }}
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
                  {snapshotFormFor === vm.id && (
                    <div className="mt-3 border-t border-overlay0/10 pt-3 flex items-end gap-2 flex-wrap">
                      <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
                        <label className="text-md text-overlay0">Snapshot name</label>
                        <input
                          type="text"
                          value={snapshotName}
                          onChange={(e) => setSnapshotName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") submitSnapshot(vm.id); if (e.key === "Escape") setSnapshotFormFor(null); }}
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
                      <Button size="sm" variant="primary" onClick={() => submitSnapshot(vm.id)} disabled={!snapshotName.trim() || !TAZ_NAME_RE.test(snapshotName.trim())}>
                        <Camera size={14} className="mr-1" /> Snapshot
                      </Button>
                      <Button size="sm" onClick={() => setSnapshotFormFor(null)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                  {ingressFormFor === vm.id && (() => {
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
                                onKeyDown={(e) => { if (e.key === "Enter") submitIngress(vm.id); if (e.key === "Escape") setIngressFormFor(null); }}
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
                              onKeyDown={(e) => { if (e.key === "Enter") submitIngress(vm.id); if (e.key === "Escape") setIngressFormFor(null); }}
                              className="bg-background border border-surface0 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono focus:border-blue"
                            />
                          </div>
                          <Button size="sm" variant="primary" onClick={() => submitIngress(vm.id)} disabled={!labelValid || !!admin.tazcloud.ingressBusy[vm.id]}>
                            {admin.tazcloud.ingressBusy[vm.id] ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Globe size={14} className="mr-1" />}
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
                  })()}
                </div>
              );
            })}
          </div>
          );
        })()}
      </div>

      <TazSnapshotsSection vms={vms} />

      <ManageVmModal
        vm={vms.find((v) => v.id === manageExpanded) ?? null}
        onClose={() => setManageExpanded(null)}
      />
    </div>
  );
}

/** Modal wrapper around ManageVmInline. Replaces the old per-row inline
 *  expansion: inlining a three-panel control surface (firewall + recipes +
 *  system info) under a single row pushed every other row down and was
 *  particularly broken in card view, where it punched out of the grid. */
function ManageVmModal({
  vm,
  onClose,
}: {
  vm: { id: string; name: string; ipv6: string; image?: string; projectId: string | null } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!vm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vm, onClose]);

  if (!vm) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] max-w-[95vw] max-h-[90vh] bg-mantle border border-surface0 rounded-lg shadow-xl z-50 flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0 shrink-0">
          <SettingsIcon size={14} className="text-blue" />
          <span className="text-text font-medium text-md">Manage</span>
          <span className="text-overlay0 text-md font-mono">{vm.name}</span>
          <div className="flex-1" />
          <button onClick={onClose} className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer" title="Close (Esc)">
            <X size={14} />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3">
          <ManageVmInline vm={vm} />
        </div>
      </div>
    </>
  );
}

/** List of all TazCloud snapshots — across every VM, since the API doesn't
 *  scope listSnapshots() per VM. Source VM names resolved from the current VM
 *  list when possible (snapshot's source VM may have been deleted). */
function TazSnapshotsSection({ vms }: { vms: AdminTazVm[] }) {
  const admin = useDeepSubjectAll($admin);
  const { snapshots, snapshotsLoading, snapshotsError, snapshotCreateError } = admin.tazcloud;
  const vmNameById = new Map(vms.map((v) => [v.id, v.name]));

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
                return (
                  <tr key={s.id} className="border-t border-overlay0/10">
                    <td className="px-3 py-2 font-mono text-text">{s.name}</td>
                    <td className="px-3 py-2 text-overlay1 font-mono text-xs">
                      {sourceName ? <span>{sourceName}</span> : <span title={s.sourceVmId} className="text-overlay0">(deleted: {s.sourceVmId.slice(0, 8)}…)</span>}
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
                      <button
                        onClick={() => { if (confirm(`Delete snapshot "${s.name}"? VMs already booted from it are unaffected.`)) deleteTazSnapshot(s.id); }}
                        disabled={s.status === "pending"}
                        className="p-1 text-overlay0 hover:text-red transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={s.status === "pending" ? "Cannot delete a pending snapshot" : "Delete snapshot"}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
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
      <AdminSystemPanel exec={exec} />
      <AdminRecipesPanel exec={exec} />
      <VpsFirewall exec={exec} />
    </div>
  );
}
