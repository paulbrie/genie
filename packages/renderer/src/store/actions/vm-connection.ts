/**
 * Actions for the live SSH terminal popup (new connection layer).
 * Terminals lease PTY channels on the manager's shared SSH tunnel per host:user.
 */
import { batch } from "subjecto";

import { onWsClose, wsSend } from "@/lib/ws";
import { clearTerminal, disposeTerminal, getTerminalSize } from "@/lib/terminal-bridge";
import { $vmConnections, $vpsDeploy } from "../subjects/vps";
import type { VmConnectionState, VmTmuxSession } from "../types/vps";
import { ensureInstanceState, watchVpsStats, unwatchVpsStats, resubscribeVpsStatsWatches, refreshVmTmuxSessions } from "./vps";
import { $manager } from "../subjects";

/** Each call to openProjectVmConnection / openDirectVmConnection mints a fresh
 *  key so the same VM can have multiple independent popups open at once. The
 *  (projectId, instanceId) tuple is *not* the uniqueness key — `nonce` is. */
export function projectVmKey(projectId: string, instanceId: string, nonce: string): string {
  return `${projectId}:${instanceId}:${nonce}`;
}

export function directVmKey(host: string, username: string, nonce: string): string {
  return `direct:${host}:${username}:${nonce}`;
}

function freshNonce(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function freshTerminalId(): string {
  return `term-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/** Apply `vm:conn:stats` probe results to $vmConnections slots and $vpsDeploy. */
export function applyVmConnStats(payload: {
  projectId: string;
  instanceId: string;
  stats: { cpu: number; mem: number; disk: number } | null;
  tmux: VmTmuxSession[];
  error: string | null;
  tmuxProbePath?: "exec" | "pty";
}): void {
  const { projectId, instanceId, stats, tmux, error, tmuxProbePath } = payload;
  if (error === "in_flight") return;

  const tmuxList = tmux || [];
  const now = Date.now();

  // Only replace the session list when we got sessions, or exec confirmed empty.
  // PTY probes inside an attached tmux often return unparseable noise — never
  // wipe a good list with an empty PTY result.
  const trustEmpty = tmuxProbePath === "exec" || tmuxProbePath == null;
  const shouldUpdateTmux = tmuxList.length > 0 || (trustEmpty && !error);

  batch(() => {
    const conns = $vmConnections.getValue().connections;
    for (const slot of Object.values(conns)) {
      if (slot.projectId !== projectId || slot.instanceId !== instanceId) continue;
      if (stats) slot.stats = stats;
      if (shouldUpdateTmux) slot.tmuxSessions = tmuxList;
      if (error) slot.statsError = error;
      else slot.statsError = null;
      slot.lastTmuxAt = now;
    }
    ensureInstanceState(instanceId);
    const inst = $vpsDeploy.getValue().instances[instanceId];
    if (shouldUpdateTmux) inst.tmuxSessions = tmuxList;
    inst.lastTmuxAt = now;
    inst.tmuxProbeError = error;
  });
}

export type OpenProjectVmArgs = {
  projectId: string;
  instanceId: string;
  host: string;
  port?: number;
  username: string;
  vmLabel: string;
  /** Shell command to run once the session is ready (e.g. launch Claude). */
  initialCommand?: string;
  /** tmux launch mode. `"new"` + `initialCommand` runs the command inside a
   *  fresh (attach-or-create) tmux session; `"attach"` reattaches to an existing
   *  `tmuxSessionName`. Omit for a plain shell / direct command. */
  tmuxIntent?: "new" | "attach";
  tmuxSessionName?: string;
};

export type OpenDirectVmArgs = {
  host: string;
  port?: number;
  username: string;
  privateKeyPath: string;
  vmLabel: string;
};

/** Mints a fresh connection every call — each click opens its own popup. */
export function openProjectVmConnection(args: OpenProjectVmArgs): string {
  const key = projectVmKey(args.projectId, args.instanceId, freshNonce());
  const terminalId = freshTerminalId();
  const port = args.port ?? 22;
  batch(() => {
    $vmConnections.getValue().connections[key] = {
      key,
      projectId: args.projectId,
      instanceId: args.instanceId,
      host: args.host,
      port,
      username: args.username,
      vmLabel: args.vmLabel,
      terminalId,
      status: "connecting",
      errorMessage: null,
      bytesIn: 0,
      bytesOut: 0,
      stats: null,
      statsError: null,
      sshSessions: null,
      tmuxSessions: [],
      lastStatsAt: null,
      lastTmuxAt: null,
      openedAt: Date.now(),
      ...(args.initialCommand ? { initialCommand: args.initialCommand } : {}),
      ...(args.tmuxIntent ? { tmuxIntent: args.tmuxIntent } : {}),
      ...(args.tmuxSessionName ? { tmuxSessionName: args.tmuxSessionName } : {}),
    };
  });
  wsSend("terminal:start", {
    terminalId,
    projectId: args.projectId,
    instanceId: args.instanceId,
    cols: 80,
    rows: 24,
    kind: args.initialCommand ? "claude" : "shell",
    ...(args.initialCommand ? { initialCommand: args.initialCommand } : {}),
    ...(args.tmuxIntent ? { tmuxIntent: args.tmuxIntent } : {}),
    ...(args.tmuxSessionName ? { tmuxSessionName: args.tmuxSessionName } : {}),
  });
  // Subscribe to the VM's live daemon stats — each HTTPS postback the VM sends
  // is fanned out by the manager as `vps:stats:update` and updates the gauges in
  // real time. The one-shot refresh below just populates gauges + tmux instantly
  // (tmux only comes from the SSH probe, not the daemon payload).
  watchVpsStats(args.projectId, args.instanceId);
  refreshVmTmuxSessions(args.projectId, args.instanceId, { force: true });
  return key;
}

export function openDirectVmConnection(args: OpenDirectVmArgs): string {
  const key = directVmKey(args.host, args.username, freshNonce());
  const terminalId = freshTerminalId();
  const port = args.port ?? 22;
  batch(() => {
    $vmConnections.getValue().connections[key] = {
      key,
      projectId: null,
      instanceId: null,
      host: args.host,
      port,
      username: args.username,
      vmLabel: args.vmLabel,
      terminalId,
      status: "connecting",
      errorMessage: null,
      bytesIn: 0,
      bytesOut: 0,
      stats: null,
      statsError: null,
      sshSessions: null,
      tmuxSessions: [],
      lastStatsAt: null,
      lastTmuxAt: null,
      openedAt: Date.now(),
      privateKeyPath: args.privateKeyPath,
    };
  });
  wsSend("terminal:start", {
    terminalId,
    host: args.host,
    port,
    username: args.username,
    privateKeyPath: args.privateKeyPath,
    cols: 80,
    rows: 24,
    kind: "shell",
  });
  return key;
}

export function refreshVmStats(key: string, opts?: { force?: boolean }): void {
  const c = $vmConnections.getValue().connections[key];
  if (!c?.projectId || !c.instanceId) return;
  refreshVmTmuxSessions(c.projectId, c.instanceId, { force: opts?.force ?? false });
}

export function injectVmCommand(
  key: string,
  command: string,
  opts?: { silent?: boolean },
): void {
  const c = $vmConnections.getValue().connections[key];
  if (!c) return;
  wsSend("terminal:inject", { terminalId: c.terminalId, command, silent: opts?.silent ?? false });
}

/** Write raw bytes straight to the PTY (no shell wrapping, no echo suppression).
 *  Used to drive tmux command-mode keys (prefix + ':' + command) where tmux owns
 *  the echo and the text never lands in the scrollback or in Claude's input. */
export function sendVmRawData(key: string, data: string): void {
  const c = $vmConnections.getValue().connections[key];
  if (!c) return;
  wsSend("terminal:data", { terminalId: c.terminalId, data });
}

/** Track which tmux session a live popup is attached to (drives badge selection). */
export function setVmConnectionTmuxSession(key: string, sessionName: string): void {
  const c = $vmConnections.getValue().connections[key];
  if (!c) return;
  batch(() => {
    c.tmuxSessionName = sessionName;
    c.tmuxIntent = "attach";
  });
}

/** Ship a clipboard image to the live PTY. Manager writes the bytes via SFTP
 *  to a temp file on the VM and types the path into the shell so Claude Code
 *  reads it from its prompt. */
export async function pasteVmImage(key: string, file: Blob, suggestedExt?: string): Promise<void> {
  const c = $vmConnections.getValue().connections[key];
  if (!c) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  // Tight base64 — manual loop is faster than chunked btoa via FileReader for
  // typical screenshots (≤ a few MB).
  let bin = "";
  for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
  const dataB64 = btoa(bin);
  const ext = (suggestedExt || extFromMime(file.type) || "png").toLowerCase();
  wsSend("terminal:paste-image", { terminalId: c.terminalId, dataB64, ext });
}

function extFromMime(mime: string): string | null {
  if (!mime) return null;
  const m = /^image\/([a-z0-9.+-]+)$/i.exec(mime);
  if (!m) return null;
  const sub = m[1].toLowerCase();
  if (sub === "jpeg") return "jpg";
  if (sub === "svg+xml") return "svg";
  return sub.replace(/\W+/g, "");
}

export function reconnectVmConnection(key: string): void {
  const c = $vmConnections.getValue().connections[key];
  if (!c) return;
  clearTerminal(c.terminalId);
  batch(() => {
    c.status = "connecting";
    c.errorMessage = null;
    c.bytesIn = 0;
    c.bytesOut = 0;
  });
  wsSend("terminal:close", { terminalId: c.terminalId });
  const size = getTerminalSize(c.terminalId) ?? { cols: 80, rows: 24 };
  const tmuxIntent = c.tmuxSessionName
    ? c.tmuxIntent === "new"
      ? "attach"
      : (c.tmuxIntent ?? "attach")
    : c.tmuxIntent;
  const startPayload = {
    terminalId: c.terminalId,
    cols: size.cols,
    rows: size.rows,
    kind: c.initialCommand ? "claude" : "shell",
    ...(tmuxIntent ? { tmuxIntent } : {}),
    ...(c.tmuxSessionName ? { tmuxSessionName: c.tmuxSessionName } : {}),
    ...(tmuxIntent === "new" && c.initialCommand ? { initialCommand: c.initialCommand } : {}),
  };
  if (c.projectId && c.instanceId) {
    wsSend("terminal:start", {
      ...startPayload,
      projectId: c.projectId,
      instanceId: c.instanceId,
    });
    watchVpsStats(c.projectId, c.instanceId);
    refreshVmTmuxSessions(c.projectId, c.instanceId, { force: true });
    return;
  }
  if (c.privateKeyPath) {
    wsSend("terminal:start", {
      ...startPayload,
      host: c.host,
      port: c.port,
      username: c.username,
      privateKeyPath: c.privateKeyPath,
    });
  }
}

function markVmConnectionsDisconnected(reason: string): void {
  batch(() => {
    for (const slot of Object.values($vmConnections.getValue().connections)) {
      if (slot.status !== "connecting" && slot.status !== "connected") continue;
      slot.status = "closed";
      slot.errorMessage = reason;
    }
  });
}

onWsClose((reason) => {
  markVmConnectionsDisconnected(reason);
});

/** Re-dial every open VM popup after the manager socket (and auth) are back.
 *  Skips slots in `error` — those need manual intervention. */
export function reconnectOpenVmConnections(): void {
  for (const key of Object.keys($vmConnections.getValue().connections)) {
    const c = $vmConnections.getValue().connections[key];
    if (!c || c.status === "error") continue;
    if (c.status === "closed" || c.status === "connecting" || c.status === "connected") {
      reconnectVmConnection(key);
    }
  }
}

let lastManagerRunning = $manager.getValue().running;
$manager.subscribe((m) => {
  if (!lastManagerRunning && m.running) {
    resubscribeVpsStatsWatches();
  }
  lastManagerRunning = m.running;
});

export function closeVmConnection(key: string): void {
  const c = $vmConnections.getValue().connections[key];
  if (!c) return;
  wsSend("terminal:close", { terminalId: c.terminalId });
  disposeTerminal(c.terminalId);
  if (c.projectId && c.instanceId) unwatchVpsStats(c.projectId, c.instanceId);
  batch(() => {
    delete $vmConnections.getValue().connections[key];
  });
}

/** Find the connection for a terminalId — used by inbound handlers. */
export function findVmConnectionByTerminalId(terminalId: string): VmConnectionState | null {
  const state = $vmConnections.getValue();
  for (const c of Object.values(state.connections)) {
    if (c.terminalId === terminalId) return c;
  }
  return null;
}
