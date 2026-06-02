import { WebSocketServer, type WebSocket } from "ws";

import http from "node:http";
import type { WsMessage } from "./types.js";

import * as projectService from "./project-service.js";
import * as orgService from "./org-service.js";
import * as projectManager from "./project-manager.js";
import { startMonitoring, stopMonitoring } from "./monitor.js";

import { startLogCapture, getLogBuffer, getErrorBuffer } from "./log-capture.js";

import { setWsSend as setSshWsSend, closeAllSessionsForWs } from "./ssh/index.js";

import { initiateOAuth, handleOAuthCallback, verifyToken, getUserById, createToken, isAdmin } from "./auth.js";

import { handleDebugServerLogs } from "./debug-api.js";

import { pruneStaleSessions } from "./assistant-session-state-service.js";

import * as docsService from "./docs-service.js";
import * as trackerService from "./tracker-service.js";
import * as backupService from "./backup-service.js";
import * as auditService from "./audit-service.js";
import { getDb } from "./db/index.js";

import { users } from "./db/schema.js";

import { eq } from "drizzle-orm";

import { v4 as uuidv4 } from "uuid";

import { connectSsh, type SshConnectionConfig } from "./vps/ssh-client.js";

import { remoteDir } from "./vps/deploy-service.js";

import { ingestVpsStats, startStatsDbPoll, unwatchVpsStatsForClient } from "./vps/stats-stream.js";

import { resolveStatsToken } from "./vps/stats-token-service.js";

import type { VpsStatsPayload } from "@genie/vps-stats";
import { ensureGenieKeyOnDisk } from "./vps/do-provision.js";

import { ensureTazcloudKeyOnDisk } from "./vps/tazcloud-provision.js";
import { syncDropletStatuses } from "./vps/droplet-sync.js";
import { buildMcpConfigMergeScript } from "./vps/mcp-config-merge.js";
import { activeAgentSessions } from "./vps/vps-agent-rsync.js";
import { MCP_BROWSER_REMOTE_PORT, MCP_SECURITY_REMOTE_PORT, MCP_NOTIFY_REMOTE_PORT, MCP_STORAGE_REMOTE_PORT, persistentMcpTunnels, tunnelKey, isTunnelLive, connectTunnelSsh, closeAllPersistentMcpTunnels } from "./vps/mcp-tunnel-pool.js";

import { setupMcpTunnel } from "./vps/mcp-tunnel.js";

import { setupMcpStreamTunnel, type McpStreamTunnel } from "./vps/mcp-stream-tunnel.js";

import { setupMcpSecurityTunnel, type McpSecurityTunnel } from "./vps/mcp-security-tunnel.js";

import { setupMcpNotifyTunnel, type McpNotifyTunnel } from "./vps/mcp-notify-tunnel.js";

import { setupMcpStorageTunnel, type McpStorageTunnel } from "./vps/mcp-storage-tunnel.js";

import { type ClientType, type DomActionExecutor, type DomActionRequestContext, type StatsPayload } from "./types.js";

import { getActiveSshConnections } from "./vps/ssh-metrics.js";

import * as settingsService from "./settings-service.js";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { type Role, canSend, canReceive, getEntry, POLICY } from "./ws-acl.js";

import { handleDbMessage } from "./handlers/db-handler.js";

import { handleBackupMessage } from "./handlers/backup-handler.js";

import { handleGitMessage } from "./handlers/git-handler.js";

import { handleFsMessage } from "./handlers/fs-handler.js";

import { handleVpsDbMessage } from "./handlers/vps-db-handler.js";

import { handleSecurityMessage, abortAllSecurityScans } from "./handlers/security-handler.js";

import { handleRecipesMessage } from "./handlers/recipes-handler.js";

import { handleAgentsMessage } from "./handlers/agents-handler.js";

import { handleFileTemplateMessage } from "./handlers/file-template-handler.js";

import { handleProjectFileMessage } from "./handlers/project-file-handler.js";

import { handleTrackerMessage } from "./handlers/tracker-handler.js";

import { handleDocsMessage } from "./handlers/docs-handler.js";

import { handleDoMessage } from "./handlers/do-handler.js";

import { handleTazcloudMessage } from "./handlers/tazcloud-handler.js";

import { handleBaseimageMessage } from "./handlers/baseimage-handler.js";

import { handleOrgMessage } from "./handlers/org-handler.js";

import { handleAdminUsersMessage } from "./handlers/admin-users-handler.js";

import { handleTerminalMessage } from "./handlers/terminal-handler.js";

import { handleProjectMessage } from "./handlers/project-handler.js";

import { handleChatMessage } from "./handlers/chat-handler.js";

import { handleAdminMiscMessage } from "./handlers/admin-misc-handler.js";

import { handleLocalFsMessage } from "./handlers/local-fs-handler.js";

import { handleMiscMessage } from "./handlers/misc-handler.js";

import { handleVpsRuntimeMessage } from "./handlers/vps-runtime-handler.js";

import { handleVpsLifecycleMessage } from "./handlers/vps-lifecycle-handler.js";

import { handleMcpMessage } from "./handlers/mcp-handler.js";

import { isPasteKeyEnabled } from "./vps/credential-crypto.js";

/** Track active chat AbortControllers by WebSocket (floating assistant) */
export const activeChatAbortControllers = new Map<WebSocket, AbortController>();

/** Track active DO deploy AbortControllers by projectId */
export const activeDoAbortControllers = new Map<string, AbortController>();

/** In-flight admin/VM exec targets keyed by execId — admin:exec:cancel evicts the
 *  cached SSH session for that host so the running channel dies. */
export const activeExecTargets = new Map<string, SshConnectionConfig>();
export const dropletExecUserCache = new Map<string, { username: string; resolvedAt: number }>();
export const DROPLET_EXEC_USER_TTL_MS = 15 * 60_000;

/** Running tally of WebSocket frames (inbound handled + outbound sent), used to
 *  derive a messages/sec rate for the sidebar server-health gauge. */
let wsFrameCount = 0;
let lastWsFrameCount = 0;
let lastStatsTs = Date.now();


// --- Assistant session-state janitor (Path A persistence) ---
// Deletes `assistant_session_state` rows older than GENIE_SESSION_RETENTION_DAYS
// (default 30; set to 0 to disable). For each deleted row we best-effort SSH to
// the VPS and remove the corresponding Claude Code JSONL transcript at
// ~/.claude/projects/-opt-project/<sessionId>.jsonl so disk doesn't accrete.
const SESSION_RETENTION_DAYS = Number(process.env.GENIE_SESSION_RETENTION_DAYS ?? 30);
const SESSION_PRUNE_INTERVAL_MIN = Number(process.env.GENIE_SESSION_PRUNE_INTERVAL_MIN ?? 60);

async function runSessionJanitor(): Promise<void> {
  if (SESSION_RETENTION_DAYS <= 0) return;
  let removed: Awaited<ReturnType<typeof pruneStaleSessions>>;
  try {
    removed = await pruneStaleSessions(SESSION_RETENTION_DAYS);
  } catch (err) {
    console.error(`[session-janitor] DB prune failed:`, err instanceof Error ? err.message : String(err));
    return;
  }
  if (removed.length === 0) return;
  console.log(`[session-janitor] pruned ${removed.length} session row(s) older than ${SESSION_RETENTION_DAYS}d`);

  // Group by VPS instance so we only open one SSH per instance, not per row.
  const byInstance = new Map<string, { projectId: string; instanceId: string; sessionIds: string[] }>();
  for (const r of removed) {
    const k = `${r.projectId}:${r.instanceId}`;
    let slot = byInstance.get(k);
    if (!slot) {
      slot = { projectId: r.projectId, instanceId: r.instanceId, sessionIds: [] };
      byInstance.set(k, slot);
    }
    slot.sessionIds.push(r.claudeCodeSessionId);
  }

  for (const { projectId, instanceId, sessionIds } of byInstance.values()) {
    try {
      const project = await projectService.getById(projectId);
      const inst = project?.vpsInstances.find((v) => v.id === instanceId);
      if (!inst) continue; // Instance gone — DB row already pruned, nothing to delete remotely.
      const ssh = await connectSsh(inst.connection, { timeoutMs: 15_000 });
      try {
        // `~` expands per the SSH login user. /opt/project is the fixed remoteDir
        // for every Genie project, so the encoded Claude Code project name is
        // always "-opt-project".
        const args = sessionIds.map((id) => `~/.claude/projects/-opt-project/${id}.jsonl`).join(" ");
        await ssh.exec(`rm -f ${args}`, undefined, { timeoutMs: 10_000 });
      } finally {
        ssh.close();
      }
    } catch (err) {
      // Best-effort: VPS could be offline, unreachable, or have permission quirks.
      // The DB row is already deleted, so the worst case is an orphan JSONL.
      console.warn(`[session-janitor] JSONL cleanup failed for ${projectId}:${instanceId}:`, err instanceof Error ? err.message : String(err));
    }
  }
}

if (SESSION_RETENTION_DAYS > 0) {
  // Stagger first run so it doesn't race with boot work.
  setTimeout(() => void runSessionJanitor(), 30_000);
  setInterval(() => void runSessionJanitor(), SESSION_PRUNE_INTERVAL_MIN * 60_000);
}

// Resume mapping (sessionKey → Claude Code session id) is persisted in the
// `assistant_session_state` table — see assistant-session-state-service.ts.
// Survives Manager restarts; conversation content itself lives on the VPS in
// ~/.claude/projects/...jsonl and is replayed by `claude --resume`.

const PORT = Number(process.env.PORT) || 9876;

interface ClientAction {
  type: string;
  ts: number;
}

/** A floating window ("popup") the client currently has open or minimized.
 *  Sourced from the renderer's $windowManager via presence:windows. */
interface PresenceWindow {
  title: string;
  icon: string;
  minimized: boolean;
}

export interface ClientState {
  userId: string | null;
  user: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  // Role of the currently-active identity (the impersonated user when impersonating, else the real user).
  // ACL gates on this. Real-caller role for impersonation start lives behind getUserById(state.impersonatedBy).
  role: Role | null;
  /** When the active session is a superadmin impersonating another user, this holds the real superadmin's id. */
  impersonatedBy: string | null;
  clientType: ClientType;
  assistantSessionId: string | null;
  currentNav: string | null;
  /** The project the client currently has selected (or null on non-project navs).
   *  Used by the 3D topology to draw real user → server lines. */
  selectedProjectId: string | null;
  recentActions: ClientAction[];
  /** Floating windows ("popups") this client currently has open/minimized. */
  openWindows: PresenceWindow[];
  ip: string | null;
  userAgent: string | null;
}

const clients = new Map<WebSocket, ClientState>();

// WS heartbeat liveness, keyed by socket (covers pre-auth sockets too, so it
// isn't entangled with ClientState lifecycle). true = pong seen since last ping.
const wsAlive = new WeakMap<WebSocket, boolean>();
let wsHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
// 30s ping with terminate-on-missed-pong gives ≤60s to reap a half-open socket —
// under Railway's ~5min edge idle window, and frequent enough to keep it warm.
const WS_PING_INTERVAL_MS = 30_000;

export async function buildAuthPayload(
  user: { id: string; name: string; email: string; avatarUrl: string | null; role: string },
  token: string,
  impersonatedBy?: { id: string; name: string; email: string } | null,
) {
  const admin = await isAdmin(user.id);
  // Pull the user's last-seen changelog version so the renderer can decide
  // whether to pop the "What's new" modal. Best-effort: a DB hiccup just
  // means the user might see the modal again next session.
  let lastSeenUpdateVersion: string | null = null;
  try {
    const [row] = await getDb()
      .select({ v: users.lastSeenUpdateVersion })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    lastSeenUpdateVersion = row?.v ?? null;
  } catch (err) {
    console.warn("[auth] read lastSeenUpdateVersion failed:", err instanceof Error ? err.message : String(err));
  }
  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      isAdmin: admin,
      role: user.role,
      lastSeenUpdateVersion,
    },
    impersonatedBy: impersonatedBy ?? null,
    // Capability flags for the renderer. pasteKeyEnabled gates the "paste a
    // private key" option when connecting a generic SSH server (false unless a
    // real GENIE_SECRET/GENIE_JWT_SECRET is configured for encryption at rest).
    pasteKeyEnabled: isPasteKeyEnabled(),
    // Genie's public key (not secret) — shown in the connect-server form so the
    // user can authorize it on their box for the default "genie-key" auth.
    geniePublicKey: (await settingsService.getGenieKeyPair())?.publicKey ?? null,
  };
}

/** Force-disconnect all WebSocket connections for a given user */
export function disconnectUser(targetUserId: string): void {
  let found = 0;
  for (const [clientWs, state] of clients) {
    if (state.userId === targetUserId) {
      found++;
      console.log(`[auth] Disconnecting user ${targetUserId} (ws readyState=${clientWs.readyState})`);
      const msg = JSON.stringify({ type: "auth:revoked", payload: { message: "Your access has been revoked by an administrator." } });
      clientWs.send(msg);
      // Clear auth so no further messages are processed
      state.userId = null;
      state.user = null;
      state.role = null;
      // Delay close to let the message flush
      setTimeout(() => clientWs.close(), 1000);
    }
  }
  console.log(`[auth] disconnectUser(${targetUserId}): found ${found} connection(s)`);
}

/** Pending DOM action requests from extension (requestId → resolve/reject) */
const pendingDomActions = new Map<string, {
  resolve: (result: { success: boolean; result: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/** Find the Chrome extension WebSocket for a given user */
export function getExtensionClient(userId: string): WebSocket | null {
  const ws = extensionClientsByUser.get(userId);
  if (!ws || ws.readyState !== ws.OPEN) return null;
  const state = clients.get(ws);
  if (!state || state.userId !== userId || state.clientType !== "chrome-extension") return null;
  return ws;
}

function registerExtensionClient(userId: string, ws: WebSocket): void {
  extensionClientsByUser.set(userId, ws);
}

function unregisterExtensionClient(userId: string, ws: WebSocket): void {
  const current = extensionClientsByUser.get(userId);
  if (current === ws) extensionClientsByUser.delete(userId);
}

/** Send a DOM action request to the extension and await the result */
function requestDomAction(extensionWs: WebSocket, action: string, params: Record<string, unknown>): Promise<{ success: boolean; result: string }> {
  return new Promise((resolve) => {
    const requestId = uuidv4();
    const timer = setTimeout(() => {
      pendingDomActions.delete(requestId);
      resolve({ success: false, result: "DOM action timed out (15s)" });
    }, 15000);

    pendingDomActions.set(requestId, { resolve, timer });

    send(extensionWs, {
      type: "extension:dom_action",
      payload: { requestId, action, params },
    });
  });
}

/** Create a domActionExecutor bound directly to a specific extension socket. */
export function createDirectDomActionExecutor(extensionWs: WebSocket): DomActionExecutor {
  return async (action, params) => requestDomAction(extensionWs, action, params as Record<string, unknown>);
}

interface DomBrokerSessionBinding {
  userId: string;
  host: string;
  projectId: string;
  instanceId: string;
  lastUsedAt: number;
}

/** Active browser broker sessions keyed by chat session id. */
const domBrokerSessions = new Map<string, DomBrokerSessionBinding>();
/** Connected extension sockets keyed by authenticated user id. */
const extensionClientsByUser = new Map<string, WebSocket>();

const DOM_BROKER_SESSION_TTL_MS = 30 * 60_000;

setInterval(() => {
  const cutoff = Date.now() - DOM_BROKER_SESSION_TTL_MS;
  for (const [sessionId, binding] of domBrokerSessions) {
    if (binding.lastUsedAt < cutoff) domBrokerSessions.delete(sessionId);
  }
}, 60_000).unref();

export function registerDomBrokerSession(
  sessionId: string,
  userId: string,
  host: string,
  projectId: string,
  instanceId: string,
): void {
  domBrokerSessions.set(sessionId, { userId, host, projectId, instanceId, lastUsedAt: Date.now() });
}

function clearDomBrokerSessionsForUser(userId: string): void {
  for (const [sessionId, binding] of domBrokerSessions) {
    if (binding.userId === userId) domBrokerSessions.delete(sessionId);
  }
}

async function userCanAccessInstance(
  userId: string,
  projectId: string,
  instanceId: string,
  host: string,
): Promise<boolean> {
  if (!(await projectService.userCanSeeProject(userId, projectId))) return false;
  const project = await projectService.getById(projectId);
  const instance = project?.vpsInstances.find((v) => v.id === instanceId);
  if (!instance) return false;
  return instance.connection.host === host;
}

/** Shared broker: route host-scoped MCP browser calls to the correct user extension socket. */
export function createDomActionExecutor(host: string): DomActionExecutor {
  return async (action, params, context?: DomActionRequestContext) => {
    const sessionId = context?.sessionId;
    const userId = context?.userId;
    const projectId = context?.projectId;
    const instanceId = context?.instanceId;
    if (!sessionId || !userId || !projectId || !instanceId) {
      return { success: false, result: "Missing DOM broker auth context (userId/sessionId/projectId/instanceId)." };
    }

    const binding = domBrokerSessions.get(sessionId);
    if (!binding) {
      return { success: false, result: `Unknown DOM broker session: ${sessionId}` };
    }
    if (binding.userId !== userId) {
      return { success: false, result: "DOM broker session/user mismatch." };
    }
    if (binding.host !== host) {
      return { success: false, result: "DOM broker session/host mismatch." };
    }
    if (binding.projectId !== projectId || binding.instanceId !== instanceId) {
      return { success: false, result: "DOM broker session target mismatch." };
    }
    if (context?.host && context.host !== host) {
      return { success: false, result: "DOM broker request host mismatch." };
    }

    if (!(await userCanAccessInstance(userId, projectId, instanceId, host))) {
      return { success: false, result: "Access denied: user cannot control this VPS instance." };
    }

    const extensionWs = getExtensionClient(userId);
    if (!extensionWs) {
      return { success: false, result: "Chrome extension is not connected for this user." };
    }

    binding.lastUsedAt = Date.now();
    return requestDomAction(extensionWs, action, params as Record<string, unknown>);
  };
}

async function setupPersistentMcpTunnels(extensionWs: WebSocket, userId: string): Promise<void> {
  registerExtensionClient(userId, extensionWs);

  // Find all projects this user can access.
  const projects = await projectService.getAllForUser(userId);

  const seenHosts = new Set<string>();
  let newTunnelCount = 0;
  for (const project of projects) {
    for (const instance of project.vpsInstances) {
      if (instance.deployFailed) continue;
      const key = tunnelKey(instance.connection.host);
      if (seenHosts.has(key)) continue;
      seenHosts.add(key);
      const dest = remoteDir(project.name);

      try {
        if (isTunnelLive(instance.connection.host)) continue;
        const sshSession = await connectTunnelSsh(instance.connection.host, instance.connection);
        const mcpTunnel = await setupMcpTunnel(sshSession, createDomActionExecutor(instance.connection.host), { remotePort: MCP_BROWSER_REMOTE_PORT });

        // Set up stdio stream tunnel (carries tracker + future MCPs)
        let streamTunnel: McpStreamTunnel | undefined;
        try {
          streamTunnel = await setupMcpStreamTunnel(sshSession, { projectId: project.id, onIssueUpdated: () => { broadcastTrackerList().catch(() => {}); } });
          console.log(`[mcp-persistent] Stream tunnel ready for ${project.name} at ${streamTunnel.socketPath}`);
        } catch (streamErr: unknown) {
          console.error(`[mcp-persistent] Stream tunnel failed for ${project.name}: ${(streamErr instanceof Error ? streamErr.message : String(streamErr))}`);
        }

        // Set up security tunnel
        let securityTunnel: McpSecurityTunnel | undefined;
        try {
          securityTunnel = await setupMcpSecurityTunnel(sshSession, { remotePort: MCP_SECURITY_REMOTE_PORT });
          console.log(`[mcp-persistent] Security tunnel ready for ${project.name}`);
        } catch (secErr: unknown) {
          console.error(`[mcp-persistent] Security tunnel failed for ${project.name}: ${(secErr instanceof Error ? secErr.message : String(secErr))}`);
        }

        // Set up notify tunnel
        let notifyTunnel: McpNotifyTunnel | undefined;
        try {
          notifyTunnel = await setupMcpNotifyTunnel(sshSession, (memberIds, conversationId, message) => {
            broadcastToUsers(memberIds, { type: "chat:message:new", payload: { conversationId, message } });
          }, { remotePort: MCP_NOTIFY_REMOTE_PORT });
          console.log(`[mcp-persistent] Notify tunnel ready for ${project.name}`);
        } catch (notifyErr: unknown) {
          console.error(`[mcp-persistent] Notify tunnel failed for ${project.name}: ${(notifyErr instanceof Error ? notifyErr.message : String(notifyErr))}`);
        }

        // Set up storage tunnel
        let storageTunnel: McpStorageTunnel | undefined;
        try {
          storageTunnel = await setupMcpStorageTunnel(sshSession, project.name, { remotePort: MCP_STORAGE_REMOTE_PORT });
          console.log(`[mcp-persistent] Storage tunnel ready for ${project.name}`);
        } catch (storageErr: unknown) {
          console.error(`[mcp-persistent] Storage tunnel failed for ${project.name}: ${(storageErr instanceof Error ? storageErr.message : String(storageErr))}`);
        }

        persistentMcpTunnels.set(key, { sshSession, mcpTunnel, streamTunnel, securityTunnel, notifyTunnel, storageTunnel, projectName: project.name, instanceHost: instance.connection.host, openedAt: Date.now(), alive: true });

        // Merge MCP servers into .mcp.json on the VPS. Browser headers are set per
        // chat session in routeChatToVpsAgent, not here.
        const mergeScript = buildMcpConfigMergeScript(
          dest,
          null,
          {
            streamTunnelSocketPath: streamTunnel?.socketPath ?? null,
            hasSecurityTunnel: !!securityTunnel,
            hasNotifyTunnel: !!notifyTunnel,
            hasStorageTunnel: !!storageTunnel,
          },
        );
        await sshSession.exec(mergeScript);

        newTunnelCount++;
        console.log(`[mcp-persistent] Shared tunnel ready for host ${instance.connection.host}:${MCP_BROWSER_REMOTE_PORT} (${project.name})`);
      } catch (err: unknown) {
        console.error(`[mcp-persistent] Failed shared tunnel to ${instance.connection.host} (${project.name}): ${(err instanceof Error ? err.message : String(err))}`);
      }
    }
  }

  if (seenHosts.size === 0) {
    console.log(`[mcp-persistent] No VPS instances found for user ${userId}`);
  } else {
    console.log(`[mcp-persistent] User ${userId} attached to ${seenHosts.size} host(s); ${newTunnelCount} new shared tunnel(s) created`);
  }
}

async function teardownPersistentMcpTunnels(userId: string): Promise<void> {
  clearDomBrokerSessionsForUser(userId);
  const ws = extensionClientsByUser.get(userId);
  if (ws) unregisterExtensionClient(userId, ws);
}

// Outbound ACL gate. Returns true iff the recipient's role may receive `type`
// per the registry. Unauthenticated sockets bypass the gate ONLY for auth:*
// and pre-auth handshake messages (auth:required, auth:failed, auth:success).
function aclAllowsDelivery(state: ClientState | undefined, type: string): boolean {
  // Auth handshake messages must be deliverable to sockets that haven't authed yet.
  if (type.startsWith("auth:")) return true;
  if (!state) return false;
  return canReceive(state.role, type);
}

function broadcast(message: WsMessage): void {
  const data = JSON.stringify(message);
  for (const [ws, state] of clients) {
    if (ws.readyState === ws.OPEN && state.userId && aclAllowsDelivery(state, message.type)) {
      ws.send(data);
      wsFrameCount++;
    }
  }
}

export function broadcastToUsers(userIds: string[], message: WsMessage): void {
  const idSet = new Set(userIds);
  const data = JSON.stringify(message);
  for (const [ws, state] of clients) {
    if (ws.readyState === ws.OPEN && state.userId && idSet.has(state.userId) && aclAllowsDelivery(state, message.type)) {
      ws.send(data);
      wsFrameCount++;
    }
  }
}

export function sendToUser(targetUserId: string, message: WsMessage): void {
  broadcastToUsers([targetUserId], message);
}

/** Decorate a stats payload with manager-process health (WS throughput + live
 *  SSH connections) and broadcast it. wsMessagesPerSec is the frame delta since
 *  the previous stats tick divided by the elapsed time. */
export function broadcastStats(stats: StatsPayload): void {
  const now = Date.now();
  const elapsedSec = Math.max(0.001, (now - lastStatsTs) / 1000);
  stats.server = {
    wsMessagesPerSec: Math.max(0, Math.round((wsFrameCount - lastWsFrameCount) / elapsedSec)),
    wsConnections: clients.size,
    sshConnections: getActiveSshConnections(),
  };
  lastWsFrameCount = wsFrameCount;
  lastStatsTs = now;
  broadcast({ type: "stats", payload: stats });
}

function send(ws: WebSocket, message: WsMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  const state = clients.get(ws);
  if (!aclAllowsDelivery(state, message.type)) {
    // Drop silently. We could log here when running locally; in prod this is
    // expected for any handler that emits to a client whose role is too low
    // (the wire is the right place to enforce it, not every call site).
    return;
  }
  ws.send(JSON.stringify(message));
  wsFrameCount++;
}

/**
 * Send the project:list filtered to what the given socket's user is allowed to see.
 * Use this instead of `send(ws, { type: "project:list", ... })` to enforce team-based visibility.
 */
export async function sendProjectListTo(ws: WebSocket): Promise<void> {
  const state = clients.get(ws);
  const list = await projectService.getAllForUser(state?.userId ?? null);
  send(ws, { type: "project:list", payload: { projects: list } });
}

/**
 * Broadcast project:list to every authenticated client, filtered per recipient.
 * Use this instead of `broadcast({ type: "project:list", ... })` to enforce team-based visibility.
 */
export async function broadcastProjectList(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const [ws, state] of clients) {
    if (ws.readyState !== ws.OPEN || !state.userId) continue;
    tasks.push(
      projectService.getAllForUser(state.userId).then((list) => {
        send(ws, { type: "project:list", payload: { projects: list } });
      }),
    );
  }
  await Promise.all(tasks);
}

export function getConnectedUserIds(): string[] {
  const ids = new Set<string>();
  for (const [, state] of clients) {
    if (state.userId) ids.add(state.userId);
  }
  return [...ids];
}

const PRESENCE_SKIP_TYPES = new Set([
  "ping", "pong", "stats", "presence:nav", "presence:windows", "presence:detail",
]);

export function broadcastPresence(): void {
  const connectedUserIds = getConnectedUserIds();
  broadcast({ type: "chat:presence", payload: { connectedUserIds } });
  void broadcastPresenceDetail();
}

interface PresenceAttachedServer {
  /** Null for direct-SSH terminals (terminal:ssh:spawn) — the renderer must
   *  fall back to matching by host in that case. */
  instanceId: string | null;
  host: string;
}

interface PresenceSession {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  clientType: string;
  currentNav: string | null;
  selectedProjectId: string | null;
  /** Servers this user currently has live PTY sessions attached to. Sourced
   *  from the ptySessions table; the topology graph draws one user→server
   *  edge per entry, matching either by instanceId or host. */
  attachedServers: PresenceAttachedServer[];
  recentActions: ClientAction[];
  /** Floating windows ("popups") this session currently has open/minimized. */
  openWindows: PresenceWindow[];
  ip: string | null;
  userAgent: string | null;
}

async function buildPresenceDetail(): Promise<PresenceSession[]> {
  // Terminal/PTY attachment data is gone with the connection layer rewrite —
  // attachedServers stays in the contract but is always empty until the new
  // layer lands. Topology graph rendering tolerates this.
  const result: PresenceSession[] = [];
  for (const [ws, state] of clients) {
    if (!state.userId || !state.user || ws.readyState !== ws.OPEN) continue;
    result.push({
      id: state.userId,
      name: state.user.name,
      email: state.user.email,
      avatarUrl: state.user.avatarUrl,
      clientType: state.clientType,
      currentNav: state.currentNav,
      selectedProjectId: state.selectedProjectId,
      attachedServers: [],
      recentActions: state.recentActions.slice(-25),
      openWindows: state.openWindows,
      ip: state.ip,
      userAgent: state.userAgent,
    });
  }
  return result;
}

async function broadcastPresenceDetail(): Promise<void> {
  const detail = await buildPresenceDetail();
  broadcast({ type: "presence:detail", payload: { sessions: detail } });
}

export async function sendInitialData(ws: WebSocket, _userId?: string): Promise<void> {
  // Send current project list and log backlogs on connect
  await sendProjectListTo(ws);
  const projectLogs = projectManager.getAllLogBuffers();
  for (const [key, data] of Object.entries(projectLogs)) {
    const [projectId, commandId] = key.split(":");
    send(ws, { type: "project:log", payload: { projectId, commandId, stream: "stdout", data } });
  }

  // Send logs sources and backlog. The superadmin-only "errors" source carries
  // a stderr-only copy (stack traces etc.); only advertise it to superadmins.
  const role = clients.get(ws)?.role;
  const sources = role === "superadmin" ? ["manager", "errors"] : ["manager"];
  send(ws, { type: "logs:sources", payload: { sources } });
  const logBacklog = getLogBuffer();
  if (logBacklog) {
    send(ws, { type: "logs:backlog", payload: { source: "manager", data: logBacklog } });
  }
  if (role === "superadmin") {
    const errBacklog = getErrorBuffer();
    if (errBacklog) {
      send(ws, { type: "logs:errors:backlog", payload: { source: "errors", data: errBacklog } });
    }
  }

  // Active terminal-session restoration removed with the connection layer rewrite.
}

async function handleAuthMessage(ws: WebSocket, msg: WsMessage): Promise<boolean> {
  switch (msg.type) {
    case "auth:google:start": {
      try {
        const { inviteToken } = msg.payload as { inviteToken?: string };
        const authUrl = initiateOAuth(
          async (user, token) => {
            const state = clients.get(ws);
            if (state) {
              state.userId = user.id;
              state.user = { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
              // Mirror the auth:token path — without state.role, sendInitialData
              // gates everything as a guest (no logs:errors:* backlog, ACL says
              // "user" for every receive check until the next page reload).
              state.role = user.role as Role;
              state.impersonatedBy = null;
            }
            const authPayload = await buildAuthPayload(user, token);
            send(ws, { type: "auth:success", payload: authPayload });
            await sendInitialData(ws, user.id);
            broadcastPresence();
          },
          (message) => {
            send(ws, { type: "auth:error", payload: { message } });
          },
          inviteToken,
        );
        send(ws, { type: "auth:google:url", payload: { url: authUrl } });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        send(ws, { type: "auth:error", payload: { message } });
      }
      return true;
    }

    case "auth:token": {
      const { token } = msg.payload as { token: string };
      const decoded = verifyToken(token);
      if (decoded) {
        const user = await getUserById(decoded.userId);
        if (user) {
          if (!user.validated) {
            send(ws, { type: "auth:failed", payload: { message: "Your account is pending validation. Please contact the administrator." } });
            return true;
          }
          // If this token represents an impersonation, fetch the impersonator for the UI banner.
          let impersonatedBy: { id: string; name: string; email: string } | null = null;
          if (decoded.impersonatedBy) {
            const impUser = await getUserById(decoded.impersonatedBy);
            if (impUser) impersonatedBy = { id: impUser.id, name: impUser.name, email: impUser.email };
          }
          const state = clients.get(ws);
          if (state) {
            state.userId = user.id;
            state.user = { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
            state.role = user.role as Role;
            state.impersonatedBy = decoded.impersonatedBy ?? null;
          }
          const authPayload = await buildAuthPayload(user, token, impersonatedBy);
          send(ws, { type: "auth:success", payload: authPayload });
          sendInitialData(ws, user.id);
          broadcastPresence();
          return true;
        }
      }
      send(ws, { type: "auth:failed", payload: { message: "Invalid or expired token" } });
      return true;
    }

    case "auth:logout": {
      const state = clients.get(ws);
      if (state) {
        state.userId = null;
        state.user = null;
        state.role = null;
      }
      send(ws, { type: "auth:logged-out", payload: {} });
      broadcastPresence();
      return true;
    }

    default:
      return false;
  }
}

export async function broadcastTrackerList(): Promise<void> {
  const [issues, labels] = await Promise.all([
    trackerService.listIssues(),
    trackerService.listLabels(),
  ]);
  broadcast({ type: "tracker:list", payload: { issues, labels } });
}

async function handleMessage(ws: WebSocket, msg: WsMessage): Promise<void> {
  wsFrameCount++; // count every inbound frame for the messages/sec gauge

  // App-level heartbeat, answered before auth so it works pre-auth and is never
  // rejected by the ACL gate. Browsers can't send WS-protocol ping frames, so the
  // client sends a JSON `ping` and watches for this `pong`; if pongs stop arriving
  // it knows its socket is half-open and reconnects. Cheap and harmless.
  if (msg.type === "ping") {
    send(ws, { type: "pong", payload: {} });
    return;
  }

  // Auth messages are always handled
  if (msg.type.startsWith("auth:")) {
    await handleAuthMessage(ws, msg);
    return;
  }

  // Auth guard: block non-auth messages until authenticated
  const state = clients.get(ws);
  if (!state?.userId) {
    send(ws, { type: "auth:required", payload: {} });
    return;
  }

  const userId = state.userId;

  // --- Inbound ACL gate ---
  // Single chokepoint for role-based authorization on every non-auth message.
  // Default-deny: types missing from ws-acl.ts get rejected here. Handlers
  // remain responsible for ownership/scope checks (e.g. "is this *your* terminal").
  if (!canSend(state.role, msg.type)) {
    const entry = getEntry(msg.type);
    if (!entry) {
      console.warn(`[ws-acl] ${POLICY}: rejecting unlisted message type "${msg.type}" from user ${userId}`);
    } else {
      console.warn(`[ws-acl] role ${state.role} forbidden from sending "${msg.type}" (requires ${entry.send ?? "—"})`);
    }
    // ws.send() bypasses ACL for auth:* but error:* still must be allowed. The
    // error namespace is user-receivable per registry, so this delivers.
    send(ws, { type: "error:forbidden", payload: { type: msg.type, message: "Not permitted" } });
    return;
  }

  // --- Presence handlers ---
  if (msg.type === "presence:nav") {
    state.currentNav = (msg.payload?.nav as string) || null;
    void broadcastPresenceDetail();
    return;
  }

  if (msg.type === "presence:project") {
    const id = msg.payload?.projectId;
    state.selectedProjectId = typeof id === "string" && id ? id : null;
    void broadcastPresenceDetail();
    return;
  }

  if (msg.type === "presence:windows") {
    const raw = Array.isArray(msg.payload?.windows) ? msg.payload.windows : [];
    state.openWindows = raw
      .filter((w: unknown): w is Record<string, unknown> => !!w && typeof w === "object")
      .slice(0, 50)
      .map((w: Record<string, unknown>) => ({
        title: typeof w.title === "string" ? w.title.slice(0, 120) : "Untitled",
        // Cap icon at 64 chars — it's a lucide icon-name key (e.g. "terminal"),
        // never a payload. Without this an authenticated client could ship
        // multi-MB strings that broadcastPresenceDetail amplifies to every
        // admin on every presence tick.
        icon: typeof w.icon === "string" ? w.icon.slice(0, 64) : "window",
        minimized: w.minimized === true,
      }));
    void broadcastPresenceDetail();
    return;
  }

  if (msg.type === "presence:detail") {
    const sessions = await buildPresenceDetail();
    send(ws, { type: "presence:detail", payload: { sessions } });
    return;
  }

  if (msg.type === "updates:mark-seen") {
    const version = msg.payload?.version;
    if (typeof version !== "string" || !version) return;
    try {
      await getDb()
        .update(users)
        .set({ lastSeenUpdateVersion: version })
        .where(eq(users.id, userId));
    } catch (err) {
      console.warn("[updates] mark-seen failed:", err instanceof Error ? err.message : String(err));
    }
    return;
  }

  // --- Chrome Extension handlers ---
  if (msg.type === "extension:identify") {
    state.clientType = "chrome-extension";
    send(ws, { type: "extension:identified", payload: {} });
    // Set up persistent MCP browser tunnel in background
    setupPersistentMcpTunnels(ws, userId).catch(err =>
      console.error(`[mcp-persistent] Setup error: ${(err instanceof Error ? err.message : String(err))}`)
    );
    return;
  }

  if (msg.type === "extension:dom_action_result") {
    const { requestId, success, result } = msg.payload;
    const pending = pendingDomActions.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingDomActions.delete(requestId);
      pending.resolve({ success, result });
    }
    return;
  }

  // Modular handlers first — return early if any of them handles the message.
  // Inline cases below stay until they get migrated to their own module.
  if (await handleDbMessage(ws, msg, send)) return;
  if (await handleBackupMessage(ws, msg, send)) return;
  if (await handleGitMessage(ws, msg, send)) return;
  if (await handleFsMessage(ws, msg, send, userId)) return;
  if (await handleVpsDbMessage(ws, msg, send, userId)) return;
  if (await handleSecurityMessage(ws, msg, send, userId)) return;
  if (await handleRecipesMessage(ws, msg, send, userId, broadcast)) return;
  if (await handleAgentsMessage(ws, msg, send, userId, broadcast)) return;
  if (await handleFileTemplateMessage(ws, msg, send, userId)) return;
  if (await handleProjectFileMessage(ws, msg, send)) return;
  if (await handleTrackerMessage(ws, msg, send, userId, broadcast, broadcastTrackerList)) return;
  if (await handleDocsMessage(ws, msg, send, userId, sendToUser)) return;
  if (await handleDoMessage(ws, msg, send, userId, state.role, broadcast)) return;
  if (await handleTazcloudMessage(ws, msg, send, userId, state.role, broadcast)) return;
  if (await handleBaseimageMessage(ws, msg, send, broadcast)) return;
  if (await handleOrgMessage(ws, msg, send, userId, state.impersonatedBy)) return;
  if (await handleAdminUsersMessage(ws, msg, send, state)) return;
  if (await handleTerminalMessage(ws, msg, send, broadcast)) return;
  if (await handleProjectMessage(ws, msg, send, state)) return;
  if (await handleChatMessage(ws, msg, send, state)) return;
  if (await handleAdminMiscMessage(ws, msg, send, state)) return;
  if (await handleLocalFsMessage(ws, msg, send)) return;
  if (await handleMiscMessage(ws, msg, send, broadcast, state)) return;
  if (await handleVpsRuntimeMessage(ws, msg, send, userId, state.role)) return;
  if (await handleVpsLifecycleMessage(ws, msg, send, broadcast, state)) return;
  if (await handleMcpMessage(ws, msg, send, state)) return;

  // No handler claimed the message — surface it as an error so the renderer can
  // distinguish "unsupported type" from "silent drop". Every namespace lives in
  // its own handler module under ./handlers/; if a type isn't picked up, the
  // dispatcher chain above is missing a wire-up.
  send(ws, {
    type: "error",
    payload: { message: `Unknown message type: ${msg.type}` },
  });
}

/** Read and JSON-parse an HTTP request body, capped at `maxBytes`. */
async function readJsonBody(req: http.IncomingMessage, maxBytes = 65536): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      body += chunk.toString();
      if (body.length > maxBytes) {
        aborted = true;
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (aborted) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Validate a posted stats payload has the scalar numeric fields we persist. */
function isValidStatsPayload(stats: unknown): stats is VpsStatsPayload {
  if (!stats || typeof stats !== "object") return false;
  const s = stats as Record<string, unknown>;
  const numericFields = [
    "cpuPercent", "memUsedBytes", "memTotalBytes", "memPercent",
    "diskUsedBytes", "diskTotalBytes", "diskPercent",
  ];
  return numericFields.every((f) => typeof s[f] === "number" && Number.isFinite(s[f] as number));
}

export async function createServer(): Promise<WebSocketServer> {
  // Bind the SSH terminal module to this server's `send` helper so the
  // SshShellSession layer can emit terminal:* frames to the originating
  // WebSocket without re-importing ws-server internals.
  setSshWsSend((ws, message) => send(ws, message as WsMessage));

  // Ensure history table + default configs/templates
  await settingsService.ensureBaseImageDefaults();

  // Start daily backup cron
  backupService.startBackupCron();

  // Restore Genie SSH key from DB to filesystem (survives ephemeral container restarts)
  try {
    await ensureGenieKeyOnDisk();
  } catch (err: unknown) {
    console.warn("Could not restore Genie SSH key from DB:", (err instanceof Error ? err.message : String(err)));
  }

  // Same for the TazCloud SSH key — terminal/SSH features that target TazCloud VMs
  // read this file by path, so it must exist before any client tries to connect.
  if (process.env.TAZCLOUD_SSH_PRIVATE_KEY) {
    try {
      ensureTazcloudKeyOnDisk(process.env.TAZCLOUD_SSH_PRIVATE_KEY);
    } catch (err: unknown) {
      console.warn("Could not write TazCloud SSH key to disk:", (err instanceof Error ? err.message : String(err)));
    }
  }

  const httpServer = http.createServer(async (req, res) => {
    // CORS headers for public doc API
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    // Health check
    if (req.url === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // OAuth callback handler
    if (await handleOAuthCallback(req, res)) return;

    // Dev-only login bypass — issues a JWT for an existing user by email and
    // redirects to the renderer with ?token=…. Loopback-only; disabled in
    // production. Used by e2e tests and `/?login=email` on localhost:3000.
    if (req.url?.startsWith("/test-login") && req.method === "GET") {
      if (process.env.NODE_ENV === "production") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const remote = req.socket.remoteAddress ?? "";
      const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
      if (!isLoopback) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("test-login is loopback-only");
        return;
      }
      try {
        const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
        const email = url.searchParams.get("email");
        if (!email) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing ?email=...");
          return;
        }
        const db = getDb();
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end(`No user with email ${email}. Sign in via Google once to create the row, then this endpoint can reuse it.`);
          return;
        }
        if (!user.validated) {
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end(`User ${email} is not validated.`);
          return;
        }
        const token = createToken(user.id);
        // Redirect to the renderer (port 3000) with ?token=… — the renderer's WS
        // client (packages/renderer/src/lib/ws.ts:65) auto-picks it up, stores
        // it in localStorage, and strips it from the URL. This avoids the
        // cross-origin localStorage issue between port 9876 (manager) and 3000
        // (renderer).
        const rendererBase = process.env.RENDERER_URL || "http://localhost:3000";
        const target = url.searchParams.get("redirect") || "/";
        const safePath = target.startsWith("/") ? target : `/${target}`;
        const sep = safePath.includes("?") ? "&" : "?";
        const redirectTo = `${rendererBase}${safePath}${sep}token=${encodeURIComponent(token)}`;
        res.writeHead(302, { Location: redirectTo });
        res.end();
        console.log(`[dev-login] issued token for ${email} → ${rendererBase}${safePath}`);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`dev-login error: ${(err instanceof Error ? err.message : String(err))}`);
      }
      return;
    }

    if (await handleDebugServerLogs(req, res)) return;

    const inviteMatch = req.url?.match(/^\/api\/public\/invite\/([A-Za-z0-9_-]+)$/);
    if (inviteMatch && req.method === "GET") {
      try {
        const preview = await orgService.getInvitePreview(inviteMatch[1]);
        if (!preview) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(preview));
        }
      } catch (err: unknown) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err instanceof Error ? err.message : String(err)) }));
      }
      return;
    }

    // VM stats postback: the on-VM genie-stats daemon POSTs each sample here,
    // authed by its per-instance bearer token. Replaces the old SSH tail.
    if (req.url === "/api/vps/stats" && req.method === "POST") {
      const sendJson = (status: number, body: Record<string, unknown>) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      try {
        const authHeader = req.headers.authorization ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          sendJson(401, { error: "Missing bearer token" });
          return;
        }
        const owner = await resolveStatsToken(authHeader.slice(7).trim());
        if (!owner) {
          sendJson(401, { error: "Invalid token" });
          return;
        }
        const body = (await readJsonBody(req)) as {
          projectId?: string;
          instanceId?: string;
          ts?: unknown;
          stats?: unknown;
        };
        // A token may only post for its own instance.
        if (
          (body.projectId && body.projectId !== owner.projectId) ||
          (body.instanceId && body.instanceId !== owner.instanceId)
        ) {
          sendJson(403, { error: "Token/instance mismatch" });
          return;
        }
        if (!isValidStatsPayload(body.stats)) {
          sendJson(400, { error: "Invalid stats payload" });
          return;
        }
        const ts = typeof body.ts === "number" && Number.isFinite(body.ts) ? body.ts : Date.now();
        // for now: one Logs-panel line per VM stats postback (via log-capture).
        const ip = req.socket.remoteAddress ?? "?";
        console.log(
          `[stats] postback from ${ip} · ${owner.projectId}:${owner.instanceId} ` +
            `cpu=${body.stats.cpuPercent.toFixed(0)}% mem=${body.stats.memPercent.toFixed(0)}% disk=${body.stats.diskPercent.toFixed(0)}%`,
        );
        ingestVpsStats(owner.projectId, owner.instanceId, ts, body.stats, send);
        sendJson(200, { ok: true });
      } catch (err: unknown) {
        sendJson(400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    const match = req.url?.match(/^\/api\/public\/doc\/([A-Za-z0-9_-]+)$/);
    if (match && req.method === "GET") {
      try {
        const doc = await docsService.getDocByPublicKey(match[1]);
        if (!doc) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(doc));
        }
      } catch (err: unknown) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err instanceof Error ? err.message : String(err)) }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });
  httpServer.listen(PORT);

  projectManager.setEventCallback((event) => {
    broadcast(event as WsMessage);
  });

  startMonitoring((stats) => {
    broadcastStats(stats);
  });

  // Dev-only: when this manager doesn't receive the VM's postback (shared DB),
  // read the latest persisted samples and push them to watchers (GENIE_STATS_DB_POLL=1).
  startStatsDbPoll(send);

  // Capture manager stdout/stderr and broadcast to clients. stderr is fanned
  // out twice: into the combined "manager" feed (admin) AND a dedicated
  // "errors" feed (superadmin-only via the ACL on logs:errors:data).
  startLogCapture((source, data) => {
    if (source === "manager") {
      broadcast({ type: "logs:data", payload: { source: "manager", data } });
    } else {
      broadcast({ type: "logs:errors:data", payload: { source: "errors", data } });
    }
  });

  // Sync droplet statuses on startup and every 60s.
  void syncDropletStatuses(broadcastProjectList);
  setInterval(() => void syncDropletStatuses(broadcastProjectList), 60_000);

  // Broadcast presence detail every 3s for real-time action updates
  setInterval(() => void broadcastPresenceDetail(), 3_000);

  // PTY event forwarding removed — terminal connection layer is being rebuilt.

  wss.on("connection", (ws, req) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || null;
    const userAgent = (req.headers["user-agent"] as string) || null;
    clients.set(ws, { userId: null, user: null, role: null, impersonatedBy: null, clientType: "web", assistantSessionId: null, currentNav: null, selectedProjectId: null, recentActions: [], openWindows: [], ip, userAgent });
    console.log(`Client connected (${clients.size} total)`);

    // Seed heartbeat liveness and mark alive on every pong (see WS_PING_INTERVAL_MS).
    wsAlive.set(ws, true);
    ws.on("pong", () => { wsAlive.set(ws, true); });

    // Tell client auth is required
    send(ws, { type: "auth:required", payload: {} });

    ws.on("message", (raw) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString());
        const clientState = clients.get(ws);
        auditService.logAction(
          clientState?.userId ?? null,
          clientState?.user?.name ?? null,
          msg.type,
          msg.payload,
        );
        // Track recent actions per client (skip noisy types)
        if (clientState?.userId && !PRESENCE_SKIP_TYPES.has(msg.type)) {
          clientState.recentActions.push({ type: msg.type, ts: Date.now() });
          if (clientState.recentActions.length > 25) clientState.recentActions.shift();
        }
        handleMessage(ws, msg).catch((err) => {
          console.error("Unhandled error in handleMessage:", err);
          send(ws, {
            type: "error",
            payload: { message: err?.message || "Internal server error" },
          });
        });
      } catch {
        send(ws, {
          type: "error",
          payload: { message: "Invalid JSON message" },
        });
      }
    });

    ws.on("close", () => {
      unwatchVpsStatsForClient(ws);

      // Abort any active chat stream for this connection
      const chatAbort = activeChatAbortControllers.get(ws);
      if (chatAbort) {
        chatAbort.abort();
        activeChatAbortControllers.delete(ws);
      }

      // Abort any active security scans for this connection
      abortAllSecurityScans();

      const closingState = clients.get(ws);
      const wasAuthenticated = closingState?.userId != null;
      // Tear down persistent MCP tunnel if this was the extension
      if (closingState?.clientType === "chrome-extension" && closingState?.userId) {
        teardownPersistentMcpTunnels(closingState.userId).catch(() => {});
      }
      // Dispose any interactive SSH terminals tied to this socket. One SSH
      // per terminal, no persistent reuse — closing the WS kills the dial.
      closeAllSessionsForWs(ws);
      clients.delete(ws);
      console.log(`Client disconnected (${clients.size} total)`);
      if (wasAuthenticated) broadcastPresence();
    });
  });

  wss.on("listening", () => {
    console.log(`Genie manager WebSocket server listening on port ${PORT}`);
  });

  // WS heartbeat. A browser↔manager socket can go HALF-OPEN — Railway's edge
  // idle-timeout, laptop sleep, or a network blip during a long "thinking" gap
  // with no tokens flowing — without ever firing `close`. The chat stream then
  // freezes mid-answer with no error and the client's onclose-driven reconnect
  // never triggers. ws-level ping/pong detects it: every PING_INTERVAL we ping
  // each socket; one that missed the previous round (no pong) is terminated,
  // which DOES fire `close` → the client reconnects. The ping traffic also keeps
  // the edge from idling the connection out in the first place.
  wsHeartbeatTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (wsAlive.get(ws) === false) {
        try { ws.terminate(); } catch { /* ignore */ }
        continue;
      }
      wsAlive.set(ws, false);
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, WS_PING_INTERVAL_MS);
  wsHeartbeatTimer.unref();

  return wss;
}

export function shutdown(wss: WebSocketServer): void {
  if (wsHeartbeatTimer) { clearInterval(wsHeartbeatTimer); wsHeartbeatTimer = null; }
  backupService.stopBackupCron();
  stopMonitoring();
  projectManager.stopEverything();
  // Close all VPS agent sessions
  for (const [, session] of activeAgentSessions) {
    session.stop();
  }
  activeAgentSessions.clear();
  closeAllPersistentMcpTunnels();
  for (const [ws] of clients) {
    ws.close();
  }
  clients.clear();
  wss.close();
}
