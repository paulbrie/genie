"use client";

// The Manage popup: a draggable, resizable floating window with a tab strip
// (Manage / Firewall / Ports / Processes / Sessions / Commands / Files / DB).
// Provider-agnostic — same component is mounted by tazcloud-panel and
// digitalocean-panel via the shared `ManageVmWindows` mount.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { batch } from "subjecto";
import { useSubject } from "subjecto/react";
import {
  Activity, ArrowDownUp, Bot, Brain, Check, ChevronDown, Cpu, Database as DatabaseIcon, FolderTree, GitBranch, KeyRound, Link2, Loader2,
  Maximize2, Minimize2, Minus, Moon, Network, Plug, PlayCircle, Puzzle, RefreshCw, ScrollText,
  Settings as SettingsIcon, Shield, Sparkles, Terminal, TriangleAlert, Trash2, X,
} from "lucide-react";
import { $admin, $auth, $persistedTerminals, $projects, $vpsDeploy, $vpsStatsSync, $windowManager } from "@/store/subjects";
import type { FloatingWindowState, PersistedTerminalSession, VpsDeployState } from "@/store/types";
import {
  adminDropletExec, adminHetznerExec, adminTazcloudExec, checkVpsRecipe, closeWindow,
  ensureAdminServerTunnelAsync, fetchVpsStats, focusWindow, loadRecipes,
  releaseAdminServerTunnel, hibernateVps, killPersistedTerminal, killVmTmuxSession, loadPersistedTerminals,
  minimizeWindow, openWindow, reattachPersistedTerminal, refreshVmTmuxSessions, registerWindow, renameVmTmuxSession, syncVmStatsAgent, unwatchVpsStats,
  updateWindowPosition, vpsExec, watchVpsStats, openClaudeChatWindow,
} from "@/store/actions";
import { useDraggable, useResizable } from "@/hooks/use-draggable";
import { openVmConnectionWindow } from "@/components/tazcloud/vm-connection-window";
import { ClaudeLogo, VpsFirewall, CommandsTab } from "@/components/project/project-detail";
import { AdminRecipesPanel } from "@/components/admin/admin-recipes-panel";
import { ClaudePluginsPanel } from "@/components/admin/claude-plugins-panel";
import { AdminSystemPanel, VpsProcessesPanel } from "@/components/admin/admin-system-panel";
import { VpsResourceBar, VpsResourceGauges, vpsStatsToBarStats } from "@/components/project/vps-resource-gauges";
import { FileExplorer } from "@/components/project/vps-file-explorer";
import { DbExplorer } from "@/components/admin/db-explorer";
import { VmClaudeLogsTab } from "./vm-claude-logs-tab";
import { VmGithubTab } from "./vm-github-tab";
import { VmTrafficTab } from "./vm-traffic-tab";
import { VmAgentsTab } from "./vm-agents-tab";
import { VmClaudeMemoryTab } from "./vm-claude-memory-tab";
import { useAllRecipes } from "@/hooks/use-all-recipes";
import { useDeepSubjectAll, useIsWindowFocused } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { sshStatsPostbackEnabled, sshStatsProbeEnabled } from "@/lib/ssh-stats-enabled";
import { wsRequest } from "@/lib/ws";
import type { AdminServerTunnelPayload } from "@/store/actions/admin";
import { Button } from "@/components/ui/button";
import { WindowFontSizeButton, useWindowFontSize, WINDOW_FONT_SCALE } from "@/components/ui/window-font-size";
import { imageDefaultUser } from "./helpers";
import { VmHostConnectionsPanel, useVmHostSshRegistry } from "./vm-host-connections-panel";
import { track } from "@/lib/analytics";
import { resolveManageVmLinked, TmuxSessionBadges } from "./tmux-session-badges";
import { TmuxSessionContextMenu } from "./tmux-session-context-menu";
import { TmuxRenameDialog } from "./tmux-rename-dialog";

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
  track("manager.open", { provider: "tazcloud" });
}

export type ManageVmProvider = "tazcloud" | "do" | "ssh" | "hetzner";

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
  return provider === "do" ? "DigitalOcean"
    : provider === "hetzner" ? "Hetzner"
    : provider === "ssh" ? "SSH" : "TazCloud";
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
  if (vm.provider === "do" || vm.provider === "hetzner") return ["genie", "root"];
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
  if (vm.provider === "hetzner") {
    // Like DO: exec runs as `genie` server-side; serverId is a number.
    return (command: string, onChunk?: (chunk: string) => void, signal?: AbortSignal) =>
      adminHetznerExec(Number(vm.id), command, onChunk, signal);
  }
  // DigitalOcean: exec runs as `genie` server-side; the username is fixed and
  // the dropletId is a number, so we ignore sshUser and stringify back to int.
  return (command: string, onChunk?: (chunk: string) => void, signal?: AbortSignal) =>
    adminDropletExec(Number(vm.id), command, onChunk, signal);
}

const GENIE_STANDARD_RECIPE_ID = "genie-standard";

function parseGenieStandardInstalled(output: string): boolean {
  return output.includes("INSTALLED") && !output.includes("NOT_INSTALLED");
}

type VmExecFn = ReturnType<typeof makeVmExec>;

/** Run the Genie Standard Setup recipe check (store-backed when linked). */
function useGenieStandardCheck(opts: {
  vm: ManageVm;
  linked: { project: { id: string }; instance: { id: string } } | null;
  exec: VmExecFn | ((command: string) => Promise<{ output: string; error?: boolean }>);
  enabled: boolean;
}) {
  const allRecipes = useAllRecipes();
  const recipe = allRecipes.find((r) => r.id === GENIE_STANDARD_RECIPE_ID);
  const vpsDeploy = useDeepSubjectAll<VpsDeployState>($vpsDeploy);
  const storeRecipe = opts.linked
    ? vpsDeploy.instances[opts.linked.instance.id]?.recipes?.[GENIE_STANDARD_RECIPE_ID]
    : undefined;
  const [local, setLocal] = useState<{ checking: boolean; installed: boolean | null }>({
    checking: false,
    installed: opts.vm.provider === "do" || opts.vm.provider === "hetzner" ? true : null,
  });

  useEffect(() => { loadRecipes(); }, []);

  const checking = opts.linked ? (storeRecipe?.checking ?? false) : local.checking;
  const installed = opts.linked
    ? (storeRecipe?.installed ?? null)
    : (opts.vm.provider === "do" || opts.vm.provider === "hetzner" ? true : local.installed);

  const runCheck = useCallback(() => {
    if (!opts.enabled || !recipe) return;
    if (opts.linked) {
      checkVpsRecipe(opts.linked.project.id, opts.linked.instance.id, recipe.id, recipe.checkScript);
      return;
    }
    if (opts.vm.provider === "do" || opts.vm.provider === "hetzner") return;
    setLocal({ checking: true, installed: null });
    void Promise.resolve(opts.exec(recipe.checkScript))
      .then((res) => {
        setLocal({
          checking: false,
          installed: parseGenieStandardInstalled(res.output),
        });
      })
      .catch(() => setLocal({ checking: false, installed: false }));
  }, [opts.enabled, opts.linked, opts.exec, opts.vm.provider, recipe]);

  useEffect(() => {
    if (!checking || !opts.linked) return;
    const instanceId = opts.linked.instance.id;
    const t = window.setTimeout(() => {
      batch(() => {
        const inst = $vpsDeploy.getValue().instances[instanceId];
        const r = inst?.recipes?.[GENIE_STANDARD_RECIPE_ID];
        if (r?.checking) {
          r.checking = false;
          if (r.installed === null) r.installed = false;
        }
      });
    }, 20_000);
    return () => window.clearTimeout(t);
  }, [checking, opts.linked?.instance.id]);

  useEffect(() => {
    if (!checking || opts.linked) return;
    const t = window.setTimeout(() => {
      setLocal((prev) => (prev.checking ? { checking: false, installed: prev.installed ?? false } : prev));
    }, 20_000);
    return () => window.clearTimeout(t);
  }, [checking, opts.linked]);

  return { checking, installed, runCheck, recipe };
}

function CheckGenieSetupButton({
  checking,
  installed,
  onCheck,
  disabled,
}: {
  checking: boolean;
  installed: boolean | null;
  onCheck: () => void;
  disabled?: boolean;
}) {
  const label = checking
    ? "Checking…"
    : installed === true
      ? "Genie OK"
      : installed === false
        ? "Setup missing"
        : "Check Genie Setup";

  return (
    <button
      type="button"
      onClick={onCheck}
      disabled={disabled || checking}
      className={cn(
        "flex items-center gap-1.5 px-2 py-0.5 rounded border text-md transition-colors disabled:opacity-40 disabled:cursor-wait",
        installed === true && "border-green/30 text-green hover:bg-green/10",
        installed === false && "border-yellow/30 text-yellow hover:bg-yellow/10",
        installed === null && "border-overlay0/30 text-overlay1 hover:bg-surface0",
      )}
      title={
        checking
          ? "Checking Genie Standard Setup…"
          : installed === true
            ? "Genie Standard Setup is installed (genie user, Docker, Node, Claude, /opt/project, stats daemon)"
            : installed === false
              ? "Genie Standard Setup is not fully installed — click to re-check or install from Add-ons"
              : "Check whether Genie Standard Setup has been applied on this VM"
      }
    >
      {checking ? (
        <Loader2 size={11} className="animate-spin shrink-0" />
      ) : installed === true ? (
        <Check size={11} className="shrink-0" />
      ) : (
        <Sparkles size={11} className="shrink-0" />
      )}
      {label}
    </button>
  );
}

/** Re-uploads the latest stats daemon bundle + postback drop-in (manager URL +
 *  token) and restarts genie-stats — without re-running the whole recipe.
 *  Handy after the daemon changes, or to re-point a VM at a dev manager. */
function SyncStatsAgentButton({ projectId, instanceId }: { projectId: string; instanceId: string }) {
  const [syncState] = useSubject($vpsStatsSync);
  const status = syncState[`${projectId}:${instanceId}`];
  const running = status?.running ?? false;
  const errored = !running && !!status?.error;
  const succeeded = !running && !errored && !!status; // a finished run with no error

  const label = running
    ? (status?.message || "Syncing…")
    : errored
      ? "Sync failed"
      : succeeded
        ? "Stats agent synced"
        : "Sync stats agent";

  return (
    <button
      type="button"
      onClick={() => syncVmStatsAgent(projectId, instanceId)}
      disabled={running}
      className={cn(
        "flex items-center gap-1.5 px-2 py-0.5 rounded border text-md transition-colors disabled:opacity-60 disabled:cursor-wait",
        errored
          ? "border-red/30 text-red hover:bg-red/10"
          : succeeded
            ? "border-green/30 text-green hover:bg-green/10"
            : "border-overlay0/30 text-overlay1 hover:bg-surface0",
      )}
      title={
        running
          ? (status?.message || "Uploading stats daemon + writing postback config…")
          : errored
            ? `Last sync failed: ${status?.error}`
            : succeeded
              ? "Stats agent synced — click to re-sync"
              : "Push the latest stats daemon + postback config (manager URL + token) to this VM and restart it"
      }
    >
      {running ? (
        <Loader2 size={11} className="animate-spin shrink-0" />
      ) : errored ? (
        <Activity size={11} className="shrink-0" />
      ) : succeeded ? (
        <Check size={11} className="shrink-0" />
      ) : (
        <Activity size={11} className="shrink-0" />
      )}
      {label}
    </button>
  );
}

/** Writes the genie-* MCP REST entries into the VM's /opt/project/.mcp.json so
 *  Claude on the VM can use genie-tracker/security/notify/storage. Project-linked
 *  only (the MCP bearer token is per project+instance). Re-launch Claude after. */
type McpCheck = { name: string; status: "ok" | "warn" | "fail"; detail: string };

function CheckRow({ check }: { check: McpCheck }) {
  const icon = check.status === "ok" ? <Check size={11} className="text-green shrink-0 mt-0.5" />
    : check.status === "warn" ? <TriangleAlert size={11} className="text-yellow shrink-0 mt-0.5" />
    : <X size={11} className="text-red shrink-0 mt-0.5" />;
  return (
    <li className="flex items-start gap-1.5 text-md leading-snug">
      {icon}
      <span className="text-subtext0"><span className="text-overlay1">{check.name}:</span> {check.detail}</span>
    </li>
  );
}

function InstallMcpsButton({ projectId, instanceId }: { projectId: string; instanceId: string }) {
  const [state, setState] = useState<"idle" | "running" | "ok" | "warn" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<McpCheck[]>([]);

  async function install() {
    setState("running"); setError(null); setChecks([]);
    try {
      const res = await wsRequest<{ ok: boolean; error?: string; checks?: McpCheck[] }>("mcp:install", { projectId, instanceId }, 60_000);
      setChecks(res.checks ?? []);
      if (!res.ok) { setState("error"); setError(res.error ?? "Verification failed"); }
      else if ((res.checks ?? []).some((c) => c.status === "warn")) setState("warn");
      else setState("ok");
    } catch (e: unknown) {
      setState("error"); setError(e instanceof Error ? e.message : "Request failed");
    }
  }

  const label = state === "running" ? "Installing & checking…"
    : state === "ok" ? "Installed & verified"
    : state === "warn" ? "Installed — see notes"
    : state === "error" ? "Install failed"
    : "Install Genie MCPs";

  return (
    <div className="flex flex-col gap-1 items-start">
      <button
        type="button"
        onClick={install}
        disabled={state === "running"}
        title="Write the genie-* MCP servers into this VM's .mcp.json, clear stale Claude sessions, then verify the token, reachability, and project scope"
        className={cn(
          "flex items-center gap-1.5 px-2 py-0.5 rounded border text-md transition-colors disabled:opacity-60 disabled:cursor-wait",
          state === "error" ? "border-red/30 text-red hover:bg-red/10"
            : state === "warn" ? "border-yellow/30 text-yellow hover:bg-yellow/10"
            : state === "ok" ? "border-green/30 text-green hover:bg-green/10"
            : "border-overlay0/30 text-overlay1 hover:bg-surface0",
        )}
      >
        {state === "running" ? <Loader2 size={11} className="animate-spin shrink-0" />
          : state === "ok" ? <Check size={11} className="shrink-0" />
          : state === "warn" ? <TriangleAlert size={11} className="shrink-0" />
          : <Plug size={11} className="shrink-0" />}
        {label}
      </button>
      {checks.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-0.5 pt-0.5">
          {checks.map((c) => <CheckRow key={c.name} check={c} />)}
        </ul>
      )}
      {error && checks.length === 0 && <span className="text-md text-red pl-0.5">{error}</span>}
    </div>
  );
}

/** Generate a fresh, human-readable tmux session name for a Claude launch.
 *  The `claude-` prefix lets the Sessions tab + badge row label it as Claude. */
function freshClaudeTmuxName(): string {
  return `claude-${Date.now().toString(36)}`;
}

/** Claude Terminal — opens the live SSH popup for this VM and launches Claude
 *  inside a fresh tmux session (xterm.js renderer). tmux-backed so the session
 *  survives SSH drops, shows up in the tmux badge row, and can be reattached. */
function ClaudeManageButton({
  vm,
  sshUser,
  linked,
}: {
  vm: ManageVm;
  sshUser: string;
  linked: { project: { id: string }; instance: { id: string } } | null;
}) {
  const enabled = !!linked;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [menuOpen]);
  const openClaude = () => {
    if (!linked) return;
    const projectId = linked.project.id;
    const instanceId = linked.instance.id;
    openVmConnectionWindow({
      projectId,
      instanceId,
      host: vm.host,
      port: 22,
      username: sshUser,
      vmLabel: `Claude · ${vm.name}`,
      initialCommand: "cd /opt/project && claude --dangerously-skip-permissions",
      tmuxIntent: "new",
      tmuxSessionName: freshClaudeTmuxName(),
    });
    // Re-probe so the new tmux session lands in the badge row once it's up
    // (session creation lags the connect by the shell-command delay).
    window.setTimeout(() => refreshVmTmuxSessions(projectId, instanceId, { force: true }), 2500);
    window.setTimeout(() => refreshVmTmuxSessions(projectId, instanceId, { force: true }), 6000);
  };
  const openChat = () => {
    if (!linked) return;
    const ownerId = $auth.getValue().user?.id;
    if (!ownerId) return;
    void openClaudeChatWindow({ ownerId, projectId: linked.project.id, instanceId: linked.instance.id, label: `${vm.name} · Claude` });
  };
  const reason = enabled ? undefined : "Attach this VM to a project to enable Claude/SSH terminals";
  return (
    <div className="relative flex items-stretch" ref={menuRef}>
      <button
        onClick={openChat}
        disabled={!enabled}
        className={cn(
          "flex items-center gap-1.5 pl-2 pr-2 py-0.5 rounded-l-md border border-peach/30 text-md text-peach outline-none transition-colors",
          enabled ? "hover:bg-peach/10" : "opacity-40 cursor-not-allowed",
        )}
        title={reason ?? `Open Claude Chat for ${vm.name} (use the menu for a terminal session)`}
      >
        <ClaudeLogo size={11} />
        Claude
      </button>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        disabled={!enabled}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Claude launch options"
        className={cn(
          "flex items-center px-1 py-0.5 rounded-r-md border border-l-0 border-peach/30 text-peach outline-none transition-colors",
          enabled ? "hover:bg-peach/10" : "opacity-40 cursor-not-allowed",
          menuOpen && "bg-peach/15",
        )}
        title="Open options"
      >
        <ChevronDown size={12} className={cn("transition-transform", menuOpen && "rotate-180")} />
      </button>
      {menuOpen && enabled && (
        <div className="absolute top-full right-0 mt-1 bg-mantle border border-surface0 rounded-lg shadow-lg shadow-black/40 py-1 min-w-[160px] z-50 overflow-hidden">
          <button
            onClick={() => { openChat(); setMenuOpen(false); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 bg-transparent border-none cursor-pointer text-peach hover:bg-surface0 outline-none transition-colors text-left"
            style={{ fontSize: 12 }}
          >
            <ClaudeLogo size={12} />
            <span className="flex-1">Claude Chat</span>
            <span className="text-overlay0" style={{ fontSize: 10 }}>default</span>
            <span className="px-1 py-px rounded bg-mauve/15 text-mauve" style={{ fontSize: 9 }}>beta</span>
          </button>
          <button
            onClick={() => { openClaude(); setMenuOpen(false); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 bg-transparent border-none cursor-pointer text-text hover:bg-surface0 outline-none transition-colors text-left"
            style={{ fontSize: 12 }}
          >
            <Terminal size={12} className="text-peach shrink-0" />
            <span className="flex-1">Terminal</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** SSH-launch split-button for the Manage tab. Click the body → open a terminal
 *  as `genie` (the deploy user); click the chevron → pick a different login. */
function SshLaunchButton({
  vm,
  linked,
}: {
  vm: ManageVm;
  linked: { project: { id: string }; instance: { id: string } } | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  if (!vm.host) return null;
  const enabled = !!linked;
  const openSsh = (user: string) => {
    if (!linked) return;
    openVmConnectionWindow({
      projectId: linked.project.id,
      instanceId: linked.instance.id,
      host: vm.host,
      port: 22,
      username: user,
      vmLabel: vm.name,
    });
  };
  const defaultUser = vm.provider === "ssh" ? (vm.connection?.username || "root") : "genie";
  const imageDefault = imageDefaultUser(vm.image);
  const userChoices = sshUserChoicesFor(vm);
  const disabledTitle = enabled ? undefined : "Attach this VM to a project to open an SSH terminal";
  return (
    <div className="relative inline-flex items-stretch">
      <button
        onClick={() => openSsh(defaultUser)}
        disabled={!enabled}
        className={cn(
          "flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-l border border-r-0 border-blue/30 text-md text-blue transition-colors",
          enabled ? "hover:bg-blue/10" : "opacity-40 cursor-not-allowed",
        )}
        title={disabledTitle ?? `Open SSH terminal — ${defaultUser}@${vm.host}`}
      >
        <Terminal size={11} />
        SSH
      </button>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        disabled={!enabled}
        className={cn(
          "flex items-center px-1 rounded-r border border-blue/30 text-blue transition-colors",
          enabled ? "hover:bg-blue/10" : "opacity-40 cursor-not-allowed",
        )}
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
  const [fontSize] = useWindowFontSize();
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
        <WindowFontSizeButton className="flex items-center gap-0.5 px-1 py-1 rounded text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer" />
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
      <div
        className="overflow-y-auto px-4 py-3 flex-1"
        style={{ zoom: WINDOW_FONT_SCALE[fontSize] } as React.CSSProperties}
      >
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

  let projInst: { label: string; ipv6: string; image?: string; projectId: string; domain?: string; domainUrl?: string } | null = null;
  if (!adminVm) {
    for (const p of projects) {
      const inst = p.vpsInstances.find((i) => i.tazcloud?.vmId === vmId);
      if (inst && inst.tazcloud) {
        projInst = {
          label: inst.label,
          ipv6: inst.tazcloud.ipv6 || inst.connection.host,
          image: inst.tazcloud.image,
          projectId: p.id,
          domain: inst.domain,
          domainUrl: inst.domainUrl,
        };
        break;
      }
    }
  }
  const projLabel = projInst?.label ?? "";
  const projIpv6 = projInst?.ipv6 ?? "";
  const projImage = projInst?.image;
  const projProjectId = projInst?.projectId ?? null;
  const projDomain = projInst?.domain ?? null;
  const projDomainUrl = projInst?.domainUrl ?? null;

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
      return {
        id: vmId, name: projLabel, host: projIpv6, image: projImage, projectId: projProjectId, provider: "tazcloud",
        ingress: projDomain ? { domain: projDomain, url: projDomainUrl ?? undefined } : null,
      };
    }
    if (sshInst) {
      return { id: vmId, name: sshLabel, host: sshHost, projectId: sshProjectId, provider: "ssh", instanceId: sshInstanceId, connection: { username: sshUsername, privateKeyPath: sshKeyPath } };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmId, !!adminVm, adminName, adminIpv6, adminImage, adminProjectId, adminIngressDomain, adminIngressUrl, adminIsPrivateHost, !!projInst, projLabel, projIpv6, projImage, projProjectId, projDomain, projDomainUrl, !!sshInst, sshLabel, sshHost, sshProjectId, sshInstanceId, sshUsername, sshKeyPath]);

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

/** Loose SSH public-key check: `<type> <base64>[ comment]`. */
function isValidSshPublicKey(s: string): boolean {
  return /^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-\S+|sk-\S+@openssh\.com)\s+[A-Za-z0-9+/]+=*(\s+\S.*)?$/.test(s.trim());
}

/** Lets the operator authorize their own SSH public key on the VM so they can
 *  connect from their own terminal. Appends (idempotently) to the authorized_keys
 *  of whichever user `exec` runs as (genie on DO/Hetzner). */
function AddSshKeyForm({ exec, connectUser, host }: { exec: VmExecFn; connectUser: string; host: string }) {
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "running" | "added" | "present" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const valid = isValidSshPublicKey(key);

  async function add() {
    const k = key.trim();
    if (!isValidSshPublicKey(k)) return;
    setState("running"); setError(null);
    const safe = k.replace(/'/g, "'\\''");
    const cmd =
      `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && ` +
      `grep -qxF '${safe}' ~/.ssh/authorized_keys && echo GENIE_KEY_PRESENT || { echo '${safe}' >> ~/.ssh/authorized_keys && echo GENIE_KEY_ADDED; }`;
    try {
      const res = await exec(cmd);
      if (res.error) { setState("error"); setError(res.output?.trim().slice(0, 300) || "SSH exec failed"); return; }
      if (res.output.includes("GENIE_KEY_ADDED")) { setState("added"); setKey(""); }
      else if (res.output.includes("GENIE_KEY_PRESENT")) { setState("present"); }
      else { setState("error"); setError(res.output?.trim().slice(0, 300) || "Unexpected response"); }
    } catch (e: unknown) {
      setState("error"); setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mb-3 rounded-md border border-overlay0/15 bg-mantle/40 px-3 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <KeyRound size={12} className="text-blue" />
        <span className="text-md font-medium text-subtext0">Add your SSH key</span>
      </div>
      <p className="text-xs text-overlay0 mb-2">
        Authorize your public key to connect from your own terminal:&nbsp;
        <span className="font-mono text-overlay1">ssh {connectUser}@{host}</span>
      </p>
      <textarea
        value={key}
        onChange={(e) => { setKey(e.target.value); setState("idle"); }}
        placeholder="ssh-ed25519 AAAA... you@laptop"
        spellCheck={false}
        rows={2}
        className="w-full bg-background border border-surface0 rounded px-2 py-1.5 text-xs font-mono text-text outline-none focus:border-blue resize-y"
      />
      <div className="flex items-center gap-2 mt-2">
        <Button size="sm" variant="primary" onClick={add} disabled={!valid || state === "running"}>
          {state === "running" ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
          {state === "running" ? "Adding…" : "Add key"}
        </Button>
        {key.trim() && !valid && <span className="text-xs text-yellow">Not a valid SSH public key.</span>}
        {state === "added" && <span className="text-xs text-green inline-flex items-center gap-1"><Check size={11} /> Key authorized.</span>}
        {state === "present" && <span className="text-xs text-overlay1">Already authorized.</span>}
        {state === "error" && <span className="text-xs text-red font-mono truncate">{error}</span>}
      </div>
    </div>
  );
}

type ManageTab = "manage" | "ssh" | "firewall" | "ports" | "processes" | "sessions" | "traffic" | "agents" | "claude-logs" | "claude-memory" | "claude-plugins" | "files" | "db" | "commands" | "github";

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
  // (login-shell quirks, npm cache paths, etc). Claude uses `claudeSshUser`
  // derived from this plus Genie Standard Setup when known. DigitalOcean droplets are provisioned with genie
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
    // Genie-provisioned VMs all use the unified `genie` user now: Taz dropped
    // per-image users (ubuntu/almalinux/…), DO/Hetzner ship with genie. The old
    // "probe as the image user, fall back if genie isn't set up" dance just
    // auth-failed as `ubuntu` on these VMs — pin genie.
    return "genie";
  });

  useEffect(() => {
    setResolvedUser(vm.provider === "ssh" ? (vm.connection?.username || "root") : "genie");
  }, [vm.id, vm.host, vm.provider, vm.connection?.username]);

  const user = resolvedUser ?? imageDefault;

  const [tab, setTab] = useState<ManageTab>("manage");
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const selectTab = useCallback((next: ManageTab) => {
    // track() → wsSend() → ws-log notify() fans out to subscribers' setState, so
    // it must NOT run inside the setState updater — React runs updaters during
    // render, which triggered "Cannot update a component while rendering another".
    // selectTab is only called from event handlers, so fire the side effect here
    // in the handler body; read current tab via a ref to avoid a stale closure.
    if (tabRef.current !== next) track("tab.view", { scope: "manage", tab: next });
    setTab(next);
  }, []);
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
          : vm.provider === "hetzner"
            ? i.hetzner?.serverId === Number(vm.id)
            : i.digitalocean?.dropletId === Number(vm.id),
    );
    if (!instance) return null;
    return { project, instance };
  }, [projects, vm.projectId, vm.id, vm.provider, vm.instanceId]);

  const hasProject = !!linked;
  const vpsDeploy = useDeepSubjectAll<VpsDeployState>($vpsDeploy);
  const streamStats = linked ? vpsDeploy.instances[linked.instance.id]?.stats ?? null : null;
  const streamError = linked ? vpsDeploy.instances[linked.instance.id]?.statsError ?? null : null;

  useEffect(() => {
    if (!sshStatsPostbackEnabled() || !linked) return;
    const projectId = linked.project.id;
    const instanceId = linked.instance.id;
    const t = window.setTimeout(() => watchVpsStats(projectId, instanceId), 8000);
    return () => {
      window.clearTimeout(t);
      unwatchVpsStats(projectId, instanceId);
    };
  }, [linked?.project.id, linked?.instance.id]);

  const [tunnelState, setTunnelState] = useState<"idle" | "connecting" | "ready" | "error">("idle");
  const [tunnelError, setTunnelError] = useState<string | null>(null);

  const tunnelPayload = useMemo((): AdminServerTunnelPayload | null => {
    if (resolvedUser === null) return null;
    if (!canUseAdminExec && linked) {
      return { projectId: linked.project.id, instanceId: linked.instance.id };
    }
    if (vm.provider === "tazcloud") {
      return { provider: "tazcloud", vmId: vm.id, host: vm.host, sshUser: user };
    }
    if (vm.provider === "do") {
      return { provider: "do", dropletId: Number(vm.id), sshUser: user };
    }
    if (vm.provider === "hetzner") {
      // No native hetzner tunnel branch on the manager — pre-warm via the linked
      // project when attached; bare servers skip the pre-warm (admin exec opens
      // its own SSH connection on demand).
      return linked ? { projectId: linked.project.id, instanceId: linked.instance.id } : null;
    }
    if (vm.provider === "ssh" && linked) {
      return { projectId: linked.project.id, instanceId: linked.instance.id };
    }
    return null;
  }, [resolvedUser, canUseAdminExec, linked, vm.id, vm.host, vm.provider, user]);

  const tunnelPayloadKey = tunnelPayload
    ? ("projectId" in tunnelPayload
      ? `${tunnelPayload.projectId}:${tunnelPayload.instanceId}`
      : "dropletId" in tunnelPayload
        ? `do:${tunnelPayload.dropletId}:${tunnelPayload.sshUser}`
        : `taz:${tunnelPayload.vmId}:${tunnelPayload.host}:${tunnelPayload.sshUser}`)
    : "";

  useEffect(() => {
    if (!tunnelPayload) return;
    let cancelled = false;
    setTunnelState("connecting");
    setTunnelError(null);
    void ensureAdminServerTunnelAsync(tunnelPayload)
      .then(() => {
        if (!cancelled) setTunnelState("ready");
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTunnelState("error");
          setTunnelError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
      releaseAdminServerTunnel(tunnelPayload);
      setTunnelState("idle");
    };
  }, [tunnelPayloadKey, tunnelPayload]);

  const { sharedTunnels, canViewRegistry } = useVmHostSshRegistry(vm.host);
  const sshTunnelCount = sharedTunnels.length;
  const sshChannelCount = sharedTunnels.reduce((n, t) => n + t.channelCount, 0);

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

  const genieSetup = useGenieStandardCheck({
    vm,
    linked,
    exec,
    enabled: tunnelState === "ready",
  });

  const claudeSshUser = useMemo(() => {
    if (vm.provider === "ssh") return vm.connection?.username || "root";
    if (vm.provider === "do" || vm.provider === "hetzner" || isV2) return "genie";
    if (genieSetup.installed === true) return "genie";
    return user;
  }, [vm.provider, vm.connection?.username, isV2, genieSetup.installed, user]);

  const tabs: { key: ManageTab; label: string; icon: typeof SettingsIcon; enabled: boolean; reason?: string }[] = [
    { key: "manage", label: "Manage", icon: SettingsIcon, enabled: true },
    {
      key: "ssh",
      label: canViewRegistry
        ? (sshTunnelCount > 0 ? `SSH (${sshTunnelCount} tun · ${sshChannelCount} ch)` : "SSH")
        : "SSH",
      icon: Link2,
      enabled: true,
    },
    { key: "firewall", label: "Firewall", icon: Shield, enabled: true },
    { key: "ports", label: "Ports", icon: Network, enabled: true },
    { key: "processes", label: "Processes", icon: Cpu, enabled: true },
    { key: "sessions", label: "Sessions", icon: Activity, enabled: true },
    { key: "traffic", label: "Traffic", icon: ArrowDownUp, enabled: hasProject, reason: "Attach this VM to a project to view traffic" },
    { key: "claude-logs", label: "Claude Logs", icon: ScrollText, enabled: true },
    { key: "claude-memory", label: "Claude Memory", icon: Brain, enabled: true },
    { key: "claude-plugins", label: "Claude Plugins", icon: Puzzle, enabled: true },
    { key: "commands", label: "Commands", icon: PlayCircle, enabled: hasProject, reason: "Attach this VM to a project to manage commands" },
    { key: "files", label: "Files", icon: FolderTree, enabled: hasProject, reason: "Attach this VM to a project to browse files" },
    { key: "db", label: "DB", icon: DatabaseIcon, enabled: hasProject, reason: "Attach this VM to a project to browse the database" },
    { key: "github", label: "Github", icon: GitBranch, enabled: hasProject, reason: "Attach this VM to a project to register repos" },
    { key: "agents", label: "Agents", icon: Bot, enabled: hasProject, reason: "Attach this VM to a project to see its agents" },
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
              onClick={() => t.enabled && selectTab(t.key)}
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

      {/* Visible explanation for the dimmed tabs — the per-tab `reason` is only
       *  a hover tooltip, which most users miss. Shows a single line under the
       *  tab bar whenever any project-gated tab is disabled (currently
       *  Commands / Files / DB, all keyed off `hasProject`). */}
      {!hasProject && (
        <div className="text-xs text-overlay0 bg-mantle border border-surface0 rounded-md px-2.5 py-1.5 flex items-start gap-2">
          <Link2 size={12} className="shrink-0 mt-0.5 text-overlay1" />
          <span className="leading-relaxed">
            <span className="text-subtext0">Commands, Files and DB are disabled</span> — these
            tabs need a Genie project to resolve the SSH connection. Attach this VM as a
            server on a project (from the project's <span className="font-mono text-subtext0">Servers</span> panel)
            to enable them.
          </span>
        </div>
      )}

      {resolvedUser === null ? (
        <div className="flex items-center gap-2 text-overlay0 text-md py-4">
          <Loader2 size={14} className="animate-spin" /> Detecting SSH user…
        </div>
      ) : tunnelState === "connecting" ? (
        <div className="flex items-center gap-2 text-overlay0 text-md py-4">
          <Loader2 size={14} className="animate-spin" /> Opening SSH tunnel…
        </div>
      ) : tunnelState === "error" ? (
        <div className="text-red text-md py-4">
          SSH tunnel failed: {tunnelError ?? "unknown error"}
        </div>
      ) : (
        <>
          {tab === "manage" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-green font-mono">
                  SSH tunnel · {user}@{vm.host}
                </span>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <CheckGenieSetupButton
                    checking={genieSetup.checking}
                    installed={genieSetup.installed}
                    onCheck={genieSetup.runCheck}
                    disabled={!genieSetup.recipe}
                  />
                  {linked && (
                    <SyncStatsAgentButton
                      projectId={linked.project.id}
                      instanceId={linked.instance.id}
                    />
                  )}
                  {linked && (
                    <InstallMcpsButton
                      projectId={linked.project.id}
                      instanceId={linked.instance.id}
                    />
                  )}
                  <ClaudeManageButton vm={vm} sshUser={claudeSshUser} linked={linked} />
                  <SshLaunchButton vm={vm} linked={linked} />
                </div>
              </div>
              {linked && (
                <TmuxSessionBadges
                  variant="row"
                  projectId={linked.project.id}
                  instanceId={linked.instance.id}
                  host={vm.host}
                  sshUser={claudeSshUser}
                  vmName={vm.name}
                />
              )}
              {vm.provider === "do" && linked && (
                <DropletSleepControl projectId={linked.project.id} instanceId={linked.instance.id} />
              )}
              {sshStatsPostbackEnabled() && linked ? (
                <VpsResourceBar
                  host={vm.host}
                  ipv6={vm.host.includes(":")}
                  isPrivateHost={vm.isPrivateHost}
                  domain={vm.ingress ? { name: vm.ingress.domain, url: vm.ingress.url } : null}
                  stats={streamStats ? vpsStatsToBarStats(streamStats) : null}
                  statsLoading={!streamStats && !streamError}
                  statsError={streamError ?? undefined}
                  onRefresh={
                    sshStatsProbeEnabled()
                      ? () => fetchVpsStats(linked.project.id, linked.instance.id)
                      : undefined
                  }
                  refreshLoading={sshStatsProbeEnabled() && !streamStats && !streamError}
                />
              ) : sshStatsProbeEnabled() ? (
                <VpsResourceGauges
                  exec={exec}
                  host={vm.host}
                  domain={vm.ingress ? { name: vm.ingress.domain, url: vm.ingress.url } : null}
                  isPrivateHost={vm.isPrivateHost}
                />
              ) : (
                <VpsResourceBar
                  host={vm.host}
                  ipv6={vm.host.includes(":")}
                  isPrivateHost={vm.isPrivateHost}
                  domain={vm.ingress ? { name: vm.ingress.domain, url: vm.ingress.url } : null}
                  stats={null}
                  statsError={null}
                />
              )}
              <AdminRecipesPanel exec={exec} deferAutoCheckMs={8000} />
              <AdminSystemPanel exec={exec} view="services" deferRefreshMs={5000} />
            </div>
          )}

          {tab === "firewall" && (
            <VpsFirewall exec={exec} />
          )}

          {tab === "ports" && (
            // Panel only mounts when the Ports tab is open, so check immediately
            // (no defer) — the SSH tunnel is already up by the time you get here.
            <AdminSystemPanel exec={exec} view="ports" />
          )}

          {tab === "processes" && (
            <VpsProcessesPanel exec={exec} />
          )}

          {tab === "sessions" && (
            <VmSessionsTab vmHost={vm.host} />
          )}

          {tab === "claude-logs" && (
            <VmClaudeLogsTab exec={exec} />
          )}
          {tab === "claude-memory" && (
            <VmClaudeMemoryTab exec={exec} />
          )}
          {tab === "claude-plugins" && (
            <ClaudePluginsPanel exec={exec} deferAutoCheckMs={2000} />
          )}
        </>
      )}

      {tab === "ssh" && (
        <>
          <AddSshKeyForm exec={exec} connectUser={user} host={vm.host} />
          <VmHostConnectionsPanel {...connectionPanelProps} view="ssh" />
        </>
      )}

      {tab === "commands" && linked && (
        <CommandsTab project={linked.project} instance={linked.instance} />
      )}

      {tab === "files" && linked && (
        <div className="h-[600px]">
          <FileExplorer project={linked.project} instance={linked.instance} />
        </div>
      )}

      {tab === "db" && linked && (
        <div className="h-[600px]">
          <DbExplorer project={linked.project} instance={linked.instance} />
        </div>
      )}

      {tab === "github" && linked && (
        <VmGithubTab projectId={linked.project.id} instanceId={linked.instance.id} />
      )}

      {tab === "traffic" && linked && (
        <VmTrafficTab projectId={linked.project.id} instanceId={linked.instance.id} />
      )}

      {tab === "agents" && linked && (
        <VmAgentsTab projectId={linked.project.id} instanceId={linked.instance.id} />
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: PersistedTerminalSession } | null>(null);
  const [renameTarget, setRenameTarget] = useState<PersistedTerminalSession | null>(null);

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

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleSessionRename = useCallback((session: PersistedTerminalSession) => {
    if (!session.projectId || !session.instanceId) {
      window.alert("Cannot rename — session is not linked to a project VPS.");
      return;
    }
    setRenameTarget(session);
  }, []);

  const submitSessionRename = useCallback((newName: string) => {
    if (!renameTarget?.projectId || !renameTarget.instanceId) return;
    const tmuxName = renameTarget.id;
    void renameVmTmuxSession(renameTarget.projectId, renameTarget.instanceId, tmuxName, newName).then((res) => {
      setRenameTarget(null);
      if (res.error) window.alert(res.output || "Rename failed");
      else refresh();
    });
  }, [renameTarget, refresh]);

  const handleSessionDelete = useCallback(async (session: PersistedTerminalSession) => {
    if (session.projectId && session.instanceId) {
      const res = await killVmTmuxSession(session.projectId, session.instanceId, session.id);
      if (res.error) {
        window.alert(res.output || "Delete failed");
        throw new Error(res.output || "Delete failed");
      }
    }
    killPersistedTerminal(session.id);
    refresh();
  }, [refresh]);

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
            const isClaude = s.kind === "claude" || s.kind === "claude-tmux";
            const baseLabel = isClaude ? "Claude" : "Shell";
            const tmuxSuffix = s.kind === "claude-tmux" ? " (tmux)" : "";
            const title = s.commandLabel ? `${s.commandLabel}${tmuxSuffix}` : `${baseLabel}${tmuxSuffix}`;
            return (
              <li
                key={s.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-surface0/40 transition-colors"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, session: s });
                }}
              >
                <Terminal size={14} className={cn("shrink-0", isClaude ? "text-mauve" : "text-overlay1")} />
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
      {contextMenu && (
        <TmuxSessionContextMenu
          sessionName={contextMenu.session.commandLabel || contextMenu.session.id}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          onRename={() => handleSessionRename(contextMenu.session)}
          onDelete={async () => handleSessionDelete(contextMenu.session)}
          deleteConfirmMessage={`Kill terminal session "${contextMenu.session.commandLabel || contextMenu.session.id}"?`}
        />
      )}
      {renameTarget && (
        <TmuxRenameDialog
          sessionName={renameTarget.id}
          onConfirm={submitSessionRename}
          onClose={() => setRenameTarget(null)}
        />
      )}
    </div>
  );
}
