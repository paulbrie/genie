"use client";

import { useEffect, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { Cloud, RefreshCw, Loader2, Terminal, Plus, ChevronDown, Settings as SettingsIcon, Pencil, Check, X, UserPlus } from "lucide-react";
import { $admin, $auth } from "@/store/subjects";
import { addSshTerminalTab, adminTazcloudExec, createAdminTazVm, deleteAdminTazVm, loadAdminTazVms, loadAdminTazcloudStats, renameAdminTazVm, switchNav } from "@/store/actions";
import { VpsFirewall } from "@/components/project-detail";
import { AdminRecipesPanel } from "@/components/admin-recipes-panel";
import { AdminSystemPanel } from "@/components/admin-system-panel";
import { AttachVmToProject } from "@/components/attach-vm-to-project";
import { DropletInstanceBar } from "@/components/droplet-instance-bar";
import { GenieUserSetup, GENIE_USER_INSTALL_SCRIPT } from "@/components/genie-user-setup";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ErrorMessage } from "@/components/ui/error-message";

const IMAGES = ["ubuntu-22", "ubuntu-24", "debian-12", "almalinux-9"];
const SIZES = ["small", "medium", "large", "xlarge"];

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
  const [manageExpanded, setManageExpanded] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Per-row "add genie user" state — vmId → "running" | "done" | "error: <msg>"
  const [genieInstallState, setGenieInstallState] = useState<Record<string, "running" | "done" | string>>({});

  async function installGenieUser(vm: { id: string; ipv6: string; image?: string; projectId: string | null }) {
    setGenieInstallState((s) => ({ ...s, [vm.id]: "running" }));
    // Force image-default user — the install BOOTSTRAPS the genie user, so SSHing
    // as genie would fail on VMs that don't have it yet (the whole point).
    const user = imageDefaultUser(vm.image);
    const res = await adminTazcloudExec(vm.id, user, GENIE_USER_INSTALL_SCRIPT, vm.ipv6);
    if (res.error || !res.output.trim().endsWith("OK")) {
      setGenieInstallState((s) => ({ ...s, [vm.id]: "error: " + (res.output.slice(0, 100) || "failed") }));
      setTimeout(() => setGenieInstallState((s) => { const n = { ...s }; delete n[vm.id]; return n; }), 6000);
      return;
    }
    setGenieInstallState((s) => ({ ...s, [vm.id]: "done" }));
    setTimeout(() => setGenieInstallState((s) => { const n = { ...s }; delete n[vm.id]; return n; }), 4000);
  }

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

  const isSuperAdmin = auth.user?.role === "superadmin";

  useEffect(() => {
    if (!isSuperAdmin) return;
    loadAdminTazVms();
    loadAdminTazcloudStats();
    // SSH-probing every VM is expensive; refresh on a slow cadence and let the
    // user hit Refresh for an immediate update.
    const id = setInterval(loadAdminTazcloudStats, 30_000);
    return () => clearInterval(id);
  }, [isSuperAdmin]);

  // Close the deploy form when a creation completes successfully (creating: true → false, no error).
  const prevCreatingRef = useRef(false);
  useEffect(() => {
    if (prevCreatingRef.current && !admin.tazcloud.creating && !admin.tazcloud.createError) {
      setDeployOpen(false);
    }
    prevCreatingRef.current = admin.tazcloud.creating;
  }, [admin.tazcloud.creating, admin.tazcloud.createError]);

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center text-overlay0">
        <div className="text-center">
          <p className="text-base">TazCloud admin is restricted to super admin users.</p>
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
    if (!trimmed) return;
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
          <Button variant="primary" size="sm" onClick={submitCreate} disabled={creating || !vmName.trim()}>
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

      <div>
        {loading && vms.length === 0 ? (
          <div className="flex items-center justify-center text-overlay0 py-12">
            <Loader2 size={16} className="animate-spin mr-2" />
            Loading…
          </div>
        ) : vms.length === 0 && !error ? (
          <div className="text-center text-overlay0 py-12">
            <p className="text-base">No TazCloud VMs.</p>
            <p className="text-md mt-1">Deploy a project with the TazCloud provider to see it here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {vms.map((vm) => {
              const isActive = vm.status === "ACTIVE";
              const isPending = pendingDelete === vm.id;
              const isDeleting = deleting.has(vm.id);
              const isRenaming = renamingId === vm.id;
              const stats = admin.tazcloud.vmStats[vm.id];
              const gState = genieInstallState[vm.id];
              const installBusy = gState === "running";
              const installDone = gState === "done";
              const installErr = typeof gState === "string" && gState.startsWith("error:") ? gState.slice(7) : null;
              return (
                <div key={vm.id} className="bg-mantle rounded-lg px-3 py-2 border border-overlay0/10">
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
                      onDelete={() => confirmDelete(vm.id)}
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
                        <button
                          onClick={() => installGenieUser(vm)}
                          disabled={installBusy || !isActive}
                          className={cn(
                            "p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                            installDone ? "text-green" : installErr ? "text-red" : "text-overlay0 hover:text-blue",
                          )}
                          title={
                            installErr ? `Install failed: ${installErr}` :
                            installDone ? "Genie user created" :
                            installBusy ? "Creating genie user…" :
                            "Add genie user (sudo + SSH key from current user)"
                          }
                        >
                          {installBusy ? <Loader2 size={13} className="animate-spin" />
                            : installDone ? <Check size={13} />
                            : <UserPlus size={13} />}
                        </button>
                        {!isRenaming && (
                          <button
                            onClick={() => startRename(vm)}
                            className="text-overlay0 hover:text-blue transition-colors p-1"
                            title="Rename VM (stored in Genie's DB; TazCloud cloud name stays unchanged)"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => setManageExpanded(manageExpanded === vm.id ? null : vm.id)}
                          disabled={!isActive}
                          className={cn(
                            "p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                            manageExpanded === vm.id ? "text-blue" : "text-overlay0 hover:text-blue",
                          )}
                          title="Manage firewall & services"
                        >
                          <SettingsIcon size={13} />
                        </button>
                      </>
                    )}
                  </div>
                  {isPending && (
                    <div className="flex items-center gap-1.5 mt-2 px-2 py-1.5 rounded bg-red/10">
                      <span className="text-md text-red">Delete this VM?</span>
                      <Button size="sm" variant="danger" onClick={() => executeDelete(vm.id)}>Confirm</Button>
                      <Button size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
                    </div>
                  )}
                  {manageExpanded === vm.id && isActive && (
                    <div className="mt-3 border-t border-overlay0/10 pt-3">
                      <ManageVmInline vm={vm} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
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
  const exec = (command: string, onChunk?: (chunk: string) => void) =>
    adminTazcloudExec(vm.id, user, command, vm.ipv6, onChunk);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-overlay0">
        Operations run via SSH as <span className="font-mono text-overlay1">{user}@{vm.ipv6}</span>
      </p>
      <GenieUserSetup vmId={vm.id} exec={exec} />
      <AdminSystemPanel exec={exec} />
      <AdminRecipesPanel exec={exec} />
      <VpsFirewall exec={exec} />
    </div>
  );
}
