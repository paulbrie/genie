import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { VpsConnectionConfig, AgentOutboundMessage } from "../types.js";
import { connectSsh, type StreamingChannel } from "./ssh-client.js";
import { execCached } from "./ssh-session-cache.js";
import { remoteDir } from "./deploy-service.js";

/** A live VPS-agent session connected over SSH. The agent is the long-running
 *  Node process on the VM that mediates Claude Code chat. */
export interface VpsAgentSession {
  send(msg: object): void;
  onMessage(handler: (msg: AgentOutboundMessage) => void): void;
  stop(): void;
  lastActivity: number;
  /** The WebSocket currently using this session (prevents concurrent chat collisions). */
  currentWs: WebSocket | null;
}

/** Remote install path. Mirrored across the merge-script helper and `mcp-cli`
 *  invocations, so any move needs an audit grep. */
export const VPS_AGENT_REMOTE_BASE = "/usr/lib/node_modules/@genie/vps-agent";
const VERSION_FILE = `${VPS_AGENT_REMOTE_BASE}/.version`;

/** Active VPS agent sessions keyed by `${projectId}:${instanceId}`. Shared
 *  across the whole manager so a single session per VM gets reused by any
 *  Claude launch path (chat:send, extension auth, etc.). */
export const activeAgentSessions = new Map<string, VpsAgentSession>();

/** Idle eviction window. Sessions silent for longer than this get torn down by
 *  the janitor below — frees the SSH channel and any open file handles. */
const AGENT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of activeAgentSessions) {
    if (now - session.lastActivity > AGENT_IDLE_TIMEOUT_MS) {
      session.stop();
      activeAgentSessions.delete(key);
    }
  }
}, 60_000);

/** Resolve path to vps-agent dist directory (relative to this package). */
export function getVpsAgentDistDir(): string {
  // packages/manager/dist/vps/vps-agent-rsync.js → packages/vps-agent/dist
  const dir = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(dir, "../../../vps-agent/dist");
}

/** Compute a hash of all local vps-agent dist JS files + package.json. The
 *  remote compares this against `.version` on disk to decide whether to
 *  re-upload. */
export async function computeLocalAgentHash(): Promise<string> {
  const localDist = getVpsAgentDistDir();
  const localPkg = path.resolve(localDist, "../package.json");
  const hash = crypto.createHash("sha256");

  hash.update(await fsp.readFile(localPkg));

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

/** Collect every file we need to ship to the VM: package.json + every .js
 *  under the local dist directory, paired with its destination remote path. */
export async function collectAgentFiles(): Promise<{ remotePath: string; content: string }[]> {
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

/** Ensure the vps-agent on the remote VPS matches the local build, re-uploading
 *  if stale. Idempotent: warm hash-match is one short cached probe. */
export async function ensureVpsAgent(connection: VpsConnectionConfig): Promise<void> {
  const localHash = await computeLocalAgentHash();

  // Check remote version through the shared session cache: this probe is
  // read-only and idempotent, so a warm ensureVpsAgent reuses an existing
  // cached connection instead of opening a throwaway dial just to read the hash.
  // The bundle upload below keeps its own dedicated session so a slow multi-step
  // upload isn't serialized behind stats probes on the cached connection.
  let remoteHash = "";
  try {
    remoteHash = (await execCached(connection, `cat ${VERSION_FILE} 2>/dev/null || echo ""`)).trim();
  } catch { /* missing */ }

  if (remoteHash === localHash) return;

  console.log(`[vps-agent] Version mismatch (local=${localHash}, remote=${remoteHash || "none"}), uploading...`);
  const filesToUpload = await collectAgentFiles();

  const uploadSession = await connectSsh(connection, { timeoutMs: 30_000 });
  try {
    // Create directory structure. `/usr/lib/node_modules/@genie` is root-owned
    // (the base recipe creates it with `sudo mkdir` for vps-stats), so the
    // sibling vps-agent dir has to be created with sudo too. Chown to genie
    // afterwards so the base64 writes and `npm install` below succeed as the
    // unprivileged session user.
    const dirs = new Set(filesToUpload.map((f) => path.posix.dirname(f.remotePath)));
    await uploadSession.exec(
      `sudo mkdir -p ${[...dirs].join(" ")} && sudo chown -R genie:genie ${VPS_AGENT_REMOTE_BASE}`,
    );

    for (const file of filesToUpload) {
      const b64 = Buffer.from(file.content).toString("base64");
      await uploadSession.exec(`echo '${b64}' | base64 -d > ${file.remotePath}`);
    }

    await uploadSession.exec(`cd ${VPS_AGENT_REMOTE_BASE} && npm install --omit=dev --no-audit --no-fund 2>&1`);

    await uploadSession.exec(`echo '${localHash}' > ${VERSION_FILE}`);
    console.log(`[vps-agent] Uploaded successfully (version=${localHash})`);
  } finally {
    uploadSession.close();
  }
}

/** Start a VPS agent process on a remote VPS via SSH. Reuses an existing
 *  session for the same `${projectId}:${instanceId}` when one is alive. */
export async function startVpsAgent(
  project: { id: string; name: string },
  instance: { id: string; label: string; connection: VpsConnectionConfig },
): Promise<VpsAgentSession> {
  const sessionKey = `${project.id}:${instance.id}`;

  const existing = activeAgentSessions.get(sessionKey);
  if (existing) {
    existing.lastActivity = Date.now();
    return existing;
  }

  await ensureVpsAgent(instance.connection);

  const sshSession = await connectSsh(instance.connection, { timeoutMs: 30_000 });

  const channel: StreamingChannel = await sshSession.execStreaming(
    `node ${VPS_AGENT_REMOTE_BASE}/dist/index.js`,
  );

  let messageHandler: ((msg: AgentOutboundMessage) => void) | null = null;
  let lineBuffer = "";
  let channelClosed = false;

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

  channel.stdout.on("end", () => {
    channelClosed = true;
    messageHandler?.({ type: "error", message: "VPS agent process exited unexpectedly" });
  });

  channel.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.error(`[vps-agent:${instance.label}] ${text}`);
  });

  const session: VpsAgentSession = {
    lastActivity: Date.now(),
    currentWs: null,
    send(msg: object) {
      if (channelClosed) return;
      session.lastActivity = Date.now();
      try {
        channel.stdin.write(JSON.stringify(msg) + "\n");
      } catch {
        // Stream already ended — ignore.
      }
    },
    onMessage(handler) {
      messageHandler = handler;
    },
    stop() {
      channelClosed = true;
      try { channel.close(); } catch { /* already closed */ }
      try { sshSession.close(); } catch { /* already closed */ }
      activeAgentSessions.delete(sessionKey);
    },
  };

  activeAgentSessions.set(sessionKey, session);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  session.send({
    type: "init",
    apiKey,
    projectDir: remoteDir(project.name),
    maxToolRounds: 40,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("VPS agent did not respond with 'ready' within 8s"));
      }, 8_000);

      const originalHandler = messageHandler;
      session.onMessage((msg) => {
        if (msg.type === "ready") {
          clearTimeout(timeout);
          session.onMessage(originalHandler || (() => { /* noop */ }));
          resolve();
        } else if (msg.type === "error") {
          clearTimeout(timeout);
          reject(new Error(msg.message));
        }
      });
    });
  } catch (err) {
    session.stop();
    throw err;
  }

  return session;
}
