import { existsSync } from "node:fs";
import net from "node:net";
import { Client } from "ssh2";
import { sshConnRegister, sshConnUnregister, captureSshOpenerStack } from "./vps/ssh-metrics.js";
import { tazSocksProxy } from "./vps/socks-dial.js";
import { buildConnectOptions, dialSock } from "./vps/ssh-client.js";
import type { PtySessionKind } from "./pty-session-service.js";

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

export type PtyLaunchKind = "shell" | "claude" | "claude-tmux";

export interface ClaudeLaunchSpec {
  cwd?: string;
  resume?: boolean;
}

export interface SshPtyConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  /** Structured launch (preferred). When `launchKind` is `claude`, use `claude`. */
  launchKind?: PtyLaunchKind;
  claude?: ClaudeLaunchSpec;
  /** Legacy shell command string; still accepted for recipe terminals and old rows. */
  initialCommand?: string;
  /** When set, the remote command is wrapped in tmux so process state survives
   *  SSH channel drops. Requires `tmux` on the VPS. */
  tmuxSessionName?: string;
  /** When true (History reattach for shell tabs), attach to an existing tmux
   *  session with `tmuxSessionName` if present. Fresh spawns default to false
   *  and always kill any same-named session before starting a new one. */
  tmuxAttachExisting?: boolean;
  /** Kill a leftover tmux session with this name before a non-tmux command
   *  (used for Claude, which never runs inside tmux). */
  clearStaleTmuxSession?: string;
  /** Persistence wrapper for the remote command. `"dtach"` wraps the inner
   *  command in dtach so process state survives SSH channel drops without
   *  exposing tmux's UX baggage (status bar, Ctrl-b, "[detached]" banner). The
   *  socket lives at {@link dtachSocketPath} on tmpfs, so it survives popup /
   *  tab / laptop close but is cleared by a VM reboot. `"none"` is the legacy
   *  direct-exec path. Tmux is selected via the `tmuxSessionName` field on the
   *  same config and is mutually exclusive with `"dtach"`. */
  persistence?: "dtach" | "none";
  /** Absolute path of the dtach socket on the VM. Defaults to
   *  `/run/genie/dtach/<sessionId>.sock` — override only when migrating an
   *  existing session or in tests. */
  dtachSocketPath?: string;
}

/** Default dtach socket dir on the VM. `/tmp` is universally writable by the
 *  SSH user (unlike `/run/...` which needs systemd RuntimeDirectory + sudo)
 *  and is wiped on reboot on every distro we target (Ubuntu / Debian / RHEL-
 *  family). Dotfile prefix keeps the dir out of casual `ls /tmp` output. */
export const DTACH_SOCKET_DIR = "/tmp/.genie-dtach";

export function defaultDtachSocketPath(sessionId: string): string {
  return `${DTACH_SOCKET_DIR}/${sessionId}.sock`;
}

/** tmux policy:
 *    • `claude`      → direct PTY, no tmux (kill any stale session with this id first).
 *    • `claude-tmux` → wrap in tmux just like `shell` so the process survives drops
 *                      and a Sessions-tab reattach picks it back up.
 *    • `shell`       → spawn replaces stale sessions; reattach attaches to existing. */
export function sshPtyTmuxPolicy(
  sessionId: string,
  opts: { kind?: PtyLaunchKind | string; mode: "spawn" | "reattach" },
): Pick<SshPtyConfig, "tmuxSessionName" | "tmuxAttachExisting" | "clearStaleTmuxSession"> {
  if (opts.kind === "claude") {
    return { clearStaleTmuxSession: sessionId };
  }
  if (opts.mode === "reattach") {
    return { tmuxSessionName: sessionId, tmuxAttachExisting: true };
  }
  return { tmuxSessionName: sessionId, tmuxAttachExisting: false };
}

/** Dtach policy — the new default for shell and claude kinds. Sets up a
 *  deterministic socket path so reopening the popup hits the same live
 *  process. Mutually exclusive with `sshPtyTmuxPolicy`; callers pick one. */
export function sshPtyDtachPolicy(
  sessionId: string,
): Pick<SshPtyConfig, "persistence" | "dtachSocketPath"> {
  return { persistence: "dtach", dtachSocketPath: defaultDtachSocketPath(sessionId) };
}

/** Quote a string for safe use inside POSIX-shell single-quotes. */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export const DEFAULT_PROJECT_DIR = "/opt/project";

const CLAUDE_BASE = "claude --dangerously-skip-permissions";

/** Persisted label for History / notifications (no `cd` prefix). */
export function claudeCommandLabel(resume?: boolean): string {
  return resume ? `${CLAUDE_BASE} --resume` : CLAUDE_BASE;
}

function claudeInnerFromSpec(spec: ClaudeLaunchSpec): { startDir: string; inner: string } {
  let inner = CLAUDE_BASE;
  if (spec.resume) inner += " --resume";
  return { startDir: spec.cwd?.trim() || DEFAULT_PROJECT_DIR, inner };
}

/** Direct PTY exec for Claude (no nested login shell / tmux). */
function claudeDirectExecCommand(config: SshPtyConfig, spec: ClaudeLaunchSpec): string {
  const { startDir, inner: claudeCmd } = claudeInnerFromSpec(spec);
  const stalePrefix = config.clearStaleTmuxSession
    ? `tmux kill-session -t ${config.clearStaleTmuxSession} 2>/dev/null || true; `
    : "";
  return `${stalePrefix}cd ${startDir} 2>/dev/null || true; export TERM=xterm-256color; exec ${claudeCmd}`;
}

/** tmux inner command — login shell + exec claude. */
function claudeLoginShellCommand(spec: ClaudeLaunchSpec): string {
  const { startDir, inner: claudeCmd } = claudeInnerFromSpec(spec);
  const compound = `cd ${startDir} 2>/dev/null || true; ${claudeCmd}`;
  return `exec $SHELL -ilc ${shSingleQuote(compound)}`;
}

/** ssh `exec` runs one command string — multi-line tmux scripts need a shell wrapper. */
function wrapRemoteShellScript(script: string): string {
  if (!script.includes("\n")) return script;
  return `exec bash -lc ${shSingleQuote(script)}`;
}

/** Build the remote command for a dtach-wrapped PTY. `dtach -A` attaches if a
 *  live master is bound to the socket, else creates a new session running
 *  `inner`. dtach handles orphan sockets natively in -A mode (ECONNREFUSED →
 *  unlink + create), so no manual zombie cleanup is needed.
 *
 *  Flags:
 *    -E  no escape character (default would be Ctrl-\\; users could accidentally
 *        detach by typing it).
 *    -z  suppress dtach's "Attached." / "[detached]" banner — the wrapper must
 *        be invisible to the user. */
function buildDtachWrappedCommand(sessionId: string, config: SshPtyConfig): string {
  const socketPath = config.dtachSocketPath || defaultDtachSocketPath(sessionId);
  let inner: string;
  let startDir = DEFAULT_PROJECT_DIR;

  if (config.launchKind === "claude" && config.claude) {
    const { startDir: sd, inner: claudeCmd } = claudeInnerFromSpec(config.claude);
    startDir = sd;
    inner = claudeCmd;
  } else if (config.initialCommand?.trim()) {
    inner = `$SHELL -ilc ${shSingleQuote(config.initialCommand.trim())}`;
  } else {
    inner = `$SHELL -l`;
  }

  const script = [
    `mkdir -p ${shSingleQuote(DTACH_SOCKET_DIR)} 2>/dev/null || true`,
    `chmod 700 ${shSingleQuote(DTACH_SOCKET_DIR)} 2>/dev/null || true`,
    `cd ${startDir} 2>/dev/null || true`,
    `export TERM=xterm-256color`,
    `exec dtach -A ${shSingleQuote(socketPath)} -E -z ${inner}`,
  ].join("\n");

  return wrapRemoteShellScript(script);
}

/** Map WS `terminal:ssh:spawn` / `vps:terminal:spawn` launch fields onto PTY config. */
export function sshPtyLaunchFromSpawnMessage(input: {
  kind?: PtyLaunchKind;
  command?: string;
  cwd?: string;
  claudeResume?: boolean;
}): Pick<SshPtyConfig, "launchKind" | "claude" | "initialCommand"> {
  if (input.kind === "claude" || input.kind === "claude-tmux") {
    return {
      launchKind: input.kind,
      claude: {
        cwd: input.cwd?.trim() || DEFAULT_PROJECT_DIR,
        resume: !!input.claudeResume,
      },
    };
  }
  if (input.kind === "shell") {
    return { launchKind: "shell", initialCommand: input.command };
  }
  // Legacy clients: infer from command string.
  const cmd = input.command?.trim();
  if (cmd && (cmd.startsWith("claude") || /^cd\s+\S+\s*&&\s*claude/.test(cmd))) {
    const cdThen = cmd.match(/^cd\s+(\S+)\s*&&\s*(.+)$/);
    if (cdThen) {
      return {
        launchKind: "claude",
        claude: { cwd: cdThen[1], resume: cdThen[2].includes("--resume") },
      };
    }
    return {
      launchKind: "claude",
      claude: { cwd: DEFAULT_PROJECT_DIR, resume: cmd.includes("--resume") },
    };
  }
  return { initialCommand: input.command };
}

export function isClaudeTerminalSpawn(input: {
  kind?: PtyLaunchKind;
  command?: string;
  title?: string;
}): boolean {
  if (input.kind === "claude" || input.kind === "claude-tmux") return true;
  const cmd = input.command?.trim();
  if (cmd?.startsWith("claude") || (cmd && /^cd\s+\S+\s*&&\s*claude/.test(cmd))) return true;
  return input.title?.toLowerCase().startsWith("claude") ?? false;
}

/** What goes into pty_sessions.kind for this spawn — preserves the tmux variant
 *  so a Sessions-tab reattach knows to use tmux attach instead of a fresh PTY. */
export function persistedKindForSpawn(input: {
  kind?: PtyLaunchKind;
  command?: string;
  title?: string;
}): PtySessionKind {
  if (input.kind === "claude-tmux") return "claude-tmux";
  if (isClaudeTerminalSpawn(input)) return "claude";
  return "shell";
}

export function persistCommandLabelForSpawn(input: {
  kind?: PtyLaunchKind;
  command?: string;
  title?: string;
  claudeResume?: boolean;
}): string | null {
  if (isClaudeTerminalSpawn(input)) {
    return claudeCommandLabel(!!input.claudeResume || (input.command?.includes("--resume") ?? false));
  }
  return input.command || input.title || null;
}

/** Reconstruct structured launch from a persisted session row. */
export function ptyLaunchFieldsFromPersisted(row: {
  kind: string;
  commandLabel: string | null;
}): Pick<SshPtyConfig, "launchKind" | "claude" | "initialCommand"> {
  const label = row.commandLabel?.trim() ?? "";
  if (row.kind === "claude" || row.kind === "claude-tmux"
      || label.startsWith("claude") || /^cd\s+\S+\s*&&\s*claude/.test(label)) {
    const launchKind: PtyLaunchKind = row.kind === "claude-tmux" ? "claude-tmux" : "claude";
    const cdThen = label.match(/^cd\s+(\S+)\s*&&\s*(.+)$/);
    if (cdThen) {
      return {
        launchKind,
        claude: { cwd: cdThen[1], resume: cdThen[2].includes("--resume") },
      };
    }
    return {
      launchKind,
      claude: { cwd: DEFAULT_PROJECT_DIR, resume: label.includes("--resume") },
    };
  }
  return { initialCommand: row.commandLabel || undefined };
}

/** How a brand-new tmux session starts. */
function resolveTmuxInnerCommand(config: SshPtyConfig): {
  startDir?: string;
  inner: string;
} {
  const defaultShell = `cd ${DEFAULT_PROJECT_DIR} 2>/dev/null || true; exec $SHELL -l`;

  if ((config.launchKind === "claude" || config.launchKind === "claude-tmux") && config.claude) {
    return { inner: claudeLoginShellCommand(config.claude) };
  }

  const initialCommand = config.initialCommand;
  if (!initialCommand?.trim()) {
    return { inner: defaultShell };
  }

  // Legacy clients that still send `cd … && claude …` as one shell string.
  const trimmed = initialCommand.trim();
  const cdThen = trimmed.match(/^cd\s+(\S+)\s*&&\s*(.+)$/);
  if (cdThen) {
    const rest = cdThen[2].trim();
    if (rest.startsWith("claude")) {
      const compound = `cd ${cdThen[1]} 2>/dev/null || true; ${rest}`;
      return { inner: `exec $SHELL -ilc ${shSingleQuote(compound)}` };
    }
  }

  if (trimmed.startsWith("claude")) {
    const compound = `cd ${DEFAULT_PROJECT_DIR} 2>/dev/null || true; ${trimmed}`;
    return { inner: `exec $SHELL -ilc ${shSingleQuote(compound)}` };
  }

  return { inner: trimmed };
}

/** Compose the remote command we send to ssh.exec(). When persistence is
 *  "dtach" the command is wrapped in dtach (process survives SSH drops, no
 *  tmux baggage). When tmuxSessionName is set the inner command is wrapped in
 *  tmux instead (legacy path, History-tab claude-tmux). Otherwise direct exec. */
function buildRemoteCommand(sessionId: string, config: SshPtyConfig): string {
  // dtach takes precedence over tmux — the two are mutually exclusive
  // persistence layers and dtach is the new default for shell/claude.
  if (config.persistence === "dtach") {
    return buildDtachWrappedCommand(sessionId, config);
  }

  // Non-tmux path:
  //   - no command → open an interactive login shell (the default terminal).
  //   - with a command → run it through an interactive login shell (`$SHELL -ilc`)
  //     and `exec` so it replaces the shell and becomes the controlling-terminal
  //     foreground process with job control enabled. This makes a TUI like
  //     `claude` behave exactly as if typed in an SSH session. A plain
  //     non-interactive `bash -c "claude"` can't grab the terminal, so claude
  //     exits immediately (the bug behind "[Process exited with code 0]").
  const killStaleTmux = (name: string) => `tmux kill-session -t ${name} 2>/dev/null || true; `;

  if (!config.tmuxSessionName) {
    const stalePrefix = config.clearStaleTmuxSession
      ? killStaleTmux(config.clearStaleTmuxSession)
      : "";
    // Note: launchKind "claude-tmux" should always reach the tmux branch (the
    // policy sets tmuxSessionName for it). This direct-exec path is only for
    // launchKind "claude" — explicit direct-PTY-no-tmux variant.
    if (config.launchKind === "claude" && config.claude) {
      return claudeDirectExecCommand(config, config.claude);
    }
    if (!config.initialCommand) {
      return `${stalePrefix}cd /opt/project 2>/dev/null || true; exec $SHELL -l`;
    }
    return `${stalePrefix}exec $SHELL -ilc ${shSingleQuote(config.initialCommand)}`;
  }
  const { startDir, inner } = resolveTmuxInnerCommand(config);
  const name = config.tmuxSessionName!;
  const cdFlag = startDir ? ` -c ${shSingleQuote(startDir)}` : "";
  // Genie-defined tmux defaults. `set-option -g` is the new-session default;
  // existing sessions keep their own copy, so we also `-t ${name}` when the
  // session already exists. Idempotent; starts the tmux server if needed.
  //
  //   focus-events on   — Claude Code + other TUIs use it to detect focus
  //                       changes; without it they print a startup notice.
  //   status off        — hide the tmux status bar so the TUI gets the full
  //                       pane height. The Genie History panel already shows
  //                       session name + last-active info, so the tmux status
  //                       line is redundant inside Genie's window chrome.
  //   mouse on          — Required so wheel events do something useful. With
  //                       `mouse off`, xterm.js sees the alt-screen buffer
  //                       (tmux always uses it) and applies "alternate scroll
  //                       mode" (DEC 1007): wheel-up/down → Up/Down arrow
  //                       sequences. Those reach the inner app and cycle shell
  //                       history (or Claude's input-prompt history). With
  //                       `mouse on`, tmux captures wheel via the SGR mouse
  //                       protocol and either forwards it to a mouse-aware app
  //                       or enters copy-mode to scroll tmux's scrollback —
  //                       which is the behavior users expect from "scroll the
  //                       popup". Native xterm.js drag-selection still works
  //                       via Option+drag (Mac) / Alt+drag, the standard
  //                       escape hatch when the inner app captures the mouse.
  //   history-limit     — generous scrollback so reattaches show useful context.
  const setGlobal = [
    'tmux set-option -g focus-events on 2>/dev/null || true',
    'tmux set-option -g status off 2>/dev/null || true',
    'tmux set-option -g mouse on 2>/dev/null || true',
    'tmux set-option -g history-limit 50000 2>/dev/null || true',
  ].join('; ');
  const setForExisting = [
    `tmux set-option -t ${name} focus-events on 2>/dev/null || true`,
    `tmux set-option -t ${name} status off 2>/dev/null || true`,
    `tmux set-option -t ${name} mouse on 2>/dev/null || true`,
  ].join('; ');
  const freshTmux = [
    setGlobal,
    killStaleTmux(name).trimEnd(),
    `exec tmux new${cdFlag} -s ${name} ${shSingleQuote(inner)}`,
  ].join('\n');

  if (config.tmuxAttachExisting !== true) {
    return wrapRemoteShellScript(freshTmux);
  }

  const attachOrNew = [
    `if tmux has-session -t ${name} 2>/dev/null; then`,
    `  ${setForExisting};`,
    `  exec tmux attach -t ${name};`,
    `fi`,
    `exec tmux new${cdFlag} -s ${name} ${shSingleQuote(inner)}`,
  ].join('\n');

  return wrapRemoteShellScript([setGlobal, attachOrNew].join('\n'));
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
  // Replace a stale in-memory session (React strict-mode remount, respawn, etc.).
  if (sessions.has(id)) closePty(id);

  let conn = new Client();
  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((info: { exitCode: number }) => void) | null = null;
  let channel: import("ssh2").ClientChannel | null = null;
  const pendingWrites: string[] = [];
  let currentCols = cols;
  let currentRows = rows;
  let cancelled = false;
  // everReady: the shell exec succeeded at least once → a later drop is a
  // mid-session disconnect (handled by the close path), not an initial-connect
  // failure (handled by tryConnect's retry/IPv6 logic). settled: we've emitted a
  // final outcome (exit or disconnect) for this session — emit it exactly once.
  let everReady = false;
  let settled = false;

  const flushPendingWrites = () => {
    if (!channel) return;
    for (const chunk of pendingWrites) channel.write(chunk);
    pendingWrites.length = 0;
  };

  const proc: PtyHandle = {
    write: (data) => {
      if (channel) channel.write(data);
      else pendingWrites.push(data);
    },
    resize: (c, r) => {
      currentCols = c;
      currentRows = r;
      channel?.setWindow(r, c, r * 16, c * 8);
    },
    kill: () => {
      cancelled = true;
      channel?.close();
      try { conn.destroy(); } catch { /* ignore */ }
    },
    onData: (cb) => { dataCallback = cb; },
    onExit: (cb) => { exitCallback = cb; },
  };

  registerSession(id, proc, ownerId);

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

  let registryId: string | null = null;
  // Capture the caller's stack synchronously — the `ready` event fires from
  // inside ssh2's event loop where the original caller has long unwound.
  const openerStack = captureSshOpenerStack();

  function tryConnect(): void {
    if (cancelled) return;
    attempt++;
    try { conn.destroy(); } catch { /* ignore — may be a fresh Client on first attempt */ }
    conn = new Client();

    // Same Railway/userspace-WG route as connectSsh — see ssh-client.ts. Hosts
    // outside 10.128/16 or with no GENIE_TAZ_SOCKS env dial directly. SOCKS
    // failures are emitted as conn errors so the retry/backoff path handles
    // them with the same UX as a normal transient SSH failure.
    dialSock(config, PER_ATTEMPT_TIMEOUT_MS)
      .then((sock) => {
        if (cancelled) { if (sock) try { sock.destroy(); } catch { /* ignore */ } return; }
        conn.connect(buildConnectOptions(config, { sock, timeoutMs: PER_ATTEMPT_TIMEOUT_MS }));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        conn.emit("error", new Error(`SOCKS dial via ${tazSocksProxy()} failed: ${err.message}`));
      });

    conn
      .on("ready", () => {
        if (!registryId) {
          registryId = sshConnRegister({
            host: config.host,
            port: config.port,
            username: config.username,
            kind: "pty",
            end: () => { try { conn.destroy(); } catch { /* ignore */ } },
            openerStack,
          });
        }
        if (cancelled) { conn.end(); return; }
        const shellCmd = buildRemoteCommand(id, config);
        conn.exec(shellCmd, { pty: { cols: currentCols, rows: currentRows, term: "xterm-256color" } }, (err, stream) => {
          if (err) {
            eventCallback?.({ type: "terminal:error", payload: { id, message: `SSH shell failed: ${err.message}` } });
            sessions.delete(id);
            conn.end();
            return;
          }
          channel = stream;
          everReady = true;
          stream.setWindow(currentRows, currentCols, currentRows * 16, currentCols * 8);
          flushPendingWrites();
          stream.on("data", (data: Buffer) => dataCallback?.(data.toString()));
          // ssh2 reports the real exit status via the 'exit' event (code OR a
          // terminating signal); the 'close' event carries no code, so the old
          // `close(code)` read was always undefined → reported as 0 for every
          // session. Capture 'exit' and surface the true code on close.
          let remoteExitCode: number | null = null;
          stream.on("exit", (code: number | null, signal?: string) => {
            if (typeof code === "number") {
              remoteExitCode = code;
            } else if (signal) {
              // Conventional 128+signal encoding; also note it inline so the
              // user sees *why* the process died (e.g. OOM kill).
              remoteExitCode = 137;
              dataCallback?.(`\r\n\x1b[33m[terminated by signal ${signal}]\x1b[0m\r\n`);
            }
          });
          stream.on("close", () => {
            if (settled) { conn.end(); return; }
            settled = true;
            if (cancelled || remoteExitCode !== null) {
              // User kill or a real remote process exit → close the pane as today.
              exitCallback?.({ exitCode: remoteExitCode ?? 0 });
            } else {
              // Transport dropped with no remote exit code (keepalive timeout,
              // network loss). For tmux-backed kinds the remote process survives
              // and can be reattached; plain `claude` cannot. Surface a disconnect
              // the renderer offers a Reconnect button for, and drop the dead PTY.
              eventCallback?.({ type: "terminal:disconnected", payload: { id, reattachable: !!config.tmuxSessionName } });
              sessions.delete(id);
            }
            conn.end();
          });
        });
      })
      .on("close", () => {
        if (registryId) { sshConnUnregister(registryId); registryId = null; }
        // Backstop: a post-ready conn close that didn't run the channel-close path
        // still surfaces a disconnect rather than a silently frozen pane.
        if (everReady && !settled) {
          settled = true;
          if (cancelled) {
            exitCallback?.({ exitCode: 0 });
          } else {
            eventCallback?.({ type: "terminal:disconnected", payload: { id, reattachable: !!config.tmuxSessionName } });
            sessions.delete(id);
          }
        }
      })
      .on("error", (err) => {
        if (cancelled) return;
        // Once the shell is live, a transport error is a mid-session drop — let the
        // close path classify it (disconnect vs exit). The initial-connect retry,
        // IPv6 preflight, and transient handling below apply only pre-ready.
        if (everReady) return;
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

/**
 * List Claude conversation JSONLs on the VM under
 * `~/.claude/projects/-opt-project/`. Used by the popup to offer "Resume
 * previous conversation" when the dtach socket is fresh (e.g. after a VM
 * reboot) but the user had a prior session on disk. Returns up to 10 most
 * recent entries, newest first.
 */
export async function listResumableClaudeJsonls(
  sshConfig: import("./vps/ssh-client.js").SshConnectionConfig,
): Promise<Array<{ id: string; mtime: number }>> {
  const { execCached } = await import("./vps/ssh-session-cache.js");
  try {
    // `stat -c` is GNU coreutils; macOS would need -f but every VM target here
    // is Linux. Print "<mtime>\t<basename>" sorted newest first.
    const out = await execCached(
      sshConfig,
      `ls -1t ~/.claude/projects/-opt-project/*.jsonl 2>/dev/null | head -10 | while IFS= read -r f; do stat -c '%Y	%n' "$f" 2>/dev/null; done`,
      undefined,
      { timeoutMs: 5_000 },
    );
    const rows: Array<{ id: string; mtime: number }> = [];
    for (const line of out.split("\n")) {
      const [mtimeStr, fullPath] = line.split("\t");
      if (!fullPath) continue;
      const base = fullPath.trim().replace(/^.*\//, "").replace(/\.jsonl$/, "");
      const mtime = parseInt(mtimeStr, 10);
      if (!base || !Number.isFinite(mtime)) continue;
      rows.push({ id: base, mtime });
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Probe whether a dtach socket exists for `sessionId` on the VM. Used to
 * decide whether the upcoming spawn is a fresh start (no socket) or a resume
 * (live socket — the user is reconnecting to an existing process). The result
 * drives the "↻ Resumed" pill in the popup. Cheap: one `[ -S file ]` exec on
 * the cached SSH session.
 */
export async function probeDtachSocketExists(
  sshConfig: import("./vps/ssh-client.js").SshConnectionConfig,
  sessionId: string,
): Promise<boolean> {
  const { execCached } = await import("./vps/ssh-session-cache.js");
  const socketPath = defaultDtachSocketPath(sessionId);
  try {
    const out = await execCached(
      sshConfig,
      `[ -S ${shSingleQuote(socketPath)} ] && echo EXISTS || echo NEW`,
      undefined,
      { timeoutMs: 3_000 },
    );
    return out.includes("EXISTS");
  } catch {
    return false;
  }
}

/**
 * Truly destroy a dtach-wrapped session on the remote VM. closePty alone only
 * drops the SSH channel — for dtach that's a detach, the inner process keeps
 * running. Use this when the user clicks "Restart" to end the conversation /
 * shell entirely. Best-effort over the cached SSH session; safe to call when
 * the socket is already gone.
 */
export async function destroyDtachSession(
  sshConfig: import("./vps/ssh-client.js").SshConnectionConfig,
  sessionId: string,
): Promise<void> {
  const { execCached } = await import("./vps/ssh-session-cache.js");
  const socketPath = defaultDtachSocketPath(sessionId);
  // pkill -f matches the full command line — our dtach invocations always
  // include the unique socket path so the match is precise. SIGTERM gives the
  // inner process (e.g. claude) a chance to write its session JSONL before
  // exiting; the trailing rm covers the case where dtach never bound (e.g.
  // missing binary) or the file lingers.
  const cmd = [
    `pkill -TERM -f ${shSingleQuote("dtach -A " + socketPath + " ")} 2>/dev/null || true`,
    `sleep 0.3`,
    `rm -f ${shSingleQuote(socketPath)} 2>/dev/null || true`,
    `echo OK`,
  ].join("; ");
  try {
    await execCached(sshConfig, cmd, undefined, { timeoutMs: 5_000 });
  } catch {
    // Best-effort: if SSH is down or the host is gone, the next reopen with the
    // same id will create a fresh socket anyway. Don't surface the error.
  }
  // Also drop the in-memory session if it's still hanging around.
  closePty(sessionId);
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
  if (!session.ownerId) return true;
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
