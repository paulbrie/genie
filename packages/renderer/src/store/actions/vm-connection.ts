/**
 * Actions for the live SSH terminal popup (new connection layer).
 * One SSH connection per (projectId, instanceId) — never reused across popups.
 */
import { batch } from "subjecto";

import { wsSend } from "@/lib/ws";
import { disposeTerminal } from "@/lib/terminal-bridge";
import { $vmConnections } from "../subjects/vps";
import type { VmConnectionState } from "../types/vps";
import { watchVpsStats, unwatchVpsStats } from "./vps";

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

export type OpenProjectVmArgs = {
  projectId: string;
  instanceId: string;
  host: string;
  port?: number;
  username: string;
  vmLabel: string;
  /** Shell command to run once the session is ready (e.g. launch Claude). */
  initialCommand?: string;
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
      openedAt: Date.now(),
    };
  });
  wsSend("terminal:start", {
    terminalId,
    projectId: args.projectId,
    instanceId: args.instanceId,
    cols: 80,
    rows: 24,
    ...(args.initialCommand ? { initialCommand: args.initialCommand } : {}),
  });
  // Subscribe to the VM's live daemon stats — each HTTPS postback the VM sends
  // is fanned out by the manager as `vps:stats:update` and updates the gauges in
  // real time. The one-shot refresh below just populates gauges + tmux instantly
  // (tmux only comes from the SSH probe, not the daemon payload).
  watchVpsStats(args.projectId, args.instanceId);
  wsSend("vps:stats:refresh", { projectId: args.projectId, instanceId: args.instanceId });
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
      openedAt: Date.now(),
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
  });
  return key;
}

export function refreshVmStats(key: string): void {
  const c = $vmConnections.getValue().connections[key];
  if (!c) return;
  if (c.projectId && c.instanceId) {
    wsSend("vps:stats:refresh", { projectId: c.projectId, instanceId: c.instanceId });
  }
}

export function injectVmCommand(key: string, command: string): void {
  const c = $vmConnections.getValue().connections[key];
  if (!c) return;
  wsSend("terminal:inject", { terminalId: c.terminalId, command });
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
