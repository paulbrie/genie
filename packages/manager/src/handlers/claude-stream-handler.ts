import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import { getVpsConnection } from "../vps/connection-resolver.js";
import { remoteDir } from "../vps/deploy-service.js";
import { execCached } from "../vps/ssh-session-cache.js";
import { connectSsh } from "../vps/ssh-client.js";
import { getResumeState } from "../chat/assistant-session-state-service.js";
import { provisionClaudeOneShot, getCachedClaudeProvision, setCachedClaudeProvision, invalidateClaudeProvision, type ExecFn } from "../chat/vps-claude-launch.js";
import {
  startClaudeStream,
  reattachClaudeStream,
  sendClaudeStreamInput,
  runClaudeStreamBash,
  runClaudeStreamGitDiff,
  stopClaudeStream,
  resizeClaudeStream,
  detachClaudeStream,
  writeClaudeStreamFile,
} from "../ssh/claude-stream/session.js";
import { type Role } from "../auth/ws-acl.js";
import { canAccessProject } from "./handler-auth.js";
import * as analyticsService from "../logging/analytics-service.js";

/** Ids with a start in flight (provisioning not yet finished). Guards against the
 *  renderer's double `claude:stream:start` (button-click + window-mount) racing
 *  into two parallel provision/launch passes before the session registers. */
const startingStreams = new Set<string>();

/** Deterministic tmux session name for a chat-mode Claude stream. Stable across
 *  reconnects so `tmux new-session -A` attaches to a surviving session (e.g.
 *  after a manager restart) instead of spawning a duplicate. Kept distinct from
 *  the interactive terminal's tmux name so the two modes never share a process. */
function chatTmuxName(claudeStreamId: string): string {
  return `claude-chat-${claudeStreamId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24)}`;
}

/** Node script (run on the VM) that lists prior Claude sessions for a project
 *  dir: newest 25 transcripts, each with id, mtime, line count, and a short title
 *  (the session summary, else the first user message). Prints a JSON array. */
const LIST_SESSIONS_NODE_SCRIPT = String.raw`
const fs = require("fs"), path = require("path");
const dir = process.argv[2];
let files = [];
try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch (e) { process.stdout.write("[]"); return; }
const items = files
  .map((f) => { try { const st = fs.statSync(path.join(dir, f)); return { f, m: st.mtimeMs }; } catch (e) { return null; } })
  .filter(Boolean)
  .sort((a, b) => b.m - a.m)
  .slice(0, 25);
const out = items.map((it) => {
  const sessionId = it.f.replace(/\.jsonl$/, "");
  let firstUser = "", summary = "", count = 0;
  let lines = [];
  try { lines = fs.readFileSync(path.join(dir, it.f), "utf8").split("\n"); } catch (e) {}
  for (const line of lines) {
    if (!line.trim()) continue;
    count++;
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    if (!summary && o.type === "summary" && typeof o.summary === "string") summary = o.summary;
    if (!firstUser && o.type === "user" && o.message) {
      const c = o.message.content;
      if (typeof c === "string") firstUser = c;
      else if (Array.isArray(c)) { const t = c.find((x) => x && x.type === "text"); if (t) firstUser = t.text || ""; }
    }
  }
  const title = (summary || firstUser || "").replace(/\s+/g, " ").trim().slice(0, 80);
  return { sessionId, mtime: Math.round(it.m), messages: count, title };
});
process.stdout.write(JSON.stringify(out));
`;

/** Concise system prompt describing the genie-* MCP tools available on the VM. */
function buildStreamContext(serverIp: string, agentMd: string): string {
  let ctx = `You are operating on a cloud VM at ${serverIp}, in /opt/project.`;
  ctx += `\nTo test the app in a browser use chrome-devtools (Puppeteer) headless; reach it at http://${serverIp}:3000 (NEVER localhost/127.0.0.1).`;
  ctx += `\n\nYou have genie-* MCP tools: genie-tracker (issue tracker — tracker_list_issues / tracker_get_issue / tracker_update_issue / tracker_comment_on_issue; set in_progress when starting, in_review when done, never done), genie-security (security_scan / security_list_scans / security_get_scan), genie-notify (notify_send_email / notify_send_chat_message), and genie-storage (storage_screenshot / storage_upload / storage_list / storage_get_url / storage_delete).`;
  if (agentMd) ctx += `\n\n=== Agent Memory (AGENT.md) ===\n${agentMd}`;
  return ctx;
}

/** Handle every `claude:stream:*` message. Returns true if handled. */
export async function handleClaudeStreamMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string | null,
  role: Role | null,
): Promise<boolean> {
  switch (msg.type) {
    case "claude:stream:start": {
      const { claudeStreamId, projectId, instanceId, tmuxName: boundTmuxName, resumeSessionId: requestedResumeId, fresh } = msg.payload as {
        claudeStreamId?: string; projectId?: string; instanceId?: string; tmuxName?: string; resumeSessionId?: string; fresh?: boolean;
      };
      if (!claudeStreamId || !projectId || !instanceId) {
        send(ws, { type: "claude:stream:error", payload: { claudeStreamId: claudeStreamId ?? null, message: "claudeStreamId, projectId and instanceId are required" } });
        return true;
      }
      // Reconnect fast-path: an in-memory session still alive (within its grace
      // window) rebinds to this socket and replays the transcript.
      if (reattachClaudeStream(ws, claudeStreamId)) {
        void analyticsService.recordEvent({ userId, userName: null, event: "claude_stream.reattach", projectId, props: {}, ip: null });
        return true;
      }
      if (startingStreams.has(claudeStreamId)) return true; // a start is already provisioning
      if (!(await canAccessProject(userId, role, projectId))) {
        send(ws, { type: "claude:stream:error", payload: { claudeStreamId, message: "Not authorized for this project" } });
        return true;
      }
      startingStreams.add(claudeStreamId);
      // Hoisted so the catch block can tear down the pre-dialed stream connection
      // (assigned inside the try once shellOpts is resolved).
      let closeStreamConn: () => void = () => {};
      try {
        send(ws, { type: "claude:stream:status", payload: { claudeStreamId, status: "Connecting to VPS..." } });
        const conn = await getVpsConnection(projectId, instanceId);
        const shellOpts = { host: conn.host, port: conn.port ?? 22, username: conn.username, privateKeyPath: conn.privateKeyPath };
        const dest = remoteDir(projectId);
        const exec: ExecFn = (cmd, opts) => execCached(shellOpts, cmd, undefined, opts);

        // Fix A: start the dedicated stream connection's SSH dial NOW, overlapping
        // its ~1–3s handshake with the provisioning below (which only needs the
        // cached exec session, not this one). startClaudeStream awaits it once it's
        // ready to write the launch script. Pre-attach a catch so an early bail
        // (no claudePath / provisioning throw) can't surface as an unhandled
        // rejection; those paths close it explicitly.
        const streamConnPromise = connectSsh(shellOpts, { timeoutMs: 30_000 });
        streamConnPromise.catch(() => {});
        closeStreamConn = () => { void streamConnPromise.then((c) => c.close()).catch(() => {}); };

        send(ws, { type: "claude:stream:status", payload: { claudeStreamId, status: "Connecting to Claude Code..." } });
        // Fix B: skip the per-VM provisioning dance (binary discovery, auth probe,
        // MCP + settings writes — several serialized SSH round-trips, including a
        // full `claude auth status` cold-start) when we've recently provisioned
        // this VM. Cold path runs it and caches the result.
        const provisionKey = `${projectId}:${instanceId}`;
        let provision = getCachedClaudeProvision(provisionKey);
        if (!provision) {
          // Fix C: one SSH exec does binary discovery + AGENT.md + settings + MCP
          // config + auth, instead of ~7 serialized round-trips.
          provision = await provisionClaudeOneShot(
            exec,
            { dest, projectId, instanceId },
            (status) => send(ws, { type: "claude:stream:status", payload: { claudeStreamId, status } }),
          );
          if (!provision) {
            closeStreamConn();
            send(ws, { type: "claude:stream:error", payload: { claudeStreamId, message: "Could not find or install Claude Code CLI on VPS. SSH in and run: npm install -g @anthropic-ai/claude-code" } });
            return true;
          }
          setCachedClaudeProvision(provisionKey, provision);
        }
        const { claudePath, auth, agentMd } = provision;
        const envApiKey = process.env.ANTHROPIC_API_KEY || "";
        const apiKey = !auth.hasSubscription && envApiKey ? envApiKey : null;

        // Resume prior on-disk history for this chat surface (separate key from
        // the floating assistant so the two don't hijack each other's session).
        const sessionKey = `${projectId}:${instanceId}:chat`;
        // `fresh` (the "New chat" / Claude button) → start a blank session: don't
        // resume the surface's last on-disk session, which would otherwise make
        // every new window replay the same conversation. An explicit resume id
        // (the "Sessions" picker) still wins; otherwise fall back to last-on-disk.
        const resumeState = fresh ? null : await getResumeState(sessionKey);
        const resumeSessionId = fresh
          ? null
          : ((requestedResumeId && /^[a-zA-Z0-9_-]+$/.test(requestedResumeId))
            ? requestedResumeId
            : (resumeState?.sessionId ?? null));
        const context = buildStreamContext(conn.host, agentMd);

        const claudeInfo = {
          model: "",
          email: auth.email,
          plan: auth.plan || (auth.hasSubscription ? "Max" : envApiKey ? "API Key" : ""),
          version: "",
        };
        // Bind to the specific chat session when the renderer names one
        // (per-session chat); else the VM's default chat session.
        // Accept any `claude-<…>` name (e.g. `claude-<user>-<token>` from the
        // renderer, or legacy `claude-chat-*`). Restricted to safe chars since
        // the name is interpolated into shell/tmux commands downstream.
        const tmuxName = boundTmuxName && /^claude-[a-zA-Z0-9_-]+$/.test(boundTmuxName)
          ? boundTmuxName
          : chatTmuxName(claudeStreamId);
        await startClaudeStream(ws, {
          claudeStreamId, shellOpts, projectId, instanceId, sessionKey,
          tmuxName,
          claudePath, dest, context,
          resumeSessionId,
          apiKey,
          authEmail: claudeInfo.email, authPlan: claudeInfo.plan, claudeInfo,
          connPromise: streamConnPromise,
        });

        void analyticsService.recordEvent({ userId, userName: null, event: "claude_stream.open", projectId, props: {}, ip: null });
      } catch (err) {
        // Any failure before/at launch: close the pre-dialed stream connection so a
        // failed open doesn't leak an SSH transport (orphaned sshd on the VM). Safe
        // here — a successful launch returns without throwing, so we only reach this
        // on failure, where tearing the connection down is the right cleanup.
        closeStreamConn();
        // Drop cached provisioning for this VM — the failure may stem from a stale
        // claude path/auth, so force the next open to re-provision from scratch.
        invalidateClaudeProvision(`${projectId}:${instanceId}`);
        send(ws, { type: "claude:stream:error", payload: { claudeStreamId, message: err instanceof Error ? err.message : "Failed to start Claude stream" } });
      } finally {
        startingStreams.delete(claudeStreamId);
      }
      return true;
    }

    case "claude:stream:input": {
      const { claudeStreamId, text } = msg.payload as { claudeStreamId?: string; text?: string };
      if (claudeStreamId && typeof text === "string" && text.length > 0) {
        sendClaudeStreamInput(claudeStreamId, text);
        // Count this submit toward the Server dashboard's "Requests by user" — the
        // durable per-VM Claude window is its own request surface, distinct from
        // the floating assistant's assistant.message. (projectId is omitted here;
        // the session holds it server-side, and the by-user view doesn't need it.)
        void analyticsService.recordEvent({ userId, userName: null, event: "claude_stream.message", props: {}, ip: null });
      }
      return true;
    }

    case "claude:stream:paste-image": {
      // Write a pasted clipboard image to the VM and hand the renderer back the
      // remote path so it can reference it in the next message (Claude reads the
      // file). Keeps the FIFO payload tiny — base64 never travels over stdin.
      const { claudeStreamId, dataB64, ext, reqId } = msg.payload as {
        claudeStreamId?: string; dataB64?: string; ext?: string; reqId?: string;
      };
      if (!claudeStreamId || !dataB64) {
        send(ws, { type: "claude:stream:paste-image:result", payload: { ok: false, error: "claudeStreamId and dataB64 are required", reqId } });
        return true;
      }
      try {
        const bytes = Buffer.from(dataB64, "base64");
        const safeExt = ext && /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : "png";
        const rand = Math.random().toString(36).slice(2, 8);
        const remotePath = `/tmp/genie-chat-paste-${Date.now().toString(36)}-${rand}.${safeExt}`;
        await writeClaudeStreamFile(claudeStreamId, remotePath, bytes);
        send(ws, { type: "claude:stream:paste-image:result", payload: { ok: true, remotePath, reqId } });
      } catch (err) {
        send(ws, { type: "claude:stream:paste-image:result", payload: { ok: false, error: err instanceof Error ? err.message : "Failed to write image to VM", reqId } });
      }
      return true;
    }

    case "claude:stream:list-sessions": {
      // Enumerate prior on-disk Claude sessions for this project's cwd so the
      // chat window's "Sessions" picker can offer to resume one. Read-only.
      const { claudeStreamId, projectId, instanceId, reqId } = msg.payload as {
        claudeStreamId?: string; projectId?: string; instanceId?: string; reqId?: string;
      };
      if (!projectId || !instanceId) {
        send(ws, { type: "claude:stream:sessions", payload: { claudeStreamId: claudeStreamId ?? null, sessions: [], error: "projectId and instanceId are required", reqId } });
        return true;
      }
      if (!(await canAccessProject(userId, role, projectId))) {
        send(ws, { type: "claude:stream:sessions", payload: { claudeStreamId, sessions: [], error: "Not authorized for this project", reqId } });
        return true;
      }
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const shellOpts = { host: conn.host, port: conn.port ?? 22, username: conn.username, privateKeyPath: conn.privateKeyPath };
        const exec: ExecFn = (cmd, opts) => execCached(shellOpts, cmd, undefined, opts);
        const dest = remoteDir(projectId);
        // Claude stores transcripts under ~/.claude/projects/<cwd-with-non-alnum→->/<id>.jsonl.
        const encoded = dest.replace(/[^a-zA-Z0-9]/g, "-");
        const scriptPath = `/tmp/genie-list-claude-sessions.js`;
        const listScript = LIST_SESSIONS_NODE_SCRIPT;
        await exec(`cat > ${scriptPath} << 'GENIEEOF'\n${listScript}\nGENIEEOF`, { timeoutMs: 5_000 });
        const out = await exec(
          `node ${scriptPath} "$HOME/.claude/projects/${encoded}" 2>/dev/null || echo "[]"`,
          { timeoutMs: 15_000 },
        );
        let sessions: unknown = [];
        try { sessions = JSON.parse(out.trim() || "[]"); } catch { sessions = []; }
        send(ws, { type: "claude:stream:sessions", payload: { claudeStreamId, sessions, reqId } });
      } catch (err) {
        send(ws, { type: "claude:stream:sessions", payload: { claudeStreamId, sessions: [], error: err instanceof Error ? err.message : "Failed to list sessions", reqId } });
      }
      return true;
    }

    case "claude:stream:bash": {
      // Bang mode: run a shell command on the VM and return its output to the
      // popup, bypassing Claude entirely.
      const { claudeStreamId, projectId, command, reqId } = msg.payload as {
        claudeStreamId?: string; projectId?: string; command?: string; reqId?: string;
      };
      if (!claudeStreamId || !projectId || !command) {
        send(ws, { type: "claude:stream:bash:result", payload: { output: "claudeStreamId, projectId and command are required", exitCode: 1, reqId } });
        return true;
      }
      if (!(await canAccessProject(userId, role, projectId))) {
        send(ws, { type: "claude:stream:bash:result", payload: { output: "Not authorized for this project", exitCode: 1, reqId } });
        return true;
      }
      try {
        const res = await runClaudeStreamBash(claudeStreamId, command, remoteDir(projectId));
        send(ws, { type: "claude:stream:bash:result", payload: { ...res, reqId } });
      } catch (err) {
        send(ws, { type: "claude:stream:bash:result", payload: { output: err instanceof Error ? err.message : "Command failed", exitCode: 1, reqId } });
      }
      return true;
    }

    case "claude:stream:gitdiff": {
      // Review panel: capture the working-tree changes in the project dir as a
      // unified diff (read-only; never mutates the repo).
      const { claudeStreamId, projectId, reqId } = msg.payload as {
        claudeStreamId?: string; projectId?: string; reqId?: string;
      };
      if (!claudeStreamId || !projectId) {
        send(ws, { type: "claude:stream:gitdiff:result", payload: { error: "claudeStreamId and projectId are required", reqId } });
        return true;
      }
      if (!(await canAccessProject(userId, role, projectId))) {
        send(ws, { type: "claude:stream:gitdiff:result", payload: { error: "Not authorized for this project", reqId } });
        return true;
      }
      try {
        const res = await runClaudeStreamGitDiff(claudeStreamId, remoteDir(projectId));
        send(ws, { type: "claude:stream:gitdiff:result", payload: { ...res, reqId } });
      } catch (err) {
        send(ws, { type: "claude:stream:gitdiff:result", payload: { error: err instanceof Error ? err.message : "git diff failed", reqId } });
      }
      return true;
    }

    case "claude:stream:stop": {
      const { claudeStreamId } = msg.payload as { claudeStreamId?: string };
      if (claudeStreamId) stopClaudeStream(claudeStreamId);
      return true;
    }

    case "claude:stream:resize": {
      const { claudeStreamId, cols, rows } = msg.payload as { claudeStreamId?: string; cols?: number; rows?: number };
      if (claudeStreamId && cols && rows) resizeClaudeStream(claudeStreamId, cols, rows);
      return true;
    }

    case "claude:stream:close": {
      // Window close = DETACH: keep the gchat tmux session + captured output
      // alive on the VM so reopening catches up. (Truly ending the session is
      // done from the tmux row's Delete.)
      const { claudeStreamId } = msg.payload as { claudeStreamId?: string };
      if (claudeStreamId) detachClaudeStream(claudeStreamId, ws);
      return true;
    }

    default:
      return false;
  }
}
