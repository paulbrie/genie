"use client";

// The Manage popup: a draggable, resizable floating window with a tab strip
// (Manage / Firewall / Ports / Processes / Sessions / Commands / Files / DB).
// Provider-agnostic — same component is mounted by tazcloud-panel and
// digitalocean-panel via the shared `ManageVmWindows` mount.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import {
  Activity, ChevronDown, Cpu, Database as DatabaseIcon, FolderTree, Loader2,
  Maximize2, Minimize2, Minus, Moon, Network, Plug, PlayCircle, RefreshCw,
  Settings as SettingsIcon, Shield, Terminal, Trash2, X,
} from "lucide-react";
import { $admin, $auth, $persistedTerminals, $projects, $vpsDeploy, $windowManager } from "@/store/subjects";
import type { FloatingWindowState, PersistedTerminalSession, VpsDeployState } from "@/store/types";
import {
  addSshTerminalTab, adminDropletExec, adminTazcloudExec, closeWindow, focusWindow, launchClaudeSshTab,
  hibernateVps, killPersistedTerminal, loadPersistedTerminals, minimizeWindow,
  openWindow, reattachPersistedTerminal, registerWindow, updateWindowPosition, vpsExec,
} from "@/store/actions";
import { useDraggable, useResizable } from "@/hooks/use-draggable";
import { ClaudeLogo, VpsFirewall, CommandsTab } from "@/components/project/project-detail";
import { AdminRecipesPanel } from "@/components/admin/admin-recipes-panel";
import { AdminSystemPanel, VpsProcessesPanel } from "@/components/admin/admin-system-panel";
import { VpsResourceGauges } from "@/components/project/vps-resource-gauges";
import { FileExplorer } from "@/components/project/vps-file-explorer";
import { DbExplorer } from "@/components/admin/db-explorer";
import { useDeepSubjectAll, useIsWindowFocused } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { imageDefaultUser } from "./helpers";
import { VmHostConnectionsPanel, useVmHostSshRegistry } from "./vm-host-connections-panel";

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

export type ManageVmProvider = "tazcloud" | "do" | "ssh";

/** Provider-agnostic shape consumed by ManageVmInline + the floating popup.
 *  `host` is whatever address SSH should target — IPv6 for legacy TazCloud
 *  VMs, IPv4 for DigitalOcean droplets, and a private 10.x for Taz vxlan-
 *  bastion VMs (which the manager reaches over the WireGuard tunnel). */
export interface ManageVm {
  id: string;
  name: string;
  host: string;
  image?: string;
  projectId: string | null;
  provider: ManageVmProvider;
  ingress?: { domain: string; url?: string } | null;
  /** True when `host` is an RFC1918 address — i.e. a Taz vxlan-bastion VM.
   *  UI suppresses the unreachable http://host:port link in that case and
   *  uses it as the "v2 mode" signal (the image-default users don't exist;
   *  only `genie` does). */
  isPrivateHost?: boolean;
  /** Generic "ssh" servers always run through the project-scoped vps:exec /
   *  terminal path, so we carry the instance id + connection essentials. */
  instanceId?: string;
  connection?: { username: string; privateKeyPath: string };
}

/** Human-readable cloud provider name, shown in the Manage popup title bar. */
function providerLabel(provider: ManageVmProvider): string {
  return provider === "do" ? "DigitalOcean" : provider === "ssh" ? "SSH" : "TazCloud";
}

/** SSH key file used to log in to a VM. Cloud providers roll a separate key
 *  each; generic servers carry their own key path on the connection. */
function sshKeyPathFor(vm: ManageVm): string {
  if (vm.provider === "ssh") return vm.connection?.privateKeyPath || "~/.genie/ssh/genie_ed25519";
  return vm.provider === "tazcloud" ? "~/.genie/ssh/tazcloud_ed25519" : "~/.genie/ssh/genie_ed25519";
}

/** Default SSH user candidates shown in the SSH split-button dropdown. */
function sshUserChoicesFor(vm: ManageVm): string[] {
  if (vm.provider === "ssh") return [vm.connection?.username || "root"];
  if (vm.provider === "do") return ["genie", "root"];
  return ["genie", "ubuntu", "debian", "almalinux", "root"];
}

/** Bind an exec function to this VM. Hides the provider-specific WS call shape
 *  so child panels (recipes, system, firewall) can just call `exec(cmd)`. */
function makeVmExec(vm: ManageVm, sshUser: string) {
  if (vm.provider === "ssh") {
    // Generic servers have no admin exec; route through the project-scoped
    // vps:exec (one-shot — no streaming/abort, fine for connect-only boxes).
    return (command: string) => vpsExec(vm.projectId!, vm.instanceId!, command);
  }
  if (vm.provider === "tazcloud") {
    return (command: string, onChunk?: (chunk: string) => void, signal?: AbortSignal) =>
      adminTazcloudExec(vm.id, sshUser, command, vm.host, onChunk, signal);
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
  const isV2 = vm.isPrivateHost === true;
  const isSsh = vm.provider === "ssh";
  // `null` while probing; `true` if genie is ready; `false` otherwise. For DO
  // and generic ssh servers there's no admin probe — use the connection user.
  const [genieReady, setGenieReady] = useState<boolean | null>(vm.provider === "do" || isSsh ? true : null);

  useEffect(() => {
    if (vm.provider === "do" || isSsh) { setGenieReady(true); return; }
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
  // (ubuntu/debian/almalinux) don't exist there at all. Generic ssh: the user
  // the server was connected as.
  const sshUser = isSsh ? (vm.connection?.username || "root") : genieReady ? "genie" : (isV2 ? "genie" : imageDefaultUser(vm.image));

  const launch = () => {
    if (pending) return;
    launchClaudeSshTab(
      {
        host: vm.host,
        port: 22,
        username: sshUser,
        privateKeyPath: sshKeyPathFor(vm),
      },
      `Claude ${sshUser}@${vm.name}`,
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
        privateKeyPath: sshKeyPathFor(vm),
      },
      `SSH ${user}@${vm.name}`,
    );
  };
  const defaultUser = vm.provider === "ssh" ? (vm.connection?.username || "root") : "genie";
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


/** Live SSH session + MCP tunnel counts for the title bar (admin-only registry). */
function ManageVmTitleBarStats({ host }: { host: string }) {
  const { sessions, tunnels, canViewRegistry } = useVmHostSshRegistry(host);

  if (!canViewRegistry || !host) return null;

  const sessionCount = sessions.length;
  const tunnelCount = tunnels.length;
  const title = `${sessionCount} live SSH connection${sessionCount === 1 ? "" : "s"}, ${tunnelCount} MCP tunnel${tunnelCount === 1 ? "" : "s"}`;

  return (
    <span
      className="shrink-0 px-1.5 py-0.5 rounded text-xs font-mono tabular-nums bg-surface0/60 text-overlay1 inline-flex items-center gap-1.5"
      title={title}
    >
      <span className="inline-flex items-center gap-0.5">
        <Terminal size={11} className="shrink-0" />
        {sessionCount}
      </span>
      <span className="text-surface1">·</span>
      <span className="inline-flex items-center gap-0.5">
        <Plug size={11} className="shrink-0" />
        {tunnelCount}
      </span>
    </span>
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
        <ManageVmTitleBarStats host={vm.host} />
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

  // Generic ("ssh") bring-your-own server. openManageVmWindow is reused for
  // these, so the window is keyed by the *instance* id — match on that, not a
  // cloud VM id (they have no tazcloud/digitalocean block).
  let sshInst: { label: string; host: string; projectId: string; instanceId: string; username: string; keyPath: string } | null = null;
  if (!adminVm && !projInst) {
    for (const p of projects) {
      const inst = p.vpsInstances.find((i) => i.id === vmId && i.ssh);
      if (inst) {
        sshInst = { label: inst.label, host: inst.connection.host, projectId: p.id, instanceId: inst.id, username: inst.connection.username, keyPath: inst.connection.privateKeyPath };
        break;
      }
    }
  }
  const sshLabel = sshInst?.label ?? "";
  const sshHost = sshInst?.host ?? "";
  const sshProjectId = sshInst?.projectId ?? null;
  const sshInstanceId = sshInst?.instanceId ?? "";
  const sshUsername = sshInst?.username ?? "";
  const sshKeyPath = sshInst?.keyPath ?? "";

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
      };
    }
    if (projInst) {
      return { id: vmId, name: projLabel, host: projIpv6, image: projImage, projectId: projProjectId, provider: "tazcloud" };
    }
    if (sshInst) {
      return { id: vmId, name: sshLabel, host: sshHost, projectId: sshProjectId, provider: "ssh", instanceId: sshInstanceId, connection: { username: sshUsername, privateKeyPath: sshKeyPath } };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmId, !!adminVm, adminName, adminIpv6, adminImage, adminProjectId, adminIngressDomain, adminIngressUrl, adminIsPrivateHost, !!projInst, projLabel, projIpv6, projImage, projProjectId, !!sshInst, sshLabel, sshHost, sshProjectId, sshInstanceId, sshUsername, sshKeyPath]);

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


interface ManageVmInlineProps {
  vm: ManageVm;
}

type ManageTab = "manage" | "ssh" | "tunnels" | "firewall" | "ports" | "processes" | "sessions" | "files" | "db" | "commands";

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
  const isV2 = vm.isPrivateHost === true;
  // Initialize synchronously for branches where we know the answer without a
  // probe: skips the brief "Detecting SSH user…" flash on first render.
  const [resolvedUser, setResolvedUser] = useState<string | null>(() => {
    if (vm.provider === "ssh") return vm.connection?.username || "root";
    if (!canUseAdminExec) return imageDefault;
    if (vm.provider === "do") return "genie";
    if (isV2) return "genie";
    return null;
  });

  useEffect(() => {
    if (vm.provider === "ssh") { setResolvedUser(vm.connection?.username || "root"); return; }
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
  }, [vm.id, vm.host, vm.provider, vm.connection?.username, imageDefault, canUseAdminExec, isV2]);

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
      vm.provider === "ssh"
        ? i.id === vm.instanceId
        : vm.provider === "tazcloud"
          ? i.tazcloud?.vmId === vm.id
          : i.digitalocean?.dropletId === Number(vm.id),
    );
    if (!instance) return null;
    return { project, instance };
  }, [projects, vm.projectId, vm.id, vm.provider, vm.instanceId]);

  const hasProject = !!linked;
  const { sessions, tunnels, canViewRegistry } = useVmHostSshRegistry(vm.host);

  const connectionPanelProps = {
    host: vm.host,
    provider: vm.provider,
    sshUser: user,
    projectName: linked?.project.name ?? null,
    isPrivateHost: vm.isPrivateHost,
    ingress: vm.ingress,
    connection: vm.connection,
  };

  // `vps:exec` resolves the SSH connection from the project, so it needs
  // linkage; without it we have no choice but the admin path even for "user".
  const exec = !canUseAdminExec && linked
    ? (command: string) => vpsExec(linked.project.id, linked.instance.id, command)
    : makeVmExec(vm, user);

  const tabs: { key: ManageTab; label: string; icon: typeof SettingsIcon; enabled: boolean; reason?: string }[] = [
    { key: "manage", label: "Manage", icon: SettingsIcon, enabled: true },
    {
      key: "ssh",
      label: canViewRegistry ? `Connections (${sessions.length})` : "Connections",
      icon: Terminal,
      enabled: true,
    },
    {
      key: "tunnels",
      label: canViewRegistry ? `Tunnels (${tunnels.length})` : "Tunnels",
      icon: Plug,
      enabled: true,
    },
    { key: "firewall", label: "Firewall", icon: Shield, enabled: true },
    { key: "ports", label: "Ports", icon: Network, enabled: true },
    { key: "processes", label: "Processes", icon: Cpu, enabled: true },
    { key: "sessions", label: "Sessions", icon: Activity, enabled: true },
    { key: "commands", label: "Commands", icon: PlayCircle, enabled: hasProject, reason: "Attach this VM to a project to manage commands" },
    { key: "files", label: "Files", icon: FolderTree, enabled: hasProject, reason: "Attach this VM to a project to browse files" },
    { key: "db", label: "DB", icon: DatabaseIcon, enabled: hasProject, reason: "Attach this VM to a project to browse the database" },
  ];

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-center gap-1 border-b border-surface0 pb-2">
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
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-md rounded-md border-none cursor-pointer transition-colors shrink-0 whitespace-nowrap",
                isActive ? "bg-surface0 text-text" : "bg-transparent text-overlay0 hover:text-subtext0 hover:bg-mantle",
                !t.enabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-overlay0",
              )}
            >
              <Icon size={14} className="shrink-0" />
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
          {tab === "manage" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-end gap-2">
                <ClaudeManageButton vm={vm} />
                <SshLaunchButton vm={vm} />
              </div>
              {vm.provider === "do" && linked && (
                <DropletSleepControl projectId={linked.project.id} instanceId={linked.instance.id} />
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
          )}

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

      {tab === "ssh" && (
        <VmHostConnectionsPanel {...connectionPanelProps} view="ssh" />
      )}

      {tab === "tunnels" && (
        <VmHostConnectionsPanel {...connectionPanelProps} view="tunnels" />
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
