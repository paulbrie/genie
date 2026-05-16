import { WebSocketServer, type WebSocket } from "ws";
import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { WsMessage as WsMessageBase } from "./types.js";

/** Internal WsMessage variant with typed payload for handler convenience */
interface WsMessage extends Omit<WsMessageBase, 'payload'> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
}
import * as projectService from "./project-service.js";
import * as cloudVmAliases from "./cloud-vm-alias-service.js";
import * as projectManager from "./project-manager.js";
import { startMonitoring, stopMonitoring, setMonitoringInterval, getDockerBin } from "./monitor.js";
import { handleChat, type ChatModelId } from "./chat.js";
import { startLogCapture, getLogBuffer, clearLogBuffer } from "./log-capture.js";
import { setPtyEventCallback, spawnPty, spawnSshPty, writePty, resizePty, closePty, closeAllPtys, getSessionAccess, getScrollback, addCollaborator, removeCollaborator, isAuthorized, removeCollaboratorFromAll, getUserSessionDetails } from "./pty-manager.js";
import { initiateOAuth, handleOAuthCallback, verifyToken, getUserById, createToken, isAdmin } from "./auth.js";
import * as assistantLogService from "./assistant-log-service.js";
import * as chatService from "./chat-service.js";
import * as docsService from "./docs-service.js";
import * as trackerService from "./tracker-service.js";
import * as adminService from "./admin-service.js";
import * as backupService from "./backup-service.js";
import * as auditService from "./audit-service.js";
import * as railwayService from "./railway-service.js";
import { getClaudeUserId } from "./db/seed.js";
import { getDb } from "./db/index.js";
import { deployLogs, aiUsage, users, savedQueries, teams, teamMembers, fileTemplates } from "./db/schema.js";
import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { connectSsh, type SshSession } from "./vps/ssh-client.js";
import type { StreamingChannel, SftpWriteHandle } from "./vps/ssh-client.js";
import { vpsDeploy, vpsStatus, vpsLogs, vpsTeardown, vpsStats, remoteDir } from "./vps/deploy-service.js";
import { createDoClient } from "./vps/do-api-client.js";
import { doProvisionAndDeploy, doDestroyDroplet, ensureGenieKeyOnDisk, ensureGenieKeyPair, writeKeyToDisk, sshKeyFingerprint, buildUfwRules } from "./vps/do-provision.js";
import { tazcloudProvisionAndDeploy, tazcloudDestroyVm, ensureTazcloudKeyOnDisk } from "./vps/tazcloud-provision.js";
import { createTazClient, sshUserForImage } from "./vps/tazcloud-api-client.js";
import * as recipesService from "./recipes-service.js";
import { createBaseImage } from "./vps/do-base-image.js";
import { setupMcpTunnel, type McpTunnel } from "./vps/mcp-tunnel.js";
import { setupMcpTrackerTunnel, type McpTrackerTunnel } from "./vps/mcp-tracker-tunnel.js";
import { setupMcpSecurityTunnel, type McpSecurityTunnel } from "./vps/mcp-security-tunnel.js";
import { setupMcpNotifyTunnel, type McpNotifyTunnel } from "./vps/mcp-notify-tunnel.js";
import { setupMcpStorageTunnel, type McpStorageTunnel } from "./vps/mcp-storage-tunnel.js";
import { VPS_SSH_USERNAME, type VpsConnectionConfig, type ClientType, type DomActionExecutor, type AgentOutboundMessage } from "./types.js";
import * as settingsService from "./settings-service.js";
import type { BaseImageConfig, BaseImageTemplate } from "./settings-service.js";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";


/** Track active base image creation AbortController */
let baseImageAbortController: AbortController | null = null;
/** Track which config name is currently building */
let baseImageBuildingName: string | null = null;

/** Track active chat AbortControllers by WebSocket (floating assistant) */
const activeChatAbortControllers = new Map<WebSocket, AbortController>();

/** Track active conversation chat AbortControllers by conversationId */
const activeConversationAbortControllers = new Map<string, AbortController>();

/** Track active DO deploy AbortControllers by projectId */
const activeDoAbortControllers = new Map<string, AbortController>();
const activeTazAbortControllers = new Map<string, AbortController>();

/** Track active security scan AbortControllers by scanId */
const activeSecurityAbortControllers = new Map<string, AbortController>();

/** Active SSH sessions for inline project commands (key: projectId:commandId) */
const activeCommandSessions = new Map<string, SshSession>();

/** In-flight chunked uploads, keyed by client-generated uploadId */
interface PendingUpload {
  session: SshSession;
  handle: SftpWriteHandle;
  offset: number;
  filePath: string;
  staleTimer: ReturnType<typeof setTimeout>;
}
const pendingUploads = new Map<string, PendingUpload>();
async function cleanupUpload(uploadId: string, opts: { deletePartial?: boolean } = {}) {
  const p = pendingUploads.get(uploadId);
  if (!p) return;
  clearTimeout(p.staleTimer);
  pendingUploads.delete(uploadId);
  try { await p.handle.close(); } catch { /* ignore */ }
  if (opts.deletePartial) {
    try {
      const escaped = p.filePath.replace(/'/g, "'\\''");
      await p.session.exec(`rm -f '${escaped}'`);
    } catch { /* ignore */ }
  }
  try { p.session.close(); } catch { /* ignore */ }
}

/** Set of droplet IDs known to be alive (refreshed periodically via DO API) */
let knownAliveDropletIds: Set<number> = new Set();
let lastDropletSync = 0;

// --- VPS Agent sessions ---

interface VpsAgentSession {
  send(msg: object): void;
  onMessage(handler: (msg: AgentOutboundMessage) => void): void;
  stop(): void;
  lastActivity: number;
  /** The WebSocket currently using this session (prevents concurrent chat collisions) */
  currentWs: WebSocket | null;
}

/** Active VPS agent sessions keyed by "projectId:instanceId" */
const activeAgentSessions = new Map<string, VpsAgentSession>();

/** Agent session idle timeout (5 minutes) */
const AGENT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Periodically clean up idle agent sessions */
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of activeAgentSessions) {
    if (now - session.lastActivity > AGENT_IDLE_TIMEOUT_MS) {
      session.stop();
      activeAgentSessions.delete(key);
    }
  }
}, 60_000);

/** Resolve path to vps-agent dist directory (relative to this package) */
function getVpsAgentDistDir(): string {
  // packages/manager/dist/ws-server.js -> packages/vps-agent/dist
  const dir = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(dir, "../../vps-agent/dist");
}

const VPS_AGENT_REMOTE_BASE = "/usr/lib/node_modules/@genie/vps-agent";

/** Compute a hash of all local vps-agent dist JS files + package.json */
async function computeLocalAgentHash(): Promise<string> {
  const localDist = getVpsAgentDistDir();
  const localPkg = path.resolve(localDist, "../package.json");
  const hash = crypto.createHash("sha256");

  // Hash package.json
  hash.update(await fsp.readFile(localPkg));

  // Recursively hash all .js files in deterministic order
  async function hashDir(dir: string) {
    const entries = (await fsp.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await hashDir(fullPath);
      } else if (entry.name.endsWith(".js")) {
        hash.update(entry.name);
        hash.update(await fsp.readFile(fullPath));
      }
    }
  }
  await hashDir(localDist);
  return hash.digest("hex").slice(0, 16);
}

/** Collect all JS files from local vps-agent dist for upload */
async function collectAgentFiles(): Promise<{ remotePath: string; content: string }[]> {
  const localDist = getVpsAgentDistDir();
  const localPkg = path.resolve(localDist, "../package.json");
  const files: { remotePath: string; content: string }[] = [];

  files.push({
    remotePath: `${VPS_AGENT_REMOTE_BASE}/package.json`,
    content: await fsp.readFile(localPkg, "utf-8"),
  });

  async function collect(dir: string, remoteBase: string) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const remotePath = `${remoteBase}/${entry.name}`;
      if (entry.isDirectory()) {
        await collect(fullPath, remotePath);
      } else if (entry.name.endsWith(".js")) {
        files.push({ remotePath, content: await fsp.readFile(fullPath, "utf-8") });
      }
    }
  }
  await collect(localDist, `${VPS_AGENT_REMOTE_BASE}/dist`);
  return files;
}

const VERSION_FILE = `${VPS_AGENT_REMOTE_BASE}/.version`;

/** Resolve a VPS connection config from projectId + instanceId */
async function getVpsConnection(projectId: string, instanceId: string): Promise<VpsConnectionConfig> {
  const project = await projectService.getById(projectId);
  const inst = project?.vpsInstances.find((v) => v.id === instanceId);
  if (!inst) throw new Error("VPS instance not found");
  return inst.connection;
}

/** Parse psql table list output (relname|reltuples per line) */
function parseTableList(out: string): { name: string; rowCount: number | null }[] {
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const parts = line.split("|");
    const name = parts[0]?.trim();
    if (!name || name.startsWith("(") || name.includes("ERROR") || name.includes("FATAL")) return null;
    const count = parts[1] ? parseInt(parts[1].trim()) : null;
    return { name, rowCount: count !== null && count >= 0 ? count : null };
  }).filter(Boolean) as { name: string; rowCount: number | null }[];
}

/** Parse psql CSV output into columns + rows */
function parseCsvResult(out: string): { columns: string[]; rows: Record<string, unknown>[]; rowCount: number; error?: string } {
  const lines = out.trim().split("\n");
  if (lines.length === 0 || out.includes("ERROR") || out.includes("FATAL")) {
    return { columns: [], rows: [], rowCount: 0, error: out.trim() };
  }

  // First line is header
  const headerLine = lines[0];
  const columns = parseCsvLine(headerLine);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("(") || line.startsWith("--")) continue;
    const values = parseCsvLine(line);
    const row: Record<string, unknown> = {};
    columns.forEach((col, j) => { row[col] = values[j] ?? null; });
    rows.push(row);
  }

  return { columns, rows, rowCount: rows.length };
}

/** Simple CSV line parser that handles quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Ensure the vps-agent on the remote VPS matches the local build, re-uploading if stale */
async function ensureVpsAgent(connection: VpsConnectionConfig): Promise<void> {
  const localHash = await computeLocalAgentHash();

  // Check remote version
  const checkSession = await connectSsh(connection, { timeoutMs: 30_000 });
  let remoteHash = "";
  try {
    remoteHash = (await checkSession.exec(`cat ${VERSION_FILE} 2>/dev/null || echo ""`)).trim();
  } catch { /* missing */ }
  checkSession.close();

  if (remoteHash === localHash) return;

  console.log(`[vps-agent] Version mismatch (local=${localHash}, remote=${remoteHash || "none"}), uploading...`);
  const filesToUpload = await collectAgentFiles();

  const uploadSession = await connectSsh(connection, { timeoutMs: 30_000 });
  try {
    // Create directory structure
    const dirs = new Set(filesToUpload.map((f) => path.posix.dirname(f.remotePath)));
    await uploadSession.exec(`mkdir -p ${[...dirs].join(" ")}`);

    // Write each file using base64
    for (const file of filesToUpload) {
      const b64 = Buffer.from(file.content).toString("base64");
      await uploadSession.exec(`echo '${b64}' | base64 -d > ${file.remotePath}`);
    }

    // Install dependencies
    await uploadSession.exec(`cd ${VPS_AGENT_REMOTE_BASE} && npm install --omit=dev --no-audit --no-fund 2>&1`);

    // Write version marker
    await uploadSession.exec(`echo '${localHash}' > ${VERSION_FILE}`);
    console.log(`[vps-agent] Uploaded successfully (version=${localHash})`);
  } finally {
    uploadSession.close();
  }
}

/** Start a VPS agent process on a remote VPS via SSH */
async function startVpsAgent(
  project: { id: string; name: string },
  instance: { id: string; label: string; connection: VpsConnectionConfig },
): Promise<VpsAgentSession> {
  const sessionKey = `${project.id}:${instance.id}`;

  // Return cached session if available
  const existing = activeAgentSessions.get(sessionKey);
  if (existing) {
    existing.lastActivity = Date.now();
    return existing;
  }

  // Ensure vps-agent is installed on the remote before trying to start it
  await ensureVpsAgent(instance.connection);

  // Open SSH connection
  const sshSession = await connectSsh(instance.connection, { timeoutMs: 30_000 });

  // Start the agent process via streaming exec
  const channel: StreamingChannel = await sshSession.execStreaming(
    `node ${VPS_AGENT_REMOTE_BASE}/dist/index.js`,
  );

  let messageHandler: ((msg: AgentOutboundMessage) => void) | null = null;
  let lineBuffer = "";
  let channelClosed = false;

  // Parse JSON lines from stdout
  channel.stdout.on("data", (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as AgentOutboundMessage;
        messageHandler?.(msg);
      } catch {
        // Ignore non-JSON lines (agent startup noise, etc.)
      }
    }
  });

  // Detect when the remote process exits (stdout closes)
  channel.stdout.on("end", () => {
    channelClosed = true;
    // Synthesize an error so any pending "ready" wait or chat handler gets notified
    messageHandler?.({ type: "error", message: "VPS agent process exited unexpectedly" });
  });

  // Log stderr for debugging
  channel.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.error(`[vps-agent:${instance.label}] ${text}`);
  });

  const session: VpsAgentSession = {
    lastActivity: Date.now(),
    currentWs: null,
    send(msg: object) {
      if (channelClosed) return; // Guard against write-after-end
      session.lastActivity = Date.now();
      try {
        channel.stdin.write(JSON.stringify(msg) + "\n");
      } catch {
        // Stream already ended — ignore
      }
    },
    onMessage(handler) {
      messageHandler = handler;
    },
    stop() {
      channelClosed = true;
      try { channel.close(); } catch {}
      try { sshSession.close(); } catch {}
      activeAgentSessions.delete(sessionKey);
    },
  };

  activeAgentSessions.set(sessionKey, session);

  // Send init message
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  session.send({
    type: "init",
    apiKey,
    projectDir: remoteDir(project.name),
    maxToolRounds: 40,
  });

  // Wait for "ready" with timeout
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("VPS agent did not respond with 'ready' within 8s"));
      }, 8_000);

      const originalHandler = messageHandler;
      session.onMessage((msg) => {
        if (msg.type === "ready") {
          clearTimeout(timeout);
          session.onMessage(originalHandler || (() => {}));
          resolve();
        } else if (msg.type === "error") {
          clearTimeout(timeout);
          reject(new Error(msg.message));
        }
      });
    });
  } catch (err) {
    // Clean up on failure so we don't leave a broken session cached
    session.stop();
    throw err;
  }

  return session;
}

/** Track Claude Code conversation IDs for --resume (key: "projectId:instanceId") */
const claudeCodeConversations = new Map<string, string>();

/** Route a chat to Claude Code on VPS. Returns true if handled, false if fallback needed. */
async function routeChatToVpsAgent(
  ws: WebSocket,
  userId: string,
  messages: { role: "user" | "assistant"; content: string }[],
  chatContext: string | undefined,
  domSnapshot: string | undefined,
  abortSignal: AbortSignal,
  onComplete?: (fullContent: string, toolUses: { name: string; input: unknown; result: string }[]) => void,
  projectIdHint?: string | null,
): Promise<boolean> {
  // Extract projectId from context string or use the hint from the caller
  let projectId: string | null = projectIdHint || null;

  if (!projectId && chatContext) {
    const projectIdMatch = chatContext.match(/Project ID:\s*([a-f0-9-]+)/i)
      || chatContext.match(/projectId[=:]\s*["']?([a-f0-9-]+)/i)
      || chatContext.match(/\(id:\s+([a-f0-9-]+)\)/);
    projectId = projectIdMatch?.[1] || null;
  }

  // Fallback: if still no project ID, find any project with VPS instances
  if (!projectId) {
    const allProjects = await projectService.getAll();
    const vpsProject = allProjects.find(p => p.vpsInstances.length > 0);
    if (vpsProject) {
      projectId = vpsProject.id;
      console.log(`[claude-code] No project in context, falling back to project "${vpsProject.name}" (${vpsProject.id})`);
    } else {
      console.log(`[claude-code] No project with VPS instances found. Context: ${chatContext?.slice(0, 200) || "(none)"}`);
      return false;
    }
  }

  const project = await projectService.getById(projectId);
  if (!project || project.vpsInstances.length === 0) {
    console.log(`[claude-code] Project ${projectId} not found or has no VPS instances`);
    return false;
  }

  // Use the first VPS instance
  const instance = project.vpsInstances[0];
  const sessionKey = `${project.id}:${instance.id}`;
  const existingSessionId = claudeCodeConversations.get(sessionKey);

  // Get the last user message
  const lastUserMsg = messages[messages.length - 1];
  if (!lastUserMsg || lastUserMsg.role !== "user") return false;

  let sshSession: SshSession;
  try {
    send(ws, { type: "chat:status", payload: { status: "Connecting to VPS..." } });
    sshSession = await connectSsh(instance.connection, { timeoutMs: 30_000 });
  } catch (err: unknown) {
    console.error(`SSH connect failed for Claude Code: ${(err instanceof Error ? err.message : String(err))}`);
    return false;
  }

  const dest = remoteDir(project.name);

  // Ensure MCP tunnels are active for this VPS instance
  {
    const tKey = tunnelKey(userId, instance.connection.host);
    let tunnel = persistentMcpTunnels.get(tKey);
    const needsAnyTunnel = !tunnel?.trackerTunnel || !tunnel?.securityTunnel || !tunnel?.notifyTunnel || !tunnel?.storageTunnel;

    if (needsAnyTunnel) {
      try {
        // Use a dedicated SSH session for MCP tunnels (the chat session will be consumed by Claude Code)
        const tunnelSsh = tunnel?.sshSession ?? await connectSsh(instance.connection, { timeoutMs: 30_000 });

        if (!tunnel) {
          tunnel = { sshSession: tunnelSsh, mcpTunnel: null as any, projectName: project.name, instanceHost: instance.connection.host };
          persistentMcpTunnels.set(tKey, tunnel);
        }

        if (!tunnel.trackerTunnel) {
          try {
            tunnel.trackerTunnel = await setupMcpTrackerTunnel(tunnelSsh, project.id, { remotePort: MCP_TRACKER_REMOTE_PORT, onIssueUpdated: () => { broadcastTrackerList().catch(() => {}); } });
            console.log(`[claude-code] Tracker tunnel established for ${project.name}`);
          } catch (err: unknown) {
            console.error(`[claude-code] Tracker tunnel failed for ${project.name}: ${(err instanceof Error ? err.message : String(err))}`);
          }
        }

        if (!tunnel.securityTunnel) {
          try {
            tunnel.securityTunnel = await setupMcpSecurityTunnel(tunnelSsh, { remotePort: MCP_SECURITY_REMOTE_PORT });
            console.log(`[claude-code] Security tunnel established for ${project.name}`);
          } catch (err: unknown) {
            console.error(`[claude-code] Security tunnel failed for ${project.name}: ${(err instanceof Error ? err.message : String(err))}`);
          }
        }

        if (!tunnel.notifyTunnel) {
          try {
            tunnel.notifyTunnel = await setupMcpNotifyTunnel(tunnelSsh, (memberIds, conversationId, message) => {
              broadcastToUsers(memberIds, { type: "chat:message:new", payload: { conversationId, message } });
            }, { remotePort: MCP_NOTIFY_REMOTE_PORT });
            console.log(`[claude-code] Notify tunnel established for ${project.name}`);
          } catch (err: unknown) {
            console.error(`[claude-code] Notify tunnel failed for ${project.name}: ${(err instanceof Error ? err.message : String(err))}`);
          }
        }

        if (!tunnel.storageTunnel) {
          try {
            tunnel.storageTunnel = await setupMcpStorageTunnel(tunnelSsh, project.name, { remotePort: MCP_STORAGE_REMOTE_PORT });
            console.log(`[claude-code] Storage tunnel established for ${project.name}`);
          } catch (err: unknown) {
            console.error(`[claude-code] Storage tunnel failed for ${project.name}: ${(err instanceof Error ? err.message : String(err))}`);
          }
        }

        // Merge MCP servers into .mcp.json on the VPS
        const mergeScript = [
          `existing=$(cat ${dest}/.mcp.json 2>/dev/null || echo '{"mcpServers":{}}')`,
          `echo "$existing" | node -e "`,
          `  const fs = require('fs');`,
          `  let input = '';`,
          `  process.stdin.on('data', d => input += d);`,
          `  process.stdin.on('end', () => {`,
          `    const cfg = JSON.parse(input);`,
          `    if (!cfg.mcpServers) cfg.mcpServers = {};`,
          ...(tunnel.trackerTunnel ? [
          `    cfg.mcpServers['genie-tracker'] = { type: 'http', url: 'http://127.0.0.1:${MCP_TRACKER_REMOTE_PORT}/mcp' };`,
          ] : []),
          ...(tunnel.securityTunnel ? [
          `    cfg.mcpServers['genie-security'] = { type: 'http', url: 'http://127.0.0.1:${MCP_SECURITY_REMOTE_PORT}/mcp' };`,
          ] : []),
          ...(tunnel.notifyTunnel ? [
          `    cfg.mcpServers['genie-notify'] = { type: 'http', url: 'http://127.0.0.1:${MCP_NOTIFY_REMOTE_PORT}/mcp' };`,
          ] : []),
          ...(tunnel.storageTunnel ? [
          `    cfg.mcpServers['genie-storage'] = { type: 'http', url: 'http://127.0.0.1:${MCP_STORAGE_REMOTE_PORT}/mcp' };`,
          ] : []),
          `    fs.writeFileSync('${dest}/.mcp.json', JSON.stringify(cfg, null, 2));`,
          `  });`,
          `"`,
        ].join("\n");
        await tunnelSsh.exec(mergeScript);

        console.log(`[claude-code] MCP tunnels ready for ${project.name}`);
      } catch (err: unknown) {
        console.error(`[claude-code] Failed to set up MCP tunnels: ${(err instanceof Error ? err.message : String(err))}`);
      }
    }
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || "";

    // Resolve claude binary path and read AGENT.md in parallel
    send(ws, { type: "chat:status", payload: { status: "Connecting to Claude Code..." } });

    // Search common paths and npm global bin; read AGENT.md in parallel
    const [claudePathRaw, agentMd] = await Promise.all([
      sshSession.exec(
        `bash -lc "which claude 2>/dev/null" || command -v claude 2>/dev/null || ` +
        `for p in /usr/local/bin/claude /usr/bin/claude /root/.npm-global/bin/claude "$(npm bin -g 2>/dev/null)/claude"; do ` +
        `  [ -x "$p" ] && echo "$p" && exit 0; done; echo ""`,
        undefined, { timeoutMs: 10_000 },
      ).then(s => s.trim()),
      sshSession.exec(`cat ${dest}/AGENT.md 2>/dev/null || echo ""`, undefined, { timeoutMs: 5_000 }).then(s => s.trim()),
    ]);

    let claudePath = claudePathRaw;

    if (!claudePath) {
      // Auto-install Claude Code CLI
      console.log(`[claude-code] claude binary not found on VPS, installing...`);
      send(ws, { type: "chat:status", payload: { status: "Installing Claude Code CLI on VPS..." } });
      try {
        await sshSession.exec(`npm install -g @anthropic-ai/claude-code`, undefined, { timeoutMs: 120_000 });
        // Re-check after install
        claudePath = (await sshSession.exec(
          `bash -lc "which claude 2>/dev/null" || command -v claude 2>/dev/null || ` +
          `for p in /usr/local/bin/claude /usr/bin/claude "$(npm bin -g 2>/dev/null)/claude"; do ` +
          `  [ -x "$p" ] && echo "$p" && exit 0; done; echo ""`,
          undefined, { timeoutMs: 10_000 },
        )).trim();
      } catch (installErr: unknown) {
        console.error(`[claude-code] Failed to install Claude Code CLI:`, installErr instanceof Error ? installErr.message : String(installErr));
      }
    }

    if (!claudePath) {
      console.error(`[claude-code] claude binary not found on VPS even after install attempt`);
      send(ws, { type: "chat:error", payload: { message: "Could not find or install Claude Code CLI on VPS. SSH into the VPS and run: npm install -g @anthropic-ai/claude-code" } });
      activeChatAbortControllers.delete(ws);
      return true; // handled (with error)
    }
    console.log(`[claude-code] Found claude at: ${claudePath}`);

    // Build system context with AGENT.md
    let systemContext = chatContext || "";
    const serverIp = instance.connection.host;
    const isExtension = (chatContext || "").includes("Client: chrome-extension");
    systemContext += `\n\nServer public IP: ${serverIp}`;
    if (isExtension) {
      systemContext += `\n\n=== Browser & MCP Tools ===`;
      systemContext += `\nThis server runs in the cloud at ${serverIp}. When using browser tools:`;
      systemContext += `\n- The app is accessible at http://${serverIp}:3000 (or whichever port it runs on). NEVER use localhost or 127.0.0.1 URLs — those refer to the VPS loopback, not your app.`;
      systemContext += `\n- genie-browser: Use this for DOM interactions. Always use the public IP (http://${serverIp}:PORT) for navigation. Never pass localhost URLs.`;
      systemContext += `\n- chrome-devtools: This runs Puppeteer on the VPS. The VPS has no display server — always use headless mode. Navigate to http://${serverIp}:PORT, never localhost.`;
    } else {
      systemContext += `\n\n=== Browser Notes ===`;
      systemContext += `\nYou are running from the Genie web app (not the Chrome extension). The genie-browser MCP server is NOT available — do NOT attempt to use it. If you need to test or interact with the app in a browser, use chrome-devtools (Puppeteer) in headless mode. The app is accessible at http://${serverIp}:3000 (or whichever port it runs on). NEVER use localhost or 127.0.0.1 URLs.`;
    }

    // Tell Claude about the tracker MCP tools
    const tKey = tunnelKey(userId, serverIp);
    if (persistentMcpTunnels.get(tKey)?.trackerTunnel) {
      systemContext += `\n\n=== Tracker ===\nYou have access to the project's issue tracker via MCP tools (genie-tracker server). Use tracker_list_issues to see all tickets, tracker_get_issue to read a specific ticket by its number, tracker_update_issue to change status/priority, and tracker_comment_on_issue to leave notes.\n\nWorkflow: set status to in_progress when you start working on a ticket. When you finish, leave a concise summary comment (bullet list of changes) using tracker_comment_on_issue, then set status to in_review (NEVER set to done — a human reviews and marks done).`;
    }

    // Tell Claude about the security MCP tools
    if (persistentMcpTunnels.get(tKey)?.securityTunnel) {
      systemContext += `\n\n=== Security Scanner ===\nYou have access to a security scanner via MCP tools (genie-security server). Use security_scan to run a full security scan on a target URL (port scan + web vulnerability checks — takes a few minutes). Use security_list_scans to see previous scan results. Use security_get_scan to retrieve full details of a specific scan by ID.`;
    }

    // Tell Claude about the notify MCP tools
    if (persistentMcpTunnels.get(tKey)?.notifyTunnel) {
      systemContext += `\n\n=== Notifications ===\nYou can contact the admin via MCP tools (genie-notify server). Use notify_send_email to send an email to the admin (for important alerts, completed tasks, errors). Use notify_send_chat_message to send a message in the admin's Genie chat (appears as a DM from Claude — good for progress updates, questions, or results).`;
    }

    // Tell Claude about the storage MCP tools
    if (persistentMcpTunnels.get(tKey)?.storageTunnel) {
      systemContext += `\n\n=== Cloud Storage ===\nYou have access to cloud storage via MCP tools (genie-storage server). Use storage_screenshot to take a screenshot of a URL (runs Puppeteer on the VPS, uploads the PNG to cloud storage, returns a presigned URL). Use storage_upload to upload any file from the VPS to cloud storage. Use storage_list to browse stored files, storage_get_url to get a fresh presigned URL, and storage_delete to remove files. All files are scoped to this project.`;
    }

    if (agentMd) {
      systemContext += `\n\n=== Agent Memory (AGENT.md) ===\n${agentMd}`;
    }

    // Write prompt and context to temp files (avoids shell escaping issues)
    const safePrompt = lastUserMsg.content.replace(/GENIEEOF/g, "GENIE-EOF");
    const safeContext = systemContext.replace(/GENIEEOF/g, "GENIE-EOF");

    await sshSession.exec(`cat > /tmp/_genie_prompt << 'GENIEEOF'\n${safePrompt}\nGENIEEOF`);
    await sshSession.exec(`cat > /tmp/_genie_ctx << 'GENIEEOF'\n${safeContext}\nGENIEEOF`);

    // Check if Claude is already authenticated (Max/Pro subscription)
    let hasSubscription = false;
    let authEmail = "";
    let authPlan = "";
    try {
      const authOut = await sshSession.exec(`${claudePath} auth status 2>&1`, undefined, { timeoutMs: 10_000 });
      hasSubscription = authOut.includes('"loggedIn": true') || authOut.includes('"loggedIn":true');
      // Try to extract email and plan from JSON output
      try {
        const authJson = JSON.parse(authOut.trim());
        authEmail = authJson.email || authJson.account || "";
        authPlan = authJson.plan || authJson.accountType || (hasSubscription ? "Max" : "");
      } catch {
        // Try regex fallback for non-JSON output
        const emailMatch = authOut.match(/"email"\s*:\s*"([^"]+)"/);
        if (emailMatch) authEmail = emailMatch[1];
        if (hasSubscription && !authPlan) authPlan = "Max";
      }
    } catch {}

    // Ensure Claude Code has full permissions on the VPS
    const claudeSettingsDir = `${dest}/.claude`;
    const claudeSettingsPath = `${claudeSettingsDir}/settings.local.json`;
    try {
      await sshSession.exec(`mkdir -p ${claudeSettingsDir}`, undefined, { timeoutMs: 5_000 });
      // Read existing settings, merge with allow-all, write back
      const existingRaw = await sshSession.exec(`cat ${claudeSettingsPath} 2>/dev/null || echo "{}"`, undefined, { timeoutMs: 5_000 });
      let settings: Record<string, unknown> = {};
      try { settings = JSON.parse(existingRaw.trim()); } catch {}
      const perms = (settings.permissions as Record<string, unknown>) || {};
      perms.allow = ["*"];
      settings.permissions = perms;
      const settingsJson = JSON.stringify(settings, null, 2);
      await sshSession.exec(`cat > ${claudeSettingsPath} << 'GENIEEOF'\n${settingsJson}\nGENIEEOF`, undefined, { timeoutMs: 5_000 });
    } catch (err) {
      console.error(`[claude-code] Failed to write settings.local.json:`, err instanceof Error ? err.message : String(err));
    }

    // Build a wrapper script — source profile for PATH, use resolved claude path
    const resumeFlag = existingSessionId ? ` --resume "${existingSessionId}"` : "";
    const scriptLines = [`#!/bin/bash`];
    // Only set API key if no subscription login — API key overrides subscription auth
    if (!hasSubscription && apiKey) {
      scriptLines.push(`export ANTHROPIC_API_KEY="${apiKey}"`);
    }
    scriptLines.push(
      `cd ${dest}`,
      `PROMPT=$(cat /tmp/_genie_prompt)`,
      `CTX=$(cat /tmp/_genie_ctx)`,
      `exec ${claudePath} -p "$PROMPT" --output-format stream-json --verbose --dangerously-skip-permissions --append-system-prompt "$CTX"${resumeFlag}`,
    );
    const script = scriptLines.join("\n");
    await sshSession.exec(`cat > /tmp/_genie_run.sh << 'GENIEEOF'\n${script}\nGENIEEOF`);

    // Send auth info early so the UI shows it while Claude is thinking
    send(ws, { type: "chat:claude-info", payload: {
      model: "",
      email: authEmail,
      plan: authPlan || (hasSubscription ? "Max" : apiKey ? "API Key" : ""),
      version: "",
    }});

    send(ws, { type: "chat:status", payload: { status: "Claude is thinking..." } });

    const cmd = `bash -l /tmp/_genie_run.sh`;
    console.log(`[claude-code] Running: ${cmd}`);
    const channel = await sshSession.execStreaming(cmd, { pty: true });

    let fullContent = "";
    const toolUses: { name: string; input: unknown; result: string }[] = [];
    let lineBuffer = "";
    let sessionId: string | null = null;

    // Track current tool being assembled from streaming chunks
    let currentToolName = "";
    let currentToolInput = "";

    function processStreamEvent(event: {
      type?: string;
      subtype?: string;
      session_id?: string;
      content_block?: { type?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string };
      message?: { content?: Array<{ type: string; text?: string; name: string; input?: unknown }> };
      model?: string;
      claude_code_version?: string;
      result?: string;
      [key: string]: unknown;
    }) {
      // Extract session_id from any event that has it
      if (event.session_id) sessionId = event.session_id;

      // Debug: log every event type we receive
      console.log(`[claude-code] event type=${event.type} subtype=${event.subtype || ""} keys=${Object.keys(event).join(",")}`);

      switch (event.type) {
        // --- Raw API streaming format ---
        case "content_block_start":
          if (event.content_block?.type === "tool_use") {
            currentToolName = event.content_block.name || "";
            currentToolInput = "";
          }
          break;

        case "content_block_delta":
          if (event.delta?.type === "text_delta") {
            const text = event.delta.text || "";
            fullContent += text;
            send(ws, { type: "chat:token", payload: { token: text } });
          } else if (event.delta?.type === "input_json_delta") {
            currentToolInput += event.delta.partial_json || "";
          }
          break;

        case "content_block_stop":
          if (currentToolName) {
            let parsedInput: Record<string, unknown> = {};
            try { parsedInput = JSON.parse(currentToolInput); } catch {}
            toolUses.push({ name: currentToolName, input: parsedInput, result: "" });
            send(ws, { type: "chat:tool", payload: { name: currentToolName, input: parsedInput, result: "" } });
            currentToolName = "";
            currentToolInput = "";
          }
          break;

        case "message_start":
        case "message_delta":
        case "message_stop":
        case "ping":
          // No action needed for these
          break;

        // --- Claude Code CLI specific format ---
        case "assistant":
          if (event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                fullContent += block.text;
                send(ws, { type: "chat:token", payload: { token: block.text } });
              } else if (block.type === "tool_use") {
                toolUses.push({ name: block.name, input: block.input, result: "" });
                send(ws, { type: "chat:tool", payload: { name: block.name, input: block.input, result: "" } });
              }
            }
          }
          break;

        case "system":
          console.log(`[claude-code] system event: ${JSON.stringify(event).slice(0, 1000)}`);
          // Enrich with model/version from the system event (email/plan already sent earlier)
          send(ws, { type: "chat:claude-info", payload: {
            model: event.model || "",
            email: authEmail,
            plan: authPlan || (hasSubscription ? "Max" : apiKey ? "API Key" : ""),
            version: event.claude_code_version || "",
          }});
          break;

        case "result":
          if (event.session_id) sessionId = event.session_id;
          if (event.result && !fullContent) fullContent = event.result;
          break;

        default:
          console.log(`[claude-code] UNHANDLED event: ${JSON.stringify(event).slice(0, 500)}`);
          break;
      }
    }

    channel.stdout.on("data", (chunk: Buffer) => {
      const raw = chunk.toString();
      console.log(`[claude-code:stdout] ${raw.slice(0, 500)}`);
      lineBuffer += raw;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          processStreamEvent(event);
        } catch {
          // Non-JSON line (e.g. claude startup output), log it
          console.log(`[claude-code:non-json] ${line.slice(0, 300)}`);
        }
      }
    });

    channel.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[claude-code:stderr:${instance.label}] ${text}`);
    });

    console.log(`[claude-code] Command: ${cmd.replace(apiKey, "***")}`);

    // Handle abort
    let aborted = false;
    abortSignal.addEventListener("abort", () => {
      aborted = true;
      try { channel.close(); } catch {}
    }, { once: true });

    // Wait for stream to complete
    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      channel.stdout.on("end", () => {
        console.log(`[claude-code] stdout ended, fullContent length=${fullContent.length}, sessionId=${sessionId}`);
        // Process any remaining buffered data
        if (lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer);
            processStreamEvent(event);
          } catch {}
        }
        done();
      });
      channel.stdout.on("close", () => {
        console.log(`[claude-code] stdout closed`);
        done();
      });
    });

    // Store session ID for conversation continuity
    if (sessionId) {
      claudeCodeConversations.set(sessionKey, sessionId);
    }

    // Send done
    activeChatAbortControllers.delete(ws);
    send(ws, { type: "chat:status", payload: { status: "" } });
    send(ws, { type: "chat:done", payload: {} });
    onComplete?.(fullContent, toolUses);
  } catch (err: unknown) {
    activeChatAbortControllers.delete(ws);
    send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) || "Claude Code failed" } });
  } finally {
    sshSession.close();
  }

  return true;
}

/**
 * Query the DO API for active droplets, cross-reference with projects,
 * and clear VPS data from any project whose droplet no longer exists.
 */
async function syncDropletStatuses(): Promise<void> {
  const doToken = await settingsService.getGlobalDoToken();
  if (!doToken) return;
  try {
    const client = createDoClient(doToken);
    const droplets = await client.listDroplets("genie");
    knownAliveDropletIds = new Set(droplets.map((d) => d.id));
    lastDropletSync = Date.now();

    // Find projects whose droplet is gone
    const projects = await projectService.getAll();
    let changed = false;
    for (const p of projects) {
      const deadInstances = p.vpsInstances.filter(
        v => v.digitalocean?.dropletId && !knownAliveDropletIds.has(v.digitalocean.dropletId)
      );
      if (deadInstances.length > 0) {
        const remaining = p.vpsInstances.filter(
          v => !v.digitalocean?.dropletId || knownAliveDropletIds.has(v.digitalocean.dropletId)
        );
        await projectService.patchProject(p.id, { vpsInstances: remaining });
        changed = true;
      }
    }
    if (changed) {
      await broadcastProjectList();
    }
  } catch (err) {
    // Silently ignore — sync will retry next interval
  }
}

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT) || 9876;

interface ClientAction {
  type: string;
  ts: number;
}

interface ClientState {
  userId: string | null;
  user: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  /** When the active session is a superadmin impersonating another user, this holds the real superadmin's id. */
  impersonatedBy: string | null;
  clientType: ClientType;
  assistantSessionId: string | null;
  currentNav: string | null;
  recentActions: ClientAction[];
  ip: string | null;
  userAgent: string | null;
}

const clients = new Map<WebSocket, ClientState>();

async function buildAuthPayload(
  user: { id: string; name: string; email: string; avatarUrl: string | null; role: string },
  token: string,
  impersonatedBy?: { id: string; name: string; email: string } | null,
) {
  const admin = await isAdmin(user.id);
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, isAdmin: admin, role: user.role },
    impersonatedBy: impersonatedBy ?? null,
  };
}

/** Force-disconnect all WebSocket connections for a given user */
function disconnectUser(targetUserId: string): void {
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
function getExtensionClient(userId: string): WebSocket | null {
  for (const [ws, state] of clients) {
    if (state.userId === userId && state.clientType === "chrome-extension" && ws.readyState === ws.OPEN) {
      return ws;
    }
  }
  return null;
}

/** Send a DOM action request to the extension and await the result */
function requestDomAction(extensionWs: WebSocket, action: string, params: Record<string, unknown>): Promise<{ success: boolean; result: string }> {
  return new Promise((resolve, reject) => {
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

/** Create a domActionExecutor bound to a specific extension WS */
function createDomActionExecutor(extensionWs: WebSocket): DomActionExecutor {
  return async (action, params) => {
    return requestDomAction(extensionWs, action, params as Record<string, unknown>);
  };
}

/* ---- Persistent MCP browser tunnels ---- */

const MCP_BROWSER_REMOTE_PORT = 9877;
const MCP_TRACKER_REMOTE_PORT = 9878;
const MCP_SECURITY_REMOTE_PORT = 9879;
const MCP_NOTIFY_REMOTE_PORT = 9880;
const MCP_STORAGE_REMOTE_PORT = 9881;

interface PersistentMcpTunnel {
  sshSession: SshSession;
  mcpTunnel: McpTunnel;
  trackerTunnel?: McpTrackerTunnel;
  securityTunnel?: McpSecurityTunnel;
  notifyTunnel?: McpNotifyTunnel;
  storageTunnel?: McpStorageTunnel;
  projectName: string;
  instanceHost: string;
}

/** Multiple tunnels per userId, keyed by `userId:instanceHost` */
const persistentMcpTunnels = new Map<string, PersistentMcpTunnel>();

function tunnelKey(userId: string, host: string): string {
  return `${userId}:${host}`;
}

async function setupPersistentMcpTunnels(extensionWs: WebSocket, userId: string): Promise<void> {
  // Tear down all existing tunnels for this user
  await teardownPersistentMcpTunnels(userId);

  // Find ALL projects with VPS instances
  const projects = await projectService.getAll();
  const domExecutor = createDomActionExecutor(extensionWs);

  let tunnelCount = 0;
  for (const project of projects) {
    for (const instance of project.vpsInstances) {
      if (instance.deployFailed) continue;
      const key = tunnelKey(userId, instance.connection.host);
      const dest = remoteDir(project.name);

      try {
        const sshSession = await connectSsh(instance.connection, { timeoutMs: 30_000 });
        const mcpTunnel = await setupMcpTunnel(sshSession, domExecutor, { remotePort: MCP_BROWSER_REMOTE_PORT });

        // Set up tracker tunnel for this project
        let trackerTunnel: McpTrackerTunnel | undefined;
        try {
          trackerTunnel = await setupMcpTrackerTunnel(sshSession, project.id, { remotePort: MCP_TRACKER_REMOTE_PORT, onIssueUpdated: () => { broadcastTrackerList().catch(() => {}); } });
          console.log(`[mcp-persistent] Tracker tunnel ready for ${project.name}`);
        } catch (trackerErr: unknown) {
          console.error(`[mcp-persistent] Tracker tunnel failed for ${project.name}: ${(trackerErr instanceof Error ? trackerErr.message : String(trackerErr))}`);
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

        persistentMcpTunnels.set(key, { sshSession, mcpTunnel, trackerTunnel, securityTunnel, notifyTunnel, storageTunnel, projectName: project.name, instanceHost: instance.connection.host });

        // Merge MCP servers into .mcp.json on the VPS
        const mergeScript = [
          `existing=$(cat ${dest}/.mcp.json 2>/dev/null || echo '{"mcpServers":{}}')`,
          `echo "$existing" | node -e "`,
          `  const fs = require('fs');`,
          `  let input = '';`,
          `  process.stdin.on('data', d => input += d);`,
          `  process.stdin.on('end', () => {`,
          `    const cfg = JSON.parse(input);`,
          `    if (!cfg.mcpServers) cfg.mcpServers = {};`,
          `    cfg.mcpServers['genie-browser'] = { type: 'http', url: 'http://127.0.0.1:${MCP_BROWSER_REMOTE_PORT}/mcp' };`,
          ...(trackerTunnel ? [
          `    cfg.mcpServers['genie-tracker'] = { type: 'http', url: 'http://127.0.0.1:${MCP_TRACKER_REMOTE_PORT}/mcp' };`,
          ] : []),
          ...(securityTunnel ? [
          `    cfg.mcpServers['genie-security'] = { type: 'http', url: 'http://127.0.0.1:${MCP_SECURITY_REMOTE_PORT}/mcp' };`,
          ] : []),
          ...(notifyTunnel ? [
          `    cfg.mcpServers['genie-notify'] = { type: 'http', url: 'http://127.0.0.1:${MCP_NOTIFY_REMOTE_PORT}/mcp' };`,
          ] : []),
          ...(storageTunnel ? [
          `    cfg.mcpServers['genie-storage'] = { type: 'http', url: 'http://127.0.0.1:${MCP_STORAGE_REMOTE_PORT}/mcp' };`,
          ] : []),
          `    fs.writeFileSync('${dest}/.mcp.json', JSON.stringify(cfg, null, 2));`,
          `  });`,
          `"`,
        ].join("\n");
        await sshSession.exec(mergeScript);

        tunnelCount++;
        console.log(`[mcp-persistent] Tunnel ready for user ${userId} → ${instance.connection.host}:${MCP_BROWSER_REMOTE_PORT} (${project.name})`);
      } catch (err: unknown) {
        console.error(`[mcp-persistent] Failed tunnel to ${instance.connection.host} (${project.name}): ${(err instanceof Error ? err.message : String(err))}`);
      }
    }
  }

  if (tunnelCount === 0) {
    console.log(`[mcp-persistent] No VPS instances found for user ${userId}`);
  } else {
    console.log(`[mcp-persistent] ${tunnelCount} tunnel(s) established for user ${userId}`);
  }
}

async function teardownPersistentMcpTunnels(userId: string): Promise<void> {
  const prefix = `${userId}:`;
  const toRemove: string[] = [];
  for (const [key, tunnel] of persistentMcpTunnels) {
    if (key.startsWith(prefix)) {
      toRemove.push(key);
      try { tunnel.trackerTunnel?.close(); } catch {}
      try { tunnel.mcpTunnel.close(); } catch {}
      try { tunnel.sshSession.close(); } catch {}
    }
  }
  for (const key of toRemove) {
    persistentMcpTunnels.delete(key);
  }
  if (toRemove.length > 0) {
    console.log(`[mcp-persistent] ${toRemove.length} tunnel(s) torn down for user ${userId}`);
  }
}

function broadcast(message: WsMessage): void {
  const data = JSON.stringify(message);
  for (const [ws, state] of clients) {
    if (ws.readyState === ws.OPEN && state.userId) {
      ws.send(data);
    }
  }
}

function broadcastToUsers(userIds: string[], message: WsMessage): void {
  const idSet = new Set(userIds);
  const data = JSON.stringify(message);
  for (const [ws, state] of clients) {
    if (ws.readyState === ws.OPEN && state.userId && idSet.has(state.userId)) {
      ws.send(data);
    }
  }
}

function sendToUser(targetUserId: string, message: WsMessage): void {
  broadcastToUsers([targetUserId], message);
}

function send(ws: WebSocket, message: WsMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Fire-and-forget email notification to the app's superadmin. Silent no-op when
 * SENDGRID_API_KEY is not configured — never throws into the caller. Pattern mirrors
 * the new-user-signup notification in auth.ts.
 */
async function notifySuperadmin(subject: string, text: string): Promise<void> {
  const sgApiKey = process.env.SENDGRID_API_KEY;
  if (!sgApiKey) return;
  try {
    const sgMail = (await import("@sendgrid/mail")).default;
    sgMail.setApiKey(sgApiKey);
    await sgMail.send({
      to: "paul.brie@teleporthq.io",
      from: process.env.BACKUP_EMAIL || "noreply@teleporthq.io",
      subject,
      text,
    });
  } catch (err: unknown) {
    console.warn("[notify] Failed to send admin email:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Send the project:list filtered to what the given socket's user is allowed to see.
 * Use this instead of `send(ws, { type: "project:list", ... })` to enforce team-based visibility.
 */
async function sendProjectListTo(ws: WebSocket): Promise<void> {
  const state = clients.get(ws);
  const list = await projectService.getAllForUser(state?.userId ?? null);
  send(ws, { type: "project:list", payload: { projects: list } });
}

/**
 * Broadcast project:list to every authenticated client, filtered per recipient.
 * Use this instead of `broadcast({ type: "project:list", ... })` to enforce team-based visibility.
 */
async function broadcastProjectList(): Promise<void> {
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

function getConnectedUserIds(): string[] {
  const ids = new Set<string>();
  for (const [, state] of clients) {
    if (state.userId) ids.add(state.userId);
  }
  return [...ids];
}

const PRESENCE_SKIP_TYPES = new Set([
  "ping", "pong", "stats", "pty:data", "pty:resize", "presence:nav", "presence:detail",
]);

function broadcastPresence(): void {
  const connectedUserIds = getConnectedUserIds();
  broadcast({ type: "chat:presence", payload: { connectedUserIds } });
  broadcastPresenceDetail();
}

interface PresenceSession {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  clientType: string;
  currentNav: string | null;
  recentActions: ClientAction[];
  ip: string | null;
  userAgent: string | null;
}

function buildPresenceDetail(): PresenceSession[] {
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
      recentActions: state.recentActions.slice(-25),
      ip: state.ip,
      userAgent: state.userAgent,
    });
  }
  return result;
}

function broadcastPresenceDetail(): void {
  const detail = buildPresenceDetail();
  broadcast({ type: "presence:detail", payload: { sessions: detail } });
}

async function sendInitialData(ws: WebSocket, userId?: string): Promise<void> {
  // Send current project list and log backlogs on connect
  await sendProjectListTo(ws);
  const projectLogs = projectManager.getAllLogBuffers();
  for (const [key, data] of Object.entries(projectLogs)) {
    const [projectId, commandId] = key.split(":");
    send(ws, { type: "project:log", payload: { projectId, commandId, stream: "stdout", data } });
  }

  // Send logs sources and backlog
  send(ws, { type: "logs:sources", payload: { sources: ["manager"] } });
  const logBacklog = getLogBuffer();
  if (logBacklog) {
    send(ws, { type: "logs:backlog", payload: { source: "manager", data: logBacklog } });
  }

  // Send active terminal sessions for this user
  if (userId) {
    const sessions = getUserSessionDetails(userId);
    if (sessions.length > 0) {
      // Resolve owner names from connected clients
      const sessionsWithNames = sessions.map((s) => {
        let ownerName = "Unknown";
        for (const [, clientState] of clients) {
          if (clientState.userId === s.ownerId && clientState.user) {
            ownerName = clientState.user.name;
            break;
          }
        }
        return {
          ...s,
          ownerName,
          viewerIds: [s.ownerId, ...s.collaboratorIds],
        };
      });
      send(ws, { type: "terminal:sessions:list", payload: { sessions: sessionsWithNames } });
    }
  }
}

async function handleAuthMessage(ws: WebSocket, msg: WsMessage): Promise<boolean> {
  switch (msg.type) {
    case "auth:google:start": {
      try {
        const authUrl = initiateOAuth(
          async (user, token) => {
            const state = clients.get(ws);
            if (state) {
              state.userId = user.id;
              state.user = { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
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
      }
      send(ws, { type: "auth:logged-out", payload: {} });
      broadcastPresence();
      return true;
    }

    default:
      return false;
  }
}

async function buildDocsPayload(userId: string) {
  const [{ own, shared, publicDocs }, { own: folders, publicFolders }] = await Promise.all([
    docsService.listDocs(userId),
    docsService.listFolders(userId),
  ]);
  return {
    own: own.map((f) => ({ id: f.id, title: f.title, folderId: f.folderId, isPublic: f.isPublic, publicKey: f.publicKey, projectId: f.projectId, updatedAt: f.updatedAt.toISOString() })),
    shared: shared.map((f) => ({ id: f.id, title: f.title, updatedAt: f.updatedAt.toISOString(), permission: f.permission, ownerId: f.ownerId, ownerName: f.ownerName, projectId: f.projectId, isPublic: f.isPublic })),
    publicDocs: publicDocs.map((f) => ({ id: f.id, title: f.title, updatedAt: f.updatedAt.toISOString(), ownerId: f.ownerId, ownerName: f.ownerName, projectId: f.projectId, isPublic: f.isPublic, permission: "read" as const })),
    folders: folders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name, isPublic: f.isPublic, projectId: f.projectId, updatedAt: f.updatedAt.toISOString() })),
    publicFolders: publicFolders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name, isPublic: f.isPublic, projectId: f.projectId, updatedAt: f.updatedAt.toISOString(), ownerId: f.ownerId, ownerName: f.ownerName })),
  };
}

async function sendDocsList(ws: WebSocket, userId: string): Promise<void> {
  send(ws, { type: "docs:list", payload: await buildDocsPayload(userId) });
}

async function sendDocsListToUser(targetUserId: string): Promise<void> {
  sendToUser(targetUserId, { type: "docs:list", payload: await buildDocsPayload(targetUserId) });
}

async function sendTrackerList(ws: WebSocket): Promise<void> {
  const [issues, labels] = await Promise.all([
    trackerService.listIssues(),
    trackerService.listLabels(),
  ]);
  send(ws, { type: "tracker:list", payload: { issues, labels } });
}

async function broadcastTrackerList(): Promise<void> {
  const [issues, labels] = await Promise.all([
    trackerService.listIssues(),
    trackerService.listLabels(),
  ]);
  broadcast({ type: "tracker:list", payload: { issues, labels } });
}

async function handleMessage(ws: WebSocket, msg: WsMessage): Promise<void> {
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

  // --- Presence handlers ---
  if (msg.type === "presence:nav") {
    state.currentNav = (msg.payload?.nav as string) || null;
    broadcastPresenceDetail();
    return;
  }

  if (msg.type === "presence:detail") {
    send(ws, { type: "presence:detail", payload: { sessions: buildPresenceDetail() } });
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

  switch (msg.type) {
    case "process:kill": {
      const { pid } = msg.payload;
      try {
        process.kill(pid, "SIGTERM");
      } catch (err: unknown) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to kill process ${pid}: ${(err instanceof Error ? err.message : String(err))}` },
        });
      }
      break;
    }

    case "docker:open": {
      try {
        await execFileAsync("/usr/bin/open", ["-a", "Docker"]);
      } catch (err: unknown) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to open Docker: ${(err instanceof Error ? err.message : String(err))}` },
        });
      }
      break;
    }

    case "docker:daemon:start": {
      try {
        await execFileAsync("/usr/bin/open", ["-a", "Docker"]);
      } catch (err: unknown) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to start Docker: ${(err instanceof Error ? err.message : String(err))}` },
        });
      }
      break;
    }

    case "docker:daemon:stop": {
      try {
        await execFileAsync("/usr/bin/killall", ["Docker Desktop"]);
      } catch (err: unknown) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to stop Docker: ${(err instanceof Error ? err.message : String(err))}` },
        });
      }
      break;
    }

    case "docker:start": {
      const { id } = msg.payload;
      const bin = getDockerBin();
      if (!bin) {
        send(ws, { type: "error", payload: { message: "Docker CLI not found" } });
        break;
      }
      try {
        await execFileAsync(bin, ["start", id]);
      } catch (err: unknown) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to start container ${id}: ${(err instanceof Error ? err.message : String(err))}` },
        });
      }
      break;
    }

    case "docker:stop": {
      const { id } = msg.payload;
      const bin = getDockerBin();
      if (!bin) {
        send(ws, { type: "error", payload: { message: "Docker CLI not found" } });
        break;
      }
      try {
        await execFileAsync(bin, ["stop", id]);
      } catch (err: unknown) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to stop container ${id}: ${(err instanceof Error ? err.message : String(err))}` },
        });
      }
      break;
    }

    case "chat:send": {
      const { messages, context: chatContext, domSnapshot, source, modelId, pinnedVm } = msg.payload;
      const abortController = new AbortController();
      activeChatAbortControllers.set(ws, abortController);

      // Determine effective client type
      const effectiveClientType: string = source === "chrome-extension"
        ? "chrome-extension"
        : (clients.get(ws)?.clientType || "web");

      // Prepend client type to context
      const clientLabel = effectiveClientType === "chrome-extension"
        ? "chrome-extension (Chrome browser plugin)"
        : "web (Genie desktop app)";
      const enrichedContext = chatContext
        ? `Client: ${clientLabel}\n${chatContext}`
        : `Client: ${clientLabel}`;

      // Session tracking for assistant chat logs
      const chatState = clients.get(ws);
      if (chatState && messages.length <= 1) {
        chatState.assistantSessionId = uuidv4();
      }
      const sessionId = chatState?.assistantSessionId || uuidv4();

      // Extract projectId/instanceId from context
      const ctxProjectIdMatch = enrichedContext.match(/Project ID:\s*([a-f0-9-]+)/i)
        || enrichedContext.match(/projectId[=:]\s*["']?([a-f0-9-]+)/i)
        || enrichedContext.match(/\(id:\s+([a-f0-9-]+)\)/);
      const contextProjectId = ctxProjectIdMatch?.[1] || null;
      const instanceIdMatch = enrichedContext.match(/instance.*?id="([a-f0-9-]+)"/i);
      const contextInstanceId = instanceIdMatch?.[1] || null;

      // Save the user message (last in array)
      const lastUserMsg = messages[messages.length - 1];
      if (lastUserMsg?.role === "user") {
        assistantLogService.saveAssistantMessage({
          sessionId,
          projectId: contextProjectId,
          instanceId: contextInstanceId,
          userId: userId || null,
          clientType: effectiveClientType,
          role: "user",
          content: lastUserMsg.content,
          modelId: modelId || null,
        }).catch(err => console.error("Failed to log user message:", err));
      }

      // Route to Claude Code on VPS when that model is selected
      void (async () => {
        if (modelId === "claude-code") {
          try {
            console.log(`[claude-code] Routing chat: contextProjectId=${contextProjectId}, enrichedContext length=${enrichedContext?.length}`);
            send(ws, { type: "chat:meta", payload: { maxToolRounds: 40 } });
            const routed = await routeChatToVpsAgent(
              ws, userId, messages, enrichedContext, domSnapshot, abortController.signal,
              (fullContent, toolUses) => {
                if (fullContent) {
                  assistantLogService.saveAssistantMessage({
                    sessionId,
                    projectId: contextProjectId,
                    instanceId: contextInstanceId,
                    userId: userId || null,
                    clientType: effectiveClientType,
                    role: "assistant",
                    content: fullContent,
                    modelId: "claude-code",
                    toolUses: toolUses.length > 0 ? toolUses : null,
                  }).catch(err => console.error("Failed to log Claude Code message:", err));
                }
              },
              contextProjectId,
            );
            if (routed) return;
            // If routing failed (no VPS instance), fall back to local
            send(ws, { type: "chat:error", payload: { message: "Claude Code requires a VPS instance. Select a project with a VPS deployment." } });
            activeChatAbortControllers.delete(ws);
            return;
          } catch (routeErr: unknown) {
            console.error("Claude Code routing failed:", (routeErr instanceof Error ? routeErr.message : String(routeErr)));
            send(ws, { type: "chat:error", payload: { message: `Claude Code error: ${(routeErr instanceof Error ? routeErr.message : String(routeErr))}` } });
            activeChatAbortControllers.delete(ws);
            return;
          }
        }

        // Load AI settings from DB
        const [dbDefaultModel, dbMaxToolRounds] = await Promise.all([
          settingsService.getGlobalSetting<string>("aiDefaultModel"),
          settingsService.getGlobalSetting<number>("aiMaxToolRounds"),
        ]);
        const resolvedModelId = (modelId || dbDefaultModel || "claude-sonnet") as ChatModelId;
        const resolvedMaxToolRounds = dbMaxToolRounds ?? 10;
        send(ws, { type: "chat:meta", payload: { maxToolRounds: resolvedMaxToolRounds } });

        // Fallback: run chat locally with SSH-based tools
        let domActionExecutor: DomActionExecutor | undefined;
        const extensionWs = source === "chrome-extension"
          ? ws
          : getExtensionClient(userId);
        if (extensionWs && extensionWs.readyState === extensionWs.OPEN && clients.get(extensionWs)?.clientType === "chrome-extension") {
          domActionExecutor = createDomActionExecutor(extensionWs);
        }

        const collectedToolUses: { name: string; input: unknown; result: string }[] = [];

        await handleChat(
          messages,
          (token) => send(ws, { type: "chat:token", payload: { token } }),
          (fullContent, usage) => {
            activeChatAbortControllers.delete(ws);
            send(ws, { type: "chat:done", payload: { usage } });
            if (usage) {
              const projectIdMatch = chatContext?.match(/Project ID:\s*([a-f0-9-]+)/i);
              const sourcePromise = projectIdMatch
                ? projectService.getById(projectIdMatch[1]).then(p => p?.name ?? projectIdMatch[1]).catch(() => projectIdMatch![1])
                : Promise.resolve(source === "chrome-extension" ? "Extension" : "Genie");
              sourcePromise.then((sourceName) => {
                getDb().insert(aiUsage).values({
                  userId: userId || null,
                  modelId: usage.modelId,
                  modelLabel: usage.modelLabel,
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  cost: usage.cost,
                  source: sourceName,
                }).catch((err) => console.error("Failed to save AI usage:", err));
              });
            }
            // Save assistant response to chat logs
            assistantLogService.saveAssistantMessage({
              sessionId,
              projectId: contextProjectId,
              instanceId: contextInstanceId,
              userId: userId || null,
              clientType: effectiveClientType,
              role: "assistant",
              content: fullContent,
              modelId: resolvedModelId,
              toolUses: collectedToolUses.length > 0 ? collectedToolUses : null,
              usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: usage.cost } : null,
            }).catch(err => console.error("Failed to log assistant message:", err));
          },
          (message) => {
            activeChatAbortControllers.delete(ws);
            send(ws, { type: "chat:error", payload: { message } });
          },
          (name, input, result, id, durationMs) => {
            send(ws, { type: "chat:tool", payload: { id, name, input, result, durationMs } });
            collectedToolUses.push({ name, input, result });
            if (name === "write_project_file") {
              void broadcastProjectList();
            }
          },
          enrichedContext,
          domSnapshot,
          abortController.signal,
          domActionExecutor,
          resolvedModelId,
          resolvedMaxToolRounds,
          pinnedVm || null,
          (id, name, input) => {
            // Tool started — emit so the UI can show a live elapsed-time ticker.
            send(ws, { type: "chat:tool:start", payload: { id, name, input } });
          },
        );
      })().catch((err) => {
        activeChatAbortControllers.delete(ws);
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) || "Chat failed" } });
      });
      break;
    }

    case "chat:stop": {
      const controller = activeChatAbortControllers.get(ws);
      if (controller) {
        controller.abort();
        activeChatAbortControllers.delete(ws);
      }
      break;
    }

    // --- Chat session history ---

    case "chat:sessions:list": {
      if (!userId) break;
      try {
        const admin = await isAdmin(userId);
        const sessions = await assistantLogService.listUserSessions(admin ? null : userId, 50);
        send(ws, { type: "chat:sessions:list", payload: { sessions } });
      } catch (err: unknown) {
        console.error("[chat:sessions:list] error:", err);
      }
      break;
    }

    case "chat:session:load": {
      const { sessionId } = msg.payload;
      if (!sessionId) break;
      try {
        const rows = await assistantLogService.getSessionMessages(sessionId);
        const messages = rows.map((r) => ({
          role: r.role as "user" | "assistant",
          content: r.content,
          toolUses: r.toolUses as unknown[] | null,
          createdAt: r.createdAt,
        }));
        send(ws, { type: "chat:session:loaded", payload: { sessionId, messages } });
      } catch (err: unknown) {
        console.error("[chat:session:load] error:", err);
      }
      break;
    }

    case "chat:session:rename": {
      const { sessionId, name } = msg.payload;
      if (!sessionId || !name) break;
      try {
        await assistantLogService.renameSession(sessionId, name);
        send(ws, { type: "chat:session:renamed", payload: { sessionId, name } });
      } catch (err: unknown) {
        console.error("[chat:session:rename] error:", err);
      }
      break;
    }

    case "chat:session:delete": {
      const { sessionId } = msg.payload;
      if (!sessionId) break;
      try {
        await assistantLogService.deleteSession(sessionId);
        send(ws, { type: "chat:session:deleted", payload: { sessionId } });
      } catch (err: unknown) {
        console.error("[chat:session:delete] error:", err);
      }
      break;
    }

    // --- Unified Chat handlers ---

    case "chat:users:list": {
      try {
        const allUsers = await chatService.getAllUsers();
        const connectedUserIds = getConnectedUserIds();
        const usersWithStatus = allUsers.map((u) => ({
          ...u,
          online: connectedUserIds.includes(u.id),
        }));
        send(ws, { type: "chat:users:list", payload: { users: usersWithStatus } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "chat:conversations:list": {
      try {
        const conversations = await chatService.getUserConversations(userId);
        send(ws, { type: "chat:conversations:list", payload: { conversations } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "chat:conversation:create": {
      try {
        const { name, memberIds, type, targetUserId } = msg.payload;
        let conversation;
        if (type === "dm") {
          // DM with a specific user, or Claude by default
          const otherId = targetUserId || getClaudeUserId();
          conversation = await chatService.getOrCreateClaudeDm(userId, otherId);
        } else {
          // Resolve "claude" placeholder to actual Claude UUID
          const claudeId = getClaudeUserId();
          const resolvedMemberIds = (memberIds || []).map((id: string) =>
            id === "claude" ? claudeId : id,
          );
          conversation = await chatService.createRoom(userId, name, resolvedMemberIds);
        }
        send(ws, { type: "chat:conversation:created", payload: { conversation } });
        // Refresh conversation list for ALL members of the new conversation
        const newMembers = await chatService.getConversationMembers(conversation.id);
        for (const member of newMembers) {
          const memberConvs = await chatService.getUserConversations(member.userId);
          sendToUser(member.userId, { type: "chat:conversations:list", payload: { conversations: memberConvs } });
        }
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "chat:conversation:open": {
      try {
        const { conversationId, limit, before } = msg.payload;
        const effectiveLimit = limit || 20;
        const messages = await chatService.getMessages(conversationId, effectiveLimit, before);
        const members = await chatService.getConversationMembers(conversationId);
        send(ws, { type: "chat:messages:list", payload: { conversationId, messages, members, hasMore: messages.length === effectiveLimit } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "chat:messages:load": {
      try {
        const { conversationId, limit, before } = msg.payload;
        const messages = await chatService.getMessages(conversationId, limit || 50, before);
        send(ws, { type: "chat:messages:list", payload: { conversationId, messages, hasMore: messages.length === (limit || 50) } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "chat:message:send": {
      try {
        const { conversationId, content, replyToId, metadata: msgMetadata } = msg.payload;

        // Save user message
        const message = await chatService.saveMessage(conversationId, userId, content, msgMetadata, replyToId);
        const members = await chatService.getConversationMembers(conversationId);
        const memberIds = members.map((m) => m.userId);

        // Broadcast to all members
        broadcastToUsers(memberIds, {
          type: "chat:message:new",
          payload: { conversationId, message },
        });

        // Determine if Claude should respond
        const claudeId = getClaudeUserId();
        const claudeIsMember = memberIds.includes(claudeId);
        const conversation = await chatService.getConversation(conversationId);

        const shouldClaudeRespond =
          (conversation?.type === "dm" && claudeIsMember) ||
          (conversation?.type === "room" && claudeIsMember && content.toLowerCase().includes("@claude"));

        if (shouldClaudeRespond) {
          // Trigger Claude response with abort support
          const convAbort = new AbortController();
          activeConversationAbortControllers.set(conversationId, convAbort);
          void handleConversationChat(ws, conversationId, claudeId, memberIds, convAbort.signal);
        }

        // @mention detection — notify mentioned users
        const mentionMatches = content.match(/@(\w+)/g);
        if (mentionMatches) {
          const allUsers = await chatService.getAllUsers();
          const senderUser = state?.user;
          const convName = conversation?.name || "a conversation";
          for (const mention of mentionMatches) {
            const word = mention.slice(1).toLowerCase();
            if (word === "claude") continue; // Claude handled above
            const matchedUser = allUsers.find(
              (u) => u.name.split(" ")[0].toLowerCase() === word,
            );
            if (matchedUser && matchedUser.id !== userId) {
              // Send mention notification to that user's WS connections
              const mentionPayload = {
                type: "chat:mention" as const,
                payload: {
                  conversationId,
                  conversationName: convName,
                  senderName: senderUser?.name || "Someone",
                  content: content.slice(0, 100),
                  messageId: message.id,
                },
              };
              sendToUser(matchedUser.id, mentionPayload);
            }
          }
        }
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "chat:message:stop": {
      const { conversationId } = msg.payload;
      const convController = activeConversationAbortControllers.get(conversationId);
      if (convController) {
        convController.abort();
        activeConversationAbortControllers.delete(conversationId);
      }
      break;
    }

    case "chat:member:add": {
      try {
        const { conversationId, targetUserId } = msg.payload;
        await chatService.addMember(conversationId, targetUserId);
        const members = await chatService.getConversationMembers(conversationId);
        const memberIds = members.map((m) => m.userId);
        broadcastToUsers(memberIds, {
          type: "chat:members:updated",
          payload: { conversationId, members },
        });
        // Send refreshed conversation list to the added user
        const addedUserConvs = await chatService.getUserConversations(targetUserId);
        sendToUser(targetUserId, { type: "chat:conversations:list", payload: { conversations: addedUserConvs } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "chat:member:remove": {
      try {
        const { conversationId, targetUserId } = msg.payload;
        // Get members before removal (to include removed user in notification)
        const membersBefore = await chatService.getConversationMembers(conversationId);
        const memberIdsBefore = membersBefore.map((m) => m.userId);
        await chatService.removeMember(conversationId, targetUserId);
        const membersAfter = await chatService.getConversationMembers(conversationId);
        // Broadcast updated members to all previous members (including removed user)
        broadcastToUsers(memberIdsBefore, {
          type: "chat:members:updated",
          payload: { conversationId, members: membersAfter },
        });
        // Send refreshed conversation list to removed user
        const removedUserConvs = await chatService.getUserConversations(targetUserId);
        sendToUser(targetUserId, { type: "chat:conversations:list", payload: { conversations: removedUserConvs } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "chat:reaction:toggle": {
      try {
        const { conversationId, messageId, emoji } = msg.payload;
        const result = await chatService.toggleReaction(messageId, userId, emoji);
        if (result) {
          const members = await chatService.getConversationMembers(conversationId);
          const memberIds = members.map((m) => m.userId);
          broadcastToUsers(memberIds, {
            type: "chat:reaction:updated",
            payload: { conversationId, messageId, reactions: result.reactions },
          });
        }
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "chat:message:edit": {
      try {
        const { conversationId, messageId, content } = msg.payload;
        const result = await chatService.editMessage(messageId, userId, content);
        if (!result) {
          send(ws, { type: "chat:error", payload: { message: "Cannot edit this message" } });
        } else {
          const members = await chatService.getConversationMembers(conversationId);
          const memberIds = members.map((m) => m.userId);
          broadcastToUsers(memberIds, {
            type: "chat:message:edited",
            payload: { conversationId, messageId, content: result.content, editedAt: result.editedAt },
          });
        }
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "logs:subscribe": {
      send(ws, { type: "logs:backlog", payload: { source: "manager", data: getLogBuffer() } });
      break;
    }

    case "logs:unsubscribe":
      break;

    case "logs:clear": {
      clearLogBuffer();
      break;
    }

    case "monitor:set-interval": {
      const ms = msg.payload.intervalMs;
      if (typeof ms === "number" && ms >= 500 && ms <= 30000) {
        setMonitoringInterval((stats) => {
          broadcast({ type: "stats", payload: stats });
        }, ms);
        broadcast({ type: "monitor:interval", payload: { intervalMs: ms } });
      }
      break;
    }

    case "terminal:spawn": {
      const { id, cols, rows, command, cwd } = msg.payload;
      void spawnPty(id, cols || 80, rows || 24, command, cwd, userId);
      break;
    }

    case "terminal:data": {
      const { id, data } = msg.payload;
      if (!isAuthorized(id, userId)) {
        send(ws, { type: "error", payload: { message: "Not authorized for this terminal" } });
        break;
      }
      writePty(id, data);
      break;
    }

    case "terminal:resize": {
      const { id, cols, rows } = msg.payload;
      if (!isAuthorized(id, userId)) break;
      resizePty(id, cols, rows);
      break;
    }

    case "terminal:close": {
      const { id } = msg.payload;
      const access = getSessionAccess(id);
      if (access && access.ownerId !== userId) {
        send(ws, { type: "error", payload: { message: "Only the owner can close this terminal" } });
        break;
      }
      closePty(id);
      break;
    }

    case "terminal:share": {
      const { sessionId, targetUserId, conversationId: shareConvId } = msg.payload;
      const access = getSessionAccess(sessionId);
      console.log(`[terminal:share] sessionId=${sessionId} userId=${userId} access=${JSON.stringify(access)}`);
      if (!access || access.ownerId !== userId) {
        send(ws, { type: "terminal:share:error", payload: { message: access ? "Only the owner can share this terminal" : "Terminal session not found (may have been restarted)" } });
        break;
      }
      sendToUser(targetUserId, {
        type: "terminal:share:invite",
        payload: { sessionId, ownerId: userId, ownerName: state.user?.name || "Unknown", conversationId: shareConvId },
      });
      send(ws, { type: "terminal:share:sent", payload: { sessionId, targetUserId } });
      // Optionally post a chat message
      if (shareConvId) {
        const meta = JSON.stringify({ type: "terminal-share", sessionId });
        const shareMsg = await chatService.saveMessage(shareConvId, userId, `Shared a terminal session`, meta);
        const members = await chatService.getConversationMembers(shareConvId);
        const memberIds = members.map((m) => m.userId);
        broadcastToUsers(memberIds, {
          type: "chat:message:new",
          payload: { conversationId: shareConvId, message: shareMsg },
        });
      }
      break;
    }

    case "terminal:share:accept": {
      const { sessionId } = msg.payload;
      const added = addCollaborator(sessionId, userId);
      if (!added) {
        send(ws, { type: "error", payload: { message: "Terminal session not found" } });
        break;
      }
      const access = getSessionAccess(sessionId);
      if (access) {
        const allUsers = [access.ownerId, ...access.collaboratorIds];
        broadcastToUsers(allUsers, {
          type: "terminal:share:viewers",
          payload: { sessionId, viewerIds: allUsers },
        });
      }
      // Send scrollback history so the invitee sees the session so far
      const scrollback = getScrollback(sessionId);
      send(ws, { type: "terminal:share:joined", payload: { sessionId, scrollback } });
      break;
    }

    case "terminal:share:leave": {
      const { sessionId } = msg.payload;
      removeCollaborator(sessionId, userId);
      const access = getSessionAccess(sessionId);
      if (access) {
        const allUsers = [access.ownerId, ...access.collaboratorIds];
        broadcastToUsers(allUsers, {
          type: "terminal:share:viewers",
          payload: { sessionId, viewerIds: allUsers },
        });
      }
      break;
    }

    case "terminal:share:replay": {
      const { sessionId } = msg.payload;
      if (!isAuthorized(sessionId, userId)) {
        send(ws, { type: "error", payload: { message: "Not authorized for this terminal" } });
        break;
      }
      const scrollback = getScrollback(sessionId);
      if (scrollback) {
        send(ws, { type: "terminal:data", payload: { id: sessionId, data: scrollback } });
      }
      break;
    }

    case "terminal:share:kick": {
      const { sessionId, userId: kickUserId } = msg.payload;
      const access = getSessionAccess(sessionId);
      if (!access || access.ownerId !== userId) {
        send(ws, { type: "error", payload: { message: "Only the owner can remove collaborators" } });
        break;
      }
      removeCollaborator(sessionId, kickUserId);
      // Notify the kicked user
      sendToUser(kickUserId, {
        type: "terminal:share:kicked",
        payload: { sessionId },
      });
      // Update viewer list for remaining users
      const updatedAccess = getSessionAccess(sessionId);
      if (updatedAccess) {
        const allUsers = [updatedAccess.ownerId, ...updatedAccess.collaboratorIds];
        broadcastToUsers(allUsers, {
          type: "terminal:share:viewers",
          payload: { sessionId, viewerIds: allUsers },
        });
      }
      break;
    }

    case "project:add": {
      const { name, commands, vpsProvider, vpsRegion, vpsSize, vpsImage, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken, gitlabDeployKey: projDeployKey, dbUrl: projDbUrl, teamId: projTeamId } = msg.payload;
      if (!name) {
        send(ws, {
          type: "error",
          payload: { message: "name is required" },
        });
        return;
      }
      // Auto-assign creator's first team if none provided and creator is a normal user —
      // otherwise the project would be invisible to them under the team-visibility rule.
      let resolvedTeamId: string | null = projTeamId ?? null;
      const creatorId = clients.get(ws)?.userId ?? null;
      if (!resolvedTeamId && creatorId && !(await isAdmin(creatorId))) {
        const [firstTeam] = await getDb().select({ teamId: teamMembers.teamId })
          .from(teamMembers)
          .where(eq(teamMembers.userId, creatorId))
          .limit(1);
        resolvedTeamId = firstTeam?.teamId ?? null;
      }
      const added = await projectService.add({ name, commands, vpsProvider, vpsRegion, vpsSize, vpsImage, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken, gitlabDeployKey: projDeployKey, dbUrl: projDbUrl, teamId: resolvedTeamId });
      await broadcastProjectList();
      break;
    }

    case "project:update": {
      const { id, name, commands, vpsProvider, vpsRegion, vpsSize, vpsImage, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken2, gitlabDeployKey: projDeployKey2, dbUrl: projDbUrl2, gitFolders, teamId: projTeamIdUpdate } = msg.payload;
      // Only admins/superadmins can transfer a project to another team. Non-admins must not
      // be able to grant themselves access to projects they don't own or evict others.
      const updaterRealId = (() => {
        const st = clients.get(ws);
        return st?.impersonatedBy ?? st?.userId ?? null;
      })();
      const updaterIsAdmin = updaterRealId ? await isAdmin(updaterRealId) : false;
      const teamIdFieldAllowed = updaterIsAdmin ? projTeamIdUpdate : undefined;
      await projectManager.stopAll(id);
      const updated = await projectService.update(id, { name, commands, vpsProvider, vpsRegion, vpsSize, vpsImage, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken2, gitlabDeployKey: projDeployKey2, dbUrl: projDbUrl2, gitFolders, teamId: teamIdFieldAllowed });
      if (!updated) {
        send(ws, {
          type: "error",
          payload: { message: `Project ${id} not found` },
        });
        return;
      }
      await broadcastProjectList();
      break;
    }

    case "project:remove": {
      const { id } = msg.payload;
      await projectManager.stopAll(id);
      const removed = await projectService.remove(id);
      if (!removed) {
        send(ws, {
          type: "error",
          payload: { message: `Project ${id} not found` },
        });
        return;
      }
      await broadcastProjectList();
      break;
    }

    case "project:setup-snippet:add": {
      const { projectId, recipeId, snippet } = msg.payload as { projectId: string; recipeId: string; snippet: string };
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "error", payload: { message: "Project not found" } });
        break;
      }
      const files = (project.setupFiles || {}) as Record<string, string>;
      const setupSh = files["setup.sh"] || "#!/bin/bash\nset -e\n";
      const marker = `# [recipe:${recipeId}]`;
      if (setupSh.includes(marker)) {
        send(ws, { type: "project:setup-snippet:result", payload: { projectId, recipeId, added: false, reason: "already in setup.sh" } });
        break;
      }
      const updatedSetup = setupSh.trimEnd() + `\n\n${marker}\n${snippet}\n`;
      const setupFiles = { ...files, "setup.sh": updatedSetup };
      await projectService.patchProject(projectId, { setupFiles });
      await broadcastProjectList();
      send(ws, { type: "project:setup-snippet:result", payload: { projectId, recipeId, added: true } });
      break;
    }

    case "project:list": {
      await sendProjectListTo(ws);
      break;
    }

    case "project:start": {
      const { projectId, commandId } = msg.payload;
      const started = await projectManager.startCommand(projectId, commandId);
      if (!started) {
        send(ws, {
          type: "error",
          payload: { message: `Cannot start command ${commandId} in project ${projectId}` },
        });
      }
      break;
    }

    case "project:stop": {
      const { projectId, commandId } = msg.payload;
      const stopped = projectManager.stopCommand(projectId, commandId);
      if (!stopped) {
        send(ws, {
          type: "error",
          payload: { message: `Cannot stop command ${commandId} in project ${projectId}` },
        });
      }
      break;
    }

    case "project:start-all": {
      const { projectId } = msg.payload;
      await projectManager.startAll(projectId);
      break;
    }

    case "project:stop-all": {
      const { projectId } = msg.payload;
      await projectManager.stopAll(projectId);
      break;
    }

    case "project:command:run": {
      const { projectId, commandId, instanceId } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "error", payload: { message: "Project not found" } });
        break;
      }
      const cmd = project.commands.find((c) => c.id === commandId);
      if (!cmd) {
        send(ws, { type: "error", payload: { message: "Command not found" } });
        break;
      }

      let conn;
      try {
        conn = await getVpsConnection(projectId, instanceId);
      } catch {
        send(ws, { type: "error", payload: { message: "VPS instance not found" } });
        break;
      }

      if (cmd.mode === "terminal") {
        // For nohup commands in terminal mode, use setsid to fully detach from the PTY
        let termCmd = cmd.command;
        if (termCmd.includes("nohup ")) {
          const clean = termCmd.replace(/\s*&\s*$/, "");
          termCmd = `setsid ${clean} &`;
        }
        // Tell the client to open an SSH terminal tab and run the command in it
        send(ws, { type: "project:command:terminal", payload: { projectId, commandId, instanceId, commandName: cmd.name, command: termCmd } });
      } else {
        // Inline execution with streamed output
        const cmdKey = `${projectId}:${commandId}`;
        // Close any previous session for this command
        const prev = activeCommandSessions.get(cmdKey);
        if (prev) { try { prev.close(); } catch {} activeCommandSessions.delete(cmdKey); }

        send(ws, { type: "project:command:started", payload: { projectId, commandId } });
        let session: SshSession;
        try {
          session = await connectSsh(conn, { timeoutMs: 30_000 });
        } catch (err: unknown) {
          send(ws, { type: "project:command:done", payload: { projectId, commandId, exitCode: 1, error: `SSH connection failed: ${(err instanceof Error ? err.message : String(err))}` } });
          break;
        }
        activeCommandSessions.set(cmdKey, session);
        try {
          // If command uses nohup, wrap it to fully detach from the SSH session
          let shellCmd = cmd.command;
          if (shellCmd.includes("nohup ")) {
            // Strip trailing & if present, we'll handle backgrounding ourselves
            const cleanCmd = shellCmd.replace(/\s*&\s*$/, "");
            shellCmd = `bash -c '${cleanCmd.replace(/'/g, "'\\''")} & disown'`;
          }
          await session.exec(`cd /opt/project 2>/dev/null || true; ${shellCmd}`, (chunk) => {
            send(ws, { type: "project:command:output", payload: { projectId, commandId, data: chunk } });
          });
          send(ws, { type: "project:command:done", payload: { projectId, commandId, exitCode: 0 } });
        } catch (err: unknown) {
          send(ws, { type: "project:command:done", payload: { projectId, commandId, exitCode: 1, error: (err instanceof Error ? err.message : String(err)) } });
        } finally {
          session.close();
          activeCommandSessions.delete(cmdKey);
        }
      }
      break;
    }

    case "project:command:stop": {
      const { projectId, commandId } = msg.payload;
      const cmdKey = `${projectId}:${commandId}`;
      const session = activeCommandSessions.get(cmdKey);
      if (session) {
        session.close();
        activeCommandSessions.delete(cmdKey);
        send(ws, { type: "project:command:done", payload: { projectId, commandId, exitCode: -1, error: "Stopped by user" } });
      }
      break;
    }

    // --- Git handlers ---

    case "git:status":
    case "git:log":
    case "git:branches":
    case "git:diff":
    case "git:stage":
    case "git:unstage":
    case "git:commit":
    case "git:push":
    case "git:pull":
    case "git:checkout":
    case "git:stash":
    case "git:stash-pop": {
      const { projectId, instanceId, folder, reqId } = msg.payload;
      const gitReply = (type: string, extra: Record<string, unknown>) =>
        send(ws, { type, payload: { ...extra, ...(reqId ? { reqId } : {}) } });
      let conn;
      try {
        conn = await getVpsConnection(projectId, instanceId);
      } catch {
        gitReply("git:error", { message: "VPS instance not found" });
        break;
      }
      let session: SshSession;
      try {
        session = await connectSsh(conn, { timeoutMs: 15_000 });
      } catch (err: unknown) {
        gitReply("git:error", { message: `SSH failed: ${(err instanceof Error ? err.message : String(err))}` });
        break;
      }
      const cwd = folder || "/opt/project";
      try {
        let result: string;
        switch (msg.type) {
          case "git:status": {
            const porcelain = await session.exec(`cd ${cwd} && git status --porcelain -b 2>&1`);
            const branch = await session.exec(`cd ${cwd} && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""`);
            const ahead = await session.exec(`cd ${cwd} && git rev-list --count @{u}..HEAD 2>/dev/null || echo "0"`);
            const behind = await session.exec(`cd ${cwd} && git rev-list --count HEAD..@{u} 2>/dev/null || echo "0"`);
            gitReply("git:status:result", { projectId, folder: cwd, porcelain: porcelain.trim(), branch: branch.trim(), ahead: parseInt(ahead.trim()) || 0, behind: parseInt(behind.trim()) || 0 });
            break;
          }
          case "git:log": {
            const count = msg.payload.count || 50;
            result = await session.exec(`cd ${cwd} && git log --oneline --decorate -n ${count} 2>&1`);
            gitReply("git:log:result", { projectId, folder: cwd, log: result.trim() });
            break;
          }
          case "git:branches": {
            result = await session.exec(`cd ${cwd} && git branch -a --format='%(refname:short) %(HEAD)' 2>&1`);
            gitReply("git:branches:result", { projectId, folder: cwd, branches: result.trim() });
            break;
          }
          case "git:diff": {
            const { file, staged } = msg.payload;
            const diffCmd = staged ? "git diff --cached" : "git diff";
            const target = file ? ` -- "${file}"` : "";
            result = await session.exec(`cd ${cwd} && ${diffCmd}${target} 2>&1`);
            gitReply("git:diff:result", { projectId, folder: cwd, file, staged, diff: result });
            break;
          }
          case "git:stage": {
            const files: string[] = msg.payload.files || ["."];
            result = await session.exec(`cd ${cwd} && git add ${files.map((f: string) => `"${f}"`).join(" ")} 2>&1`);
            gitReply("git:stage:done", { projectId, folder: cwd });
            break;
          }
          case "git:unstage": {
            const files: string[] = msg.payload.files || ["."];
            result = await session.exec(`cd ${cwd} && git reset HEAD ${files.map((f: string) => `"${f}"`).join(" ")} 2>&1`);
            gitReply("git:unstage:done", { projectId, folder: cwd });
            break;
          }
          case "git:commit": {
            const message = msg.payload.message || "commit";
            // Escape single quotes in commit message
            const safeMsg = message.replace(/'/g, "'\\''");
            result = await session.exec(`cd ${cwd} && git commit -m '${safeMsg}' 2>&1`);
            gitReply("git:commit:done", { projectId, folder: cwd, output: result.trim() });
            break;
          }
          case "git:push": {
            result = await session.exec(`cd ${cwd} && git push 2>&1`, undefined, { timeoutMs: 60_000 });
            gitReply("git:push:done", { projectId, folder: cwd, output: result.trim() });
            break;
          }
          case "git:pull": {
            result = await session.exec(`cd ${cwd} && git pull 2>&1`, undefined, { timeoutMs: 60_000 });
            gitReply("git:pull:done", { projectId, folder: cwd, output: result.trim() });
            break;
          }
          case "git:checkout": {
            const branchName = msg.payload.branch;
            result = await session.exec(`cd ${cwd} && git checkout "${branchName}" 2>&1`);
            gitReply("git:checkout:done", { projectId, folder: cwd, output: result.trim() });
            break;
          }
          case "git:stash": {
            result = await session.exec(`cd ${cwd} && git stash 2>&1`);
            gitReply("git:stash:done", { projectId, folder: cwd, output: result.trim() });
            break;
          }
          case "git:stash-pop": {
            result = await session.exec(`cd ${cwd} && git stash pop 2>&1`);
            gitReply("git:stash-pop:done", { projectId, folder: cwd, output: result.trim() });
            break;
          }
        }
      } catch (err: unknown) {
        gitReply("git:error", { message: (err instanceof Error ? err.message : String(err)) });
      } finally {
        session.close();
      }
      break;
    }

    // --- Docs handlers ---

    case "docs:list": {
      try {
        await sendDocsList(ws, userId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:get": {
      try {
        const doc = await docsService.getDoc(userId, msg.payload.docId);
        if (!doc) {
          send(ws, { type: "docs:error", payload: { message: "Doc not found" } });
        } else {
          send(ws, { type: "docs:content", payload: doc });
        }
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:create": {
      try {
        const { title, content, folderId, projectId } = msg.payload;
        const doc = await docsService.createDoc(userId, title, content, folderId, projectId);
        send(ws, { type: "docs:created", payload: doc });
        await sendDocsList(ws, userId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:save": {
      try {
        const { docId, title, content } = msg.payload;
        const result = await docsService.updateDoc(userId, docId, { title, content });
        if (!result) {
          send(ws, { type: "docs:error", payload: { message: "Doc not found" } });
        } else {
          // Fan-out saved event and refresh lists for all collaborators
          for (const uid of result.allUserIds) {
            sendToUser(uid, { type: "docs:saved", payload: result.doc });
            await sendDocsListToUser(uid);
          }
        }
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:delete": {
      try {
        const { docId } = msg.payload;
        const deleted = await docsService.deleteDoc(userId, docId);
        if (!deleted) {
          send(ws, { type: "docs:error", payload: { message: "Doc not found" } });
        } else {
          send(ws, { type: "docs:deleted", payload: { docId } });
          await sendDocsList(ws, userId);
        }
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:folder:create": {
      try {
        const { name, parentId, projectId } = msg.payload;
        await docsService.createFolder(userId, name, parentId, projectId);
        await sendDocsList(ws, userId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:folder:rename": {
      try {
        const { folderId, name } = msg.payload;
        await docsService.renameFolder(userId, folderId, name);
        await sendDocsList(ws, userId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:folder:delete": {
      try {
        const { folderId } = msg.payload;
        await docsService.deleteFolder(userId, folderId);
        await sendDocsList(ws, userId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:move": {
      try {
        const { docId, folderId } = msg.payload;
        await docsService.moveDoc(userId, docId, folderId ?? null);
        await sendDocsList(ws, userId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:share": {
      try {
        const { docId, targetUserId, permission } = msg.payload;
        await docsService.shareDoc(userId, docId, targetUserId, permission);
        const shares = await docsService.getDocShares(userId, docId);
        send(ws, { type: "docs:shares", payload: { docId, shares: shares.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })) } });
        await sendDocsListToUser(targetUserId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:unshare": {
      try {
        const { docId, targetUserId } = msg.payload;
        await docsService.unshareDoc(userId, docId, targetUserId);
        const shares = await docsService.getDocShares(userId, docId);
        send(ws, { type: "docs:shares", payload: { docId, shares: shares.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })) } });
        await sendDocsListToUser(targetUserId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:shares:get": {
      try {
        const { docId } = msg.payload;
        const shares = await docsService.getDocShares(userId, docId);
        send(ws, { type: "docs:shares", payload: { docId, shares: shares.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })) } });
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:download:zip": {
      try {
        const zipBuffer = await docsService.exportDocsAsZip(userId);
        send(ws, { type: "docs:download:zip", payload: { data: zipBuffer.toString("base64") } });
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:download:doc": {
      try {
        const { docId } = msg.payload;
        const { buffer, fileName } = await docsService.exportDocAsZip(userId, docId);
        send(ws, { type: "docs:download:item", payload: { data: buffer.toString("base64"), fileName } });
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:download:folder": {
      try {
        const { folderId } = msg.payload;
        const { buffer, fileName } = await docsService.exportFolderAsZip(userId, folderId);
        send(ws, { type: "docs:download:item", payload: { data: buffer.toString("base64"), fileName } });
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:toggle-public": {
      try {
        const { docId } = msg.payload;
        const result = await docsService.toggleDocPublic(userId, docId);
        send(ws, { type: "docs:public-toggled", payload: result });
        await sendDocsList(ws, userId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:folder:toggle-public": {
      try {
        const { folderId } = msg.payload;
        const result = await docsService.toggleFolderPublic(userId, folderId);
        send(ws, { type: "docs:folder:public-toggled", payload: result });
        await sendDocsList(ws, userId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:set-project": {
      try {
        const { docId, projectId } = msg.payload;
        await docsService.setDocProject(userId, docId, projectId ?? null);
        await sendDocsList(ws, userId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:folder:set-project": {
      try {
        const { folderId, projectId } = msg.payload;
        await docsService.setFolderProject(userId, folderId, projectId ?? null);
        await sendDocsList(ws, userId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "docs:get-public": {
      try {
        const { publicKey } = msg.payload;
        const doc = await docsService.getDocByPublicKey(publicKey);
        if (!doc) {
          send(ws, { type: "docs:error", payload: { message: "Public doc not found" } });
        } else {
          send(ws, { type: "docs:public-content", payload: doc });
        }
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    // --- Compose file handlers ---

    case "compose:read": {
      const { projectId } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "compose:content", payload: { projectId, content: null, error: "Project not found" } });
        break;
      }
      // Read compose from setupFiles stored in DB
      const composeNames = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
      const files = project.setupFiles || {};
      let composeContent: string | null = null;
      let composeFileName: string | null = null;
      for (const name of composeNames) {
        if (name in files) { composeContent = files[name]; composeFileName = name; break; }
      }
      send(ws, { type: "compose:content", payload: { projectId, content: composeContent, filePath: composeFileName, error: null } });
      break;
    }

    case "compose:save": {
      const { projectId, content } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "compose:saved", payload: { projectId, ok: false, error: "Project not found" } });
        break;
      }
      // Save compose to setupFiles in DB
      const composeNames = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
      const files = project.setupFiles || {};
      let targetName = "docker-compose.yml";
      for (const name of composeNames) {
        if (name in files) { targetName = name; break; }
      }
      const setupFiles = { ...files, [targetName]: content };
      await projectService.patchProject(projectId, { setupFiles });
      send(ws, { type: "compose:saved", payload: { projectId, ok: true, filePath: targetName, error: null } });
      break;
    }

    // --- Project file editor handlers ---

    case "project-file:list": {
      const { projectId } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:files", payload: { projectId, files: [], error: "Project not found" } });
        break;
      }
      const files = Object.keys(project.setupFiles || {});
      send(ws, { type: "project-file:files", payload: { projectId, files, error: null } });
      break;
    }

    case "project-file:read": {
      const { projectId, fileName } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:content", payload: { projectId, fileName, content: null, error: "Project not found" } });
        break;
      }
      const content = (project.setupFiles || {})[fileName] ?? null;
      send(ws, { type: "project-file:content", payload: { projectId, fileName, content, error: null } });
      break;
    }

    case "project-file:save": {
      const { projectId, fileName, content } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:saved", payload: { projectId, fileName, ok: false, error: "Project not found" } });
        break;
      }
      const setupFiles = { ...(project.setupFiles || {}), [fileName]: content };
      await projectService.patchProject(projectId, { setupFiles });
      send(ws, { type: "project-file:saved", payload: { projectId, fileName, ok: true, error: null } });
      break;
    }

    case "project-file:delete": {
      const { projectId, fileName } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:deleted", payload: { projectId, fileName, ok: false, error: "Project not found" } });
        break;
      }
      const remaining = { ...(project.setupFiles || {}) };
      delete remaining[fileName];
      await projectService.patchProject(projectId, { setupFiles: remaining });
      send(ws, { type: "project-file:deleted", payload: { projectId, fileName, ok: true, error: null } });
      break;
    }

    case "project-file:add": {
      const { projectId, fileName } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:added", payload: { projectId, fileName, ok: false, error: "Project not found" } });
        break;
      }
      const withNew = { ...(project.setupFiles || {}), [fileName]: "" };
      await projectService.patchProject(projectId, { setupFiles: withNew });
      send(ws, { type: "project-file:added", payload: { projectId, fileName, ok: true, error: null } });
      break;
    }

    case "project-file:rename": {
      const { projectId, oldName, newName } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:renamed", payload: { projectId, ok: false, error: "Project not found" } });
        break;
      }
      const files = { ...(project.setupFiles || {}) };
      if (!(oldName in files)) {
        send(ws, { type: "project-file:renamed", payload: { projectId, ok: false, error: "File not found" } });
        break;
      }
      const content = files[oldName];
      delete files[oldName];
      files[newName] = content;
      await projectService.patchProject(projectId, { setupFiles: files });
      send(ws, { type: "project-file:renamed", payload: { projectId, oldName, newName, ok: true, error: null } });
      break;
    }

    case "project-file:import-from-disk": {
      const { projectId } = msg.payload;
      send(ws, { type: "project-file:imported", payload: { projectId, files: [], error: "Import from disk is no longer supported. Create files directly in the editor." } });
      break;
    }

    // --- File template handlers ---

    case "file-template:list": {
      const db = getDb();
      const rows = await db.select().from(fileTemplates).orderBy(fileTemplates.name);
      const templates = rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        files: r.files as Record<string, string>,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
      }));
      send(ws, { type: "file-template:list", payload: { templates } });
      break;
    }

    case "file-template:create": {
      const { name, description, files } = msg.payload;
      const db = getDb();
      const [row] = await db.insert(fileTemplates).values({
        name,
        description: description || "",
        files: files || {},
        createdBy: userId!,
      }).returning();
      send(ws, { type: "file-template:created", payload: { ok: true, template: { id: row.id, name: row.name, description: row.description, files: row.files, createdBy: row.createdBy, createdAt: row.createdAt.toISOString() } } });
      break;
    }

    case "file-template:update": {
      const { id, name, description, files } = msg.payload;
      const db = getDb();
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (name !== undefined) patch.name = name;
      if (description !== undefined) patch.description = description;
      if (files !== undefined) patch.files = files;
      await db.update(fileTemplates).set(patch).where(eq(fileTemplates.id, id));
      send(ws, { type: "file-template:updated", payload: { ok: true, id } });
      break;
    }

    case "file-template:delete": {
      const { id } = msg.payload;
      const db = getDb();
      await db.delete(fileTemplates).where(eq(fileTemplates.id, id));
      send(ws, { type: "file-template:deleted", payload: { ok: true, id } });
      break;
    }

    case "file-template:inject": {
      const { projectId, templateId, mode } = msg.payload; // mode: "merge" | "replace"
      const db = getDb();
      const [tpl] = await db.select().from(fileTemplates).where(eq(fileTemplates.id, templateId));
      if (!tpl) {
        send(ws, { type: "file-template:injected", payload: { ok: false, error: "Template not found" } });
        break;
      }
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "file-template:injected", payload: { ok: false, error: "Project not found" } });
        break;
      }
      const tplFiles = (tpl.files || {}) as Record<string, string>;
      const existing = (project.setupFiles || {}) as Record<string, string>;
      const merged = mode === "replace" ? { ...tplFiles } : { ...existing, ...tplFiles };
      await projectService.patchProject(projectId, { setupFiles: merged });
      send(ws, { type: "file-template:injected", payload: { ok: true, projectId } });
      break;
    }

    case "file-template:save-from-project": {
      const { projectId, name, description } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "file-template:created", payload: { ok: false, error: "Project not found" } });
        break;
      }
      const db = getDb();
      const [row] = await db.insert(fileTemplates).values({
        name,
        description: description || "",
        files: project.setupFiles || {},
        createdBy: userId!,
      }).returning();
      send(ws, { type: "file-template:created", payload: { ok: true, template: { id: row.id, name: row.name, description: row.description, files: row.files, createdBy: row.createdBy, createdAt: row.createdAt.toISOString() } } });
      break;
    }

    // --- DigitalOcean handlers ---

    case "do:validate-token": {
      const doToken = await settingsService.getGlobalDoToken();
      if (!doToken) {
        send(ws, { type: "do:token-valid", payload: { valid: false } });
        break;
      }
      try {
        const doClient = createDoClient(doToken);
        const account = await doClient.getAccount();
        send(ws, { type: "do:token-valid", payload: { valid: true, email: account.email } });
      } catch {
        send(ws, { type: "do:token-valid", payload: { valid: false } });
      }
      break;
    }

    case "do:snapshots:list": {
      const doToken = await settingsService.getGlobalDoToken();
      if (!doToken) {
        send(ws, { type: "do:snapshots:list", payload: { snapshots: [] } });
        break;
      }
      try {
        const doClient = createDoClient(doToken);
        const snapshots = await doClient.listAccountSnapshots();
        send(ws, { type: "do:snapshots:list", payload: { snapshots: snapshots.map(s => ({ id: s.id, name: s.name, regions: s.regions, sizeGb: s.size_gigabytes, createdAt: s.created_at, minDiskSize: s.min_disk_size })) } });
      } catch {
        send(ws, { type: "do:snapshots:list", payload: { snapshots: [] } });
      }
      break;
    }

    case "do:snapshot:delete": {
      const { snapshotId } = msg.payload;
      const snapDoToken = await settingsService.getGlobalDoToken();
      if (!snapDoToken) { send(ws, { type: "do:snapshot:delete:result", payload: { ok: false, error: "No DO token" } }); break; }
      try {
        const snapClient = createDoClient(snapDoToken);
        await snapClient.deleteSnapshot(snapshotId);
        // Refresh list
        const updatedSnaps = await snapClient.listAccountSnapshots();
        send(ws, { type: "do:snapshots:list", payload: { snapshots: updatedSnaps.map(s => ({ id: s.id, name: s.name, regions: s.regions, sizeGb: s.size_gigabytes, createdAt: s.created_at, minDiskSize: s.min_disk_size })) } });
        send(ws, { type: "do:snapshot:delete:result", payload: { ok: true } });
      } catch (err: unknown) {
        send(ws, { type: "do:snapshot:delete:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "do:deploy": {
      const { projectId: doProjectId, instanceId: doInstanceId, label: doLabel } = msg.payload;
      const doProject = await projectService.getById(doProjectId);
      if (!doProject) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: doProjectId, message: "Project not found" } });
        break;
      }
      const doToken = await settingsService.resolveDoToken(doProjectId);
      if (!doToken) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: doProjectId, message: "DigitalOcean API token not configured. Add it in Settings." } });
        break;
      }

      // Auto-create AGENT.md if it doesn't exist
      let doAgentMemoryCreated = false;
      if (!doProject.setupFiles?.["AGENT.md"]) {
        const defaultAgentMd = `# Agent Memory\n\nThis file is automatically maintained by Genie. It stores knowledge about the project's codebase, architecture, and deployment so the agent doesn't need to rediscover things each session.\n\n## Codebase Overview\n<!-- The agent will fill this in after exploring the codebase -->\n\n## Architecture & Tech Stack\n<!-- Key technologies, frameworks, patterns -->\n\n## Important Files & Paths\n<!-- Critical files the agent has discovered -->\n\n## Deployment Notes\n<!-- Instance-specific deployment knowledge -->\n`;
        const updatedFiles = { ...(doProject.setupFiles || {}), "AGENT.md": defaultAgentMd };
        await projectService.patchProject(doProjectId, { setupFiles: updatedFiles });
        doProject.setupFiles = updatedFiles;
        doAgentMemoryCreated = true;
      }

      const newDoInstanceId = doInstanceId || uuidv4();
      const abortController = new AbortController();
      activeDoAbortControllers.set(doProjectId, abortController);

      // Insert deploy log row
      const doDb = getDb();
      const [doLogRow] = await doDb.insert(deployLogs).values({ projectId: doProjectId }).returning({ id: deployLogs.id });
      const doDeployLogId = doLogRow.id;
      const doProgressAcc: string[] = [];

      const doTemplateName = doProject.vpsBaseImageConfigName || "default";
      const doFirstMsg = `Starting DigitalOcean auto-provision for "${doProject.name}" (template: ${doTemplateName})...`;
      doProgressAcc.push(doFirstMsg);
      send(ws, { type: "vps:deploy:progress", payload: { projectId: doProjectId, instanceId: newDoInstanceId, message: doFirstMsg } });

      const gitlabKey = await settingsService.resolveGitlabDeployKey(doProjectId);
      const gitTokenValue = await settingsService.resolveGitToken(userId);

      void doProvisionAndDeploy(
        {
          token: doToken,
          projectName: doProject.name,
          region: doProject.vpsRegion || undefined,
          size: doProject.vpsSize || undefined,
          signal: abortController.signal,
          gitlabDeployKey: gitlabKey || undefined,
          gitToken: gitTokenValue || undefined,
          envVars: doProject.secrets?.reduce((acc, s) => { if (s.key) acc[s.key] = s.value; return acc; }, {} as Record<string, string>),
          baseImageId: await settingsService.resolveBaseImageId(doProject),
          setupFiles: doProject.setupFiles,
        },
        (step) => {
          doProgressAcc.push(step);
          send(ws, { type: "vps:deploy:progress", payload: { projectId: doProjectId, instanceId: newDoInstanceId, message: step } });
        },
      ).then(async (result) => {
        activeDoAbortControllers.delete(doProjectId);
        const connection: VpsConnectionConfig = {
          host: result.ipAddress,
          port: 22,
          username: VPS_SSH_USERNAME,
          privateKeyPath: path.join(os.homedir(), ".genie", "ssh", "genie_ed25519"),
        };
        const instance: import("./types.js").VpsInstance = {
          id: newDoInstanceId,
          label: doLabel || "production",
          connection,
          services: [],
          digitalocean: {
            dropletId: result.dropletId,
            ipAddress: result.ipAddress,
            region: result.region,
            size: result.size,
          },
        };
        // Write server info into CLAUDE.md
        try {
          const sshTmp = await connectSsh(connection, { timeoutMs: 15_000 });
          const claudeMdPath = `${remoteDir(doProject.name)}/CLAUDE.md`;
          const serverBlock = [
            `Server public IP: ${result.ipAddress}`,
            ``,
            `## Browser & MCP Tools`,
            `This server runs in the cloud at ${result.ipAddress}. When using browser tools:`,
            `- The app is accessible at http://${result.ipAddress}:3000 (or whichever port). NEVER use localhost or 127.0.0.1 URLs.`,
            `- genie-browser: Always use the public IP (http://${result.ipAddress}:PORT) for navigation. Never pass localhost URLs.`,
            `- chrome-devtools: Runs Puppeteer on the VPS with no display server — always use headless mode. Navigate to http://${result.ipAddress}:PORT, never localhost.`,
          ].join('\\n');
          const script = `node -e "
            const fs = require('fs');
            const p = '${claudeMdPath}';
            let c = '';
            try { c = fs.readFileSync(p, 'utf8'); } catch {}
            if (c.includes('Server public IP:')) {
              c = c.replace(/Server public IP:[\\\\s\\\\S]*?(?=\\n##[^#]|\\n\\n[^#\\\\s]|$)/, '${serverBlock}');
            } else {
              const i = c.indexOf('\\n');
              c = i >= 0 ? c.slice(0, i + 1) + '\\n${serverBlock}\\n' + c.slice(i + 1) : '${serverBlock}\\n' + c;
            }
            fs.writeFileSync(p, c);
          "`;
          await sshTmp.exec(script, undefined, { timeoutMs: 10_000 });
          sshTmp.close();
        } catch {}
        try {
          instance.services = await vpsStatus(doProject.name, connection);
        } catch { /* keep empty services */ }
        // Add or update the instance
        const existing = doProject.vpsInstances.find(v => v.id === newDoInstanceId);
        if (existing) {
          await projectService.updateVpsInstance(doProjectId, newDoInstanceId, instance);
        } else {
          await projectService.addVpsInstance(doProjectId, instance);
        }
        await broadcastProjectList();
        await doDb.update(deployLogs).set({ status: "success", progress: doProgressAcc, endedAt: new Date() }).where(eq(deployLogs.id, doDeployLogId));
        if (doAgentMemoryCreated) {
          send(ws, { type: "vps:deploy:progress", payload: { projectId: doProjectId, instanceId: newDoInstanceId, message: "Created AGENT.md — ask Genie to explore your codebase to build memory." } });
        }
        send(ws, { type: "vps:deploy:done", payload: { projectId: doProjectId, instanceId: newDoInstanceId, services: instance.services, deployLogId: doDeployLogId } });
      }).catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        activeDoAbortControllers.delete(doProjectId);
        await doDb.update(deployLogs).set({ status: "error", progress: doProgressAcc, error: (err instanceof Error ? err.message : String(err)), endedAt: new Date() }).where(eq(deployLogs.id, doDeployLogId));
        // If the droplet was created, attach it to the project as a failed instance
        if (((err as Error & { dropletId?: number }).dropletId)) {
          const failedInstance: import("./types.js").VpsInstance = {
            id: newDoInstanceId,
            label: doLabel || "production",
            connection: {
              host: ((err as Error & { dropletIp?: string }).dropletIp) || "unknown",
              port: 22,
              username: VPS_SSH_USERNAME,
              privateKeyPath: path.join(os.homedir(), ".genie", "ssh", "genie_ed25519"),
            },
            services: [],
            digitalocean: {
              dropletId: ((err as Error & { dropletId?: number }).dropletId)!,
              ipAddress: ((err as Error & { dropletIp?: string }).dropletIp) || "unknown",
              region: doProject.vpsRegion || "unknown",
              size: doProject.vpsSize || "unknown",
            },
            deployFailed: true,
            deployError: (err instanceof Error ? err.message : String(err)),
          };
          await projectService.addVpsInstance(doProjectId, failedInstance);
          await broadcastProjectList();
        }
        send(ws, { type: "vps:deploy:error", payload: { projectId: doProjectId, instanceId: newDoInstanceId, message: (err instanceof Error ? err.message : String(err)), deployLogId: doDeployLogId, ...(((err as Error & { dropletId?: number }).dropletId) ? { failedDroplet: { dropletId: ((err as Error & { dropletId?: number }).dropletId), ipAddress: ((err as Error & { dropletIp?: string }).dropletIp) } } : {}) } });
      });
      break;
    }

    case "do:cancel": {
      const { projectId: cancelProjectId } = msg.payload;
      const controller = activeDoAbortControllers.get(cancelProjectId);
      if (controller) {
        controller.abort();
        activeDoAbortControllers.delete(cancelProjectId);
        send(ws, { type: "vps:deploy:progress", payload: { projectId: cancelProjectId, message: "Cancelling deployment..." } });
      }
      break;
    }

    case "do:destroy-failed-droplet": {
      const { dropletId: failedDropletId, projectId: failedProjectId, instanceId: failedInstanceId } = msg.payload;
      try {
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        await doDestroyDroplet(doToken, failedDropletId, (step) => {
          send(ws, { type: "vps:deploy:progress", payload: { projectId: failedProjectId, instanceId: failedInstanceId, message: step } });
        });
        // Remove the VPS instance if it was saved
        if (failedProjectId && failedInstanceId) {
          try { await projectService.removeVpsInstance(failedProjectId, failedInstanceId); } catch {}
          await broadcastProjectList();
        }
        send(ws, { type: "do:destroy-failed-droplet:done", payload: { dropletId: failedDropletId } });
      } catch (err: unknown) {
        send(ws, { type: "do:destroy-failed-droplet:error", payload: { dropletId: failedDropletId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    // --- TazCloud handlers ---

    case "tazcloud:deploy": {
      const { projectId: tazProjectId, instanceId: tazInstanceId, label: tazLabel } = msg.payload;
      const tazProject = await projectService.getById(tazProjectId);
      if (!tazProject) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: tazProjectId, message: "Project not found" } });
        break;
      }
      const tazToken = process.env.TAZCLOUD_API_TOKEN;
      const tazPrivateKey = process.env.TAZCLOUD_SSH_PRIVATE_KEY;
      if (!tazToken || !tazPrivateKey) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: tazProjectId, message: "TazCloud credentials not configured (TAZCLOUD_API_TOKEN and TAZCLOUD_SSH_PRIVATE_KEY env vars)." } });
        break;
      }

      // Auto-create AGENT.md if missing (mirrors DO path).
      if (!tazProject.setupFiles?.["AGENT.md"]) {
        const defaultAgentMd = `# Agent Memory\n\nThis file is automatically maintained by Genie.\n`;
        const updatedFiles = { ...(tazProject.setupFiles || {}), "AGENT.md": defaultAgentMd };
        await projectService.patchProject(tazProjectId, { setupFiles: updatedFiles });
        tazProject.setupFiles = updatedFiles;
      }

      const newTazInstanceId = tazInstanceId || uuidv4();
      const abortController = new AbortController();
      activeTazAbortControllers.set(tazProjectId, abortController);

      const tazDb = getDb();
      const [tazLogRow] = await tazDb.insert(deployLogs).values({ projectId: tazProjectId }).returning({ id: deployLogs.id });
      const tazDeployLogId = tazLogRow.id;
      const tazProgressAcc: string[] = [];

      const tazFirstMsg = `Starting TazCloud auto-provision for "${tazProject.name}" (image: ${tazProject.vpsImage || "ubuntu-22"}, size: ${tazProject.vpsSize || "small"})...`;
      tazProgressAcc.push(tazFirstMsg);
      send(ws, { type: "vps:deploy:progress", payload: { projectId: tazProjectId, instanceId: newTazInstanceId, message: tazFirstMsg } });

      const gitlabKey = await settingsService.resolveGitlabDeployKey(tazProjectId);
      const gitTokenValue = await settingsService.resolveGitToken(userId);

      void tazcloudProvisionAndDeploy(
        {
          token: tazToken,
          privateKey: tazPrivateKey,
          projectName: tazProject.name,
          image: tazProject.vpsImage || undefined,
          size: tazProject.vpsSize || undefined,
          signal: abortController.signal,
          gitlabDeployKey: gitlabKey || undefined,
          gitToken: gitTokenValue || undefined,
          envVars: tazProject.secrets?.reduce((acc, s) => { if (s.key) acc[s.key] = s.value; return acc; }, {} as Record<string, string>),
          setupFiles: tazProject.setupFiles,
        },
        (step) => {
          tazProgressAcc.push(step);
          send(ws, { type: "vps:deploy:progress", payload: { projectId: tazProjectId, instanceId: newTazInstanceId, message: step } });
        },
      ).then(async (result) => {
        activeTazAbortControllers.delete(tazProjectId);
        const tazKeyPath = ensureTazcloudKeyOnDisk(tazPrivateKey);
        const connection: VpsConnectionConfig = {
          host: result.ipv6,
          port: 22,
          username: VPS_SSH_USERNAME,
          privateKeyPath: tazKeyPath,
        };
        const instance: import("./types.js").VpsInstance = {
          id: newTazInstanceId,
          label: tazLabel || "production",
          connection,
          services: [],
          tazcloud: {
            vmId: result.vmId,
            ipv6: result.ipv6,
            image: result.image,
            size: result.size,
            sshUser: result.sshUser,
          },
        };
        try {
          instance.services = await vpsStatus(tazProject.name, connection);
        } catch { /* keep empty */ }
        const existing = tazProject.vpsInstances.find(v => v.id === newTazInstanceId);
        if (existing) {
          await projectService.updateVpsInstance(tazProjectId, newTazInstanceId, instance);
        } else {
          await projectService.addVpsInstance(tazProjectId, instance);
        }
        await broadcastProjectList();
        await tazDb.update(deployLogs).set({ status: "success", progress: tazProgressAcc, endedAt: new Date() }).where(eq(deployLogs.id, tazDeployLogId));
        send(ws, { type: "vps:deploy:done", payload: { projectId: tazProjectId, instanceId: newTazInstanceId, services: instance.services, deployLogId: tazDeployLogId } });
      }).catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        activeTazAbortControllers.delete(tazProjectId);
        await tazDb.update(deployLogs).set({ status: "error", progress: tazProgressAcc, error: message, endedAt: new Date() }).where(eq(deployLogs.id, tazDeployLogId));
        const failedVmId = (err as Error & { vmId?: string }).vmId;
        if (failedVmId) {
          const failedInstance: import("./types.js").VpsInstance = {
            id: newTazInstanceId,
            label: tazLabel || "production",
            connection: {
              host: "unknown",
              port: 22,
              username: VPS_SSH_USERNAME,
              privateKeyPath: ensureTazcloudKeyOnDisk(tazPrivateKey),
            },
            services: [],
            tazcloud: {
              vmId: failedVmId,
              ipv6: "unknown",
              image: tazProject.vpsImage || "unknown",
              size: tazProject.vpsSize || "unknown",
              sshUser: VPS_SSH_USERNAME,
            },
            deployFailed: true,
            deployError: message,
          };
          await projectService.addVpsInstance(tazProjectId, failedInstance);
          await broadcastProjectList();
        }
        send(ws, {
          type: "vps:deploy:error",
          payload: {
            projectId: tazProjectId,
            instanceId: newTazInstanceId,
            message,
            deployLogId: tazDeployLogId,
            ...(failedVmId ? { failedVm: { vmId: failedVmId, provider: "tazcloud" } } : {}),
          },
        });
      });
      break;
    }

    case "tazcloud:cancel": {
      const { projectId: cancelProjectId } = msg.payload;
      const controller = activeTazAbortControllers.get(cancelProjectId);
      if (controller) {
        controller.abort();
        activeTazAbortControllers.delete(cancelProjectId);
        send(ws, { type: "vps:deploy:progress", payload: { projectId: cancelProjectId, message: "Cancelling TazCloud deployment..." } });
      }
      break;
    }

    case "tazcloud:destroy-failed-vm": {
      const { vmId: failedVmId, projectId: failedProjectId, instanceId: failedInstanceId } = msg.payload;
      try {
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        await tazcloudDestroyVm(tazToken, failedVmId, (step) => {
          send(ws, { type: "vps:deploy:progress", payload: { projectId: failedProjectId, instanceId: failedInstanceId, message: step } });
        });
        if (failedProjectId && failedInstanceId) {
          try { await projectService.removeVpsInstance(failedProjectId, failedInstanceId); } catch {}
          await broadcastProjectList();
        }
        send(ws, { type: "tazcloud:destroy-failed-vm:done", payload: { vmId: failedVmId } });
      } catch (err: unknown) {
        send(ws, { type: "tazcloud:destroy-failed-vm:error", payload: { vmId: failedVmId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    // --- VPS (SSH) deploy handlers ---

    case "vps:test-connection": {
      const { host, port, username, privateKeyPath } = msg.payload as VpsConnectionConfig;
      try {
        const session = await connectSsh({ host, port, username, privateKeyPath });
        // Quick smoke test — run hostname
        const hostname = await session.exec("hostname");
        session.close();
        send(ws, { type: "vps:test-connection:ok", payload: { hostname: hostname.trim() } });
      } catch (err: unknown) {
        send(ws, { type: "vps:test-connection:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "vps:attach-existing": {
      // Attach an already-existing cloud VM (DO droplet or TazCloud VM) to a project
      // without re-provisioning. Admin-only because the source lists are admin-scoped.
      const { projectId, provider, vmId, label } = msg.payload as {
        projectId: string; provider: "digitalocean" | "tazcloud"; vmId: string | number; label?: string;
      };
      try {
        const callerState = clients.get(ws);
        const realCallerId = callerState?.impersonatedBy ?? callerState?.userId ?? null;
        if (!realCallerId || !(await isAdmin(realCallerId))) {
          send(ws, { type: "vps:attach-existing:error", payload: { message: "Admins only" } });
          break;
        }
        const project = await projectService.getById(projectId);
        if (!project) {
          send(ws, { type: "vps:attach-existing:error", payload: { message: "Project not found" } });
          break;
        }

        // Refuse if this VM is already attached to any project.
        const allProjects = await projectService.getAll();
        for (const p of allProjects) {
          for (const v of p.vpsInstances) {
            const matchDo = provider === "digitalocean" && v.digitalocean?.dropletId === Number(vmId);
            const matchTaz = provider === "tazcloud" && v.tazcloud?.vmId === String(vmId);
            if (matchDo || matchTaz) {
              send(ws, { type: "vps:attach-existing:error", payload: { message: `Already attached to project "${p.name}"` } });
              return;
            }
          }
        }

        let instance;
        if (provider === "digitalocean") {
          const doToken = await settingsService.getGlobalDoToken();
          if (!doToken) throw new Error("DigitalOcean API token not configured");
          const doClient = createDoClient(doToken);
          const droplet = await doClient.getDroplet(Number(vmId));
          const publicV4 = droplet.networks.v4.find((n) => n.type === "public")?.ip_address;
          if (!publicV4) throw new Error("Droplet has no public IPv4 yet");
          instance = {
            id: uuidv4(),
            label: (label || droplet.name).slice(0, 64),
            connection: {
              host: publicV4,
              port: 22,
              username: VPS_SSH_USERNAME,
              privateKeyPath: "~/.genie/ssh/genie_ed25519",
            },
            services: [],
            digitalocean: {
              dropletId: droplet.id,
              ipAddress: publicV4,
              region: droplet.region.slug,
              size: droplet.size_slug,
            },
          };
        } else {
          const tazToken = process.env.TAZCLOUD_API_TOKEN;
          if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
          const tazClient = createTazClient(tazToken);
          const vm = await tazClient.getVm(String(vmId));
          if (!vm.ipv6) throw new Error("VM has no IPv6 address yet");
          // Image-default user — these VMs aren't Genie-provisioned so the `genie` user doesn't exist.
          const sshUser = vm.image ? sshUserForImage(vm.image) : "ubuntu";
          instance = {
            id: uuidv4(),
            label: (label || vm.name).slice(0, 64),
            connection: {
              host: vm.ipv6,
              port: vm.ssh_port || 22,
              username: sshUser,
              privateKeyPath: "~/.genie/ssh/tazcloud_ed25519",
            },
            services: [],
            tazcloud: {
              vmId: vm.id,
              ipv6: vm.ipv6,
              image: vm.image || "ubuntu-22",
              size: vm.size || "small",
              sshUser,
            },
          };
        }

        await projectService.addVpsInstance(projectId, instance);
        await broadcastProjectList();
        // Refresh the cloud panels so the "Project" column updates.
        broadcast({ type: "admin:droplets:list:stale", payload: {} });
        broadcast({ type: "admin:tazcloud:list:stale", payload: {} });
        send(ws, { type: "vps:attach-existing:ok", payload: { projectId, provider, vmId, instanceId: instance.id } });
      } catch (err: unknown) {
        send(ws, { type: "vps:attach-existing:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "vps:deploy": {
      const { projectId, connection, instanceId: sshInstanceId, label: sshLabel } = msg.payload as { projectId: string; connection: VpsConnectionConfig; instanceId?: string; label?: string };
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "vps:deploy:error", payload: { projectId, message: "Project not found" } });
        break;
      }

      // Auto-create AGENT.md if it doesn't exist
      let vpsAgentMemoryCreated = false;
      if (!project.setupFiles?.["AGENT.md"]) {
        const defaultAgentMd = `# Agent Memory\n\nThis file is automatically maintained by Genie. It stores knowledge about the project's codebase, architecture, and deployment so the agent doesn't need to rediscover things each session.\n\n## Codebase Overview\n<!-- The agent will fill this in after exploring the codebase -->\n\n## Architecture & Tech Stack\n<!-- Key technologies, frameworks, patterns -->\n\n## Important Files & Paths\n<!-- Critical files the agent has discovered -->\n\n## Deployment Notes\n<!-- Instance-specific deployment knowledge -->\n`;
        const updatedFiles = { ...(project.setupFiles || {}), "AGENT.md": defaultAgentMd };
        await projectService.patchProject(projectId, { setupFiles: updatedFiles });
        project.setupFiles = updatedFiles;
        vpsAgentMemoryCreated = true;
      }

      const newSshInstanceId = sshInstanceId || uuidv4();

      // Insert deploy log row
      const vpsDb = getDb();
      const [vpsLogRow] = await vpsDb.insert(deployLogs).values({ projectId }).returning({ id: deployLogs.id });
      const vpsDeployLogId = vpsLogRow.id;
      const vpsProgressAcc: string[] = [];

      const vpsFirstMsg = `Starting VPS deploy for "${project.name}"...`;
      vpsProgressAcc.push(vpsFirstMsg);
      send(ws, { type: "vps:deploy:progress", payload: { projectId, instanceId: newSshInstanceId, message: vpsFirstMsg } });

      const secretEnvVars = project.secrets?.reduce((acc, s) => { if (s.key) acc[s.key] = s.value; return acc; }, {} as Record<string, string>);

      void vpsDeploy(project.name, connection, (step) => {
        vpsProgressAcc.push(step);
        send(ws, { type: "vps:deploy:progress", payload: { projectId, instanceId: newSshInstanceId, message: step } });
      }, secretEnvVars, project.setupFiles).then(async () => {
        const instance: import("./types.js").VpsInstance = {
          id: newSshInstanceId,
          label: sshLabel || "default",
          connection,
          services: [],
        };
        // Write server info into CLAUDE.md
        try {
          const sshTmp = await connectSsh(connection, { timeoutMs: 15_000 });
          const claudeMdPath = `${remoteDir(project.name)}/CLAUDE.md`;
          const ip = connection.host;
          const serverBlock = [
            `Server public IP: ${ip}`,
            ``,
            `## Browser & MCP Tools`,
            `This server runs in the cloud at ${ip}. When using browser tools:`,
            `- The app is accessible at http://${ip}:3000 (or whichever port). NEVER use localhost or 127.0.0.1 URLs.`,
            `- genie-browser: Always use the public IP (http://${ip}:PORT) for navigation. Never pass localhost URLs.`,
            `- chrome-devtools: Runs Puppeteer on the VPS with no display server — always use headless mode. Navigate to http://${ip}:PORT, never localhost.`,
          ].join('\\n');
          const script = `node -e "
            const fs = require('fs');
            const p = '${claudeMdPath}';
            let c = '';
            try { c = fs.readFileSync(p, 'utf8'); } catch {}
            if (c.includes('Server public IP:')) {
              c = c.replace(/Server public IP:[\\\\s\\\\S]*?(?=\\n##[^#]|\\n\\n[^#\\\\s]|$)/, '${serverBlock}');
            } else {
              const i = c.indexOf('\\n');
              c = i >= 0 ? c.slice(0, i + 1) + '\\n${serverBlock}\\n' + c.slice(i + 1) : '${serverBlock}\\n' + c;
            }
            fs.writeFileSync(p, c);
          "`;
          await sshTmp.exec(script, undefined, { timeoutMs: 10_000 });
          sshTmp.close();
        } catch {}
        try {
          instance.services = await vpsStatus(project.name, connection);
        } catch { /* keep empty services */ }
        const existing = project.vpsInstances.find(v => v.id === newSshInstanceId);
        if (existing) {
          await projectService.updateVpsInstance(projectId, newSshInstanceId, instance);
        } else {
          await projectService.addVpsInstance(projectId, instance);
        }
        await broadcastProjectList();
        await vpsDb.update(deployLogs).set({ status: "success", progress: vpsProgressAcc, endedAt: new Date() }).where(eq(deployLogs.id, vpsDeployLogId));
        if (vpsAgentMemoryCreated) {
          send(ws, { type: "vps:deploy:progress", payload: { projectId, instanceId: newSshInstanceId, message: "Created AGENT.md — ask Genie to explore your codebase to build memory." } });
        }
        send(ws, { type: "vps:deploy:done", payload: { projectId, instanceId: newSshInstanceId, services: instance.services, deployLogId: vpsDeployLogId } });
      }).catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        await vpsDb.update(deployLogs).set({ status: "error", progress: vpsProgressAcc, error: message, endedAt: new Date() }).where(eq(deployLogs.id, vpsDeployLogId));
        send(ws, { type: "vps:deploy:error", payload: { projectId, instanceId: newSshInstanceId, message: (err instanceof Error ? err.message : String(err)), deployLogId: vpsDeployLogId } });
      });
      break;
    }

    case "deploy:logs:list": {
      const { projectId: logsProjectId } = msg.payload;
      const logsDb = getDb();
      const rows = await logsDb.select().from(deployLogs).where(eq(deployLogs.projectId, logsProjectId)).orderBy(desc(deployLogs.startedAt)).limit(20);
      send(ws, { type: "deploy:logs:list", payload: { projectId: logsProjectId, logs: rows } });
      break;
    }

    case "vps:status": {
      const { projectId, instanceId } = msg.payload;
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "error", payload: { message: "No VPS deployment for this project/instance" } });
        break;
      }
      try {
        const containers = await vpsStatus(project!.name, vpsInst.connection);
        await projectService.updateVpsInstance(projectId, instanceId, { services: containers });
        send(ws, { type: "vps:status:update", payload: { projectId, instanceId, services: containers } });
        await broadcastProjectList();
      } catch (err: unknown) {
        send(ws, { type: "error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "vps:stats": {
      const { projectId, instanceId } = msg.payload;
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "vps:stats:error", payload: { projectId, instanceId, message: "No VPS deployment for this project/instance" } });
        break;
      }
      // Trigger a background sync if the droplet isn't in our known-alive set,
      // but still attempt SSH — the DO API list may be stale or incomplete.
      const dropletId = vpsInst.digitalocean?.dropletId;
      if (dropletId && lastDropletSync > 0 && !knownAliveDropletIds.has(dropletId)) {
        void syncDropletStatuses();
      }
      try {
        const stats = await vpsStats(vpsInst.connection);
        send(ws, { type: "vps:stats:result", payload: { projectId, instanceId, stats } });
      } catch (err: unknown) {
        send(ws, { type: "vps:stats:error", payload: { projectId, instanceId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "vps:process:kill": {
      const { projectId, instanceId, pid } = msg.payload;
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "vps:process:kill:result", payload: { projectId, instanceId, pid, ok: false, error: "No VPS deployment" } });
        break;
      }
      try {
        const session = await connectSsh(vpsInst.connection);
        try {
          await session.exec(`kill -9 ${Number(pid)}`);
        } finally {
          session.close();
        }
        send(ws, { type: "vps:process:kill:result", payload: { projectId, instanceId, pid, ok: true } });
      } catch (err: unknown) {
        send(ws, { type: "vps:process:kill:result", payload: { projectId, instanceId, pid, ok: false, error: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "mcp:tunnel:start": {
      const { projectId, instanceId } = msg.payload as { projectId: string; instanceId: string };
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst || !project) {
        send(ws, { type: "mcp:tunnel:result", payload: { projectId, instanceId, ok: false, error: "No VPS deployment" } });
        break;
      }
      const host = vpsInst.connection.host;
      const key = tunnelKey(userId, host);
      // Already has a tunnel?
      if (persistentMcpTunnels.has(key)) {
        send(ws, { type: "mcp:tunnel:result", payload: { projectId, instanceId, ok: true } });
        break;
      }
      try {
        // Try to find existing extension WS for DOM actions, else use a stub
        const extensionWs = getExtensionClient(userId);
        const domExecutor: DomActionExecutor = extensionWs
          ? createDomActionExecutor(extensionWs)
          : async () => ({ success: false, result: "No browser extension connected. Install the Genie Chrome extension for browser automation." });

        const sshSession = await connectSsh(vpsInst.connection, { timeoutMs: 30_000 });
        const mcpTunnel = await setupMcpTunnel(sshSession, domExecutor, { remotePort: MCP_BROWSER_REMOTE_PORT });

        // Set up tracker tunnel
        let trackerTunnel: McpTrackerTunnel | undefined;
        try {
          trackerTunnel = await setupMcpTrackerTunnel(sshSession, project.id, { remotePort: MCP_TRACKER_REMOTE_PORT, onIssueUpdated: () => { broadcastTrackerList().catch(() => {}); } });
        } catch (trackerErr: unknown) {
          console.error(`[mcp-tunnel] Tracker tunnel failed for ${project.name}: ${(trackerErr instanceof Error ? trackerErr.message : String(trackerErr))}`);
        }

        // Set up security tunnel
        let securityTunnel: McpSecurityTunnel | undefined;
        try {
          securityTunnel = await setupMcpSecurityTunnel(sshSession, { remotePort: MCP_SECURITY_REMOTE_PORT });
        } catch (secErr: unknown) {
          console.error(`[mcp-tunnel] Security tunnel failed for ${project.name}: ${(secErr instanceof Error ? secErr.message : String(secErr))}`);
        }

        // Set up notify tunnel
        let notifyTunnel: McpNotifyTunnel | undefined;
        try {
          notifyTunnel = await setupMcpNotifyTunnel(sshSession, (memberIds, conversationId, message) => {
            broadcastToUsers(memberIds, { type: "chat:message:new", payload: { conversationId, message } });
          }, { remotePort: MCP_NOTIFY_REMOTE_PORT });
        } catch (notifyErr: unknown) {
          console.error(`[mcp-tunnel] Notify tunnel failed for ${project.name}: ${(notifyErr instanceof Error ? notifyErr.message : String(notifyErr))}`);
        }

        // Set up storage tunnel
        let storageTunnel: McpStorageTunnel | undefined;
        try {
          storageTunnel = await setupMcpStorageTunnel(sshSession, project.name, { remotePort: MCP_STORAGE_REMOTE_PORT });
        } catch (storageErr: unknown) {
          console.error(`[mcp-tunnel] Storage tunnel failed for ${project.name}: ${(storageErr instanceof Error ? storageErr.message : String(storageErr))}`);
        }

        persistentMcpTunnels.set(key, { sshSession, mcpTunnel, trackerTunnel, securityTunnel, notifyTunnel, storageTunnel, projectName: project.name, instanceHost: host });

        // Merge MCP servers into .mcp.json on the VPS
        const dest = remoteDir(project.name);
        const mergeScript = [
          `existing=$(cat ${dest}/.mcp.json 2>/dev/null || echo '{"mcpServers":{}}')`,
          `echo "$existing" | node -e "`,
          `  const fs = require('fs');`,
          `  let input = '';`,
          `  process.stdin.on('data', d => input += d);`,
          `  process.stdin.on('end', () => {`,
          `    const cfg = JSON.parse(input);`,
          `    if (!cfg.mcpServers) cfg.mcpServers = {};`,
          `    cfg.mcpServers['genie-browser'] = { type: 'http', url: 'http://127.0.0.1:${MCP_BROWSER_REMOTE_PORT}/mcp' };`,
          ...(trackerTunnel ? [
          `    cfg.mcpServers['genie-tracker'] = { type: 'http', url: 'http://127.0.0.1:${MCP_TRACKER_REMOTE_PORT}/mcp' };`,
          ] : []),
          ...(securityTunnel ? [
          `    cfg.mcpServers['genie-security'] = { type: 'http', url: 'http://127.0.0.1:${MCP_SECURITY_REMOTE_PORT}/mcp' };`,
          ] : []),
          ...(notifyTunnel ? [
          `    cfg.mcpServers['genie-notify'] = { type: 'http', url: 'http://127.0.0.1:${MCP_NOTIFY_REMOTE_PORT}/mcp' };`,
          ] : []),
          ...(storageTunnel ? [
          `    cfg.mcpServers['genie-storage'] = { type: 'http', url: 'http://127.0.0.1:${MCP_STORAGE_REMOTE_PORT}/mcp' };`,
          ] : []),
          `    fs.writeFileSync('${dest}/.mcp.json', JSON.stringify(cfg, null, 2));`,
          `  });`,
          `"`,
        ].join("\n");
        await sshSession.exec(mergeScript);

        console.log(`[mcp-tunnel] Web UI tunnel ready for user ${userId} → ${host}:${MCP_BROWSER_REMOTE_PORT} (${project.name})`);
        send(ws, { type: "mcp:tunnel:result", payload: { projectId, instanceId, ok: true } });
      } catch (err: unknown) {
        console.error(`[mcp-tunnel] Web UI tunnel failed for ${host}: ${(err instanceof Error ? err.message : String(err))}`);
        send(ws, { type: "mcp:tunnel:result", payload: { projectId, instanceId, ok: false, error: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "vps:recipe:check": {
      const { projectId, instanceId, recipeId, script } = msg.payload as {
        projectId: string; instanceId: string; recipeId: string; script: string;
      };
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "vps:recipe:check:result", payload: { projectId, instanceId, recipeId, installed: false } });
        break;
      }
      try {
        const session = await connectSsh(vpsInst.connection);
        try {
          const output = await session.exec(`cat << 'GENIE_RECIPE_EOF' | bash 2>&1\n${script}\nGENIE_RECIPE_EOF`, undefined, { timeoutMs: 15_000 });
          const lastLine = output.trim().split("\n").pop()?.trim();
          const installed = lastLine === "INSTALLED";
          send(ws, { type: "vps:recipe:check:result", payload: { projectId, instanceId, recipeId, installed } });
        } finally {
          session.close();
        }
      } catch {
        send(ws, { type: "vps:recipe:check:result", payload: { projectId, instanceId, recipeId, installed: false } });
      }
      break;
    }

    case "vps:exec": {
      const { projectId, instanceId, command, execId } = msg.payload as {
        projectId: string; instanceId: string; command: string; execId: string;
      };
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "vps:exec:result", payload: { execId, output: "No VPS deployment found", error: true } });
        break;
      }
      try {
        const session = await connectSsh(vpsInst.connection);
        try {
          const output = await session.exec(`${command} 2>&1`, undefined, { timeoutMs: 30_000 });
          send(ws, { type: "vps:exec:result", payload: { execId, output } });
        } finally {
          session.close();
        }
      } catch (err: unknown) {
        send(ws, { type: "vps:exec:result", payload: { execId, output: (err instanceof Error ? err.message : String(err)), error: true } });
      }
      break;
    }

    case "vps:recipe:uninstall": {
      const { projectId, instanceId, recipeId, script } = msg.payload as {
        projectId: string; instanceId: string; recipeId: string; script: string;
      };
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "vps:recipe:error", payload: { projectId, instanceId, recipeId, message: "No VPS deployment" } });
        break;
      }
      try {
        const session = await connectSsh(vpsInst.connection);
        try {
          await session.exec(`cat << 'GENIE_RECIPE_EOF' | bash 2>&1\n${script}\nGENIE_RECIPE_EOF`, (chunk) => {
            const line = chunk.trimEnd();
            if (line) send(ws, { type: "vps:recipe:progress", payload: { projectId, instanceId, recipeId, message: line } });
          }, { timeoutMs: 300_000, idleTimeoutMs: 60_000 });
        } finally {
          session.close();
        }
        send(ws, { type: "vps:recipe:uninstall:done", payload: { projectId, instanceId, recipeId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:recipe:error", payload: { projectId, instanceId, recipeId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "vps:recipe:run": {
      const { projectId, instanceId, recipeId, script } = msg.payload as {
        projectId: string; instanceId: string; recipeId: string; script: string;
      };
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "vps:recipe:error", payload: { projectId, instanceId, recipeId, message: "No VPS deployment" } });
        break;
      }
      try {
        const session = await connectSsh(vpsInst.connection);
        try {
          await session.exec(`cat << 'GENIE_RECIPE_EOF' | bash 2>&1\n${script}\nGENIE_RECIPE_EOF`, (chunk) => {
            const line = chunk.trimEnd();
            if (line) send(ws, { type: "vps:recipe:progress", payload: { projectId, instanceId, recipeId, message: line } });
          }, { timeoutMs: 600_000, idleTimeoutMs: 120_000 });
        } finally {
          session.close();
        }
        send(ws, { type: "vps:recipe:done", payload: { projectId, instanceId, recipeId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:recipe:error", payload: { projectId, instanceId, recipeId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "vps:logs": {
      const { projectId, instanceId, serviceName, tail } = msg.payload;
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "error", payload: { message: "No VPS deployment for this project/instance" } });
        break;
      }
      try {
        const logs = await vpsLogs(project!.name, vpsInst.connection, serviceName, tail);
        send(ws, { type: "vps:logs:data", payload: { projectId, instanceId, serviceName, logs } });
      } catch (err: unknown) {
        send(ws, { type: "error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "vps:teardown": {
      const { projectId, instanceId } = msg.payload;
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "error", payload: { message: "No VPS deployment for this project/instance" } });
        break;
      }
      try {
        // Try SSH cleanup, but don't fail the whole teardown if unreachable
        try {
          await vpsTeardown(project!.name, vpsInst.connection, (step) => {
            send(ws, { type: "vps:teardown:progress", payload: { projectId, instanceId, message: step } });
          });
        } catch (sshErr: unknown) {
          send(ws, { type: "vps:teardown:progress", payload: { projectId, instanceId, message: `SSH cleanup skipped: ${sshErr instanceof Error ? sshErr.message : String(sshErr)}` } });
        }
        if (vpsInst.digitalocean) {
          const doToken = await settingsService.getGlobalDoToken();
          if (doToken) {
            await doDestroyDroplet(doToken, vpsInst.digitalocean.dropletId, (step) => {
              send(ws, { type: "vps:teardown:progress", payload: { projectId, instanceId, message: step } });
            });
          }
        }
        await projectService.removeVpsInstance(projectId, instanceId);
        await broadcastProjectList();
        send(ws, { type: "vps:teardown:done", payload: { projectId, instanceId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:teardown:error", payload: { projectId, instanceId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "vps:hibernate": {
      const { projectId, instanceId } = msg.payload;
      const hProject = await projectService.getById(projectId);
      const hInst = hProject?.vpsInstances.find(v => v.id === instanceId);
      if (!hInst?.digitalocean) {
        send(ws, { type: "vps:hibernate:error", payload: { projectId, instanceId, message: "No DigitalOcean droplet to hibernate" } });
        break;
      }
      const hToken = await settingsService.resolveDoToken(projectId);
      if (!hToken) {
        send(ws, { type: "vps:hibernate:error", payload: { projectId, instanceId, message: "No DO token configured" } });
        break;
      }
      void (async () => {
        const progress = (msg: string) => send(ws, { type: "vps:hibernate:progress", payload: { projectId, instanceId, message: msg } });
        try {
          const client = createDoClient(hToken);
          const dropletId = hInst.digitalocean!.dropletId;
          const snapshotName = `genie-hibernate-${hInst.label}-${Date.now()}`;

          progress("Creating snapshot (this may take several minutes)...");
          const action = await client.snapshotDroplet(dropletId, snapshotName);

          // Poll until snapshot completes (up to 15 minutes)
          const maxWait = 15 * 60 * 1000;
          const pollInterval = 10_000;
          const start = Date.now();
          let completed = false;
          while (Date.now() - start < maxWait) {
            await new Promise(r => setTimeout(r, pollInterval));
            const status = await client.getAction(action.id);
            const elapsed = Math.round((Date.now() - start) / 1000);
            progress(`Snapshot in progress... (${elapsed}s)`);
            if (status.status === "completed") { completed = true; break; }
            if (status.status === "errored") throw new Error("Snapshot failed at DigitalOcean");
          }
          if (!completed) throw new Error("Snapshot timed out after 15 minutes");

          // Find the snapshot ID
          const snapshots = await client.listDropletSnapshots(dropletId);
          const snap = snapshots.find(s => s.name === snapshotName);
          if (!snap) throw new Error("Snapshot created but not found in droplet snapshots");

          progress("Snapshot complete. Destroying droplet...");
          await client.deleteDroplet(dropletId);

          // Update VPS instance with hibernate info
          await projectService.updateVpsInstance(projectId, instanceId, {
            digitalocean: undefined,
            services: [],
            connection: { ...hInst.connection, host: "" },
            hibernate: {
              snapshotId: snap.id,
              snapshotName,
              region: hInst.digitalocean!.region,
              size: hInst.digitalocean!.size,
              hibernatedAt: new Date().toISOString(),
            },
          });

          await broadcastProjectList();
          progress("Droplet destroyed. Instance hibernated.");
          send(ws, { type: "vps:hibernate:done", payload: { projectId, instanceId } });
        } catch (err: unknown) {
          send(ws, { type: "vps:hibernate:error", payload: { projectId, instanceId, message: (err instanceof Error ? err.message : String(err)) } });
        }
      })();
      break;
    }

    case "vps:wake": {
      const { projectId, instanceId } = msg.payload;
      const wProject = await projectService.getById(projectId);
      const wInst = wProject?.vpsInstances.find(v => v.id === instanceId);
      if (!wInst?.hibernate) {
        send(ws, { type: "vps:wake:error", payload: { projectId, instanceId, message: "Instance is not hibernated" } });
        break;
      }
      const wToken = await settingsService.resolveDoToken(projectId);
      if (!wToken) {
        send(ws, { type: "vps:wake:error", payload: { projectId, instanceId, message: "No DO token configured" } });
        break;
      }
      void (async () => {
        const progress = (msg: string) => send(ws, { type: "vps:wake:progress", payload: { projectId, instanceId, message: msg } });
        try {
          const client = createDoClient(wToken);
          const hib = wInst.hibernate!;

          // Ensure SSH key is registered
          progress("Preparing SSH keys...");
          const keyPair = await ensureGenieKeyPair();
          const fingerprint = sshKeyFingerprint(keyPair.publicKey);
          const existingKeys = await client.listSshKeys();
          let sshKeyId = existingKeys.find(k => k.fingerprint === fingerprint)?.id;
          if (!sshKeyId) {
            const newKey = await client.createSshKey(`genie-${Date.now()}`, keyPair.publicKey);
            sshKeyId = newKey.id;
          }

          // Create droplet from snapshot
          const dropletName = `genie-${wInst.label}-${Date.now()}`;
          progress(`Creating droplet from snapshot in ${hib.region} (${hib.size})...`);
          const droplet = await client.createDroplet({
            name: dropletName,
            region: hib.region,
            size: hib.size,
            image: hib.snapshotId,
            sshKeyIds: [sshKeyId],
            tags: ["genie"],
          });

          // Wait for active + IP
          const maxWait = 180_000;
          const start = Date.now();
          let ip: string | null = null;
          while (Date.now() - start < maxWait) {
            await new Promise(r => setTimeout(r, 5000));
            const d = await client.getDroplet(droplet.id);
            const elapsed = Math.round((Date.now() - start) / 1000);
            if (d.status === "active") {
              const v4 = d.networks?.v4 || [];
              const pub = v4.find(n => n.type === "public");
              if (pub?.ip_address) { ip = pub.ip_address; break; }
            }
            progress(`Waiting for droplet... (${elapsed}s)`);
          }
          if (!ip) throw new Error("Droplet did not become active within 3 minutes");

          progress(`Droplet active at ${ip}. Waiting for SSH...`);

          // Wait for SSH
          const connConfig: VpsConnectionConfig = {
            host: ip,
            port: 22,
            username: VPS_SSH_USERNAME,
            privateKeyPath: path.join(os.homedir(), ".genie", "ssh", "genie_ed25519"),
          };
          const sshStart = Date.now();
          const sshTimeout = 120_000;
          let sshReady = false;
          while (Date.now() - sshStart < sshTimeout) {
            try {
              const session = await connectSsh(connConfig);
              await session.exec("echo ok");
              session.close();
              sshReady = true;
              break;
            } catch {
              await new Promise(r => setTimeout(r, 5000));
            }
          }
          if (!sshReady) throw new Error("SSH did not become available within 2 minutes");

          // Re-apply firewall
          progress("Configuring firewall...");
          try {
            const fwSession = await connectSsh({ ...connConfig, username: "root" });
            await fwSession.exec(buildUfwRules(process.env.MANAGER_PUBLIC_IP, process.env.MANAGER_PUBLIC_IP_DEV, process.env.MANAGER_PUBLIC_IP_V6, process.env.MANAGER_PUBLIC_IP_V6_DEV).join(" && "));
            fwSession.close();
          } catch (fwErr: unknown) {
            progress(`Warning: Firewall config failed: ${fwErr instanceof Error ? fwErr.message : String(fwErr)}`);
          }

          // Restart docker containers
          progress("Starting Docker containers...");
          try {
            const dkSession = await connectSsh(connConfig);
            await dkSession.exec(`cd /opt/project && docker compose up -d 2>&1 || true`);
            dkSession.close();
          } catch {
            progress("Warning: Could not restart Docker containers");
          }

          // Delete snapshot to save storage costs
          progress("Cleaning up snapshot...");
          try {
            await client.deleteSnapshot(hib.snapshotId);
          } catch {
            progress("Warning: Could not delete snapshot — clean up manually");
          }

          // Update instance
          await projectService.updateVpsInstance(projectId, instanceId, {
            connection: connConfig,
            digitalocean: {
              dropletId: droplet.id,
              ipAddress: ip,
              region: hib.region,
              size: hib.size,
            },
            hibernate: undefined,
          });

          await broadcastProjectList();
          progress(`Instance woken up at ${ip}`);
          send(ws, { type: "vps:wake:done", payload: { projectId, instanceId } });
        } catch (err: unknown) {
          send(ws, { type: "vps:wake:error", payload: { projectId, instanceId, message: (err instanceof Error ? err.message : String(err)) } });
        }
      })();
      break;
    }

    case "vps:disconnect": {
      const { projectId, instanceId } = msg.payload;
      await projectService.removeVpsInstance(projectId, instanceId);
      await broadcastProjectList();
      break;
    }

    // --- Tracker handlers ---

    case "tracker:list": {
      try {
        await sendTrackerList(ws);
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "feedback:submit": {
      try {
        const { title, description } = msg.payload as { title: string; description: string };
        if (!title?.trim()) { send(ws, { type: "feedback:error", payload: { message: "Title is required" } }); break; }

        // Find or use first project for feedback tickets
        const allProjects = await projectService.getAll();
        if (allProjects.length === 0) { send(ws, { type: "feedback:error", payload: { message: "No projects available" } }); break; }
        const feedbackProject = allProjects[0];

        // Create tracker issue
        const userName = state.user?.name || "Unknown";
        const userEmail = state.user?.email || "";
        const issueTitle = `[Feedback] ${title.trim()}`;
        const issueDesc = `${description?.trim() || ""}\n\n---\nSubmitted by: ${userName} (${userEmail})`;
        await trackerService.createIssue(userId, {
          projectId: feedbackProject.id,
          title: issueTitle,
          description: issueDesc,
          status: "todo",
          priority: "medium",
        });
        await broadcastTrackerList();

        // Send email notification
        try {
          const sgApiKey = process.env.SENDGRID_API_KEY;
          if (sgApiKey) {
            const sgMail = (await import("@sendgrid/mail")).default;
            sgMail.setApiKey(sgApiKey);
            await sgMail.send({
              to: "paul.brie@teleporthq.io",
              from: process.env.BACKUP_EMAIL || "noreply@teleporthq.io",
              subject: `[Genie Feedback] ${title.trim()}`,
              text: `New feedback from ${userName} (${userEmail}):\n\nTitle: ${title.trim()}\n\n${description?.trim() || "(no description)"}`,
            });
          }
        } catch (emailErr) {
          console.error("Failed to send feedback email:", emailErr);
        }

        send(ws, { type: "feedback:submitted", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "feedback:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "tracker:issue:create": {
      try {
        const issue = await trackerService.createIssue(userId, msg.payload as { projectId: string; title: string; description?: string; status?: string; priority?: string; assigneeId?: string | null; labelIds?: string[] });
        send(ws, { type: "tracker:issue:created", payload: issue as Record<string, unknown> });
        await broadcastTrackerList();
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "tracker:issue:update": {
      try {
        const { issueId, ...fields } = msg.payload;
        const issue = await trackerService.updateIssue(userId, issueId, fields);
        if (!issue) {
          send(ws, { type: "tracker:error", payload: { message: "Issue not found" } });
        } else {
          broadcast({ type: "tracker:issue:updated", payload: issue });
          await broadcastTrackerList();
        }
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "tracker:issue:delete": {
      try {
        const { issueId } = msg.payload;
        const deleted = await trackerService.deleteIssue(userId, issueId);
        if (!deleted) {
          send(ws, { type: "tracker:error", payload: { message: "Issue not found" } });
        } else {
          broadcast({ type: "tracker:issue:deleted", payload: { issueId } });
          await broadcastTrackerList();
        }
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "tracker:issue:reorder": {
      try {
        const { issueId, sortOrder } = msg.payload;
        await trackerService.reorderIssue(issueId, sortOrder);
        await broadcastTrackerList();
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "tracker:label:create": {
      try {
        const { name, color } = msg.payload;
        await trackerService.createLabel(userId, name, color);
        await broadcastTrackerList();
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "tracker:label:update": {
      try {
        const { labelId, ...fields } = msg.payload;
        await trackerService.updateLabel(userId, labelId, fields);
        await broadcastTrackerList();
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "tracker:label:delete": {
      try {
        const { labelId } = msg.payload;
        await trackerService.deleteLabel(userId, labelId);
        await broadcastTrackerList();
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "tracker:comments:list": {
      try {
        const { issueId } = msg.payload;
        const comments = await trackerService.listComments(issueId);
        send(ws, { type: "tracker:comments:list", payload: { issueId, comments } });
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "tracker:comment:create": {
      try {
        const { issueId, content } = msg.payload;
        const userRow = await getDb()
          .select({ name: users.name, avatarUrl: users.avatarUrl })
          .from(users)
          .where(eq(users.id, userId))
          .then((r) => r[0]);
        const comment = await trackerService.createComment({
          issueId,
          userId,
          authorName: userRow?.name || "Unknown",
          authorAvatar: userRow?.avatarUrl || undefined,
          content,
        });
        broadcast({ type: "tracker:comment:created", payload: { issueId, comment } });
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "tracker:comment:delete": {
      try {
        const { commentId, issueId } = msg.payload;
        await trackerService.deleteComment(commentId);
        broadcast({ type: "tracker:comment:deleted", payload: { commentId, issueId } });
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    // --- Admin ---

    case "admin:railway:test": {
      try {
        const result = await railwayService.testConnection();
        send(ws, { type: "admin:railway:test", payload: result });
      } catch (err: unknown) {
        send(ws, { type: "admin:railway:test", payload: { ok: false, message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:prodlogs:deployments": {
      try {
        const deployments = await railwayService.getDeployments(msg.payload.limit ?? 20);
        send(ws, { type: "admin:prodlogs:deployments", payload: { deployments } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:prodlogs:logs": {
      try {
        const { deploymentId, logType, limit } = msg.payload;
        const logs = logType === "build"
          ? await railwayService.getBuildLogs(deploymentId, limit ?? 500)
          : await railwayService.getDeploymentLogs(deploymentId, limit ?? 500);
        send(ws, { type: "admin:prodlogs:logs", payload: { deploymentId, logType, logs } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:audit:list": {
      try {
        const { userId, action, from, to, limit, offset } = msg.payload;
        const logs = await auditService.getAuditLogs({
          userId,
          action,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
          limit,
          offset,
        });
        send(ws, { type: "admin:audit:list", payload: { logs } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:tables": {
      try {
        const tables = await adminService.listTables();
        send(ws, { type: "admin:tables", payload: { tables } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:table:columns": {
      try {
        const { tableName } = msg.payload;
        const columns = await adminService.getTableColumns(tableName);
        const primaryKey = await adminService.getPrimaryKey(tableName);
        send(ws, { type: "admin:table:columns", payload: { tableName, columns, primaryKey } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:table:rows": {
      try {
        const { tableName, page, pageSize, orderBy, orderDir } = msg.payload;
        const result = await adminService.getTableRows(tableName, { page, pageSize, orderBy, orderDir });
        send(ws, { type: "admin:table:rows", payload: result });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:row:get": {
      try {
        const { tableName, pkCol, pkVal } = msg.payload;
        const row = await adminService.getRow(tableName, pkCol, pkVal);
        send(ws, { type: "admin:row:get", payload: { row } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:row:insert": {
      try {
        const { tableName, data } = msg.payload;
        const row = await adminService.insertRow(tableName, data);
        send(ws, { type: "admin:row:inserted", payload: { tableName, row } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:row:update": {
      try {
        const { tableName, pkCol, pkVal, data } = msg.payload;
        const row = await adminService.updateRow(tableName, pkCol, pkVal, data);
        send(ws, { type: "admin:row:updated", payload: { tableName, row } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:row:delete": {
      try {
        const { tableName, pkCol, pkVal } = msg.payload;
        const row = await adminService.deleteRow(tableName, pkCol, pkVal);
        send(ws, { type: "admin:row:deleted", payload: { tableName, row } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:sql:execute": {
      try {
        const { query } = msg.payload;
        const result = await adminService.executeRawSql(query);
        send(ws, { type: "admin:sql:result", payload: result });
      } catch (err: unknown) {
        send(ws, { type: "admin:sql:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:drizzle:push": {
      try {
        // Backup DB before push
        send(ws, { type: "admin:drizzle:push:output", payload: { data: "Creating database backup...\n" } });
        try {
          const backupPath = await backupService.createBackup();
          send(ws, { type: "admin:drizzle:push:output", payload: { data: `Backup saved: ${backupPath}\n\n` } });
        } catch (backupErr: unknown) {
          send(ws, { type: "admin:drizzle:push:output", payload: { data: `Backup warning: ${(backupErr instanceof Error ? backupErr.message : String(backupErr))}\n\n` } });
        }

        const dir = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
        const cwd = path.resolve(dir, "..");
        const child = spawn("npx", ["drizzle-kit", "push", "--force"], {
          cwd,
          shell: true,
          env: { ...process.env },
        });
        const sendChunk = (data: string) => {
          send(ws, { type: "admin:drizzle:push:output", payload: { data } });
        };
        child.stdout?.on("data", (buf: Buffer) => sendChunk(buf.toString()));
        child.stderr?.on("data", (buf: Buffer) => sendChunk(buf.toString()));
        child.on("close", (code) => {
          sendChunk(`\nProcess exited with code ${code}\n`);
          send(ws, { type: "admin:drizzle:push:done", payload: { code } });
        });
        child.on("error", (err) => {
          sendChunk(`\nError: ${(err instanceof Error ? err.message : String(err))}\n`);
          send(ws, { type: "admin:drizzle:push:done", payload: { code: 1 } });
        });
      } catch (err: unknown) {
        send(ws, { type: "admin:drizzle:push:output", payload: { data: `Error: ${(err instanceof Error ? err.message : String(err))}\n` } });
        send(ws, { type: "admin:drizzle:push:done", payload: { code: 1 } });
      }
      break;
    }

    case "admin:backups:list": {
      try {
        const files = backupService.listBackups();
        send(ws, { type: "admin:backups:list", payload: { files } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:backups:create": {
      try {
        await backupService.createBackup();
        const files = backupService.listBackups();
        send(ws, { type: "admin:backups:created", payload: { files } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:backups:delete": {
      try {
        backupService.deleteBackup(msg.payload.name);
        const files = backupService.listBackups();
        send(ws, { type: "admin:backups:deleted", payload: { files } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:tazcloud:list": {
      const tazToken = process.env.TAZCLOUD_API_TOKEN;
      if (!tazToken) {
        send(ws, { type: "admin:tazcloud:list", payload: { vms: [], error: "TAZCLOUD_API_TOKEN not configured on the manager." } });
        break;
      }
      try {
        const tazClient = createTazClient(tazToken);
        const vms = await tazClient.listVms();
        // Overlay Genie-side aliases — preferred over the cloud-returned name so the
        // rename UX feels consistent even though the TazCloud API can't rename in-place.
        const aliasMap = await cloudVmAliases.getAliasMap("tazcloud", vms.map((v) => v.id));
        const decoratedVms = vms.map((v) => aliasMap.has(v.id) ? { ...v, name: aliasMap.get(v.id)! } : v);
        // Map VM id → project for inline labeling (mirrors DO handler).
        const projects = await projectService.getAll();
        const projectMap: Record<string, { projectId: string; projectName: string }> = {};
        for (const p of projects) {
          for (const v of p.vpsInstances) {
            if (v.tazcloud?.vmId) {
              projectMap[v.tazcloud.vmId] = { projectId: p.id, projectName: p.name };
            }
          }
        }
        send(ws, { type: "admin:tazcloud:list", payload: { vms: decoratedVms, projectMap } });
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:list", payload: { vms: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:tazcloud:stats": {
      // SSH-probe every ACTIVE TazCloud VM for runtime port info, regardless of
      // project linkage. Mirrors admin:droplets:stats but uses the project-
      // independent credential path from admin:tazcloud:exec.
      try {
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        const tazPrivateKey = process.env.TAZCLOUD_SSH_PRIVATE_KEY;
        if (!tazToken || !tazPrivateKey) {
          send(ws, { type: "admin:tazcloud:stats", payload: { stats: {} } });
          break;
        }
        const tazClient = createTazClient(tazToken);
        const vms = await tazClient.listVms();
        const keyPath = ensureTazcloudKeyOnDisk(tazPrivateKey);
        const projects = await projectService.getAll();
        const linked = new Set<string>();
        for (const p of projects) {
          for (const v of p.vpsInstances) {
            if (v.tazcloud?.vmId) linked.add(v.tazcloud.vmId);
          }
        }
        const results: Record<string, unknown> = {};
        await Promise.allSettled(
          vms
            .filter((vm) => vm.status === "ACTIVE" && vm.ssh_host)
            .map(async (vm) => {
              try {
                const username = linked.has(vm.id) ? VPS_SSH_USERNAME : sshUserForImage(vm.image || "ubuntu-22");
                const stats = await vpsStats({ host: vm.ssh_host, port: 22, username, privateKeyPath: keyPath });
                results[vm.id] = stats;
              } catch { /* skip unreachable VM */ }
            }),
        );
        send(ws, { type: "admin:tazcloud:stats", payload: { stats: results } });
      } catch {
        send(ws, { type: "admin:tazcloud:stats", payload: { stats: {} } });
      }
      break;
    }

    // --- Recipes CRUD ---

    case "recipes:list": {
      try {
        const rows = await recipesService.listRecipes();
        send(ws, { type: "recipes:list", payload: { recipes: rows } });
      } catch (err: unknown) {
        send(ws, { type: "recipes:list", payload: { recipes: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "recipes:create": {
      try {
        const row = await recipesService.createRecipe(msg.payload as recipesService.RecipeInput, userId);
        send(ws, { type: "recipes:upserted", payload: { recipe: row } });
        broadcast({ type: "recipes:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "recipes:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "recipes:update": {
      try {
        const { id, ...rest } = msg.payload;
        const row = await recipesService.updateRecipe(id, rest);
        if (!row) throw new Error("Recipe not found");
        send(ws, { type: "recipes:upserted", payload: { recipe: row } });
        broadcast({ type: "recipes:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "recipes:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "recipes:delete": {
      try {
        const { id } = msg.payload;
        await recipesService.deleteRecipe(id);
        send(ws, { type: "recipes:deleted", payload: { id } });
        broadcast({ type: "recipes:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "recipes:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:tazcloud:exec": {
      // Run an arbitrary SSH command on a TazCloud VM. Renderer passes `host` so we
      // don't hit the TazCloud API on every command — previously every recipe check
      // (5+ per panel open) triggered a getVm() call, which is wasteful and dies when
      // the upstream API is flaky.
      const { vmId, sshUser, host: hostFromClient, command, execId } = msg.payload as {
        vmId: string; sshUser: string; host?: string; command: string; execId: string;
      };
      try {
        const tazPrivateKey = process.env.TAZCLOUD_SSH_PRIVATE_KEY;
        if (!tazPrivateKey) throw new Error("TAZCLOUD_SSH_PRIVATE_KEY not configured on the manager");
        let host = hostFromClient;
        if (!host) {
          // Fallback: ask the API (used only when the renderer doesn't know the host yet).
          const tazToken = process.env.TAZCLOUD_API_TOKEN;
          if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured on the manager");
          const tazClient = createTazClient(tazToken);
          const vm = await tazClient.getVm(vmId);
          host = vm?.ssh_host;
          if (!host) throw new Error(`VM ${vmId} has no ssh_host`);
        }
        const keyPath = ensureTazcloudKeyOnDisk(tazPrivateKey);
        const session = await connectSsh({
          host,
          port: 22,
          username: sshUser || "ubuntu",
          privateKeyPath: keyPath,
        });
        try {
          // Generous timeouts — recipe installs (apt + downloads) can take several
          // minutes. idleTimeoutMs is bumped to 10 minutes since recipe scripts
          // often redirect apt output to /dev/null and may go silent for a while.
          const output = await session.exec(`${command} 2>&1`, (chunk) => {
            send(ws, { type: "admin:tazcloud:exec:progress", payload: { execId, chunk } });
          }, { timeoutMs: 900_000, idleTimeoutMs: 600_000 });
          send(ws, { type: "admin:tazcloud:exec:result", payload: { execId, output } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:exec:result", payload: { execId, output: (err instanceof Error ? err.message : String(err)), error: true } });
      }
      break;
    }

    case "admin:droplets:rename": {
      try {
        const { dropletId, name } = msg.payload as { dropletId: number; name: string };
        if (!name || typeof name !== "string") throw new Error("name is required");
        // Genie DB is the source of truth for the display name. Best-effort propagate to DO
        // so the cloud console agrees; never fail the rename when the provider call errors.
        await cloudVmAliases.setAlias("digitalocean", String(dropletId), name);
        try {
          const doToken = await settingsService.getGlobalDoToken();
          if (doToken) {
            const doClient = createDoClient(doToken);
            await doClient.renameDroplet(dropletId, name);
          }
        } catch (apiErr) {
          console.warn(`[droplets:rename] DO API rename failed for ${dropletId} (alias still saved):`, apiErr instanceof Error ? apiErr.message : apiErr);
        }
        send(ws, { type: "admin:droplets:renamed", payload: { dropletId, name } });
        // Refresh list so the UI picks up the new name.
        broadcast({ type: "admin:droplets:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:tazcloud:rename": {
      try {
        const { vmId, name } = msg.payload as { vmId: string; name: string };
        if (!vmId || typeof vmId !== "string") throw new Error("vmId is required");
        if (!name || typeof name !== "string") throw new Error("name is required");
        // TazCloud API doesn't support renaming, so this is Genie-DB only.
        await cloudVmAliases.setAlias("tazcloud", vmId, name);
        send(ws, { type: "admin:tazcloud:renamed", payload: { vmId, name } });
        broadcast({ type: "admin:tazcloud:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:droplets:exec": {
      // Run an arbitrary SSH command on a DO droplet by ID (admin/superadmin scope).
      // Parallels admin:tazcloud:exec for the unified Clouds panel.
      const { dropletId, command, execId } = msg.payload as {
        dropletId: number; command: string; execId: string;
      };
      try {
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const doClient = createDoClient(doToken);
        const droplet = await doClient.getDroplet(dropletId);
        const pub = droplet.networks?.v4?.find((n) => n.type === "public");
        if (!pub?.ip_address) throw new Error(`Droplet ${dropletId} has no public IPv4`);
        const keyPath = await ensureGenieKeyOnDisk();
        const session = await connectSsh({
          host: pub.ip_address,
          port: 22,
          username: VPS_SSH_USERNAME,
          privateKeyPath: keyPath,
        });
        try {
          const output = await session.exec(`${command} 2>&1`, (chunk) => {
            send(ws, { type: "admin:droplets:exec:progress", payload: { execId, chunk } });
          }, { timeoutMs: 900_000, idleTimeoutMs: 600_000 });
          send(ws, { type: "admin:droplets:exec:result", payload: { execId, output } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:exec:result", payload: { execId, output: (err instanceof Error ? err.message : String(err)), error: true } });
      }
      break;
    }

    case "admin:tazcloud:create": {
      try {
        const { name, image, size } = msg.payload;
        if (!name || typeof name !== "string") throw new Error("name is required");
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        const tazPrivateKey = process.env.TAZCLOUD_SSH_PRIVATE_KEY;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        const tazClient = createTazClient(tazToken);
        const vm = await tazClient.createVm({ name, image, size });
        send(ws, { type: "admin:tazcloud:created", payload: { vm } });

        // Async firewall preset: wait for SSH, then apply default-deny + allow 22/3000.
        // Fire-and-forget so the UI can show the VM immediately; the firewall card
        // will reflect the new rules on next refresh.
        if (tazPrivateKey && vm.ssh_host) {
          void (async () => {
            const keyPath = ensureTazcloudKeyOnDisk(tazPrivateKey);
            const sshUser = sshUserForImage(image || "ubuntu-22");
            const conn = { host: vm.ssh_host, port: 22, username: sshUser, privateKeyPath: keyPath };
            // Poll SSH up to 3 minutes.
            const sshStart = Date.now();
            let ready = false;
            while (Date.now() - sshStart < 180_000) {
              try {
                const s = await connectSsh(conn, { timeoutMs: 10_000 });
                await s.exec("true");
                s.close();
                ready = true;
                break;
              } catch { /* not yet */ }
              await new Promise((r) => setTimeout(r, 5_000));
            }
            if (!ready) {
              console.warn(`[tazcloud] firewall preset: SSH didn't come up for ${vm.id} (${vm.ssh_host}) within 3min — skipping`);
              return;
            }
            try {
              const ufwSession = await connectSsh(conn);
              await ufwSession.exec([
                "sudo ufw --force reset",
                "sudo ufw default deny incoming",
                "sudo ufw default allow outgoing",
                "sudo ufw allow 22/tcp",
                "sudo ufw allow 3000/tcp",
                "sudo ufw --force enable",
              ].join(" && "));
              ufwSession.close();
              console.log(`[tazcloud] firewall preset applied to ${vm.id} (${vm.ssh_host}): SSH + 3000 open`);
            } catch (err) {
              console.warn(`[tazcloud] firewall preset failed for ${vm.id}:`, err);
            }
          })().catch(() => {});
        }
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:create:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:tazcloud:delete": {
      try {
        const { vmId } = msg.payload;
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        const tazClient = createTazClient(tazToken);
        await tazClient.deleteVm(vmId);
        await cloudVmAliases.clearAlias("tazcloud", vmId);
        // Detach from any owning project.
        const projects = await projectService.getAll();
        for (const p of projects) {
          const inst = p.vpsInstances.find(v => v.tazcloud?.vmId === vmId);
          if (inst) {
            await projectService.removeVpsInstance(p.id, inst.id);
            await broadcastProjectList();
            break;
          }
        }
        send(ws, { type: "admin:tazcloud:deleted", payload: { vmId } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:droplets:list": {
      const doToken = await settingsService.getGlobalDoToken();
      if (!doToken) {
        send(ws, { type: "admin:droplets:list", payload: { droplets: [], error: "DigitalOcean API token not configured. Configure it in Settings." } });
        break;
      }
      try {
        const doClient = createDoClient(doToken);
        const droplets = await doClient.listDroplets("genie");
        // Overlay Genie-side aliases — prefer them so DO and Taz share one unified rename source.
        const aliasMap = await cloudVmAliases.getAliasMap("digitalocean", droplets.map((d) => String(d.id)));
        const decoratedDroplets = droplets.map((d) => {
          const alias = aliasMap.get(String(d.id));
          return alias ? { ...d, name: alias } : d;
        });
        const projects = await projectService.getAll();
        const projectMap: Record<number, { projectId: string; projectName: string }> = {};
        for (const p of projects) {
          for (const v of p.vpsInstances) {
            if (v.digitalocean?.dropletId) {
              projectMap[v.digitalocean.dropletId] = { projectId: p.id, projectName: p.name };
            }
          }
        }
        send(ws, { type: "admin:droplets:list", payload: { droplets: decoratedDroplets, projectMap } });
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:list", payload: { droplets: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:droplets:create": {
      // Create a bare detached droplet (no Genie setup.sh, no project link).
      // Mirrors admin:tazcloud:create. Uses the genie SSH key (uploads it to the
      // DO account on first use), tags with "genie" so admin:droplets:list shows it.
      try {
        const { name, region, size, image } = msg.payload as {
          name: string; region: string; size: string; image: string;
        };
        if (!name || typeof name !== "string") throw new Error("name is required");
        if (!region) throw new Error("region is required");
        if (!size) throw new Error("size is required");
        if (!image) throw new Error("image is required");
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const client = createDoClient(doToken);
        const keyPair = await ensureGenieKeyPair();
        const fingerprint = sshKeyFingerprint(keyPair.publicKey);
        const existingKeys = await client.listSshKeys();
        let sshKeyId = existingKeys.find((k) => k.fingerprint === fingerprint)?.id;
        if (!sshKeyId) {
          const newKey = await client.createSshKey(`genie-${Date.now()}`, keyPair.publicKey);
          sshKeyId = newKey.id;
        }
        const droplet = await client.createDroplet({
          name, region, size, image,
          sshKeyIds: [sshKeyId],
          tags: ["genie"],
        });
        send(ws, { type: "admin:droplets:created", payload: { droplet } });
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:create:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:droplets:delete": {
      try {
        const { dropletId } = msg.payload;
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const doClient = createDoClient(doToken);
        await doClient.deleteDroplet(dropletId);
        await cloudVmAliases.clearAlias("digitalocean", String(dropletId));
        // Clear vps instance from owning project if any
        const projects = await projectService.getAll();
        for (const p of projects) {
          const inst = p.vpsInstances.find(v => v.digitalocean?.dropletId === dropletId);
          if (inst) {
            await projectService.removeVpsInstance(p.id, inst.id);
            await broadcastProjectList();
            break;
          }
        }
        send(ws, { type: "admin:droplets:deleted", payload: { dropletId } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:droplets:stats": {
      try {
        const projects = await projectService.getAll();
        // Build dropletId → connection map from project VPS instances
        const connMap: Record<number, { host: string; port: number; username: string; privateKeyPath: string }> = {};
        for (const p of projects) {
          for (const v of p.vpsInstances) {
            if (v.digitalocean?.dropletId && v.connection?.host) {
              connMap[v.digitalocean.dropletId] = v.connection;
            }
          }
        }
        const ids = Object.keys(connMap).map(Number);
        if (ids.length === 0) {
          send(ws, { type: "admin:droplets:stats", payload: { stats: {} } });
          break;
        }
        const results: Record<number, unknown> = {};
        await Promise.allSettled(
          ids.map(async (id) => {
            try {
              const stats = await vpsStats(connMap[id]);
              results[id] = stats;
            } catch { /* skip unreachable droplets */ }
          })
        );
        send(ws, { type: "admin:droplets:stats", payload: { stats: results } });
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:stats", payload: { stats: {} } });
      }
      break;
    }

    // ── Base Image ─────────────────────────────────────────
    case "admin:baseimage:configs:list": {
      const doToken = await settingsService.getGlobalDoToken();
      const configs = await settingsService.getAllBaseImageConfigs();
      const templates = await settingsService.getAllBaseImageTemplates();
      const verifiedTemplates: Record<string, unknown> = {};
      if (doToken) {
        try {
          const doClient = createDoClient(doToken);
          const snapshots = await doClient.listAccountSnapshots();
          const snapIds = new Set(snapshots.map((s) => String(s.id)));
          for (const [name, tmpl] of Object.entries(templates)) {
            const verified = tmpl.snapshotId ? snapIds.has(String(tmpl.snapshotId)) : false;
            let snapshotName = tmpl.snapshotName;
            if (tmpl.snapshotId) {
              const snap = snapshots.find((s) => String(s.id) === String(tmpl.snapshotId));
              if (snap) snapshotName = snap.name;
            }
            verifiedTemplates[name] = { ...tmpl, verified, snapshotName };
          }
        } catch {
          for (const [name, tmpl] of Object.entries(templates)) {
            verifiedTemplates[name] = { ...tmpl, verified: false };
          }
        }
      } else {
        for (const [name, tmpl] of Object.entries(templates)) {
          verifiedTemplates[name] = { ...tmpl, verified: false };
        }
      }
      const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
      send(ws, { type: "admin:baseimage:configs:list", payload: { configs, templates: verifiedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      break;
    }

    case "admin:baseimage:config:save": {
      try {
        const { name, config, originalName } = msg.payload as { name: string; config: BaseImageConfig; originalName?: string };
        if (originalName && originalName !== name) {
          await settingsService.deleteBaseImageConfigByName(originalName);
          const allTemplates = await settingsService.getAllBaseImageTemplates();
          for (const [tName, tmpl] of Object.entries(allTemplates)) {
            if (tmpl.configName === originalName) {
              allTemplates[tName] = { ...tmpl, configName: name };
            }
          }
          await settingsService.saveAllBaseImageTemplates(allTemplates);
          await settingsService.saveBaseImageConfigByName(name, config);
        } else {
          await settingsService.saveBaseImageConfigByName(name, config);
        }
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:baseimage:config:delete": {
      try {
        const { name } = msg.payload as { name: string };
        await settingsService.deleteBaseImageConfigByName(name);
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:baseimage:template:save": {
      try {
        const { name, template, originalName } = msg.payload as { name: string; template: BaseImageTemplate; originalName?: string };
        if (originalName && originalName !== name) {
          const oldTmpl = await settingsService.getBaseImageTemplateByName(originalName);
          await settingsService.deleteBaseImageTemplateByName(originalName);
          await settingsService.saveBaseImageTemplateByName(name, {
            ...template,
            snapshotId: template.snapshotId ?? oldTmpl?.snapshotId ?? null,
            snapshotName: template.snapshotName ?? oldTmpl?.snapshotName ?? null,
          });
        } else {
          const existing = await settingsService.getBaseImageTemplateByName(name);
          await settingsService.saveBaseImageTemplateByName(name, {
            ...template,
            snapshotId: template.snapshotId ?? existing?.snapshotId ?? null,
            snapshotName: template.snapshotName ?? existing?.snapshotName ?? null,
          });
        }
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:baseimage:template:delete": {
      try {
        const { name } = msg.payload as { name: string };
        await settingsService.deleteBaseImageTemplateByName(name);
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:baseimage:template:restore": {
      try {
        const { name } = msg.payload as { name: string };
        await settingsService.restoreBaseImageTemplateByName(name);
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:baseimage:template:hard-delete": {
      try {
        const { name } = msg.payload as { name: string };
        await settingsService.hardDeleteBaseImageTemplateByName(name);
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:baseimage:template:history": {
      try {
        const { name } = msg.payload as { name?: string };
        const history = name
          ? await settingsService.getTemplateHistory(name)
          : await settingsService.getAllTemplateHistory();
        send(ws, { type: "admin:baseimage:template:history", payload: { history } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:baseimage:test": {
      const { templateName } = msg.payload as { templateName: string };
      const doToken = await settingsService.getGlobalDoToken();
      if (!doToken) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: "DigitalOcean API token not configured" } });
        break;
      }
      const biTemplate = await settingsService.getBaseImageTemplateByName(templateName);
      if (!biTemplate?.snapshotId) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: `Template "${templateName}" has no snapshot — build it first` } });
        break;
      }
      const biConfig = await settingsService.getBaseImageConfigByName(biTemplate.configName);
      if (!biConfig) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: `Config "${biTemplate.configName}" not found` } });
        break;
      }
      baseImageBuildingName = templateName;
      void (async () => {
        try {
          const client = createDoClient(doToken);
          const keyPair = await ensureGenieKeyPair();
          const privateKeyPath = await ensureGenieKeyOnDisk();
          const fingerprint = sshKeyFingerprint(keyPair.publicKey);
          const existingKeys = await client.listSshKeys();
          let keyId: number;
          const existing = existingKeys.find((k) => k.fingerprint === fingerprint);
          if (existing) {
            keyId = existing.id;
          } else {
            const created = await client.createSshKey(`genie-${Date.now()}`, keyPair.publicKey.trim());
            keyId = created.id;
          }

          broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: `Creating test droplet from snapshot ${biTemplate.snapshotId}...` } });
          const droplet = await client.createDroplet({
            name: `genie-test-${templateName}-${Date.now()}`,
            region: biConfig.region,
            size: biConfig.size,
            image: biTemplate.snapshotId!,
            sshKeyIds: [keyId],
            tags: ["genie-test"],
          });
          const dropletId = droplet.id;
          broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: `Test droplet created (id: ${dropletId}), waiting for active...` } });

          let ipAddress = "";
          const pollStart = Date.now();
          while (Date.now() - pollStart < 120_000) {
            const current = await client.getDroplet(dropletId);
            const pub = current.networks?.v4?.find((n) => n.type === "public");
            if (current.status === "active" && pub?.ip_address) {
              ipAddress = pub.ip_address;
              break;
            }
            broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: `Droplet status: ${current.status}...` } });
            await new Promise((r) => setTimeout(r, 5_000));
          }
          if (!ipAddress) throw Object.assign(new Error("Timed out waiting for droplet"), { failedDropletId: dropletId, failedDropletIp: "" });

          broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: `Test droplet ready at ${ipAddress}` } });
          broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: `SSH: ssh -o StrictHostKeyChecking=no -i ~/.genie/ssh/genie_ed25519 root@${ipAddress}` } });

          baseImageBuildingName = null;
          // Report as "error" with droplet info so the UI shows Connect/Destroy buttons
          broadcast({ type: "admin:baseimage:error", payload: {
            configName: templateName,
            message: `Test droplet ready — connect to debug, destroy when done`,
            failedDropletId: dropletId,
            failedDropletIp: ipAddress,
          } });
        } catch (err: unknown) {
          baseImageBuildingName = null;
          broadcast({ type: "admin:baseimage:error", payload: {
            configName: templateName,
            message: (err instanceof Error ? err.message : String(err)),
            failedDropletId: ((err as Error & { failedDropletId?: number }).failedDropletId) || null,
            failedDropletIp: ((err as Error & { failedDropletIp?: string }).failedDropletIp) || null,
          } });
        }
      })();
      break;
    }

    case "admin:baseimage:destroy-failed": {
      try {
        const { dropletId } = msg.payload as { dropletId: number };
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const doClient = createDoClient(doToken);
        await doClient.deleteDroplet(dropletId);
        broadcast({ type: "admin:baseimage:progress", payload: { configName: "", message: `Failed build droplet ${dropletId} destroyed` } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:baseimage:create": {
      const { templateName } = msg.payload as { templateName: string };
      const doToken = await settingsService.getGlobalDoToken();
      if (!doToken) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: "DigitalOcean API token not configured" } });
        break;
      }
      if (baseImageAbortController) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: "Base image creation already in progress" } });
        break;
      }
      const biTemplate = await settingsService.getBaseImageTemplateByName(templateName);
      if (!biTemplate) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: `Template "${templateName}" not found` } });
        break;
      }
      const biConfig = await settingsService.getBaseImageConfigByName(biTemplate.configName);
      if (!biConfig) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: `Config "${biTemplate.configName}" referenced by template "${templateName}" not found` } });
        break;
      }
      baseImageAbortController = new AbortController();
      baseImageBuildingName = templateName;
      void createBaseImage(
        {
          token: doToken,
          region: biConfig.region,
          size: biConfig.size,
          snapshotPrefix: biTemplate.snapshotPrefix,
          provisionScript: biConfig.provisionScript,
          signal: baseImageAbortController.signal,
        },
        (step) => { broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: step } }); },
      ).then(async (result) => {
        baseImageAbortController = null;
        baseImageBuildingName = null;
        await settingsService.saveBaseImageTemplateByName(templateName, { ...biTemplate, snapshotId: result.snapshotId, snapshotName: result.snapshotName });

        // Clean up old snapshots matching this template's prefix, but protect IDs used by any template
        try {
          const allTemplates = await settingsService.getAllBaseImageTemplates();
          const protectedIds = new Set<string>();
          for (const tmpl of Object.values(allTemplates)) {
            if (tmpl.snapshotId) protectedIds.add(String(tmpl.snapshotId));
          }
          const doClient = createDoClient(doToken);
          const allSnapshots = await doClient.listAccountSnapshots();
          for (const old of allSnapshots) {
            if (old.name.startsWith("snapshot-" + biTemplate.snapshotPrefix + "-") && !protectedIds.has(String(old.id))) {
              try {
                await doClient.deleteSnapshot(old.id);
              } catch {}
            }
          }
        } catch {}

        broadcast({ type: "admin:baseimage:done", payload: { configName: templateName, snapshotId: result.snapshotId, snapshotName: result.snapshotName } });
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        baseImageAbortController = null;
        baseImageBuildingName = null;
        broadcast({ type: "admin:baseimage:error", payload: {
          configName: templateName,
          message: (err instanceof Error ? err.message : String(err)),
          failedDropletId: ((err as Error & { failedDropletId?: number }).failedDropletId) || null,
          failedDropletIp: ((err as Error & { failedDropletIp?: string }).failedDropletIp) || null,
        } });
      });
      break;
    }

    // ── SSH Key management ────────────────────────────────
    case "admin:sshkey:get": {
      try {
        const stored = await settingsService.getGenieKeyPair();
        const history = await settingsService.getGenieKeyHistory();
        const createdAt = await settingsService.getGlobalSetting<string>("genieKeyCreatedAt");
        if (stored) {
          const fingerprint = sshKeyFingerprint(stored.publicKey);
          send(ws, { type: "admin:sshkey:result", payload: { exists: true, publicKey: stored.publicKey, fingerprint, createdAt, history } });
        } else {
          send(ws, { type: "admin:sshkey:result", payload: { exists: false, publicKey: null, fingerprint: null, createdAt: null, history } });
        }
      } catch (err: unknown) {
        send(ws, { type: "admin:sshkey:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:sshkey:regenerate": {
      try {
        // Generate new key pair using ssh-keygen with temp files
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "genie-ssh-"));
        const tmpKeyPath = path.join(tmpDir, "genie_ed25519");
        try {
          const execFileAsync = promisify(execFile);
          await execFileAsync("ssh-keygen", ["-t", "ed25519", "-f", tmpKeyPath, "-N", "", "-C", "genie-deploy"]);
          const privateKey = fs.readFileSync(tmpKeyPath, "utf-8");
          const publicKey = fs.readFileSync(`${tmpKeyPath}.pub`, "utf-8");

          // Save to DB
          await settingsService.saveGenieKeyPair(privateKey, publicKey);

          // Write to disk cache
          writeKeyToDisk(privateKey, publicKey);

          const fingerprint = sshKeyFingerprint(publicKey);
          const history = await settingsService.getGenieKeyHistory();
          const createdAt = await settingsService.getGlobalSetting<string>("genieKeyCreatedAt");
          send(ws, { type: "admin:sshkey:result", payload: { exists: true, publicKey, fingerprint, createdAt, history } });
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
      } catch (err: unknown) {
        send(ws, { type: "admin:sshkey:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:sshkey:delete": {
      try {
        await settingsService.deleteGenieKeyPair();
        // Remove disk cache
        const homeDir = os.homedir();
        const privPath = path.join(homeDir, ".genie", "ssh", "genie_ed25519");
        const pubPath = path.join(homeDir, ".genie", "ssh", "genie_ed25519.pub");
        try { fs.unlinkSync(privPath); } catch {}
        try { fs.unlinkSync(pubPath); } catch {}
        const history = await settingsService.getGenieKeyHistory();
        send(ws, { type: "admin:sshkey:result", payload: { exists: false, publicKey: null, fingerprint: null, createdAt: null, history } });
      } catch (err: unknown) {
        send(ws, { type: "admin:sshkey:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    // ── AI Usage / Costs ──────────────────────────────────
    case "admin:ai:costs": {
      try {
        const db = getDb();
        const rows = await db
          .select({
            id: aiUsage.id,
            userId: aiUsage.userId,
            userName: users.name,
            modelId: aiUsage.modelId,
            modelLabel: aiUsage.modelLabel,
            inputTokens: aiUsage.inputTokens,
            outputTokens: aiUsage.outputTokens,
            cost: aiUsage.cost,
            source: aiUsage.source,
            createdAt: aiUsage.createdAt,
          })
          .from(aiUsage)
          .leftJoin(users, eq(aiUsage.userId, users.id))
          .orderBy(desc(aiUsage.createdAt))
          .limit(500);
        send(ws, { type: "admin:ai:costs", payload: { rows } });
      } catch (err: unknown) {
        send(ws, { type: "admin:ai:costs", payload: { rows: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:ai:settings:get": {
      try {
        const defaultModel = await settingsService.getGlobalSetting<string>("aiDefaultModel") ?? "claude-sonnet";
        const maxToolRounds = await settingsService.getGlobalSetting<number>("aiMaxToolRounds") ?? 10;
        send(ws, { type: "admin:ai:settings", payload: { defaultModel, maxToolRounds } });
      } catch (err: unknown) {
        send(ws, { type: "admin:ai:settings", payload: { defaultModel: "claude-sonnet", maxToolRounds: 10, error: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:ai:settings:save": {
      try {
        const { defaultModel, maxToolRounds } = msg.payload;
        if (defaultModel != null) await settingsService.setGlobalSetting("aiDefaultModel", defaultModel);
        if (maxToolRounds != null) await settingsService.setGlobalSetting("aiMaxToolRounds", maxToolRounds);
        send(ws, { type: "admin:ai:settings", payload: { defaultModel, maxToolRounds } });
      } catch (err: unknown) {
        send(ws, { type: "admin:ai:settings:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    // ── Users & Teams ─────────────────────────────────────
    case "admin:users:list": {
      try {
        const db = getDb();
        const allUsers = await db.select().from(users).orderBy(users.createdAt);
        send(ws, { type: "admin:users:list", payload: { users: allUsers } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:users:validate": {
      try {
        const db = getDb();
        const { userId, validated } = msg.payload;
        const [updated] = await db.update(users).set({ validated }).where(eq(users.id, userId)).returning();
        send(ws, { type: "admin:users:updated", payload: { user: updated } });
        if (!validated) disconnectUser(userId);
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:users:update": {
      try {
        const db = getDb();
        const { userId, data } = msg.payload;
        const allowedFields: Record<string, any> = {};
        if (data.name !== undefined) allowedFields.name = data.name;
        if (data.validated !== undefined) allowedFields.validated = data.validated;
        if (data.defaultEditor !== undefined) allowedFields.defaultEditor = data.defaultEditor;
        if (data.role !== undefined) allowedFields.role = data.role;
        const [updated] = await db.update(users).set(allowedFields).where(eq(users.id, userId)).returning();
        send(ws, { type: "admin:users:updated", payload: { user: updated } });
        if (data.validated === false) disconnectUser(userId);
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:users:delete": {
      try {
        const db = getDb();
        const { userId } = msg.payload;
        await db.delete(users).where(eq(users.id, userId));
        send(ws, { type: "admin:users:deleted", payload: { userId } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:impersonate:start": {
      try {
        const state = clients.get(ws);
        const callerId = state?.userId ?? null;
        if (!callerId) {
          send(ws, { type: "admin:error", payload: { message: "Not authenticated" } });
          break;
        }
        // Only superadmins (the real superadmin, not the currently-impersonated user) can start impersonation.
        const realCallerId = state?.impersonatedBy ?? callerId;
        const caller = await getUserById(realCallerId);
        if (caller?.role !== "superadmin") {
          send(ws, { type: "admin:error", payload: { message: "Only superadmins can impersonate" } });
          break;
        }
        const { userId: targetId } = msg.payload as { userId: string };
        if (!targetId || targetId === realCallerId) {
          send(ws, { type: "admin:error", payload: { message: "Invalid impersonation target" } });
          break;
        }
        const target = await getUserById(targetId);
        if (!target || target.isAgent) {
          send(ws, { type: "admin:error", payload: { message: "Target user not found" } });
          break;
        }
        const newToken = createToken(target.id, realCallerId);
        if (state) {
          state.userId = target.id;
          state.user = { id: target.id, name: target.name, email: target.email, avatarUrl: target.avatarUrl };
          state.impersonatedBy = realCallerId;
        }
        const authPayload = await buildAuthPayload(target, newToken, { id: caller.id, name: caller.name, email: caller.email });
        send(ws, { type: "auth:success", payload: authPayload });
        await sendInitialData(ws, target.id);
        broadcastPresence();
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:impersonate:stop": {
      try {
        const state = clients.get(ws);
        const realCallerId = state?.impersonatedBy ?? null;
        if (!realCallerId) {
          send(ws, { type: "admin:error", payload: { message: "Not currently impersonating" } });
          break;
        }
        const caller = await getUserById(realCallerId);
        if (!caller) {
          send(ws, { type: "admin:error", payload: { message: "Original user no longer exists" } });
          break;
        }
        const newToken = createToken(caller.id);
        if (state) {
          state.userId = caller.id;
          state.user = { id: caller.id, name: caller.name, email: caller.email, avatarUrl: caller.avatarUrl };
          state.impersonatedBy = null;
        }
        const authPayload = await buildAuthPayload(caller, newToken, null);
        send(ws, { type: "auth:success", payload: authPayload });
        await sendInitialData(ws, caller.id);
        broadcastPresence();
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:teams:list": {
      try {
        const db = getDb();
        const allTeams = await db.select().from(teams).orderBy(teams.createdAt);
        const allMembers = await db.select().from(teamMembers);
        send(ws, { type: "admin:teams:list", payload: { teams: allTeams, members: allMembers } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:teams:create": {
      try {
        const db = getDb();
        const { name } = msg.payload;
        const [team] = await db.insert(teams).values({ name }).returning();
        send(ws, { type: "admin:teams:created", payload: { team } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:teams:update": {
      try {
        const db = getDb();
        const { teamId, name } = msg.payload;
        const [team] = await db.update(teams).set({ name }).where(eq(teams.id, teamId)).returning();
        send(ws, { type: "admin:teams:updated", payload: { team } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:teams:delete": {
      try {
        const db = getDb();
        const { teamId } = msg.payload;
        await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
        await db.delete(teams).where(eq(teams.id, teamId));
        send(ws, { type: "admin:teams:deleted", payload: { teamId } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:teams:add-member": {
      try {
        const db = getDb();
        const { teamId, userId, role } = msg.payload;
        const [member] = await db.insert(teamMembers).values({ teamId, userId, role: role || "member" }).returning();
        send(ws, { type: "admin:teams:member-added", payload: { member } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:teams:remove-member": {
      try {
        const db = getDb();
        const { memberId } = msg.payload;
        await db.delete(teamMembers).where(eq(teamMembers.id, memberId));
        send(ws, { type: "admin:teams:member-removed", payload: { memberId } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "admin:teams:set-role": {
      try {
        const db = getDb();
        const { memberId, role } = msg.payload;
        const [updated] = await db.update(teamMembers).set({ role }).where(eq(teamMembers.id, memberId)).returning();
        send(ws, { type: "admin:teams:role-updated", payload: { member: updated } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    // ── Settings ──────────────────────────────────────────
    case "settings:get": {
      const reqId = msg.payload?.reqId;
      try {
        const data = await settingsService.getComposedSettings(userId);
        send(ws, { type: "settings:result", payload: { ...data, reqId } });
      } catch {
        send(ws, { type: "settings:result", payload: { reqId } });
      }
      break;
    }

    case "settings:save": {
      const reqId = msg.payload?.reqId;
      try {
        const { reqId: _, ...fields } = msg.payload;
        await settingsService.saveRoutedSettings(userId, fields);
        send(ws, { type: "settings:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "settings:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    // ── File-system helpers ─────────────────────────────
    case "fs:homePath": {
      const reqId = msg.payload?.reqId;
      send(ws, { type: "fs:result", payload: { path: os.homedir(), reqId } });
      break;
    }

    case "fs:readDirectory": {
      const reqId = msg.payload?.reqId;
      try {
        const dirPath = msg.payload.path as string;
        const names = await fsp.readdir(dirPath);
        const entries = await Promise.all(
          names.filter((n: string) => !n.startsWith(".")).map(async (name: string) => {
            const fullPath = path.join(dirPath, name);
            try {
              const stat = await fsp.stat(fullPath);
              return { name, path: fullPath, isDirectory: stat.isDirectory(), size: stat.size, modifiedMs: stat.mtimeMs };
            } catch {
              return null;
            }
          }),
        );
        send(ws, { type: "fs:result", payload: { ok: true, entries: entries.filter(Boolean), reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "fs:readFile": {
      const reqId = msg.payload?.reqId;
      try {
        const filePath = msg.payload.path as string;
        const stat = await fsp.stat(filePath);
        if (stat.size > 1_000_000) {
          send(ws, { type: "fs:result", payload: { ok: true, content: null, binary: false, reqId } });
          break;
        }
        const buf = await fsp.readFile(filePath);
        const isBinary = buf.includes(0);
        send(ws, { type: "fs:result", payload: { ok: true, content: isBinary ? null : buf.toString("utf-8"), binary: isBinary, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "fs:createFolder": {
      const reqId = msg.payload?.reqId;
      try {
        await fsp.mkdir(msg.payload.path as string, { recursive: true });
        send(ws, { type: "fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "fs:renameEntry": {
      const reqId = msg.payload?.reqId;
      try {
        await fsp.rename(msg.payload.oldPath as string, msg.payload.newPath as string);
        send(ws, { type: "fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "fs:deleteEntry": {
      const reqId = msg.payload?.reqId;
      try {
        await fsp.rm(msg.payload.path as string, { recursive: true, force: true });
        send(ws, { type: "fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "fs:openInFinder": {
      const reqId = msg.payload?.reqId;
      try {
        await execFileAsync("open", ["-R", msg.payload.path as string]);
        send(ws, { type: "fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "fs:openFile": {
      const reqId = msg.payload?.reqId;
      try {
        const editor = (() => {
          try {
            const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".genie", "settings.json"), "utf-8"));
            return s.defaultEditor || "Visual Studio Code";
          } catch { return "Visual Studio Code"; }
        })();
        await execFileAsync("open", ["-a", editor, msg.payload.path as string]);
        send(ws, { type: "fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    // ── Remote (VPS) file operations via SSH ────────────────
    case "vps:docker:logs": {
      const { projectId, instanceId, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn);
        try {
          // List all containers with their names and status
          const containersOut = await session.exec(`docker ps -a --format '{{.Names}}\\t{{.Status}}' 2>/dev/null`);
          const containers = containersOut.trim().split("\n").filter(Boolean).map((line: string) => {
            const [name, ...statusParts] = line.split("\t");
            return { name, status: statusParts.join("\t") };
          });
          // Fetch last 200 lines of logs for each container
          const logs: { name: string; status: string; logs: string }[] = [];
          for (const c of containers) {
            try {
              const logOut = await session.exec(`docker logs --tail 200 '${c.name.replace(/'/g, "'\\''")}' 2>&1`);
              logs.push({ name: c.name, status: c.status, logs: logOut });
            } catch {
              logs.push({ name: c.name, status: c.status, logs: "(failed to fetch logs)" });
            }
          }
          send(ws, { type: "vps:docker:logs:result", payload: { ok: true, containers: logs, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:docker:logs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:fs:readDirectory": {
      const { projectId, instanceId, path: dirPath, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn);
        try {
          const escaped = dirPath.replace(/'/g, "'\\''");
          const out = await session.exec(`find '${escaped}' -maxdepth 1 -not -path '${escaped}' -printf '%T@ %s %y %f\\n' 2>/dev/null | sort -k4`);
          const entries = out.trim().split("\n").filter(Boolean).map((line: string) => {
            const parts = line.split(" ");
            const modifiedMs = parseFloat(parts[0]) * 1000;
            const size = parseInt(parts[1]) || 0;
            const isDir = parts[2] === "d";
            const name = parts.slice(3).join(" ");
            return { name, path: dirPath.replace(/\/$/, "") + "/" + name, isDirectory: isDir, size, modifiedMs };
          });
          send(ws, { type: "vps:fs:result", payload: { ok: true, entries, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:fs:readFile": {
      const { projectId, instanceId, path: filePath, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn);
        try {
          const escaped = filePath.replace(/'/g, "'\\''");
          // Check size first
          const sizeOut = await session.exec(`stat -c '%s' '${escaped}' 2>/dev/null || echo 0`);
          const fileSize = parseInt(sizeOut.trim()) || 0;
          if (fileSize > 1_000_000) {
            send(ws, { type: "vps:fs:result", payload: { ok: true, content: null, binary: false, tooLarge: true, reqId } });
          } else {
            const content = await session.exec(`cat '${escaped}'`);
            const isBinary = /[\x00-\x08\x0E-\x1F]/.test(content.slice(0, 1000));
            send(ws, { type: "vps:fs:result", payload: { ok: true, content: isBinary ? null : content, binary: isBinary, reqId } });
          }
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:fs:writeFile": {
      const { projectId, instanceId, path: filePath, content, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn);
        try {
          const escaped = filePath.replace(/'/g, "'\\''");
          // Use heredoc to write content
          const b64 = Buffer.from(content as string).toString("base64");
          await session.exec(`echo '${b64}' | base64 -d > '${escaped}'`);
          send(ws, { type: "vps:fs:result", payload: { ok: true, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:fs:upload": {
      // Chunked upload over SFTP. Client sends chunks (base64-encoded on the wire,
      // decoded here) with a shared uploadId. SFTP has proper flow control so chunk
      // writes ack reliably — unlike piping into `base64 -d` via execStreaming, which
      // can stall under SSH channel-window backpressure.
      const { uploadId, projectId, instanceId, path: uploadDir, fileName, dataBase64, chunkIndex, totalChunks, reqId } = msg.payload;
      try {
        if (typeof uploadId !== "string" || typeof chunkIndex !== "number" || typeof totalChunks !== "number") {
          throw new Error("upload requires uploadId, chunkIndex, totalChunks");
        }
        if (chunkIndex === 0) {
          await cleanupUpload(uploadId); // wipe any stale leftover with the same id
          const conn = await getVpsConnection(projectId, instanceId);
          const session = await connectSsh(conn);
          const filePath = `${(uploadDir as string).replace(/\/$/, "")}/${fileName}`;
          const handle = await session.sftpOpenWrite(filePath);
          const staleTimer = setTimeout(() => { cleanupUpload(uploadId, { deletePartial: true }).catch(() => {}); }, 10 * 60 * 1000);
          pendingUploads.set(uploadId, { session, handle, offset: 0, filePath, staleTimer });
        }
        const pending = pendingUploads.get(uploadId);
        if (!pending) throw new Error("no pending upload for this uploadId");

        const buf = Buffer.from(dataBase64, "base64");
        // SFTP single write is capped at the negotiated max packet (~32 KB). Fire the
        // sub-writes in parallel — SFTP allows ~64 outstanding requests, so this
        // pipelines over the SSH round-trip latency instead of paying it per packet.
        const SFTP_WRITE = 32 * 1024;
        const writes: Promise<void>[] = [];
        for (let p = 0; p < buf.length; p += SFTP_WRITE) {
          const slice = buf.subarray(p, Math.min(p + SFTP_WRITE, buf.length));
          writes.push(pending.handle.write(slice, pending.offset + p));
        }
        await Promise.all(writes);
        pending.offset += buf.length;

        if (chunkIndex + 1 === totalChunks) {
          await cleanupUpload(uploadId);
        }
        send(ws, { type: "vps:fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        if (typeof uploadId === "string") await cleanupUpload(uploadId, { deletePartial: true }).catch(() => {});
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:fs:upload-cancel": {
      const { uploadId } = msg.payload;
      if (typeof uploadId === "string") {
        await cleanupUpload(uploadId, { deletePartial: true }).catch(() => {});
      }
      break;
    }

    case "vps:fs:rename": {
      const { projectId, instanceId, oldPath, newPath, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn);
        try {
          const escapedOld = (oldPath as string).replace(/'/g, "'\\''");
          const escapedNew = (newPath as string).replace(/'/g, "'\\''");
          await session.exec(`mv '${escapedOld}' '${escapedNew}'`);
          send(ws, { type: "vps:fs:result", payload: { ok: true, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:fs:download": {
      const { projectId, instanceId, path: dlPath, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn);
        try {
          const escaped = (dlPath as string).replace(/'/g, "'\\''");
          const name = (dlPath as string).split("/").pop() || "download";
          const parentDir = (dlPath as string).replace(/\/[^/]+$/, "") || "/";
          const escapedParent = parentDir.replace(/'/g, "'\\''");
          const data = await session.exec(`tar -czf - -C '${escapedParent}' '${name}' 2>/dev/null | base64`);
          send(ws, { type: "vps:fs:result", payload: { ok: true, data: data.replace(/\s/g, ""), fileName: `${name}.tar.gz`, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:fs:delete": {
      const { projectId, instanceId, path: delPath, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn);
        try {
          const escaped = (delPath as string).replace(/'/g, "'\\''");
          await session.exec(`rm -rf '${escaped}'`);
          send(ws, { type: "vps:fs:result", payload: { ok: true, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    // ── VPS Database Explorer ──────────────────────────────
    case "vps:db:detect": {
      const { projectId, instanceId, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 15_000 });
        try {
          // Try common locations for DATABASE_URL
          const envOut = await session.exec(
            `cat /opt/project/.env 2>/dev/null; cat /opt/project/.env.local 2>/dev/null; cat /opt/project/.env.production 2>/dev/null`
          );
          // Match DATABASE_URL or POSTGRES_URL patterns
          const match = envOut.match(/(?:DATABASE_URL|POSTGRES_URL|DB_URL)\s*=\s*['"]?(postgres(?:ql)?:\/\/[^\s'"]+)/);
          if (match) {
            send(ws, { type: "vps:db:detect:result", payload: { ok: true, url: match[1], reqId } });
          } else {
            // Try to detect a running postgres and construct a URL
            const pgOut = await session.exec(`docker exec $(docker ps --filter 'ancestor=postgres' -q 2>/dev/null | head -1) printenv 2>/dev/null || echo ""`);
            const pgUser = pgOut.match(/POSTGRES_USER=(\S+)/)?.[1] || "postgres";
            const pgPass = pgOut.match(/POSTGRES_PASSWORD=(\S+)/)?.[1];
            const pgDb = pgOut.match(/POSTGRES_DB=(\S+)/)?.[1] || pgUser;
            if (pgPass) {
              send(ws, { type: "vps:db:detect:result", payload: { ok: true, url: `postgres://${pgUser}:${pgPass}@localhost:5432/${pgDb}`, reqId } });
            } else {
              send(ws, { type: "vps:db:detect:result", payload: { ok: false, reqId } });
            }
          }
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:detect:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:db:databases": {
      const { projectId, instanceId, dbUrl, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 15_000 });
        try {
          const escapedUrl = (dbUrl as string).replace(/'/g, "'\\''");
          let out = await session.exec(
            `psql '${escapedUrl}' -t -A -c "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname" 2>&1`
          );
          if (out.includes("command not found")) {
            out = await session.exec(
              `docker run --rm --network host postgres:16-alpine psql '${escapedUrl}' -t -A -c "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname" 2>&1`
            );
          }
          const databases = out.trim().split("\n").filter(Boolean).filter(d => !d.includes("FATAL") && !d.includes("ERROR"));
          send(ws, { type: "vps:db:databases:result", payload: { ok: true, databases, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:databases:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:db:tables": {
      const { projectId, instanceId, dbUrl, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 15_000 });
        try {
          const escaped = (dbUrl as string).replace(/'/g, "'\\''");
          const out = await session.exec(
            `psql '${escaped}' -t -A -c "SELECT c.relname, c.reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname" 2>&1`
          );
          if (out.includes("command not found")) {
            // psql not on host — try via docker
            const dockerOut = await session.exec(
              `docker run --rm --network host postgres:16-alpine psql '${escaped}' -t -A -c "SELECT c.relname, c.reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname" 2>&1`
            );
            const tables = parseTableList(dockerOut);
            send(ws, { type: "vps:db:tables:result", payload: { ok: true, tables, reqId } });
          } else if (out.includes("FATAL") || out.includes("could not connect")) {
            send(ws, { type: "vps:db:tables:result", payload: { ok: false, error: out.trim(), reqId } });
          } else {
            const tables = parseTableList(out);
            send(ws, { type: "vps:db:tables:result", payload: { ok: true, tables, reqId } });
          }
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:tables:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:db:query": {
      const { projectId, instanceId, dbUrl, query, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 30_000 });
        try {
          const escapedUrl = (dbUrl as string).replace(/'/g, "'\\''");
          // Use JSON output for structured data
          const escapedQuery = (query as string).replace(/'/g, "'\\''");
          const out = await session.exec(
            `psql '${escapedUrl}' -c '${escapedQuery}' --csv 2>&1`
          );
          if (out.includes("command not found")) {
            // Try via docker
            const dockerOut = await session.exec(
              `docker run --rm --network host postgres:16-alpine psql '${escapedUrl}' -c '${escapedQuery}' --csv 2>&1`
            );
            const result = parseCsvResult(dockerOut);
            send(ws, { type: "vps:db:query:result", payload: { ok: !result.error, result, reqId } });
          } else if (out.includes("ERROR") || out.includes("FATAL")) {
            send(ws, { type: "vps:db:query:result", payload: { ok: false, error: out.trim(), reqId } });
          } else {
            const result = parseCsvResult(out);
            send(ws, { type: "vps:db:query:result", payload: { ok: !result.error, result, reqId } });
          }
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:query:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    // ── VPS Database Backups ─────────────────────────────
    case "vps:db:backup:create": {
      const { projectId, instanceId, dbUrl, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 120_000 });
        try {
          const escapedUrl = (dbUrl as string).replace(/'/g, "'\\''");
          await session.exec("mkdir -p /opt/genie-backups");
          const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const fileName = `backup-${ts}.sql.gz`;
          const filePath = `/opt/genie-backups/${fileName}`;
          // Try pg_dump directly, fallback to docker
          const testPgDump = await session.exec("which pg_dump 2>/dev/null || echo 'notfound'");
          let cmd: string;
          if (testPgDump.trim() === "notfound") {
            cmd = `docker run --rm --network host postgres:16-alpine pg_dump '${escapedUrl}' 2>&1 | gzip > '${filePath}'`;
          } else {
            cmd = `pg_dump '${escapedUrl}' 2>&1 | gzip > '${filePath}'`;
          }
          await session.exec(cmd);
          // Verify file was created and has content
          const sizeOut = await session.exec(`stat -c%s '${filePath}' 2>/dev/null || stat -f%z '${filePath}' 2>/dev/null || echo 0`);
          const size = parseInt(sizeOut.trim()) || 0;
          if (size < 20) {
            await session.exec(`rm -f '${filePath}'`);
            send(ws, { type: "vps:db:backup:result", payload: { ok: false, error: "Backup failed — dump file is empty", reqId } });
          } else {
            send(ws, { type: "vps:db:backup:result", payload: { ok: true, fileName, size, reqId } });
          }
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:backup:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:db:backup:list": {
      const { projectId, instanceId, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 15_000 });
        try {
          await session.exec("mkdir -p /opt/genie-backups");
          const out = await session.exec("ls -lh --time-style=long-iso /opt/genie-backups/*.sql.gz 2>/dev/null || echo ''");
          const backups = out.trim().split("\n").filter(Boolean).filter(l => !l.startsWith("total")).map((line) => {
            const parts = line.split(/\s+/);
            const size = parts[4] || "0";
            const date = parts[5] || "";
            const time = parts[6] || "";
            const fullPath = parts[7] || "";
            const name = fullPath.split("/").pop() || "";
            return { name, size, date: `${date} ${time}`, path: fullPath };
          }).filter(b => b.name);
          send(ws, { type: "vps:db:backup:result", payload: { ok: true, backups, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:backup:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:db:backup:download": {
      const { projectId, instanceId, fileName, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 60_000 });
        try {
          const safeName = (fileName as string).replace(/[^a-zA-Z0-9._-]/g, "");
          const filePath = `/opt/genie-backups/${safeName}`;
          const data = await session.exec(`base64 '${filePath}'`);
          send(ws, { type: "vps:db:backup:result", payload: { ok: true, data: data.replace(/\s/g, ""), fileName: safeName, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:backup:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:db:backup:delete": {
      const { projectId, instanceId, fileName, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 15_000 });
        try {
          const safeName = (fileName as string).replace(/[^a-zA-Z0-9._-]/g, "");
          await session.exec(`rm -f '/opt/genie-backups/${safeName}'`);
          send(ws, { type: "vps:db:backup:result", payload: { ok: true, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:backup:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    // ── Saved Queries ─────────────────────────────────────
    case "db:saved-queries:list": {
      const { projectId, reqId } = msg.payload;
      try {
        const db = getDb();
        const rows = await db.select({
          id: savedQueries.id,
          projectId: savedQueries.projectId,
          userId: savedQueries.userId,
          name: savedQueries.name,
          description: savedQueries.description,
          query: savedQueries.query,
          createdAt: savedQueries.createdAt,
          updatedAt: savedQueries.updatedAt,
          userName: users.name,
          userAvatar: users.avatarUrl,
        })
          .from(savedQueries)
          .leftJoin(users, eq(savedQueries.userId, users.id))
          .where(eq(savedQueries.projectId, projectId))
          .orderBy(savedQueries.name);
        send(ws, { type: "db:saved-queries:result", payload: { ok: true, queries: rows, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "db:saved-queries:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "db:saved-queries:save": {
      const { projectId, name, description, query, queryId, reqId } = msg.payload;
      if (!userId) { send(ws, { type: "db:saved-queries:result", payload: { ok: false, error: "Not authenticated", reqId } }); break; }
      try {
        const db = getDb();
        if (queryId) {
          // Update existing
          await db.update(savedQueries).set({ name, description, query, updatedAt: new Date() }).where(eq(savedQueries.id, queryId));
        } else {
          // Insert new
          await db.insert(savedQueries).values({ projectId, userId, name, description, query });
        }
        // Return updated list
        const rows = await db.select({
          id: savedQueries.id,
          projectId: savedQueries.projectId,
          userId: savedQueries.userId,
          name: savedQueries.name,
          description: savedQueries.description,
          query: savedQueries.query,
          createdAt: savedQueries.createdAt,
          updatedAt: savedQueries.updatedAt,
          userName: users.name,
          userAvatar: users.avatarUrl,
        })
          .from(savedQueries)
          .leftJoin(users, eq(savedQueries.userId, users.id))
          .where(eq(savedQueries.projectId, projectId))
          .orderBy(savedQueries.name);
        send(ws, { type: "db:saved-queries:result", payload: { ok: true, queries: rows, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "db:saved-queries:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "db:saved-queries:delete": {
      const { projectId, queryId, reqId } = msg.payload;
      try {
        const db = getDb();
        await db.delete(savedQueries).where(eq(savedQueries.id, queryId));
        const rows = await db.select({
          id: savedQueries.id,
          projectId: savedQueries.projectId,
          userId: savedQueries.userId,
          name: savedQueries.name,
          description: savedQueries.description,
          query: savedQueries.query,
          createdAt: savedQueries.createdAt,
          updatedAt: savedQueries.updatedAt,
          userName: users.name,
          userAvatar: users.avatarUrl,
        })
          .from(savedQueries)
          .leftJoin(users, eq(savedQueries.userId, users.id))
          .where(eq(savedQueries.projectId, projectId))
          .orderBy(savedQueries.name);
        send(ws, { type: "db:saved-queries:result", payload: { ok: true, queries: rows, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "db:saved-queries:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      break;
    }

    case "vps:terminal:spawn": {
      const { id, projectId, instanceId, cols, rows } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        spawnSshPty(id, cols || 80, rows || 24, {
          host: conn.host,
          port: conn.port || 22,
          username: conn.username,
          privateKeyPath: conn.privateKeyPath,
        }, userId);
      } catch (err: unknown) {
        send(ws, { type: "error", payload: { message: `SSH terminal failed: ${(err instanceof Error ? err.message : String(err))}` } });
      }
      break;
    }

    case "terminal:ssh:spawn": {
      const { id, host, port, username, privateKeyPath, cols, rows, title, command } = msg.payload as {
        id: string; host: string; port?: number; username?: string; privateKeyPath?: string;
        cols?: number; rows?: number; title?: string; command?: string;
      };
      const resolvedUser = username || VPS_SSH_USERNAME;
      spawnSshPty(id, cols || 80, rows || 24, {
        host,
        port: port || 22,
        username: resolvedUser,
        privateKeyPath: privateKeyPath || "~/.genie/ssh/genie_ed25519",
      }, userId);
      // Notify the superadmin that someone opened a remote shell. Fire-and-forget;
      // a missing SENDGRID_API_KEY makes this a silent no-op.
      const actor = clients.get(ws)?.user;
      const actorLabel = actor ? `${actor.name} <${actor.email}>` : "Unknown user";
      // "Claude Terminal" is just an SSH session that auto-runs `claude` after connect —
      // detect via the command or the user-facing title set by the renderer.
      const isClaude = (command?.trim().startsWith("claude") ?? false) || (title?.toLowerCase().startsWith("claude") ?? false);
      const kindLabel = isClaude ? "Claude Terminal" : "SSH Terminal";
      const lines = [
        `${actorLabel} started a ${kindLabel}.`,
        ``,
        `Target: ${resolvedUser}@${host}:${port || 22}`,
      ];
      if (title) lines.push(`Label: ${title}`);
      if (command) lines.push(`Initial command: ${command}`);
      lines.push(``, `Time: ${new Date().toISOString()}`);
      void notifySuperadmin(`[Genie] ${kindLabel} started by ${actor?.name ?? "user"}`, lines.join("\n"));
      break;
    }

    // --- Security scanning ---

    case "security:scan:start": {
      const { target } = msg.payload;
      if (!target) {
        send(ws, { type: "security:scan:error", payload: { scanId: "", message: "Target is required" } });
        break;
      }
      const abortController = new AbortController();
      let registeredScanId: string | null = null;
      const scanResult = await (async () => {
        const { runSecurityScan } = await import("./security-service.js");
        return runSecurityScan(target, {
          signal: abortController.signal,
          onProgress: (update) => {
            if (update.id && !registeredScanId) {
              registeredScanId = update.id;
              activeSecurityAbortControllers.set(registeredScanId, abortController);
            }
            send(ws, { type: "security:scan:progress", payload: update });
          },
        });
      })();
      const scanId = scanResult.id;
      activeSecurityAbortControllers.delete(scanId);
      // Persist to DB
      try {
        const { saveScan } = await import("./security-service.js");
        await saveScan(userId, scanResult);
      } catch (err) {
        console.error("Failed to persist security scan:", err);
      }
      if (scanResult.status === "completed") {
        send(ws, { type: "security:scan:complete", payload: { scanId, completedAt: scanResult.completedAt } });
      } else if (scanResult.status === "error") {
        send(ws, { type: "security:scan:error", payload: { scanId, message: scanResult.error || "Unknown error" } });
      }
      break;
    }

    case "security:scan:stop": {
      const { scanId } = msg.payload;
      const ctrl = activeSecurityAbortControllers.get(scanId);
      if (ctrl) {
        ctrl.abort();
        activeSecurityAbortControllers.delete(scanId);
        send(ws, { type: "security:scan:complete", payload: { scanId, completedAt: Date.now() } });
      }
      break;
    }

    case "security:scans:list": {
      try {
        const { listScans } = await import("./security-service.js");
        const scans = await listScans(userId);
        send(ws, { type: "security:scans:list", payload: { scans } });
      } catch (err: unknown) {
        send(ws, { type: "security:scan:error", payload: { scanId: "", message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "security:scan:delete": {
      try {
        const { deleteScan } = await import("./security-service.js");
        await deleteScan(msg.payload.scanId);
        send(ws, { type: "security:scan:deleted", payload: { scanId: msg.payload.scanId } });
      } catch (err: unknown) {
        send(ws, { type: "security:scan:error", payload: { scanId: msg.payload.scanId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    default:
      send(ws, {
        type: "error",
        payload: { message: `Unknown message type: ${msg.type}` },
      });
  }
}

async function handleConversationChat(
  ws: WebSocket,
  conversationId: string,
  claudeId: string,
  memberIds: string[],
  abortSignal?: AbortSignal,
): Promise<void> {
  try {
    await handleChat(
      // Load history from DB for context
      await chatService.getMessagesForClaude(conversationId),
      (token) => {
        broadcastToUsers(memberIds, {
          type: "chat:message:token",
          payload: { conversationId, token },
        });
      },
      async (fullContent) => {
        activeConversationAbortControllers.delete(conversationId);
        // Save Claude's complete response to DB
        const saved = await chatService.saveMessage(conversationId, claudeId, fullContent);
        broadcastToUsers(memberIds, {
          type: "chat:message:done",
          payload: { conversationId, message: saved },
        });
      },
      (message) => {
        activeConversationAbortControllers.delete(conversationId);
        broadcastToUsers(memberIds, {
          type: "chat:message:error",
          payload: { conversationId, message },
        });
      },
      (name, input, result) => {
        broadcastToUsers(memberIds, {
          type: "chat:message:tool",
          payload: { conversationId, name, input, result },
        });
      },
      undefined, // context
      undefined, // domSnapshot
      abortSignal,
    );
  } catch (err: unknown) {
    activeConversationAbortControllers.delete(conversationId);
    send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) || "Chat failed" } });
  }
}

export async function createServer(): Promise<WebSocketServer> {
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
    // stores it in localStorage via a self-contained HTML page that redirects
    // to /. Bound to loopback (127.0.0.1 / ::1) so it can't be reached from
    // other hosts even if the dev server is exposed. Intended for UI automation
    // (Chrome DevTools MCP) where Google OAuth can't be completed headlessly.
    if (req.url?.startsWith("/test-login") && req.method === "GET") {
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
    broadcast({ type: "stats", payload: stats });
  });

  // Capture manager stdout/stderr and broadcast to clients
  startLogCapture((data) => {
    broadcast({ type: "logs:data", payload: { source: "manager", data } });
  });

  // Sync droplet statuses on startup and every 60s
  void syncDropletStatuses();
  setInterval(() => void syncDropletStatuses(), 60_000);

  // Broadcast presence detail every 3s for real-time action updates
  setInterval(() => broadcastPresenceDetail(), 3_000);

  // Forward PTY events — filtered to authorized users
  setPtyEventCallback((event) => {
    const sessionId = (event.payload as Record<string, unknown> | undefined)?.id as string | undefined;
    if (sessionId) {
      const access = getSessionAccess(sessionId);
      if (access) {
        broadcastToUsers([access.ownerId, ...access.collaboratorIds], event as WsMessage);
        return;
      }
    }
    broadcast(event as WsMessage);
  });

  wss.on("connection", (ws, req) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || null;
    const userAgent = (req.headers["user-agent"] as string) || null;
    clients.set(ws, { userId: null, user: null, impersonatedBy: null, clientType: "web", assistantSessionId: null, currentNav: null, recentActions: [], ip, userAgent });
    console.log(`Client connected (${clients.size} total)`);

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
      // Abort any active chat stream for this connection
      const chatAbort = activeChatAbortControllers.get(ws);
      if (chatAbort) {
        chatAbort.abort();
        activeChatAbortControllers.delete(ws);
      }

      // Abort any active security scans for this connection
      for (const [scanId, ctrl] of activeSecurityAbortControllers) {
        ctrl.abort();
        activeSecurityAbortControllers.delete(scanId);
      }

      const closingState = clients.get(ws);
      const wasAuthenticated = closingState?.userId != null;
      // Tear down persistent MCP tunnel if this was the extension
      if (closingState?.clientType === "chrome-extension" && closingState?.userId) {
        teardownPersistentMcpTunnels(closingState.userId).catch(() => {});
      }
      // Clean up terminal collaborations
      if (closingState?.userId) {
        const affected = removeCollaboratorFromAll(closingState.userId);
        for (const sessionId of affected) {
          const access = getSessionAccess(sessionId);
          if (access) {
            const allUsers = [access.ownerId, ...access.collaboratorIds];
            broadcastToUsers(allUsers, {
              type: "terminal:share:viewers",
              payload: { sessionId, viewerIds: allUsers },
            });
          }
        }
      }
      clients.delete(ws);
      console.log(`Client disconnected (${clients.size} total)`);
      if (wasAuthenticated) broadcastPresence();
    });
  });

  wss.on("listening", () => {
    console.log(`Genie manager WebSocket server listening on port ${PORT}`);
  });

  return wss;
}

export function shutdown(wss: WebSocketServer): void {
  backupService.stopBackupCron();
  stopMonitoring();
  projectManager.stopEverything();
  closeAllPtys();
  // Close all VPS agent sessions
  for (const [, session] of activeAgentSessions) {
    session.stop();
  }
  activeAgentSessions.clear();
  for (const [ws] of clients) {
    ws.close();
  }
  clients.clear();
  wss.close();
}
