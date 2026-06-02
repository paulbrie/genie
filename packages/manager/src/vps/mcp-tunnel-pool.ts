import * as projectService from "../project-service.js";
import { connectSsh, type SshConnectionConfig, type SshSession } from "./ssh-client.js";
import { setupMcpTunnel, type McpTunnel } from "./mcp-tunnel.js";
import { setupMcpStreamTunnel, type McpStreamTunnel } from "./mcp-stream-tunnel.js";
import { setupMcpSecurityTunnel, type McpSecurityTunnel } from "./mcp-security-tunnel.js";
import { setupMcpNotifyTunnel, type McpNotifyTunnel } from "./mcp-notify-tunnel.js";
import { setupMcpStorageTunnel, type McpStorageTunnel } from "./mcp-storage-tunnel.js";
import { remoteDir } from "./deploy-service.js";
import { buildMcpConfigMergeScript } from "./mcp-config-merge.js";
import { ensureVpsAgent, VPS_AGENT_REMOTE_BASE } from "./vps-agent-rsync.js";

// MCP tunnels share state with ws-server's user/presence layer:
//  - createDomActionExecutor routes browser actions back through the user's
//    extension socket;
//  - broadcastToUsers + broadcastTrackerList push notifications back to
//    connected clients.
// Importing them from ws-server.js creates a value-import cycle that resolves
// because none of these are used at module-load (only inside async functions).
// eslint-disable-next-line import/no-cycle
import {
  createDomActionExecutor,
  broadcastToUsers,
  broadcastTrackerList,
} from "../ws-server.js";

/* ---- Persistent MCP browser tunnels ---- */

export const MCP_BROWSER_REMOTE_PORT = 9877;
export const MCP_SECURITY_REMOTE_PORT = 9879;
export const MCP_NOTIFY_REMOTE_PORT = 9880;
export const MCP_STORAGE_REMOTE_PORT = 9881;

export interface PersistentMcpTunnel {
  sshSession: SshSession;
  mcpTunnel: McpTunnel;
  securityTunnel?: McpSecurityTunnel;
  notifyTunnel?: McpNotifyTunnel;
  storageTunnel?: McpStorageTunnel;
  /** Unix-socket stdio multiplexer. Replaces trackerTunnel-style port forwards
   *  for any MCP server registered in mcp-stream-tunnel. */
  streamTunnel?: McpStreamTunnel;
  projectName: string;
  instanceHost: string;
  openedAt: number;
  /** Flipped false by the connectTunnelSsh onSessionClosed handler when the
   *  underlying SSH session drops (now detected promptly via keepalive). A
   *  dead-but-not-yet-evicted entry reads as not-live so ensureMcpTunnelsForHost
   *  rebuilds it. */
  alive: boolean;
}

/** Shared tunnels keyed by instance host (one tunnel per VPS host). */
export const persistentMcpTunnels = new Map<string, PersistentMcpTunnel>();

/** One in-flight (re)build per host — prevents two concurrent callers (two Claude
 *  launches, or the Reconnect button racing the chat/terminal path) from both
 *  closing and rebuilding, which orphaned an SSH session + its reverse forwards.
 *  Mirrors inflightDials in ssh-session-cache.ts. */
const inflightTunnelBuilds = new Map<string, Promise<void>>();

export function tunnelKey(host: string): string {
  return host;
}

/** True only when a tunnel is registered AND its SSH session is still alive.
 *  Used by ensureMcpTunnelsForHost so a dead-but-present entry triggers a rebuild
 *  instead of a no-op (the old `.has()` check couldn't tell the difference). */
export function isTunnelLive(host: string): boolean {
  const entry = persistentMcpTunnels.get(tunnelKey(host));
  return !!entry && entry.alive;
}

/** connectSsh for a persistent MCP tunnel, wired so that when the session drops
 *  — detected promptly via SSH keepalive (see ssh-client.ts) — the host is
 *  evicted and its forwards torn down, so the next ensureMcpTunnelsForHost
 *  rebuilds. The identity guard (entry.sshSession === self) stops a late close
 *  from an OLD session from evicting a freshly-rebuilt entry. */
export async function connectTunnelSsh(host: string, cfg: SshConnectionConfig): Promise<SshSession> {
  let self: SshSession | null = null;
  self = await connectSsh(cfg, {
    timeoutMs: 30_000,
    onSessionClosed: () => {
      const entry = persistentMcpTunnels.get(tunnelKey(host));
      if (entry && entry.sshSession === self) {
        entry.alive = false;
        closePersistentMcpTunnelForHost(host);
      }
    },
  });
  return self;
}

/** Close + rebuild all MCP tunnels for `host`, deduped: concurrent callers share
 *  one in-flight build instead of each closing+rebuilding (which leaked sessions).
 *  Mirrors the inflightDials pattern in ssh-session-cache.ts. */
export async function reconnectPersistentMcpTunnelForHost(host: string): Promise<void> {
  const key = tunnelKey(host);
  const existing = inflightTunnelBuilds.get(key);
  if (existing) return existing;
  const build = doReconnectPersistentMcpTunnelForHost(host).finally(() => {
    if (inflightTunnelBuilds.get(key) === build) inflightTunnelBuilds.delete(key);
  });
  inflightTunnelBuilds.set(key, build);
  return build;
}

async function doReconnectPersistentMcpTunnelForHost(host: string): Promise<void> {
  closePersistentMcpTunnelForHost(host);

  const projects = await projectService.getAll();
  let targetProject: (typeof projects)[number] | null = null;
  let targetInstance: (typeof projects)[number]["vpsInstances"][number] | null = null;
  for (const project of projects) {
    const instance = project.vpsInstances.find((v) => !v.deployFailed && v.connection.host === host);
    if (instance) {
      targetProject = project;
      targetInstance = instance;
      break;
    }
  }
  if (!targetProject || !targetInstance) {
    throw new Error(`No active VPS instance found for host ${host}`);
  }

  // Make sure the vps-agent bundle is on the VM before wiring genie-tracker
  // (stdio → node mcp-cli.js). Without it the tunnel comes up but the tracker
  // MCP can't launch. Best-effort: a failure here shouldn't block the HTTP
  // tunnels (browser/security/notify/storage), so we log and continue.
  try {
    await ensureVpsAgent(targetInstance.connection);
  } catch (err: unknown) {
    console.error(`[mcp] ensureVpsAgent failed for ${host} (genie-tracker may be unavailable): ${(err instanceof Error ? err.message : String(err))}`);
  }

  const sshSession = await connectTunnelSsh(host, targetInstance.connection);
  const mcpTunnel = await setupMcpTunnel(
    sshSession,
    createDomActionExecutor(host),
    { remotePort: MCP_BROWSER_REMOTE_PORT },
  );

  let streamTunnel: McpStreamTunnel | undefined;
  try {
    streamTunnel = await setupMcpStreamTunnel(sshSession, {
      projectId: targetProject.id,
      onIssueUpdated: () => { broadcastTrackerList().catch(() => { /* noop */ }); },
    });
  } catch (err: unknown) {
    console.error(`[mcp-persistent] Stream tunnel reconnect failed for ${targetProject.name}: ${(err instanceof Error ? err.message : String(err))}`);
  }

  let securityTunnel: McpSecurityTunnel | undefined;
  try {
    securityTunnel = await setupMcpSecurityTunnel(sshSession, { remotePort: MCP_SECURITY_REMOTE_PORT });
  } catch (err: unknown) {
    console.error(`[mcp-persistent] Security tunnel reconnect failed for ${targetProject.name}: ${(err instanceof Error ? err.message : String(err))}`);
  }

  let notifyTunnel: McpNotifyTunnel | undefined;
  try {
    notifyTunnel = await setupMcpNotifyTunnel(sshSession, (memberIds, conversationId, message) => {
      broadcastToUsers(memberIds, { type: "chat:message:new", payload: { conversationId, message } });
    }, { remotePort: MCP_NOTIFY_REMOTE_PORT });
  } catch (err: unknown) {
    console.error(`[mcp-persistent] Notify tunnel reconnect failed for ${targetProject.name}: ${(err instanceof Error ? err.message : String(err))}`);
  }

  let storageTunnel: McpStorageTunnel | undefined;
  try {
    storageTunnel = await setupMcpStorageTunnel(sshSession, targetProject.name, { remotePort: MCP_STORAGE_REMOTE_PORT });
  } catch (err: unknown) {
    console.error(`[mcp-persistent] Storage tunnel reconnect failed for ${targetProject.name}: ${(err instanceof Error ? err.message : String(err))}`);
  }

  persistentMcpTunnels.set(tunnelKey(host), {
    sshSession,
    mcpTunnel,
    streamTunnel,
    securityTunnel,
    notifyTunnel,
    storageTunnel,
    projectName: targetProject.name,
    instanceHost: host,
    openedAt: Date.now(),
    alive: true,
  });

  const dest = remoteDir(targetProject.name);

  // Only advertise genie-tracker if the stdio binary actually landed — if
  // ensureVpsAgent failed above, the port-forward (streamTunnel) is still up
  // but Claude would try to spawn a missing mcp-cli.js and report the server
  // as failed. Better to omit it from .mcp.json than to lie.
  let trackerCliExists = false;
  if (streamTunnel) {
    try {
      const out = await sshSession.exec(
        `test -e ${VPS_AGENT_REMOTE_BASE}/dist/mcp-cli.js && echo yes || echo no`,
      );
      trackerCliExists = out.trim() === "yes";
    } catch { /* treat as missing */ }
    if (!trackerCliExists) {
      console.warn(`[mcp] genie-tracker omitted from ${host} .mcp.json: ${VPS_AGENT_REMOTE_BASE}/dist/mcp-cli.js not found`);
    }
  }

  const mergeScript = buildMcpConfigMergeScript(
    dest,
    null,
    {
      streamTunnelSocketPath: streamTunnel && trackerCliExists ? streamTunnel.socketPath : null,
      hasSecurityTunnel: !!securityTunnel,
      hasNotifyTunnel: !!notifyTunnel,
      hasStorageTunnel: !!storageTunnel,
    },
  );
  await sshSession.exec(mergeScript);
}

/** Ensure shared MCP tunnels are live for `host` and the VM's `.mcp.json` points
 *  at them. Cheap no-op in the warm case (a tunnel is already registered for the
 *  host); otherwise — cold manager after a restart, or a dropped tunnel — it
 *  (re)establishes every tunnel, uploads the vps-agent bundle, and rewrites
 *  `.mcp.json`. Pass `force` to rebuild even when a tunnel is already present
 *  (used by the manual "Reconnect MCP servers" button).
 *
 *  This is the single entry point every Claude launch path funnels through so
 *  MCP setup is transparent: the in-app chat (routeChatToVpsAgent), the Claude
 *  terminal popup (terminal:ssh:spawn), and the manual button all call it. */
export async function ensureMcpTunnelsForHost(host: string, opts: { force?: boolean } = {}): Promise<void> {
  const inflight = inflightTunnelBuilds.get(tunnelKey(host));
  if (inflight) return inflight;
  if (!opts.force && isTunnelLive(host)) return;
  await reconnectPersistentMcpTunnelForHost(host);
}

function closePersistentMcpTunnel(tunnel: PersistentMcpTunnel): void {
  try { tunnel.streamTunnel?.close(); } catch { /* already closed */ }
  try { tunnel.securityTunnel?.close(); } catch { /* already closed */ }
  try { tunnel.notifyTunnel?.close(); } catch { /* already closed */ }
  try { tunnel.storageTunnel?.close(); } catch { /* already closed */ }
  try { tunnel.mcpTunnel.close(); } catch { /* already closed */ }
  try { tunnel.sshSession.close(); } catch { /* already closed */ }
}

export function closeAllPersistentMcpTunnels(): void {
  // Snapshot + clear BEFORE closing: tunnel.sshSession.close() fires the
  // connectTunnelSsh onSessionClosed callback synchronously, which looks the host
  // up in the map — with the map already cleared that re-entry is a safe no-op.
  const tunnels = [...persistentMcpTunnels.values()];
  persistentMcpTunnels.clear();
  for (const tunnel of tunnels) {
    closePersistentMcpTunnel(tunnel);
  }
}

export function closePersistentMcpTunnelForHost(host: string): boolean {
  const tunnel = persistentMcpTunnels.get(host);
  if (!tunnel) return false;
  // Delete BEFORE close so the synchronous onSessionClosed re-entry (sshSession
  // .close() → conn close → onSessionClosed → this function) finds no entry and
  // returns immediately instead of recursing.
  persistentMcpTunnels.delete(host);
  closePersistentMcpTunnel(tunnel);
  return true;
}

export interface SshTunnelInfo {
  host: string;
  projectName: string;
  openedAt: number;
  /** False once the underlying SSH session has dropped (keepalive close fired)
   *  but before the next launch rebuilds — surfaces a silently-dead tunnel in
   *  /ssh instead of showing it as healthy. Normally an evicted dead tunnel
   *  leaves the map entirely, so this is mainly visible in the brief window
   *  between the close event and eviction. */
  alive: boolean;
  browser: boolean;
  stream: boolean;
  security: boolean;
  notify: boolean;
  storage: boolean;
}

export function listPersistentMcpTunnels(): SshTunnelInfo[] {
  const out: SshTunnelInfo[] = [];
  for (const [host, tunnel] of persistentMcpTunnels) {
    out.push({
      host,
      projectName: tunnel.projectName,
      openedAt: tunnel.openedAt,
      alive: tunnel.alive,
      browser: true,
      stream: !!tunnel.streamTunnel,
      security: !!tunnel.securityTunnel,
      notify: !!tunnel.notifyTunnel,
      storage: !!tunnel.storageTunnel,
    });
  }
  return out.sort((a, b) => a.openedAt - b.openedAt);
}
