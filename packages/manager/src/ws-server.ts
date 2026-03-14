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
import * as store from "./store.js";
import * as appManager from "./app-manager.js";
import * as projectService from "./project-service.js";
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
import type { StreamingChannel } from "./vps/ssh-client.js";
import { vpsDeploy, vpsStatus, vpsLogs, vpsTeardown, vpsStats, remoteDir } from "./vps/deploy-service.js";
import { createDoClient } from "./vps/do-api-client.js";
import { doProvisionAndDeploy, doDestroyDroplet, ensureGenieKeyOnDisk, ensureGenieKeyPair, writeKeyToDisk, sshKeyFingerprint } from "./vps/do-provision.js";
import { createBaseImage } from "./vps/do-base-image.js";
import { setupMcpTunnel, type McpTunnel } from "./vps/mcp-tunnel.js";
import type { VpsConnectionConfig, ClientType, DomActionExecutor, AgentOutboundMessage } from "./types.js";
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

/** Active SSH sessions for inline project commands (key: projectId:commandId) */
const activeCommandSessions = new Map<string, SshSession>();

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
): Promise<boolean> {
  // Extract projectId from context string
  if (!chatContext) { console.log(`[claude-code] No chatContext, skipping VPS route`); return false; }
  const projectIdMatch = chatContext.match(/Project ID:\s*([a-f0-9-]+)/i)
    || chatContext.match(/projectId[=:]\s*["']?([a-f0-9-]+)/i);
  if (!projectIdMatch) { console.log(`[claude-code] No projectId found in context: ${chatContext.slice(0, 200)}`); return false; }

  const projectId = projectIdMatch[1];
  const project = await projectService.getById(projectId);
  if (!project || project.vpsInstances.length === 0) return false;

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

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || "";

    // Resolve claude binary path and read AGENT.md in parallel
    send(ws, { type: "chat:status", payload: { status: "Connecting to Claude Code..." } });

    const [claudePath, agentMd] = await Promise.all([
      sshSession.exec(`bash -lc "which claude" 2>/dev/null || echo ""`, undefined, { timeoutMs: 10_000 }).then(s => s.trim()),
      sshSession.exec(`cat ${dest}/AGENT.md 2>/dev/null || echo ""`, undefined, { timeoutMs: 5_000 }).then(s => s.trim()),
    ]);

    if (!claudePath) {
      console.error(`[claude-code] claude binary not found on VPS`);
      send(ws, { type: "chat:error", payload: { message: "Claude Code CLI not found on VPS. Install it with: npm install -g @anthropic-ai/claude-code" } });
      activeChatAbortControllers.delete(ws);
      return true; // handled (with error)
    }
    console.log(`[claude-code] Found claude at: ${claudePath}`);

    // Build system context with AGENT.md
    let systemContext = chatContext || "";
    systemContext += `\n\nServer public IP: ${instance.connection.host}`;
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
      `exec ${claudePath} -p "$PROMPT" --output-format stream-json --verbose --append-system-prompt "$CTX"${resumeFlag}`,
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
      broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
    }
  } catch (err) {
    // Silently ignore — sync will retry next interval
  }
}

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT) || 9876;

interface ClientState {
  userId: string | null;
  user: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  clientType: ClientType;
  assistantSessionId: string | null;
}

const clients = new Map<WebSocket, ClientState>();

async function buildAuthPayload(user: { id: string; name: string; email: string; avatarUrl: string | null; role: string }, token: string) {
  const admin = await isAdmin(user.id);
  return { token, user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, isAdmin: admin, role: user.role } };
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

/* ---- Persistent MCP browser tunnel ---- */

const MCP_BROWSER_REMOTE_PORT = 9877;

interface PersistentMcpTunnel {
  sshSession: SshSession;
  mcpTunnel: McpTunnel;
  extensionWs: WebSocket;
}

/** One persistent tunnel per userId (keyed by userId) */
const persistentMcpTunnels = new Map<string, PersistentMcpTunnel>();

async function setupPersistentMcpTunnel(extensionWs: WebSocket, userId: string): Promise<void> {
  // Tear down any existing tunnel for this user
  await teardownPersistentMcpTunnel(userId);

  // Find a project with a VPS for this user
  const projects = await projectService.getAll();
  const project = projects.find(p => p.vpsInstances.length > 0);
  if (!project) {
    console.log(`[mcp-persistent] No project with VPS found, skipping persistent tunnel`);
    return;
  }

  const instance = project.vpsInstances[0];
  const dest = remoteDir(project.name);

  try {
    const sshSession = await connectSsh(instance.connection, { timeoutMs: 30_000 });
    const domExecutor = createDomActionExecutor(extensionWs);
    const mcpTunnel = await setupMcpTunnel(sshSession, domExecutor, { remotePort: MCP_BROWSER_REMOTE_PORT });

    persistentMcpTunnels.set(userId, { sshSession, mcpTunnel, extensionWs });

    // Merge genie-browser into .mcp.json on the VPS
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
      `    fs.writeFileSync('${dest}/.mcp.json', JSON.stringify(cfg, null, 2));`,
      `  });`,
      `"`,
    ].join("\n");
    await sshSession.exec(mergeScript);

    console.log(`[mcp-persistent] Tunnel ready for user ${userId} → VPS ${instance.connection.host}:${MCP_BROWSER_REMOTE_PORT}`);
  } catch (err: unknown) {
    console.error(`[mcp-persistent] Failed to set up persistent tunnel: ${(err instanceof Error ? err.message : String(err))}`);
  }
}

async function teardownPersistentMcpTunnel(userId: string): Promise<void> {
  const existing = persistentMcpTunnels.get(userId);
  if (!existing) return;
  persistentMcpTunnels.delete(userId);
  try { existing.mcpTunnel.close(); } catch {}
  try { existing.sshSession.close(); } catch {}
  console.log(`[mcp-persistent] Tunnel torn down for user ${userId}`);
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

function getConnectedUserIds(): string[] {
  const ids = new Set<string>();
  for (const [, state] of clients) {
    if (state.userId) ids.add(state.userId);
  }
  return [...ids];
}

function broadcastPresence(): void {
  const connectedUserIds = getConnectedUserIds();
  broadcast({ type: "chat:presence", payload: { connectedUserIds } });
}

async function sendInitialData(ws: WebSocket, userId?: string): Promise<void> {
  // Send current app list and log backlog on connect
  send(ws, { type: "app:list", payload: { apps: store.getAll() } });
  const logs = appManager.getAllLogBuffers();
  for (const [id, data] of Object.entries(logs)) {
    send(ws, { type: "app:log", payload: { id, stream: "stdout", data } });
  }

  // Send current project list and log backlogs on connect
  send(ws, { type: "project:list", payload: { projects: await projectService.getAll() } });
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
          const state = clients.get(ws);
          if (state) {
            state.userId = user.id;
            state.user = { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
          }
          const authPayload = await buildAuthPayload(user, token);
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

  // --- Chrome Extension handlers ---
  if (msg.type === "extension:identify") {
    state.clientType = "chrome-extension";
    send(ws, { type: "extension:identified", payload: {} });
    // Set up persistent MCP browser tunnel in background
    setupPersistentMcpTunnel(ws, userId).catch(err =>
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
    case "app:add": {
      const { name, command, cwd, env } = msg.payload;
      if (!name || !command) {
        send(ws, {
          type: "error",
          payload: { message: "name and command are required" },
        });
        return;
      }
      const app = store.add({ name, command, cwd, env });
      broadcast({ type: "app:list", payload: { apps: store.getAll() } });
      break;
    }

    case "app:remove": {
      const { id } = msg.payload;
      appManager.stopApp(id);
      const removed = store.remove(id);
      if (!removed) {
        send(ws, {
          type: "error",
          payload: { message: `App ${id} not found` },
        });
        return;
      }
      broadcast({ type: "app:list", payload: { apps: store.getAll() } });
      break;
    }

    case "app:start": {
      const { id } = msg.payload;
      const started = appManager.startApp(id);
      if (!started) {
        send(ws, {
          type: "error",
          payload: { message: `Cannot start app ${id}` },
        });
      }
      break;
    }

    case "app:stop": {
      const { id } = msg.payload;
      const stopped = appManager.stopApp(id);
      if (!stopped) {
        send(ws, {
          type: "error",
          payload: { message: `Cannot stop app ${id}` },
        });
      }
      break;
    }

    case "app:list": {
      send(ws, { type: "app:list", payload: { apps: store.getAll() } });
      break;
    }

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
      const { messages, context: chatContext, domSnapshot, source, modelId } = msg.payload;
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
          (name, input, result) => {
            send(ws, { type: "chat:tool", payload: { name, input, result } });
            collectedToolUses.push({ name, input, result });
            if (name === "write_project_file") {
              void projectService.getAll().then((ps) =>
                broadcast({ type: "project:list", payload: { projects: ps } })
              );
            }
          },
          enrichedContext,
          domSnapshot,
          abortController.signal,
          domActionExecutor,
          resolvedModelId,
          resolvedMaxToolRounds,
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
        const { name, memberIds, type } = msg.payload;
        let conversation;
        if (type === "dm") {
          // DM with Claude
          const claudeId = getClaudeUserId();
          conversation = await chatService.getOrCreateClaudeDm(userId, claudeId);
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
      const { name, commands, vpsRegion, vpsSize, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken, gitlabDeployKey: projDeployKey, dbUrl: projDbUrl } = msg.payload;
      if (!name) {
        send(ws, {
          type: "error",
          payload: { message: "name is required" },
        });
        return;
      }
      const added = await projectService.add({ name, commands, vpsRegion, vpsSize, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken, gitlabDeployKey: projDeployKey, dbUrl: projDbUrl });
      broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
      break;
    }

    case "project:update": {
      const { id, name, commands, vpsRegion, vpsSize, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken2, gitlabDeployKey: projDeployKey2, dbUrl: projDbUrl2, gitFolders } = msg.payload;
      await projectManager.stopAll(id);
      const updated = await projectService.update(id, { name, commands, vpsRegion, vpsSize, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken2, gitlabDeployKey: projDeployKey2, dbUrl: projDbUrl2, gitFolders });
      if (!updated) {
        send(ws, {
          type: "error",
          payload: { message: `Project ${id} not found` },
        });
        return;
      }
      broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
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
      broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
      break;
    }

    case "project:list": {
      send(ws, { type: "project:list", payload: { projects: await projectService.getAll() } });
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
        // Tell the client to open an SSH terminal tab and run the command in it
        send(ws, { type: "project:command:terminal", payload: { projectId, commandId, instanceId, commandName: cmd.name, command: cmd.command } });
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
          await session.exec(`cd /opt/project 2>/dev/null || true; ${cmd.command}`, (chunk) => {
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
        send(ws, { type: "do:snapshots:list", payload: { snapshots: snapshots.map(s => ({ id: s.id, name: s.name, regions: s.regions })) } });
      } catch {
        send(ws, { type: "do:snapshots:list", payload: { snapshots: [] } });
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
          username: "root",
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
        // Write server public IP into CLAUDE.md
        try {
          const sshTmp = await connectSsh(connection, { timeoutMs: 15_000 });
          const claudeMdPath = `${remoteDir(doProject.name)}/CLAUDE.md`;
          const ipLine = `Server public IP: ${result.ipAddress}`;
          const script = `node -e "
            const fs = require('fs');
            const p = '${claudeMdPath}';
            let c = '';
            try { c = fs.readFileSync(p, 'utf8'); } catch {}
            if (c.includes('Server public IP:')) {
              c = c.replace(/Server public IP:.*/g, '${ipLine}');
            } else {
              const i = c.indexOf('\\n');
              c = i >= 0 ? c.slice(0, i + 1) + '\\n${ipLine}\\n' + c.slice(i + 1) : '${ipLine}\\n' + c;
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
        broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
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
              username: "root",
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
          broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
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
          broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
        }
        send(ws, { type: "do:destroy-failed-droplet:done", payload: { dropletId: failedDropletId } });
      } catch (err: unknown) {
        send(ws, { type: "do:destroy-failed-droplet:error", payload: { dropletId: failedDropletId, message: (err instanceof Error ? err.message : String(err)) } });
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
        // Write server public IP into CLAUDE.md
        try {
          const sshTmp = await connectSsh(connection, { timeoutMs: 15_000 });
          const claudeMdPath = `${remoteDir(project.name)}/CLAUDE.md`;
          const ipLine = `Server public IP: ${connection.host}`;
          const script = `node -e "
            const fs = require('fs');
            const p = '${claudeMdPath}';
            let c = '';
            try { c = fs.readFileSync(p, 'utf8'); } catch {}
            if (c.includes('Server public IP:')) {
              c = c.replace(/Server public IP:.*/g, '${ipLine}');
            } else {
              const i = c.indexOf('\\n');
              c = i >= 0 ? c.slice(0, i + 1) + '\\n${ipLine}\\n' + c.slice(i + 1) : '${ipLine}\\n' + c;
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
        broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
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
        broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
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
        broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
        send(ws, { type: "vps:teardown:done", payload: { projectId, instanceId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:teardown:error", payload: { projectId, instanceId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      break;
    }

    case "vps:disconnect": {
      const { projectId, instanceId } = msg.payload;
      await projectService.removeVpsInstance(projectId, instanceId);
      broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
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

    case "admin:droplets:list": {
      const doToken = await settingsService.getGlobalDoToken();
      if (!doToken) {
        send(ws, { type: "admin:droplets:list", payload: { droplets: [], error: "DigitalOcean API token not configured. Configure it in Settings." } });
        break;
      }
      try {
        const doClient = createDoClient(doToken);
        const droplets = await doClient.listDroplets("genie");
        const projects = await projectService.getAll();
        const projectMap: Record<number, { projectId: string; projectName: string }> = {};
        for (const p of projects) {
          for (const v of p.vpsInstances) {
            if (v.digitalocean?.dropletId) {
              projectMap[v.digitalocean.dropletId] = { projectId: p.id, projectName: p.name };
            }
          }
        }
        send(ws, { type: "admin:droplets:list", payload: { droplets, projectMap } });
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:list", payload: { droplets: [], error: (err instanceof Error ? err.message : String(err)) } });
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
        // Clear vps instance from owning project if any
        const projects = await projectService.getAll();
        for (const p of projects) {
          const inst = p.vpsInstances.find(v => v.digitalocean?.dropletId === dropletId);
          if (inst) {
            await projectService.removeVpsInstance(p.id, inst.id);
            broadcast({ type: "project:list", payload: { projects: await projectService.getAll() } });
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
        if (stored) {
          const fingerprint = sshKeyFingerprint(stored.publicKey);
          send(ws, { type: "admin:sshkey:result", payload: { exists: true, publicKey: stored.publicKey, fingerprint } });
        } else {
          send(ws, { type: "admin:sshkey:result", payload: { exists: false, publicKey: null, fingerprint: null } });
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
          send(ws, { type: "admin:sshkey:result", payload: { exists: true, publicKey, fingerprint } });
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
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
      const { id, host, port, username, privateKeyPath, cols, rows } = msg.payload;
      spawnSshPty(id, cols || 80, rows || 24, {
        host,
        port: port || 22,
        username: username || "root",
        privateKeyPath: privateKeyPath || "~/.genie/ssh/genie_ed25519",
      }, userId);
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

  appManager.setEventCallback((event) => {
    broadcast(event as WsMessage);
  });

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

  wss.on("connection", (ws) => {
    clients.set(ws, { userId: null, user: null, clientType: "web", assistantSessionId: null });
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

      const closingState = clients.get(ws);
      const wasAuthenticated = closingState?.userId != null;
      // Tear down persistent MCP tunnel if this was the extension
      if (closingState?.clientType === "chrome-extension" && closingState?.userId) {
        teardownPersistentMcpTunnel(closingState.userId).catch(() => {});
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
  appManager.stopAll();
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
