import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
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

// Errors that mean "VM exists but isn't accepting SSH yet" (still booting,
// IPv6 stack not up, sshd not bound). Retry these for a window — newly-created
// TazCloud VMs typically need 25–70s post-create before sshd binds.
const TRANSIENT_SSH_ERRORS = ["EHOSTUNREACH", "ENETUNREACH", "ECONNREFUSED", "ETIMEDOUT", "Timed out"];

function isTransientSshError(message: string): boolean {
  return TRANSIENT_SSH_ERRORS.some((t) => message.includes(t));
}

// Module-level cache for the local-IPv6-reachability probe. The host's IPv6
// state doesn't flip second-to-second, so we cache the verdict for 60s to keep
// repeated SSH attempts cheap.
let ipv6ProbeAt = 0;
let ipv6ProbeResult: boolean | null = null;
const IPV6_PROBE_TTL_MS = 60_000;
// Cloudflare's anycast DNS over IPv6 — globally reachable, no auth, port 53
// accepts TCP. Good cheap reachability target. (Falls back to Google's v6 DNS
// if the first fails, in case a network filters Cloudflare specifically.)
const IPV6_PROBE_TARGETS: Array<{ host: string; port: number }> = [
  { host: "2606:4700:4700::1111", port: 53 },
  { host: "2001:4860:4860::8888", port: 53 },
];

function probeIpv6Target(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    try {
      socket.connect({ host, port, family: 6 });
    } catch {
      done(false);
    }
  });
}

/** Check whether this host can reach the public IPv6 internet. Cached 60s. */
async function checkLocalIpv6(): Promise<boolean> {
  if (ipv6ProbeResult !== null && Date.now() - ipv6ProbeAt < IPV6_PROBE_TTL_MS) {
    return ipv6ProbeResult;
  }
  for (const t of IPV6_PROBE_TARGETS) {
    if (await probeIpv6Target(t.host, t.port, 3000)) {
      ipv6ProbeResult = true;
      ipv6ProbeAt = Date.now();
      return true;
    }
  }
  ipv6ProbeResult = false;
  ipv6ProbeAt = Date.now();
  return false;
}

function formatTerminalSshError(host: string, message: string): string {
  const looksLikeIpv6 = /:[0-9a-f]{1,4}:/i.test(host);
  if (message.includes("ENETUNREACH") && looksLikeIpv6) {
    return `SSH connection failed: no IPv6 route to ${host} (ENETUNREACH). This usually means the target VM is offline or its IPv6 tunnel is down — not necessarily a local IPv6 problem. If other IPv6 hosts work from this manager (e.g. \`ping6 2606:4700:4700::1111\`), the target is the issue. Otherwise enable IPv6 on this host (e.g. a Hurricane Electric tunnel).`;
  }
  if (message.includes("EHOSTUNREACH")) {
    return `SSH connection failed: host unreachable (${host}) after retries. The VM may still be booting (TazCloud sshd usually binds within 70s of create) — wait a moment and reopen. Otherwise check that the VM is running and your firewall/NAT permits the connection.`;
  }
  return `SSH connection failed: ${message}`;
}

export function spawnSshPty(
  id: string,
  cols: number,
  rows: number,
  config: SshPtyConfig,
  ownerId?: string,
): void {
  if (sessions.has(id)) return;

  let conn = new Client();
  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((info: { exitCode: number }) => void) | null = null;
  let channel: import("ssh2").ClientChannel | null = null;
  let currentCols = cols;
  let currentRows = rows;
  let cancelled = false;

  const proc: PtyHandle = {
    write: (data) => channel?.write(data),
    resize: (c, r) => {
      currentCols = c;
      currentRows = r;
      channel?.setWindow(r, c, r * 16, c * 8);
    },
    kill: () => {
      cancelled = true;
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

  const authConfig = privateKey
    ? { privateKey }
    : process.env.SSH_AUTH_SOCK
      ? { agent: process.env.SSH_AUTH_SOCK }
      : {};

  // Total retry budget for transient errors (VM still booting / sshd not bound).
  // TazCloud's documented post-create SSH-ready window is 25–70s; 90s covers it
  // with a margin without keeping the user waiting too long for a dead host.
  const RETRY_BUDGET_MS = 90_000;
  const RETRY_INTERVAL_MS = 5_000;
  const PER_ATTEMPT_TIMEOUT_MS = 15_000;
  const startedAt = Date.now();
  let attempt = 0;

  function emitRetryNotice(reason: string): void {
    // Render an inline notice in the terminal pane so the user sees progress
    // instead of a silent stall. \x1b[33m = yellow.
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const text = `\r\n\x1b[33m[ssh] attempt ${attempt} after ${elapsed}s: ${reason} — retrying...\x1b[0m\r\n`;
    dataCallback?.(text);
  }

  const targetLooksLikeIpv6 = /:[0-9a-f]{1,4}:/i.test(config.host);
  let ipv6PreflightDone = false;

  function failWithMessage(message: string): void {
    eventCallback?.({ type: "terminal:error", payload: { id, message } });
    sessions.delete(id);
  }

  function tryConnect(): void {
    if (cancelled) return;
    attempt++;
    conn = new Client();

    conn
      .on("ready", () => {
        if (cancelled) { conn.end(); return; }
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
        if (cancelled) return;
        const msg = err.message;
        const elapsed = Date.now() - startedAt;
        const transient = isTransientSshError(msg);
        const withinBudget = elapsed < RETRY_BUDGET_MS;

        if (transient && withinBudget) {
          // First transient error against a v6 host — probe whether this host
          // has working IPv6 at all. If not, the next 90s of retries are
          // pointless; surface the real cause now.
          if (targetLooksLikeIpv6 && !ipv6PreflightDone) {
            ipv6PreflightDone = true;
            dataCallback?.("\r\n\x1b[33m[ssh] checking local IPv6 connectivity...\x1b[0m\r\n");
            checkLocalIpv6().then((ok) => {
              if (cancelled) return;
              if (!ok) {
                failWithMessage(
                  `SSH connection failed: this host has no working IPv6 route to the public internet. ` +
                  `TazCloud VMs are IPv6-only (prefix 2001:470:1f15:97::/64 — Hurricane Electric tunnel space). ` +
                  `Fix options: (1) enable IPv6 on your ISP, (2) set up a free Hurricane Electric tunnel ` +
                  `at tunnelbroker.net, or (3) run the manager on a host with native IPv6. ` +
                  `Diagnostic: \`ping6 -c 3 2606:4700:4700::1111\` should succeed on a working host.`,
                );
                return;
              }
              // We have v6; the target is just slow. Carry on retrying.
              dataCallback?.("\r\n\x1b[32m[ssh] local IPv6 OK — target is still warming up, continuing to retry.\x1b[0m\r\n");
              emitRetryNotice(msg);
              setTimeout(tryConnect, RETRY_INTERVAL_MS);
            });
            return;
          }
          emitRetryNotice(msg);
          setTimeout(tryConnect, RETRY_INTERVAL_MS);
          return;
        }
        failWithMessage(formatTerminalSshError(config.host, msg));
      })
      .connect({
        host: config.host,
        port: config.port,
        username: config.username,
        ...authConfig,
        readyTimeout: PER_ATTEMPT_TIMEOUT_MS,
      });
  }

  tryConnect();
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
