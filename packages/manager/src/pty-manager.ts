import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "ssh2";

const MAX_SCROLLBACK = 100_000; // chars

interface PtyHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (info: { exitCode: number }) => void): void;
}

interface PtySession {
  proc: PtyHandle;
  id: string;
  ownerId: string;
  collaboratorIds: Set<string>;
  scrollback: string;
}

let ptyModule: typeof import("node-pty") | null = null;
let ptyLoadError: string | null = null;

async function loadPty(): Promise<typeof import("node-pty") | null> {
  if (ptyModule) return ptyModule;
  if (ptyLoadError) return null;
  try {
    ptyModule = await import("node-pty");
    return ptyModule;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ptyLoadError = message;
    console.error("Failed to load node-pty:", message);
    return null;
  }
}

const sessions = new Map<string, PtySession>();
let eventCallback: ((event: { type: string; payload: unknown }) => void) | null = null;

export function setPtyEventCallback(cb: (event: { type: string; payload: unknown }) => void): void {
  eventCallback = cb;
}

let cachedShell: string | null = null;

function resolveShell(): string {
  if (cachedShell) return cachedShell;
  const candidates = [
    process.env.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
  ];
  for (const sh of candidates) {
    if (sh && existsSync(sh)) {
      cachedShell = sh;
      return sh;
    }
  }
  cachedShell = "/bin/sh";
  return cachedShell;
}

let cachedEnv: Record<string, string> | null = null;

function buildCleanEnv(): Record<string, string> {
  if (cachedEnv) return cachedEnv;
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val !== undefined) clean[key] = val;
  }
  if (!clean.PATH || clean.PATH === "") {
    clean.PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }
  cachedEnv = clean;
  return cachedEnv;
}

export async function spawnPty(
  id: string,
  cols: number,
  rows: number,
  command?: string,
  spawnCwd?: string,
  ownerId?: string,
): Promise<void> {
  if (sessions.has(id)) return;

  const pty = await loadPty();
  if (!pty) {
    eventCallback?.({
      type: "terminal:error",
      payload: { id, message: `node-pty not available: ${ptyLoadError}` },
    });
    return;
  }

  const shell = resolveShell();
  const cwd = spawnCwd || process.env.HOME || "/tmp";
  const env = buildCleanEnv();
  const args = command ? ["-c", command] : [];

  let rawProc: import("node-pty").IPty;
  try {
    rawProc = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to spawn PTY (shell=${shell}, cwd=${cwd}):`, message);
    eventCallback?.({
      type: "terminal:error",
      payload: { id, message: `Failed to spawn shell: ${message}` },
    });
    return;
  }

  const proc: PtyHandle = {
    write: (data) => rawProc.write(data),
    resize: (c, r) => rawProc.resize(c, r),
    kill: () => rawProc.kill(),
    onData: (cb) => rawProc.onData(cb),
    onExit: (cb) => rawProc.onExit(cb),
  };

  registerSession(id, proc, ownerId);
}

function registerSession(id: string, proc: PtyHandle, ownerId?: string): void {
  const session: PtySession = { proc, id, ownerId: ownerId || "", collaboratorIds: new Set(), scrollback: "" };
  sessions.set(id, session);

  proc.onData((data: string) => {
    session.scrollback += data;
    if (session.scrollback.length > MAX_SCROLLBACK) {
      session.scrollback = session.scrollback.slice(-MAX_SCROLLBACK);
    }
    eventCallback?.({ type: "terminal:data", payload: { id, data } });
  });

  proc.onExit(({ exitCode }: { exitCode: number }) => {
    sessions.delete(id);
    eventCallback?.({ type: "terminal:exit", payload: { id, code: exitCode } });
  });
}

export interface SshPtyConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  initialCommand?: string;
}

function resolveHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return p.replace("~", os.homedir());
  }
  const genieIdx = p.indexOf(".genie/ssh/");
  if (genieIdx > 0) {
    return path.join(os.homedir(), p.slice(genieIdx));
  }
  return p;
}

export function spawnSshPty(
  id: string,
  cols: number,
  rows: number,
  config: SshPtyConfig,
  ownerId?: string,
): void {
  if (sessions.has(id)) return;

  const conn = new Client();
  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((info: { exitCode: number }) => void) | null = null;
  let channel: import("ssh2").ClientChannel | null = null;
  let currentCols = cols;
  let currentRows = rows;

  const proc: PtyHandle = {
    write: (data) => channel?.write(data),
    resize: (c, r) => {
      currentCols = c;
      currentRows = r;
      channel?.setWindow(r, c, r * 16, c * 8);
    },
    kill: () => {
      channel?.close();
      conn.end();
    },
    onData: (cb) => { dataCallback = cb; },
    onExit: (cb) => { exitCallback = cb; },
  };

  registerSession(id, proc, ownerId);

  let privateKey: Buffer | undefined;
  try {
    const keyPath = resolveHome(config.privateKeyPath);
    privateKey = readFileSync(keyPath);
  } catch {
    // fall through — will try agent auth
  }

  conn
    .on("ready", () => {
      const shellCmd = config.initialCommand || 'cd /opt/project 2>/dev/null || true; exec $SHELL -l';
      conn.exec(shellCmd, { pty: { cols: currentCols, rows: currentRows, term: "xterm-256color" } }, (err, stream) => {
        if (err) {
          eventCallback?.({ type: "terminal:error", payload: { id, message: `SSH shell failed: ${err.message}` } });
          sessions.delete(id);
          conn.end();
          return;
        }
        channel = stream;
        stream.on("data", (data: Buffer) => dataCallback?.(data.toString()));
        stream.stderr.on("data", (data: Buffer) => dataCallback?.(data.toString()));
        stream.on("close", (code: number) => {
          exitCallback?.({ exitCode: code ?? 0 });
          conn.end();
        });
      });
    })
    .on("error", (err) => {
      let message = `SSH connection failed: ${err.message}`;
      const looksLikeIpv6 = /:[0-9a-f]{1,4}:/i.test(config.host);
      if (err.message.includes("ENETUNREACH") && looksLikeIpv6) {
        message = `SSH connection failed: no IPv6 route from this manager to ${config.host}. The target is IPv6-only and your network has no IPv6 connectivity. Enable IPv6 (e.g. a Hurricane Electric tunnel) or run the manager from a host with IPv6 egress.`;
      } else if (err.message.includes("EHOSTUNREACH")) {
        message = `SSH connection failed: host unreachable (${config.host}). Check that the VM is running and your firewall/NAT permits the connection.`;
      }
      eventCallback?.({ type: "terminal:error", payload: { id, message } });
      sessions.delete(id);
    })
    .connect({
      host: config.host,
      port: config.port,
      username: config.username,
      ...(privateKey
        ? { privateKey }
        : process.env.SSH_AUTH_SOCK
          ? { agent: process.env.SSH_AUTH_SOCK }
          : {}),
      readyTimeout: 30_000,
    });
}

export function writePty(id: string, data: string): void {
  sessions.get(id)?.proc.write(data);
}

export function resizePty(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (session) {
    try {
      session.proc.resize(cols, rows);
    } catch {
      // ignore resize errors on exited pty
    }
  }
}

export function closePty(id: string): void {
  const session = sessions.get(id);
  if (session) {
    session.proc.kill();
    sessions.delete(id);
  }
}

export function closeAllPtys(): void {
  for (const [, session] of sessions) {
    session.proc.kill();
  }
  sessions.clear();
}

export function getSessionAccess(sessionId: string): { ownerId: string; collaboratorIds: string[] } | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return { ownerId: session.ownerId, collaboratorIds: [...session.collaboratorIds] };
}

export function getScrollback(sessionId: string): string {
  const session = sessions.get(sessionId);
  return session?.scrollback ?? "";
}

export function addCollaborator(sessionId: string, userId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.collaboratorIds.add(userId);
  return true;
}

export function removeCollaborator(sessionId: string, userId: string): void {
  const session = sessions.get(sessionId);
  if (session) session.collaboratorIds.delete(userId);
}

export function isAuthorized(sessionId: string, userId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return true; // allow if session not tracked
  return session.ownerId === userId || session.collaboratorIds.has(userId);
}

export function getSessionsByUser(userId: string): string[] {
  const result: string[] = [];
  for (const [id, session] of sessions) {
    if (session.ownerId === userId || session.collaboratorIds.has(userId)) {
      result.push(id);
    }
  }
  return result;
}

export function getUserSessionDetails(userId: string): Array<{
  id: string;
  ownerId: string;
  collaboratorIds: string[];
  isOwner: boolean;
}> {
  const result = [];
  for (const [id, session] of sessions) {
    if (session.ownerId === userId || session.collaboratorIds.has(userId)) {
      result.push({
        id,
        ownerId: session.ownerId,
        collaboratorIds: [...session.collaboratorIds],
        isOwner: session.ownerId === userId,
      });
    }
  }
  return result;
}

export function removeCollaboratorFromAll(userId: string): string[] {
  const affected: string[] = [];
  for (const [id, session] of sessions) {
    if (session.collaboratorIds.has(userId)) {
      session.collaboratorIds.delete(userId);
      affected.push(id);
    }
  }
  return affected;
}
