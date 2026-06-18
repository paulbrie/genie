import { WebSocketServer, type WebSocket } from "ws";

import http from "node:http";
import type { WsMessage } from "./types.js";

import * as projectService from "./projects/project-service.js";
import * as orgService from "./org-service.js";
import * as projectManager from "./projects/project-manager.js";
import { startMonitoring, stopMonitoring } from "./logging/monitor.js";

import { startLogCapture, getLogBuffer, getErrorBuffer } from "./logging/log-capture.js";

import { setWsSend as setSshWsSend, closeAllSessionsForWs } from "./ssh/index.js";

import { initiateOAuth, handleOAuthCallback, verifyToken, getUserById, createToken, isAdmin } from "./auth/auth.js";

import { handleDebugServerLogs } from "./debug/debug-api.js";

import { pruneStaleSessions } from "./chat/assistant-session-state-service.js";
import { detachDurableChatTurnsForWs } from "./chat/durable-chat-turn.js";

import * as docsService from "./docs-service.js";
import * as trackerService from "./tracker-service.js";
import * as backupService from "./backup-service.js";
import * as auditService from "./logging/audit-service.js";
import * as connectionLogService from "./logging/connection-log-service.js";
import { getDb } from "./db/index.js";

import { users } from "./db/schema.js";

import { eq } from "drizzle-orm";

import { v4 as uuidv4 } from "uuid";

import { connectSsh, type SshConnectionConfig } from "./vps/ssh-client.js";

import { ingestVpsStats, startStatsDbPoll, unwatchVpsStatsForClient } from "./vps/stats-stream.js";

import { resolveStatsToken } from "./vps/stats-token-service.js";

import type { VpsStatsPayload } from "@genie/vps-stats";
import { ensureGenieKeyOnDisk } from "./vps/do-provision.js";

import { ensureTazcloudKeyOnDisk } from "./vps/tazcloud-provision.js";
import { syncDropletStatuses } from "./vps/droplet-sync.js";
import { activeAgentSessions } from "./vps/vps-agent-rsync.js";
import { handleMcpRestRequest, type McpRestService } from "./vps/mcp-rest-router.js";

import { type ClientType, type DomActionExecutor, type DomActionRequestContext, type StatsPayload } from "./types.js";

import { getActiveTunnelCount, releaseAllManageRefsForWs } from "./vps/ssh-session-cache.js";

import * as settingsService from "./settings-service.js";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { type Role, canSend, canReceive, getEntry, POLICY } from "./auth/ws-acl.js";

import { handleDbMessage } from "./handlers/db-handler.js";

import { handleBackupMessage } from "./handlers/backup-handler.js";

import { handleGitMessage } from "./handlers/git-handler.js";
import { handleVpsGitReposMessage } from "./handlers/vps-git-repos-handler.js";

import { handleFsMessage } from "./handlers/fs-handler.js";

import { handleVpsDbMessage } from "./handlers/vps-db-handler.js";

import { handleSecurityMessage, abortAllSecurityScans } from "./handlers/security-handler.js";

import { handleRecipesMessage } from "./handlers/recipes-handler.js";
import { handleKnowledgeMessage } from "./handlers/knowledge-handler.js";

import { handleClaudePluginsMessage } from "./handlers/claude-plugins-handler.js";

import { handleAgentsMessage } from "./handlers/agents-handler.js";

import { handleFileTemplateMessage } from "./handlers/file-template-handler.js";

import { handleProjectFileMessage } from "./handlers/project-file-handler.js";

import { handleTrackerMessage } from "./handlers/tracker-handler.js";

import { handleDocsMessage } from "./handlers/docs-handler.js";

import { handleDoMessage } from "./handlers/do-handler.js";

import { handleTazcloudMessage } from "./handlers/tazcloud-handler.js";

import { handleHetznerMessage } from "./handlers/hetzner-handler.js";

import { handleBaseimageMessage } from "./handlers/baseimage-handler.js";

import { handleOrgMessage } from "./handlers/org-handler.js";

import { handleAdminUsersMessage } from "./handlers/admin-users-handler.js";

import { handleTerminalMessage } from "./handlers/terminal-handler.js";

import { handleLocalPtyMessage, closeAllLocalPtySessionsForWs } from "./handlers/local-pty-handler.js";
import { handleClaudeStreamMessage } from "./handlers/claude-stream-handler.js";
import { setClaudeStreamSend, closeAllClaudeStreamsForWs } from "./ssh/claude-stream/session.js";

import { handleProjectMessage } from "./handlers/project-handler.js";

import { handleChatMessage } from "./handlers/chat-handler.js";

import { handleAdminMiscMessage } from "./handlers/admin-misc-handler.js";
import { handleAnalyticsMessage } from "./handlers/analytics-handler.js";
import * as analyticsService from "./logging/analytics-service.js";

import { handleLocalFsMessage } from "./handlers/local-fs-handler.js";

import { handleMiscMessage } from "./handlers/misc-handler.js";

import { handleVpsRuntimeMessage } from "./handlers/vps-runtime-handler.js";
import { handleAdminServerMetricsMessage } from "./handlers/admin-server-metrics-handler.js";
import { recordStatsRequest, recordWsSent, startServerMetrics, stopServerMetrics, unwatchServerMetrics } from "./logging/server-metrics.js";

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

// Bound analytics_events growth. Default 180d; set GENIE_ANALYTICS_RETENTION_DAYS=0 to keep forever.
const ANALYTICS_RETENTION_DAYS = Number(process.env.GENIE_ANALYTICS_RETENTION_DAYS ?? 180);
if (ANALYTICS_RETENTION_DAYS > 0) {
  setTimeout(() => void analyticsService.pruneOldEvents(ANALYTICS_RETENTION_DAYS), 45_000);
  setInterval(() => void analyticsService.pruneOldEvents(ANALYTICS_RETENTION_DAYS), 24 * 60 * 60_000);
}

// Bound audit_log growth — it gains a row on every WS action (~17k/day) and had
// reached 2.5 GB / 1.5M rows in under 3 months, so 90d+ would prune nothing.
// Default 30d; set GENIE_AUDIT_RETENTION_DAYS=0 to keep forever.
const AUDIT_RETENTION_DAYS = Number(process.env.GENIE_AUDIT_RETENTION_DAYS ?? 30);
async function runAuditJanitor(): Promise<void> {
  const removed = await auditService.pruneOldAuditLogs(AUDIT_RETENTION_DAYS);
  if (removed > 0) console.log(`[audit-janitor] pruned ${removed} audit row(s) older than ${AUDIT_RETENTION_DAYS}d`);
}
if (AUDIT_RETENTION_DAYS > 0) {
  setTimeout(() => void runAuditJanitor(), 60_000);
  setInterval(() => void runAuditJanitor(), 24 * 60 * 60_000);
}

// connection_log holds one row per WS close — much sparser than audit_log, but
// still bounded. 30d is enough to compare burst windows month-to-month and to
// hand Railway support sample request IDs long after the Railway log retention
// window has rolled off. Set GENIE_CONNECTION_LOG_RETENTION_DAYS=0 to keep forever.
const CONNECTION_LOG_RETENTION_DAYS = Number(process.env.GENIE_CONNECTION_LOG_RETENTION_DAYS ?? 30);
async function runConnectionLogJanitor(): Promise<void> {
  const removed = await connectionLogService.pruneOldConnectionLogs(CONNECTION_LOG_RETENTION_DAYS);
  if (removed > 0) console.log(`[connection-log-janitor] pruned ${removed} row(s) older than ${CONNECTION_LOG_RETENTION_DAYS}d`);
}
if (CONNECTION_LOG_RETENTION_DAYS > 0) {
  setTimeout(() => void runConnectionLogJanitor(), 60_000);
  setInterval(() => void runConnectionLogJanitor(), 24 * 60 * 60_000);
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
  /** Window id (e.g. "manage-hzserver-12345"). Used by the Connected Users
   *  panel to open the matching popup in the admin's own session. */
  id: string;
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
  /** The browser URL path this client is currently on (e.g. "/projects/foo/servers"),
   *  reported by the renderer via presence:path. More granular than currentNav —
   *  carries the entity slug / sub-tab the nav label alone drops. Admin-only (rides
   *  the admin-gated presence:detail broadcast). */
  currentPath: string | null;
  /** The project the client currently has selected (or null on non-project navs).
   *  Used by the 3D topology to draw real user → server lines. */
  selectedProjectId: string | null;
  recentActions: ClientAction[];
  /** Floating windows ("popups") this client currently has open/minimized. */
  openWindows: PresenceWindow[];
  ip: string | null;
  userAgent: string | null;
  /** When this socket connected — lets the close handler report session length,
   *  separating idle-timeout drops from mid-stream ones. */
  connectedAt: number;
  /** Railway edge request id (`x-railway-request-id` on the HTTP upgrade) —
   *  echoed in `[ws-close]` so we can hand Railway support the IDs they need to
   *  trace edge-side resets back to specific connections. */
  railwayRequestId: string | null;
}

const clients = new Map<WebSocket, ClientState>();

// WS heartbeat liveness, keyed by socket (covers pre-auth sockets too, so it
// isn't entangled with ClientState lifecycle). true = pong seen since last ping.
const wsAlive = new WeakMap<WebSocket, boolean>();

// Annotates a socket the SERVER is about to close/terminate, so the `close`
// handler can attribute the drop to a known cause (heartbeat reaped a half-open
// socket, admin revoked auth, graceful shutdown) instead of blaming the
// peer/edge. Set right before close()/terminate(); read once in the handler.
const closeReasonHint = new WeakMap<WebSocket, string>();

// Running breakdown of why sockets close, so a pattern is visible in the Logs
// panel without external aggregation. Keyed by server-hint or decoded code.
const wsCloseTally = new Map<string, number>();

// Throttle the per-postback [stats] log. Each VM posts every ~5s and there are
// dozens of them, so logging every postback floods the 100KB log buffer and
// evicts everything else (ws-close forensics, errors) within minutes. Log at
// most one line per instance per window; ingestion + metrics are unaffected.
const STATS_LOG_THROTTLE_MS = 60_000;
const lastStatsLogAt = new Map<string, number>();

// Decode a WS close code (RFC 6455). 1006 (abnormal, no close frame) is the
// signature of a TCP reset / proxy idle-kill / peer vanishing — i.e. the edge
// dropped it, not a clean app close.
function describeWsCloseCode(code: number): string {
  switch (code) {
    case 1000: return "normal";
    case 1001: return "going-away";
    case 1002: return "protocol-error";
    case 1005: return "no-status";
    case 1006: return "abnormal-no-close-frame";
    case 1008: return "policy-violation";
    case 1009: return "message-too-big";
    case 1011: return "server-error";
    case 1012: return "service-restart";
    case 1013: return "try-again-later";
    case 1015: return "tls-failure";
    default: return code >= 4000 ? "app-defined" : "other";
  }
}
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
      closeReasonHint.set(clientWs, "auth-revoked");
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

// The genie-* MCP services now reach the manager over REST (see
// mcp-rest-router.ts), so there are no per-host tunnels to build when the
// Chrome extension attaches. We still track the extension socket so the
// browser DOM broker (createDomActionExecutor) can route to it.
async function registerExtensionSocket(extensionWs: WebSocket, userId: string): Promise<void> {
  registerExtensionClient(userId, extensionWs);
}

async function unregisterExtensionSocket(userId: string): Promise<void> {
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
      recordWsSent();
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
      recordWsSent();
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
    sshConnections: getActiveTunnelCount(),
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
  recordWsSent();
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

/** Display name of the authenticated user behind a socket (impersonation-aware:
 *  this is the active identity, the same one ACL gates on). Null if unknown. */
export function getClientUserName(ws: WebSocket): string | null {
  return clients.get(ws)?.user?.name ?? null;
}

const PRESENCE_SKIP_TYPES = new Set([
  "ping", "pong", "stats", "presence:nav", "presence:path", "presence:windows", "presence:detail",
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
  /** The browser URL path this session is currently on (e.g. "/clouds/taz"). */
  currentPath: string | null;
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
      currentPath: state.currentPath,
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
            // A genuine sign-in. The auth:token path is silent token re-auth on
            // every WS (re)connect, so recording the login there over-counts
            // reconnects as logins — keep auth.login on the real OAuth flow only.
            void analyticsService.recordEvent({
              userId: user.id,
              userName: user.name,
              event: "auth.login",
              props: { role: user.role, impersonated: false },
              ip: state?.ip ?? null,
            });
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

// Broadcast tracker:list to every authenticated client, with issues filtered
// per recipient to the projects they may see (mirrors broadcastProjectList).
// Labels are global, so fetch them once. Without per-recipient scoping a
// mutation would leak every project's issues to everyone.
export async function broadcastTrackerList(): Promise<void> {
  const labels = await trackerService.listLabels();
  const tasks: Promise<unknown>[] = [];
  for (const [ws, state] of clients) {
    if (ws.readyState !== ws.OPEN || !state.userId) continue;
    tasks.push(
      projectService.getAccessibleProjectIds(state.userId).then((allowedProjectIds) =>
        trackerService.listIssues(allowedProjectIds).then((issues) => {
          send(ws, { type: "tracker:list", payload: { issues, labels } });
        }),
      ),
    );
  }
  await Promise.all(tasks);
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

  if (msg.type === "presence:path") {
    // Cap at 256 chars — app paths are short slug/sub-tab segments. Without this
    // an authenticated client could ship a huge string that broadcastPresenceDetail
    // amplifies to every admin on each presence tick (same guard as openWindows).
    const p = msg.payload?.path;
    state.currentPath = typeof p === "string" && p ? p.slice(0, 256) : null;
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
        // Cap id at 128 chars — window ids are short prefixed slugs.
        id: typeof w.id === "string" ? w.id.slice(0, 128) : "",
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
    // Track the extension socket for the browser DOM broker (no MCP tunnels).
    registerExtensionSocket(ws, userId).catch(err =>
      console.error(`[extension] Register error: ${(err instanceof Error ? err.message : String(err))}`)
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
  if (await handleDbMessage(ws, msg, send, state.role)) return;
  if (await handleBackupMessage(ws, msg, send)) return;
  if (await handleGitMessage(ws, msg, send, userId, state.role)) return;
  if (await handleVpsGitReposMessage(ws, msg, send, userId, broadcast, state.role)) return;
  if (await handleFsMessage(ws, msg, send, userId)) return;
  if (await handleVpsDbMessage(ws, msg, send, userId)) return;
  if (await handleSecurityMessage(ws, msg, send, userId)) return;
  if (await handleRecipesMessage(ws, msg, send, userId, broadcast, state.role)) return;
  if (await handleKnowledgeMessage(ws, msg, send, userId, broadcast, state.role)) return;
  if (await handleClaudePluginsMessage(ws, msg, send, userId, broadcast, state.role)) return;
  if (await handleAgentsMessage(ws, msg, send, userId, broadcast)) return;
  if (await handleFileTemplateMessage(ws, msg, send, userId)) return;
  if (await handleProjectFileMessage(ws, msg, send, userId, state.role)) return;
  if (await handleTrackerMessage(ws, msg, send, userId, broadcast, broadcastTrackerList)) return;
  if (await handleDocsMessage(ws, msg, send, userId, sendToUser)) return;
  if (await handleDoMessage(ws, msg, send, userId, state.role, broadcast)) return;
  if (await handleTazcloudMessage(ws, msg, send, userId, state.role, broadcast)) return;
  if (await handleHetznerMessage(ws, msg, send, userId, state.role, broadcast)) return;
  if (await handleBaseimageMessage(ws, msg, send, broadcast)) return;
  if (await handleOrgMessage(ws, msg, send, userId, state.impersonatedBy)) return;
  if (await handleAdminUsersMessage(ws, msg, send, state)) return;
  if (await handleLocalPtyMessage(ws, msg, send, userId)) return;
  if (await handleTerminalMessage(ws, msg, send, broadcast, userId, state.role)) return;
  if (await handleClaudeStreamMessage(ws, msg, send, userId, state.role)) return;
  if (await handleProjectMessage(ws, msg, send, state)) return;
  if (await handleChatMessage(ws, msg, send, state)) return;
  if (await handleAdminMiscMessage(ws, msg, send, state)) return;
  if (await handleAnalyticsMessage(ws, msg, send, state)) return;
  if (await handleLocalFsMessage(ws, msg, send)) return;
  if (await handleMiscMessage(ws, msg, send, broadcast, state)) return;
  if (await handleVpsRuntimeMessage(ws, msg, send, userId, state.role)) return;
  if (await handleAdminServerMetricsMessage(ws, msg, send, state.role)) return;
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
  setClaudeStreamSend((ws, message) => send(ws, message as WsMessage));

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
        // Throttled Logs-panel line per VM (≤1/min/instance — see lastStatsLogAt).
        const statsKey = `${owner.projectId}:${owner.instanceId}`;
        const nowMs = Date.now();
        if (nowMs - (lastStatsLogAt.get(statsKey) ?? 0) >= STATS_LOG_THROTTLE_MS) {
          lastStatsLogAt.set(statsKey, nowMs);
          const ip = req.socket.remoteAddress ?? "?";
          console.log(
            `[stats] postback from ${ip} · ${statsKey} ` +
              `cpu=${body.stats.cpuPercent.toFixed(0)}% mem=${body.stats.memPercent.toFixed(0)}% disk=${body.stats.diskPercent.toFixed(0)}%`,
          );
        }
        recordStatsRequest();
        ingestVpsStats(owner.projectId, owner.instanceId, ts, body.stats, send);
        sendJson(200, { ok: true });
      } catch (err: unknown) {
        sendJson(400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // genie-* MCP services over REST: the VM's Claude reaches these directly
    // over HTTPS with its per-instance bearer token (no reverse tunnels). The
    // router authenticates and frames JSON-RPC; we inject the manager-side
    // broadcast side effects so it doesn't import this module back.
    const mcpMatch = req.url?.match(/^\/api\/vps\/mcp\/(tracker|security|notify|storage)$/);
    if (mcpMatch) {
      await handleMcpRestRequest(req, res, mcpMatch[1] as McpRestService, {
        broadcastChatMessage: (memberIds, conversationId, message) => {
          broadcastToUsers(memberIds, { type: "chat:message:new", payload: { conversationId, message } });
        },
        onIssueUpdated: () => { broadcastTrackerList().catch(() => { /* noop */ }); },
      });
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

  // Per-second server throughput buffer for the superadmin "Server" dashboard.
  startServerMetrics(send);

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
    const railwayRequestId = (req.headers["x-railway-request-id"] as string) || (req.headers["x-request-id"] as string) || null;
    clients.set(ws, { userId: null, user: null, role: null, impersonatedBy: null, clientType: "web", assistantSessionId: null, currentNav: null, currentPath: null, selectedProjectId: null, recentActions: [], openWindows: [], ip, userAgent, connectedAt: Date.now(), railwayRequestId });
    console.log(`Client connected (${clients.size} total)${railwayRequestId ? ` reqId=${railwayRequestId}` : ""}`);

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

    ws.on("close", (code: number, reasonBuf: Buffer) => {
      // --- Disconnect forensics ---------------------------------------------
      // Attribute every drop. `hint` is set when WE closed it (heartbeat reaped a
      // half-open socket, auth revoked, shutdown); otherwise the peer/edge did.
      // wsAlive=false at close time means the last ping went unanswered → the
      // socket was already half-open (network/edge), not a clean client close.
      const hint = closeReasonHint.get(ws);
      closeReasonHint.delete(ws);
      const stateForLog = clients.get(ws);
      const durSec = stateForLog ? Math.round((Date.now() - stateForLog.connectedAt) / 1000) : -1;
      const who = stateForLog?.user?.email ?? stateForLog?.userId ?? "unauthed";
      const reasonStr = reasonBuf?.toString() || "";
      const tallyKey = hint ?? `code:${code}`;
      wsCloseTally.set(tallyKey, (wsCloseTally.get(tallyKey) ?? 0) + 1);
      const tally = [...wsCloseTally].map(([k, v]) => `${k}=${v}`).join(" ");
      console.log(
        `[ws-close] ${who} code=${code}(${describeWsCloseCode(code)}) ` +
        `${hint ? `server-initiated=${hint}` : "peer-or-edge-closed"} ` +
        `aliveLastPing=${wsAlive.get(ws)} durSec=${durSec} ` +
        `clientType=${stateForLog?.clientType ?? "?"} ip=${stateForLog?.ip ?? "?"} ` +
        `reqId=${stateForLog?.railwayRequestId ?? "?"}` +
        `${reasonStr ? ` reason="${reasonStr}"` : ""} | tally: ${tally}`,
      );

      // Persist to connection_log for cross-burst analysis and to outlive
      // Railway's log retention. Fire-and-forget; errors are logged inside
      // recordDisconnect so a DB hiccup doesn't break the close path.
      void connectionLogService.recordDisconnect({
        userId: stateForLog?.userId ?? null,
        userName: stateForLog?.user?.name ?? null,
        clientType: stateForLog?.clientType ?? null,
        ip: stateForLog?.ip ?? null,
        userAgent: stateForLog?.userAgent ?? null,
        railwayRequestId: stateForLog?.railwayRequestId ?? null,
        connectedAt: stateForLog ? new Date(stateForLog.connectedAt) : new Date(),
        closedAt: new Date(),
        durationSec: durSec >= 0 ? durSec : null,
        closeCode: code,
        closeDescription: describeWsCloseCode(code),
        closeHint: hint ?? null,
        closeReason: reasonStr || null,
        aliveLastPing: wsAlive.get(ws) ?? null,
      });

      unwatchVpsStatsForClient(ws);
      unwatchServerMetrics(ws);

      // Abort any active chat stream for this connection. The claude-code path
      // (VPS agent routing) is tracked here and aborted on drop. The direct
      // Anthropic floating-assistant path is durable instead: detach it so it
      // keeps running and can be replayed on reconnect (grace-limited).
      const chatAbort = activeChatAbortControllers.get(ws);
      if (chatAbort) {
        chatAbort.abort();
        activeChatAbortControllers.delete(ws);
      }
      detachDurableChatTurnsForWs(ws);

      // Abort any active security scans for this connection
      abortAllSecurityScans();

      const closingState = clients.get(ws);
      const wasAuthenticated = closingState?.userId != null;
      // Tear down persistent MCP tunnel if this was the extension
      if (closingState?.clientType === "chrome-extension" && closingState?.userId) {
        unregisterExtensionSocket(closingState.userId).catch(() => {});
      }
      // Dispose any interactive terminals tied to this socket: SSH (VM
      // connections) and local PTY (manager-pty). One session per terminal,
      // no persistent reuse — closing the WS kills the dial / pty.
      closeAllSessionsForWs(ws);
      closeAllClaudeStreamsForWs(ws);
      closeAllLocalPtySessionsForWs(ws);
      // Tab close skips React useEffect cleanup, so the renderer's paired
      // admin:server:tunnel:release never arrives. Drop every manage ref this
      // ws bumped via ensureServerTunnel so the cached SshSession can evict.
      releaseAllManageRefsForWs(ws);
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
        // Missed the previous ping round → half-open. Tag before terminate() so
        // the close log shows OUR heartbeat reaped it (vs the edge dropping it).
        // A high count here means either real half-opens (edge/network) or the
        // event loop stalling so pongs aren't read in time — both worth knowing.
        closeReasonHint.set(ws, "heartbeat-missed-pong");
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
  stopServerMetrics();
  projectManager.stopEverything();
  // Close all VPS agent sessions
  for (const [, session] of activeAgentSessions) {
    session.stop();
  }
  activeAgentSessions.clear();
  for (const [ws] of clients) {
    closeReasonHint.set(ws, "server-shutdown");
    ws.close();
  }
  clients.clear();
  wss.close();
}
