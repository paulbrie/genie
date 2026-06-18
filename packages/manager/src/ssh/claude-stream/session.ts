/**
 * Durable streaming Claude session — the backend for chat-mode terminals.
 *
 * Runs `claude -p --input-format stream-json --output-format stream-json` inside
 * a DETACHED tmux session on the project VPS (so it survives SSH/WS drops), with:
 *   - stdin  ← a FIFO (named pipe). stream-json input requires a *pipe*, not a
 *     TTY; a long-lived `sleep` writer holds the FIFO open so claude never sees
 *     EOF between user messages. The manager writes one NDJSON frame per turn.
 *   - stdout → a file, which the manager `tail -F`s over a non-PTY exec channel.
 *     A clean byte stream (no terminal rendering) → reliable NDJSON parsing.
 *
 * Output is parsed (StreamJsonParser) into structured chat events that are
 * (a) accumulated into a server-side transcript for catch-up on reattach, and
 * (b) streamed live to the client as `claude:stream:*` messages.
 *
 * A socket drop orphans the session for a grace window (the tmux session is the
 * longer-lived backstop) so a reconnect reattaches and replays the transcript.
 */
import type { WebSocket } from "ws";

import { connectSsh, type SshSession, type StreamingChannel, type SshConnectionConfig } from "../../vps/ssh-client.js";
import { StreamJsonParser } from "../../chat/stream-json-parser.js";
import { saveResumeSessionId } from "../../chat/assistant-session-state-service.js";

export type ClaudeStreamSendFn = (ws: WebSocket, msg: { type: string; payload: unknown }) => void;

export interface StreamStep {
  content: string;
  toolUse?: { name: string; input: Record<string, unknown>; result: string };
}
export interface StreamMessageUsage {
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  modelLabel: string;
  cost: number;
}
export interface StreamMessage {
  role: "user" | "assistant";
  content: string;
  steps?: StreamStep[];
  /** Token/cost summary for an assistant turn (carried into replay). */
  usage?: StreamMessageUsage;
  /** Wall-clock the assistant spent on this turn, in ms. */
  thinkingMs?: number;
}

/** "claude-opus-4-8..." → "Opus 4.8" for the usage footer. */
function shortModelLabel(model: string): string {
  if (!model) return "Claude";
  const m = model.toLowerCase();
  const fam = m.includes("opus") ? "Opus" : m.includes("sonnet") ? "Sonnet" : m.includes("haiku") ? "Haiku" : "Claude";
  const ver = model.match(/\d+(?:[-.]\d+)?/)?.[0]?.replace(/-/g, ".");
  return ver ? `${fam} ${ver}` : fam;
}
export interface ClaudeInfo {
  model: string;
  email: string;
  plan: string;
  version: string;
}

interface StreamState {
  conn: SshSession;
  tail: StreamingChannel | null;
  parser: StreamJsonParser;
  ws: WebSocket | null;
  shellOpts: SshConnectionConfig;
  projectId: string;
  instanceId: string;
  sessionKey: string;
  tmuxName: string;
  fifoPath: string;
  outPath: string;
  authEmail: string;
  authPlan: string;
  messages: StreamMessage[];
  loading: boolean;
  streamingSteps: StreamStep[];
  currentStepContent: string;
  claudeInfo: ClaudeInfo | null;
  claudeSessionId: string | null;
  /** Newline-terminated lines consumed from the out file — the re-tail offset. */
  linesConsumed: number;
  orphanedAt: number | null;
  /** True once a deliberate close started — suppresses tail-drop re-tailing. */
  closing: boolean;
}

const MAX_MESSAGES = 200;
const GRACE_MS = 60_000;

const streams = new Map<string, StreamState>();
const orphanTimers = new Map<string, ReturnType<typeof setTimeout>>();

let sendFn: ClaudeStreamSendFn | null = null;
export function setClaudeStreamSend(fn: ClaudeStreamSendFn) {
  sendFn = fn;
}

function emit(id: string, type: string, payload: Record<string, unknown>) {
  const ws = streams.get(id)?.ws;
  if (!ws) return; // orphaned — transcript still updates, replayed on reattach
  sendFn?.(ws, { type, payload: { claudeStreamId: id, ...payload } });
}

export function hasClaudeStream(id: string): boolean {
  return streams.has(id);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** tmux binary resolver (snap installs aren't always on a non-login PATH). */
const TMUX_RESOLVE =
  'export PATH="/snap/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"; ' +
  'T=$(command -v tmux 2>/dev/null || true); ' +
  '[ -z "$T" ] && [ -e /snap/bin/tmux ] && T=/snap/bin/tmux; ' +
  '[ -z "$T" ] && [ -e /usr/bin/tmux ] && T=/usr/bin/tmux';

function snapshot(st: StreamState) {
  return {
    messages: st.messages,
    streaming: { loading: st.loading, steps: st.streamingSteps, partialContent: st.currentStepContent },
    claudeInfo: st.claudeInfo,
  };
}

function finalizeAssistantTurn(st: StreamState, usage?: StreamMessageUsage, thinkingMs?: number) {
  if (st.currentStepContent) {
    st.streamingSteps.push({ content: st.currentStepContent });
    st.currentStepContent = "";
  }
  if (st.streamingSteps.length > 0) {
    const content = st.streamingSteps.map((s) => s.content).join("");
    st.messages.push({ role: "assistant", content, steps: st.streamingSteps, ...(usage ? { usage } : {}), ...(thinkingMs ? { thinkingMs } : {}) });
    if (st.messages.length > MAX_MESSAGES) st.messages.splice(0, st.messages.length - MAX_MESSAGES);
  }
  st.streamingSteps = [];
  st.loading = false;
}

function persistSessionId(st: StreamState) {
  if (!st.claudeSessionId) return;
  void saveResumeSessionId(st.sessionKey, st.claudeSessionId, st.projectId, st.instanceId)
    .catch((err) => console.error(`[claude-stream] persist session id failed:`, err instanceof Error ? err.message : String(err)));
}

function makeParser(id: string): StreamJsonParser {
  return new StreamJsonParser((event) => {
    const st = streams.get(id);
    if (!st) return;
    switch (event.kind) {
      case "token":
        if (!event.text) break;
        st.currentStepContent += event.text;
        emit(id, "claude:stream:token", { token: event.text });
        break;
      case "tool":
        st.streamingSteps.push({ content: st.currentStepContent, toolUse: event });
        st.currentStepContent = "";
        emit(id, "claude:stream:tool", { name: event.name, input: event.input, result: event.result });
        break;
      case "claude-info":
        st.claudeInfo = { model: event.model, email: st.authEmail, plan: st.authPlan, version: event.version };
        emit(id, "claude:stream:claude-info", { ...st.claudeInfo });
        break;
      case "user": {
        // claude echoed a user turn (--replay-user-messages). Skip if it's the
        // one we already added optimistically in sendClaudeStreamInput (live);
        // on a cold OUT-replay there's no optimistic entry, so this rebuilds the
        // user's prompts and is forwarded to the client.
        const last = st.messages[st.messages.length - 1];
        if (last && last.role === "user" && last.content === event.text) break;
        st.messages.push({ role: "user", content: event.text });
        if (st.messages.length > MAX_MESSAGES) st.messages.splice(0, st.messages.length - MAX_MESSAGES);
        emit(id, "claude:stream:user", { content: event.text });
        break;
      }
      case "session":
        if (event.sessionId && event.sessionId !== st.claudeSessionId) {
          st.claudeSessionId = event.sessionId;
          persistSessionId(st);
        }
        break;
      case "turn-done": {
        const usage: StreamMessageUsage | undefined = event.usage
          ? {
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cost: event.usage.costUsd,
              modelId: st.claudeInfo?.model || "",
              modelLabel: shortModelLabel(st.claudeInfo?.model || ""),
            }
          : undefined;
        const thinkingMs = event.usage?.durationMs || undefined;
        finalizeAssistantTurn(st, usage, thinkingMs);
        emit(id, "claude:stream:status", { status: "" });
        emit(id, "claude:stream:done", { ...(usage ? { usage } : {}), ...(thinkingMs ? { thinkingMs } : {}) });
        break;
      }
    }
  }, { log: (line) => console.log(`[claude-stream:${id}] ${line}`) });
}

/** Attach a tail channel for the out file starting at `fromLine` (1-based). */
async function startTail(st: StreamState, id: string, fromLine: number): Promise<void> {
  const cmd = `${TMUX_RESOLVE}; tail -F -n +${fromLine} -s 0.2 ${shellSingleQuote(st.outPath)} 2>/dev/null`;
  const tail = await st.conn.execStreaming(cmd, { pty: false });
  st.tail = tail;
  tail.stdout.on("data", (chunk: Buffer) => {
    const str = chunk.toString();
    for (let i = 0; i < str.length; i++) if (str[i] === "\n") st.linesConsumed++;
    st.parser.push(str);
  });
  tail.stdout.on("end", () => { void onTailDropped(id); });
  tail.stdout.on("close", () => { void onTailDropped(id); });
}

/** The tail channel died (SSH connection dropped) while the session is still
 *  live. Reconnect and resume tailing from the next unconsumed line. */
async function onTailDropped(id: string): Promise<void> {
  const st = streams.get(id);
  if (!st || st.closing || st.tail === null) return;
  st.tail = null;
  console.warn(`[claude-stream:${id}] tail dropped, reconnecting (from line ${st.linesConsumed + 1})`);
  try {
    st.conn = await connectSsh(st.shellOpts, { timeoutMs: 30_000 });
    await startTail(st, id, st.linesConsumed + 1);
    console.log(`[claude-stream:${id}] tail reconnected`);
  } catch (err) {
    console.error(`[claude-stream:${id}] tail reconnect failed:`, err instanceof Error ? err.message : String(err));
  }
}

/** Node script (run on the VM) that converts a Claude session transcript
 *  (`<dir>/<sessionId>.jsonl`) into our chat message shape: an array of
 *  `{ role, content, steps? }` where assistant steps carry text + tool calls
 *  (results matched from the following tool_result lines). Prints JSON. */
const RESUME_TRANSCRIPT_NODE_SCRIPT = String.raw`
const fs = require("fs"), path = require("path");
const dir = process.argv[2], sid = process.argv[3];
let lines = [];
try { lines = fs.readFileSync(path.join(dir, sid + ".jsonl"), "utf8").split("\n"); } catch (e) { process.stdout.write("[]"); return; }
const parsed = [];
const results = {};
for (const line of lines) {
  if (!line.trim()) continue;
  let o; try { o = JSON.parse(line); } catch (e) { continue; }
  parsed.push(o);
  if (o.type === "user" && o.message && Array.isArray(o.message.content)) {
    for (const b of o.message.content) {
      if (b && b.type === "tool_result" && b.tool_use_id) {
        let txt = "";
        if (typeof b.content === "string") txt = b.content;
        else if (Array.isArray(b.content)) txt = b.content.map((x) => (x && x.type === "text" ? x.text : "")).join("");
        results[b.tool_use_id] = String(txt || "").slice(0, 800);
      }
    }
  }
}
const NOISE = /^\s*<(local-command-caveat|command-name|command-message|command-args|local-command-stdout|command-contents)\b/;
const messages = [];
for (const o of parsed) {
  if (o.type === "user" && o.message) {
    const c = o.message.content;
    if (typeof c === "string") { if (c.trim() && !NOISE.test(c)) messages.push({ role: "user", content: c }); }
    else if (Array.isArray(c)) {
      const txt = c.filter((b) => b && b.type === "text").map((b) => b.text || "").join("");
      if (txt.trim() && !NOISE.test(txt)) messages.push({ role: "user", content: txt });
    }
  } else if (o.type === "assistant" && o.message && Array.isArray(o.message.content)) {
    const steps = []; let buf = "";
    for (const b of o.message.content) {
      if (b.type === "text") buf += b.text || "";
      else if (b.type === "tool_use") { steps.push({ content: buf, toolUse: { name: b.name || "tool", input: b.input || {}, result: results[b.id] || "" } }); buf = ""; }
    }
    if (buf) steps.push({ content: buf });
    if (steps.length) messages.push({ role: "assistant", content: steps.map((s) => s.content).join(""), steps });
  }
}
const MAX = 200;
process.stdout.write(JSON.stringify(messages.length > MAX ? messages.slice(messages.length - MAX) : messages));
`;

/** Seed an opening (resumed) window with the prior session's transcript so the
 *  conversation is visible — `--resume` gives Claude the context but doesn't
 *  re-stream the old turns. Best-effort: on any failure the window just opens
 *  empty (Claude still has the context). */
async function seedResumedTranscript(st: StreamState, id: string, dest: string, sessionId: string): Promise<void> {
  try {
    const encoded = dest.replace(/[^a-zA-Z0-9]/g, "-");
    const scriptPath = `/tmp/_genie_resume_parse.js`;
    await st.conn.exec(`cat > ${scriptPath} << 'GENIEEOF'\n${RESUME_TRANSCRIPT_NODE_SCRIPT}\nGENIEEOF`);
    const out = await st.conn.exec(`node ${scriptPath} "$HOME/.claude/projects/${encoded}" ${shellSingleQuote(sessionId)} 2>/dev/null || echo "[]"`);
    let parsed: StreamMessage[] = [];
    try { parsed = JSON.parse(out.trim() || "[]"); } catch { parsed = []; }
    if (Array.isArray(parsed) && parsed.length) {
      st.messages = parsed.slice(-MAX_MESSAGES);
      emit(id, "claude:stream:replay", { ...snapshot(st) });
      console.log(`[claude-stream:${id}] seeded ${st.messages.length} messages from resumed session ${sessionId}`);
    }
  } catch (err) {
    console.warn(`[claude-stream:${id}] resume transcript seed failed:`, err instanceof Error ? err.message : String(err));
  }
}

export interface StartClaudeStreamParams {
  claudeStreamId: string;
  shellOpts: SshConnectionConfig;
  projectId: string;
  instanceId: string;
  sessionKey: string;
  tmuxName: string;
  claudePath: string;
  /** Remote working dir (e.g. /opt/project). */
  dest: string;
  /** System-prompt context (written to a temp file and passed via --append-system-prompt). */
  context: string;
  /** Prior claude session id to --resume, if any. */
  resumeSessionId: string | null;
  /** Set only when the VM has no Claude subscription and the manager has a key. */
  apiKey: string | null;
  authEmail: string;
  authPlan: string;
  claudeInfo: ClaudeInfo;
}

/** Open (or relaunch) a durable Claude stream. */
export async function startClaudeStream(ws: WebSocket, params: StartClaudeStreamParams): Promise<void> {
  const { claudeStreamId: id, tmuxName } = params;
  // Drop any stale in-memory state but DON'T kill the VM session — the launch
  // below does `tmux new-session -A`, reattaching to a surviving gchat session
  // (and the tail from line 1 replays its captured output → catch-up).
  detachClaudeStream(id);

  const fifoPath = `/tmp/_genie_chat_in_${tmuxName}`;
  const outPath = `/tmp/_genie_chat_out_${tmuxName}`;
  const ctxPath = `/tmp/_genie_chat_ctx_${tmuxName}`;
  const scriptPath = `/tmp/_genie_chat_run_${tmuxName}.sh`;

  const conn = await connectSsh(params.shellOpts, { timeoutMs: 30_000 });

  const st: StreamState = {
    conn,
    tail: null,
    parser: makeParser(id),
    ws,
    shellOpts: params.shellOpts,
    projectId: params.projectId,
    instanceId: params.instanceId,
    sessionKey: params.sessionKey,
    tmuxName,
    fifoPath,
    outPath,
    authEmail: params.authEmail,
    authPlan: params.authPlan,
    messages: [],
    loading: false,
    streamingSteps: [],
    currentStepContent: "",
    claudeInfo: params.claudeInfo,
    claudeSessionId: null,
    linesConsumed: 0,
    orphanedAt: null,
    closing: false,
  };
  streams.set(id, st);

  // Launch script: FIFO stdin (held open) + file stdout, exec'd inside detached tmux.
  const ctx = params.context.replace(/GENIEEOF/g, "GENIE-EOF");
  const resumeFlag = params.resumeSessionId ? ` --resume ${shellSingleQuote(params.resumeSessionId)}` : "";
  const script = [
    `#!/bin/bash`,
    ...(params.apiKey ? [`export ANTHROPIC_API_KEY=${shellSingleQuote(params.apiKey)}`] : []),
    `FIFO=${shellSingleQuote(fifoPath)}`,
    `OUT=${shellSingleQuote(outPath)}`,
    `rm -f "$FIFO"`,
    `mkfifo -m600 "$FIFO" 2>/dev/null || true`,
    `: > "$OUT"`,
    // Hold a writer fd open so claude's stdin never EOFs between messages.
    `( exec sleep 2147483647 ) > "$FIFO" &`,
    `CTX="$(cat ${shellSingleQuote(ctxPath)} 2>/dev/null)"`,
    `cd ${shellSingleQuote(params.dest)}`,
    // --replay-user-messages echoes each user turn back onto stdout so the OUT
    // file is a complete transcript (assistant + user) — replayed on reattach.
    `exec ${shellSingleQuote(params.claudePath)} -p --input-format stream-json --output-format stream-json --verbose --replay-user-messages --dangerously-skip-permissions --append-system-prompt "$CTX"${resumeFlag} < "$FIFO" >> "$OUT" 2>&1`,
  ].join("\n");

  await conn.exec(`cat > ${ctxPath} << 'GENIEEOF'\n${ctx}\nGENIEEOF`);
  await conn.exec(`cat > ${scriptPath} << 'GENIEEOF'\n${script}\nGENIEEOF`);
  // Create the gchat session ONLY if it isn't already running. We can't use
  // `new-session -A` here: over a non-PTY exec, attaching to an existing session
  // fails ("open terminal failed: not a terminal"). When it already exists,
  // claude is still running (stdin=FIFO, stdout=OUT independent of any client) —
  // so we just tail OUT from the top, replaying the full prior conversation.
  const quotedName = shellSingleQuote(tmuxName);
  const created = await conn.exec(
    `${TMUX_RESOLVE}; if "$T" has-session -t ${quotedName} 2>/dev/null; then echo GENIE_REATTACH; else "$T" new-session -d -s ${quotedName} "bash ${scriptPath}" && echo GENIE_CREATED; fi 2>&1`,
  );
  const reattached = /GENIE_REATTACH/.test(created);
  console.log(`[claude-stream:${id}] ${reattached ? "reattached to surviving" : "created"} tmux ${tmuxName}`);

  emit(id, "claude:stream:ready", { reattached, tmuxName });
  emit(id, "claude:stream:claude-info", { ...params.claudeInfo });

  // Resuming a prior session: --resume restores Claude's context but doesn't
  // re-stream the old turns, so seed the window from the transcript on disk.
  // (The resumed session writes new turns to a fresh transcript, so there's no
  // overlap with what the OUT tail picks up below.)
  if (params.resumeSessionId && !reattached) {
    await seedResumedTranscript(st, id, params.dest, params.resumeSessionId);
  }

  await startTail(st, id, 1);
}

/** Rebind an orphaned (or live) stream to a new socket and replay the transcript. */
export function reattachClaudeStream(ws: WebSocket, id: string): boolean {
  const st = streams.get(id);
  if (!st) return false;
  clearTimeout(orphanTimers.get(id));
  orphanTimers.delete(id);
  st.ws = ws;
  st.orphanedAt = null;
  sendFn?.(ws, { type: "claude:stream:ready", payload: { claudeStreamId: id, reattached: true, tmuxName: st.tmuxName } });
  sendFn?.(ws, { type: "claude:stream:replay", payload: { claudeStreamId: id, ...snapshot(st) } });
  console.log(`[claude-stream] reattached ${id} (${st.messages.length} msgs, loading=${st.loading})`);
  return true;
}

/** Send a user message (or slash command): one NDJSON frame into the FIFO. */
export function sendClaudeStreamInput(id: string, text: string): void {
  const st = streams.get(id);
  if (!st) return;
  st.messages.push({ role: "user", content: text });
  if (st.messages.length > MAX_MESSAGES) st.messages.splice(0, st.messages.length - MAX_MESSAGES);
  st.loading = true;
  st.streamingSteps = [];
  st.currentStepContent = "";
  emit(id, "claude:stream:status", { status: "Claude is thinking..." });
  const frame = JSON.stringify({ type: "user", message: { role: "user", content: text } });
  // printf one line into the FIFO. The held-open writer keeps claude's stdin alive.
  void st.conn.exec(`printf '%s\\n' ${shellSingleQuote(frame)} > ${shellSingleQuote(st.fifoPath)}`)
    .catch((err) => {
      console.error(`[claude-stream:${id}] input write failed:`, err instanceof Error ? err.message : String(err));
      emit(id, "claude:stream:error", { message: "Failed to send message to Claude" });
    });
}

/** Run a one-off shell command on the session's VM (the chat's `!cmd` bang mode)
 *  in the project dir, capturing combined stdout+stderr and the exit code. Output
 *  is truncated to keep the round-trip small. Non-interactive (no PTY). */
export async function runClaudeStreamBash(id: string, command: string, dest: string): Promise<{ output: string; exitCode: number }> {
  const st = streams.get(id);
  if (!st) throw new Error("Claude session is not running");
  const marker = "__GENIE_RC__:";
  // Run in a brace group so multi-word/compound commands work; append the exit
  // code via a marker (the overall line still exits 0, so exec won't throw).
  const full = `cd ${shellSingleQuote(dest)} 2>/dev/null; { ${command}\n; } 2>&1; printf '\\n${marker}%s' "$?"`;
  const raw = await st.conn.exec(full, undefined, { timeoutMs: 30_000 });
  let output = raw;
  let exitCode = 0;
  const idx = raw.lastIndexOf(marker);
  if (idx >= 0) {
    exitCode = parseInt(raw.slice(idx + marker.length).trim(), 10) || 0;
    output = raw.slice(0, idx);
  }
  output = output.replace(/\n+$/, "");
  if (output.length > 12_000) output = output.slice(0, 12_000) + "\n…(truncated)";
  return { output, exitCode };
}

/** Write a (pasted) file to the VM over the session's SSH connection. Returns the
 *  remote path so the caller can reference it in a chat message. */
export async function writeClaudeStreamFile(id: string, remotePath: string, data: Buffer): Promise<void> {
  const st = streams.get(id);
  if (!st) throw new Error("no such claude stream");
  const handle = await st.conn.sftpOpenWrite(remotePath);
  try {
    await handle.write(data, 0);
  } finally {
    await handle.close();
  }
}

/** Best-effort interrupt: write an interrupt control frame into the FIFO. */
export function stopClaudeStream(id: string): void {
  const st = streams.get(id);
  if (!st) return;
  const frame = JSON.stringify({ type: "control_request", request: { subtype: "interrupt" } });
  void st.conn.exec(`printf '%s\\n' ${shellSingleQuote(frame)} > ${shellSingleQuote(st.fifoPath)}`).catch(() => { /* best-effort */ });
}

export function resizeClaudeStream(_id: string, _cols: number, _rows: number): void {
  // No PTY — stream-json output is layout-independent. No-op.
}

/** Detach from a dead socket but keep the in-memory transcript alive for the
 *  grace window so a quick reconnect replays it; after that, fall back to a full
 *  detach (the tmux session + captured output survive on the VM regardless). */
export function orphanClaudeStream(id: string): void {
  const st = streams.get(id);
  if (!st) return;
  st.ws = null;
  st.orphanedAt = Date.now();
  clearTimeout(orphanTimers.get(id));
  orphanTimers.set(id, setTimeout(() => {
    console.log(`[claude-stream] grace expired, detaching ${id} (tmux session kept)`);
    detachClaudeStream(id);
  }, GRACE_MS));
  console.log(`[claude-stream] orphaned ${id} (grace ${GRACE_MS}ms)`);
}

/** Drop the SSH connection + in-memory state but LEAVE the tmux session and its
 *  captured output running on the VM, so a later open reattaches (tmux -A) and
 *  replays the output file (`tail -n +1`) — i.e. catches up the working session.
 *  This is what window-close and grace-expiry do; the gchat session is only
 *  truly ended via killClaudeStream (or the tmux row's Delete). */
export function detachClaudeStream(id: string, notifyWs?: WebSocket): void {
  const st = streams.get(id);
  clearTimeout(orphanTimers.get(id));
  orphanTimers.delete(id);
  if (st) {
    st.closing = true;
    try { st.tail?.close(); } catch { /* ignore */ }
    try { st.conn.close(); } catch { /* ignore */ }
  }
  streams.delete(id);
  if (notifyWs) sendFn?.(notifyWs, { type: "claude:stream:closed", payload: { claudeStreamId: id } });
}

/** Explicitly END the session: kill the tmux session (claude + FIFO writer) and
 *  delete the temp files. Used for an explicit "end" — not window-close. */
export function killClaudeStream(id: string, notifyWs?: WebSocket): void {
  const st = streams.get(id);
  clearTimeout(orphanTimers.get(id));
  orphanTimers.delete(id);
  if (st) {
    st.closing = true;
    void st.conn.exec(`${TMUX_RESOLVE}; "$T" kill-session -t ${shellSingleQuote(st.tmuxName)} 2>/dev/null; rm -f ${shellSingleQuote(st.fifoPath)} ${shellSingleQuote(st.outPath)} 2>/dev/null; true`)
      .catch(() => { /* best-effort */ })
      .finally(() => { try { st.tail?.close(); } catch { /* ignore */ } try { st.conn.close(); } catch { /* ignore */ } });
  }
  streams.delete(id);
  if (notifyWs) sendFn?.(notifyWs, { type: "claude:stream:closed", payload: { claudeStreamId: id } });
}

export function closeAllClaudeStreamsForWs(ws: WebSocket): void {
  for (const [id, st] of [...streams]) {
    if (st.ws === ws) orphanClaudeStream(id);
  }
}
