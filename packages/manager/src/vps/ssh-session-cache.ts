import {
  connectSsh,
  type ShellHandle,
  type SshConnectionConfig,
  type SshSession,
} from "./ssh-client.js";
import { sshConnRegister, sshConnUnregister } from "./ssh-metrics.js";

// One SSH client per (host, port, username). Manage UI pins via manageRefs;
// interactive terminals lease PTY shell channels on the same connection.

const IDLE_TTL_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

export type ServerTunnelKey = string;

export function serverTunnelKey(cfg: SshConnectionConfig): ServerTunnelKey {
  return `${cfg.host}:${cfg.port}:${cfg.username}`;
}

function keyOf(cfg: SshConnectionConfig): ServerTunnelKey {
  return serverTunnelKey(cfg);
}

export interface SharedChannelSnapshot {
  terminalId: string;
  status: "open" | "closed";
  cols: number;
  rows: number;
  projectId: string | null;
  instanceId: string | null;
  openedAt: number;
  bytesIn: number;
  bytesOut: number;
}

export interface SharedTunnelSnapshot {
  key: ServerTunnelKey;
  host: string;
  port: number;
  username: string;
  status: "connecting" | "connected" | "disconnected";
  manageRefs: number;
  channelCount: number;
  execInFlight: boolean;
  pinned: boolean;
  openedAt: number;
  channels: SharedChannelSnapshot[];
}

interface ChannelEntry {
  terminalId: string;
  cols: number;
  rows: number;
  projectId: string | null;
  instanceId: string | null;
  openedAt: number;
  handle: ShellHandle | null;
  ptyRegistryId: string | null;
  onReady?: () => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

interface SharedTunnelEntry {
  cfg: SshConnectionConfig;
  session: SshSession | null;
  manageRefs: number;
  channels: Map<string, ChannelEntry>;
  lastUsed: number;
  openedAt: number;
  execInFlight: boolean;
}

const cache = new Map<string, SharedTunnelEntry>();
const inflightDials = new Map<string, Promise<SshSession>>();

/** ssh2 allows multiple channels per connection, but overlapping execs on one
 *  cached session (stats fan-out + bundle upload) can stall probes for 30s+ on
 *  busy VMs. Serialize exec per cached session. */
const execTail = new WeakMap<SshSession, Promise<unknown>>();

function execSerialized<T>(session: SshSession, run: () => Promise<T>): Promise<T> {
  const prev = execTail.get(session) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(run);
  execTail.set(session, next);
  return next;
}

function isActive(entry: SharedTunnelEntry): boolean {
  return entry.manageRefs > 0 || entry.channels.size > 0;
}

function evictIfIdle(key: string): void {
  const entry = cache.get(key);
  if (!entry || isActive(entry)) return;
  try { entry.session?.close(); } catch { /* ignore */ }
  for (const ch of entry.channels.values()) {
    if (ch.ptyRegistryId) sshConnUnregister(ch.ptyRegistryId);
    try { ch.handle?.close(); } catch { /* ignore */ }
  }
  entry.channels.clear();
  entry.session = null;
  cache.delete(key);
}

function onSharedSessionClosed(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.session = null;
  for (const ch of [...entry.channels.values()]) {
    if (ch.ptyRegistryId) {
      sshConnUnregister(ch.ptyRegistryId);
      ch.ptyRegistryId = null;
    }
    ch.handle = null;
    ch.onClose?.();
  }
}

function startDial(key: string, cfg: SshConnectionConfig): Promise<SshSession> {
  if (!inflightDials.has(key)) {
    let resolveDial!: (s: SshSession) => void;
    let rejectDial!: (err: unknown) => void;
    const dial = new Promise<SshSession>((resolve, reject) => {
      resolveDial = resolve;
      rejectDial = reject;
    });
    inflightDials.set(key, dial);

    void connectSsh(cfg, {
      onSessionClosed: () => onSharedSessionClosed(key),
    })
      .then((session) => {
        const entry = cache.get(key);
        if (entry) {
          entry.session = session;
          entry.lastUsed = Date.now();
        } else {
          cache.set(key, {
            cfg,
            session,
            manageRefs: 0,
            channels: new Map(),
            lastUsed: Date.now(),
            openedAt: Date.now(),
            execInFlight: false,
          });
        }
        resolveDial(session);
        return session;
      })
      .catch((err) => {
        const entry = cache.get(key);
        if (entry && !entry.session && entry.manageRefs === 0 && entry.channels.size === 0) {
          cache.delete(key);
        }
        rejectDial(err);
      })
      .finally(() => {
        if (inflightDials.get(key) === dial) inflightDials.delete(key);
      });
  }
  return inflightDials.get(key)!;
}

function ensureEntry(cfg: SshConnectionConfig): SharedTunnelEntry {
  const key = keyOf(cfg);
  let entry = cache.get(key);
  if (!entry) {
    entry = {
      cfg,
      session: null,
      manageRefs: 0,
      channels: new Map(),
      lastUsed: Date.now(),
      openedAt: Date.now(),
      execInFlight: false,
    };
    cache.set(key, entry);
  }
  return entry;
}

export async function getCachedSession(cfg: SshConnectionConfig): Promise<SshSession> {
  const key = keyOf(cfg);
  const entry = ensureEntry(cfg);
  if (entry.session) {
    entry.lastUsed = Date.now();
    return entry.session;
  }
  return startDial(key, cfg);
}

/** @deprecated Use manage ref API — kept for callers that only need pin semantics. */
export function pinServerTunnel(cfg: SshConnectionConfig): void {
  ensureEntry(cfg).manageRefs++;
}

/** @deprecated */
export function unpinServerTunnel(cfg: SshConnectionConfig): void {
  releaseManageRef(cfg);
}

export function isServerTunnelPinned(cfg: SshConnectionConfig): boolean {
  const entry = cache.get(keyOf(cfg));
  return (entry?.manageRefs ?? 0) > 0;
}

/** Establish (or reuse) one SSH tunnel for this server and pin until release. */
export async function ensureServerTunnel(cfg: SshConnectionConfig): Promise<SshSession> {
  ensureEntry(cfg).manageRefs++;
  return getCachedSession(cfg);
}

/** Decrement Manage popup ref; evict only when no terminals are attached. */
export function releaseServerTunnel(cfg: SshConnectionConfig): void {
  releaseManageRef(cfg);
}

export function releaseManageRef(cfg: SshConnectionConfig): void {
  const key = keyOf(cfg);
  const entry = cache.get(key);
  if (!entry) return;
  entry.manageRefs = Math.max(0, entry.manageRefs - 1);
  evictIfIdle(key);
}

/** Ensure shared tunnel exists for a terminal (does not bump manageRefs). */
export async function acquireTerminalTunnel(cfg: SshConnectionConfig): Promise<SshSession> {
  return getCachedSession(cfg);
}

export type OpenTerminalChannelOpts = {
  terminalId: string;
  cols: number;
  rows: number;
  projectId: string | null;
  instanceId: string | null;
  onData: (data: Buffer) => void;
  onReady: () => void;
  onError: (message: string) => void;
  onClose: () => void;
};

export async function openTerminalChannel(
  cfg: SshConnectionConfig,
  opts: OpenTerminalChannelOpts,
): Promise<void> {
  const key = keyOf(cfg);
  const entry = ensureEntry(cfg);
  closeTerminalChannel(opts.terminalId);

  const ch: ChannelEntry = {
    terminalId: opts.terminalId,
    cols: opts.cols,
    rows: opts.rows,
    projectId: opts.projectId,
    instanceId: opts.instanceId,
    openedAt: Date.now(),
    handle: null,
    ptyRegistryId: null,
    onReady: opts.onReady,
    onError: opts.onError,
    onClose: opts.onClose,
  };
  entry.channels.set(opts.terminalId, ch);
  entry.lastUsed = Date.now();

  try {
    const session = await getCachedSession(cfg);
    const handle = await session.openShell({
      cols: opts.cols,
      rows: opts.rows,
      onData: opts.onData,
      onClose: () => {
        const live = entry.channels.get(opts.terminalId);
        if (!live) return;
        if (live.ptyRegistryId) {
          sshConnUnregister(live.ptyRegistryId);
          live.ptyRegistryId = null;
        }
        live.handle = null;
        entry.channels.delete(opts.terminalId);
        evictIfIdle(key);
        live.onClose?.();
      },
    });
    ch.handle = handle;
    ch.ptyRegistryId = sshConnRegister({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      kind: "pty",
      parentKey: key,
      end: () => { try { handle.close(); } catch { /* ignore */ } },
    });
    ch.onReady?.();
  } catch (err) {
    entry.channels.delete(opts.terminalId);
    evictIfIdle(key);
    opts.onError(err instanceof Error ? err.message : "Failed to open shell channel");
    throw err;
  }
}

export function closeTerminalChannel(terminalId: string): void {
  for (const [key, entry] of cache) {
    const ch = entry.channels.get(terminalId);
    if (!ch) continue;
    if (ch.ptyRegistryId) {
      sshConnUnregister(ch.ptyRegistryId);
      ch.ptyRegistryId = null;
    }
    try { ch.handle?.close(); } catch { /* ignore */ }
    entry.channels.delete(terminalId);
    evictIfIdle(key);
    return;
  }
}

export function getTerminalChannelHandle(terminalId: string): ShellHandle | null {
  for (const entry of cache.values()) {
    const ch = entry.channels.get(terminalId);
    if (ch?.handle?.isOpen()) return ch.handle;
  }
  return null;
}

/** Count of connected pooled SSH tunnels — one per (host, port, username),
 *  regardless of how many pty channels or cached-exec calls are multiplexed on
 *  it. This is what the sidebar SSH gauge shows: "how many VM tunnels are open",
 *  not the raw per-channel registry count (which inflates with every terminal). */
export function getActiveTunnelCount(): number {
  let n = 0;
  for (const entry of cache.values()) {
    if (entry.session) n++;
  }
  return n;
}

export function listSharedTunnels(): SharedTunnelSnapshot[] {
  const out: SharedTunnelSnapshot[] = [];
  for (const [key, entry] of cache) {
    const channels: SharedChannelSnapshot[] = [];
    for (const ch of entry.channels.values()) {
      const traffic = ch.handle?.getTraffic() ?? { bytesIn: 0, bytesOut: 0 };
      channels.push({
        terminalId: ch.terminalId,
        status: ch.handle?.isOpen() ? "open" : "closed",
        cols: ch.cols,
        rows: ch.rows,
        projectId: ch.projectId,
        instanceId: ch.instanceId,
        openedAt: ch.openedAt,
        bytesIn: traffic.bytesIn,
        bytesOut: traffic.bytesOut,
      });
    }
    out.push({
      key,
      host: entry.cfg.host,
      port: entry.cfg.port,
      username: entry.cfg.username,
      status: entry.session ? "connected" : inflightDials.has(key) ? "connecting" : "disconnected",
      manageRefs: entry.manageRefs,
      channelCount: entry.channels.size,
      execInFlight: entry.execInFlight,
      pinned: entry.manageRefs > 0,
      openedAt: entry.openedAt,
      channels,
    });
  }
  return out.sort((a, b) => a.openedAt - b.openedAt);
}

/** Forcibly drop the cached session for `cfg`. Closes all channels first. */
export function evictSession(cfg: SshConnectionConfig): void {
  const key = keyOf(cfg);
  const entry = cache.get(key);
  if (!entry) return;
  for (const ch of [...entry.channels.values()]) {
    if (ch.ptyRegistryId) sshConnUnregister(ch.ptyRegistryId);
    try { ch.handle?.close(); } catch { /* ignore */ }
  }
  entry.channels.clear();
  entry.manageRefs = 0;
  try { entry.session?.close(); } catch { /* ignore */ }
  entry.session = null;
  cache.delete(key);
}

/** Drop every cached session targeting `host` (all ports/users). */
export function evictAllSessionsForHost(host: string): void {
  const clearedInflight = [...inflightDials.keys()].filter((k) => k.startsWith(`${host}:`));
  for (const k of clearedInflight) inflightDials.delete(k);
  for (const [key, entry] of cache) {
    if (entry.cfg.host !== host) continue;
    evictSession(entry.cfg);
  }
}

export async function execCached(
  cfg: SshConnectionConfig,
  command: string,
  onData?: (data: string) => void,
  opts?: { timeoutMs?: number; idleTimeoutMs?: number },
): Promise<string> {
  const key = keyOf(cfg);
  const entry = ensureEntry(cfg);
  entry.execInFlight = true;
  try {
    const session = await getCachedSession(cfg);
    return await execSerialized(session, () => session.exec(command, onData, opts));
  } catch (err) {
    evictSession(cfg);
    if (err instanceof Error && err.message.includes("timed out")) throw err;
    const session = await getCachedSession(cfg);
    return await execSerialized(session, () => session.exec(command, onData, opts));
  } finally {
    const live = cache.get(key);
    if (live) live.execInFlight = false;
  }
}

export function evictAllSessions(): void {
  inflightDials.clear();
  for (const entry of [...cache.values()]) {
    evictSession(entry.cfg);
  }
}

export function cachedSessionCount(): number {
  return cache.size;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (isActive(entry)) continue;
    if (entry.session && now - entry.lastUsed > IDLE_TTL_MS) {
      evictIfIdle(key);
    }
  }
}, SWEEP_INTERVAL_MS).unref();
