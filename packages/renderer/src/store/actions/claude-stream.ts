import { $claudeStream } from "../subjects/claude-stream";
import { emptyClaudeStreamSession, type ClaudeStreamSession, type ClaudeSessionSummary } from "../types/claude-stream";
import { chatStreamIdForTmux } from "@/lib/claude-session-id";
import { wsSend, wsRequest } from "@/lib/ws";

// Bumped each time a chat is (re)opened so the windows container can bring the
// just-opened window to the front.
let focusNonce = 0;

/** A unique tmux/session name per "new chat" so the Claude button spins up a
 *  fresh, independent session + window every click (the `claude-chat-` prefix
 *  makes the tmux badge render as Claude). Reattaching a specific session passes
 *  its own name instead. */
function freshGchatTmuxName(): string {
  return `claude-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Mutate a single session in the map (no-op if it's gone). */
export function updateClaudeStreamSession(
  claudeStreamId: string,
  updater: (s: ClaudeStreamSession) => ClaudeStreamSession,
): void {
  const state = $claudeStream.getValue();
  const session = state.sessions[claudeStreamId];
  if (!session) return;
  $claudeStream.next({ sessions: { ...state.sessions, [claudeStreamId]: updater(session) } });
}

/** Open (register + start) a durable chat-mode Claude session. Idempotent: if a
 *  session for this id already exists it just re-issues `claude:stream:start`
 *  (the manager reattaches and replays the transcript). */
export function openClaudeStream(args: {
  claudeStreamId: string;
  projectId: string;
  instanceId: string;
  label: string;
  /** Bind to this exact tmux session (per-session chat). */
  tmuxName?: string;
  /** Resume a prior on-disk Claude session (`--resume <id>`) on first launch. */
  resumeSessionId?: string;
  /** Start a blank session — the manager skips resuming the surface's last
   *  on-disk session (so a "new chat" doesn't replay an old conversation). Only
   *  meaningful on the first start; ignored on reattach. */
  fresh?: boolean;
}): void {
  const { claudeStreamId, projectId, instanceId, label, tmuxName, resumeSessionId, fresh } = args;
  const state = $claudeStream.getValue();
  if (!state.sessions[claudeStreamId]) {
    $claudeStream.next({
      sessions: {
        ...state.sessions,
        [claudeStreamId]: emptyClaudeStreamSession(claudeStreamId, projectId, instanceId, label, tmuxName, resumeSessionId),
      },
    });
  }
  wsSend("claude:stream:start", { claudeStreamId, projectId, instanceId, tmuxName, resumeSessionId, fresh });
}

/** Open a chat-mode Claude window. Each open gets its own popup + session:
 *   - explicit tmuxName (a gchat-* badge)   → reattach that session;
 *   - resumeSessionId (the Sessions picker) → one window per resumed session;
 *   - otherwise (the Manage "Claude" button) → a brand-new BLANK chat — a fresh
 *     unique session every click, NOT resuming the VM's last conversation.
 *  Returns the popup's claudeStreamId. */
export async function openClaudeChatWindow(args: {
  ownerId: string;
  projectId: string;
  instanceId: string;
  label: string;
  tmuxName?: string;
  /** Resume a prior on-disk Claude session into this window. */
  resumeSessionId?: string;
}): Promise<string> {
  // A "new chat" (no tmuxName, no resume) gets a fresh unique tmux name so every
  // click is an independent, blank session + window. `fresh` tells the manager
  // not to resume the surface's last on-disk session.
  const fresh = !args.tmuxName && !args.resumeSessionId;
  const tmuxName = args.tmuxName ?? (fresh ? freshGchatTmuxName() : undefined);
  // Unique id per open: a fresh tmux name, the picked session, or the bound name.
  const idSeed = tmuxName ?? `resume-${args.resumeSessionId}`;
  const claudeStreamId = await chatStreamIdForTmux(args.ownerId, args.projectId, args.instanceId, idSeed);
  openClaudeStream({ claudeStreamId, projectId: args.projectId, instanceId: args.instanceId, label: args.label, tmuxName, resumeSessionId: args.resumeSessionId, fresh });
  // Bring the (possibly already-open) window to the front.
  const s = $claudeStream.getValue();
  $claudeStream.next({ ...s, focusRequest: { claudeStreamId, nonce: ++focusNonce } });
  return claudeStreamId;
}

/** List prior on-disk Claude sessions for this chat's project (newest first) so
 *  the window's "Sessions" picker can offer to resume one. */
export async function listClaudeSessions(claudeStreamId: string): Promise<ClaudeSessionSummary[]> {
  const session = $claudeStream.getValue().sessions[claudeStreamId];
  if (!session) return [];
  try {
    const res = await wsRequest<{ sessions?: ClaudeSessionSummary[]; error?: string }>(
      "claude:stream:list-sessions",
      { claudeStreamId, projectId: session.projectId, instanceId: session.instanceId },
      20_000,
    );
    return res.sessions ?? [];
  } catch {
    return [];
  }
}

/** Send a user message (or slash command). Optimistically appends the user turn.
 *  `images` (pasted-image data URLs) ride on the optimistic message so the
 *  thumbnails stay visible in the conversation — the server's user-message
 *  replay is deduped by content, so they survive (until a full transcript
 *  replay on reconnect, which only carries text). */
/** Wrappers around buffered bang-mode output so it reads as context to Claude and
 *  can be stripped from the displayed bubble on transcript replay. Kept in sync
 *  with the strip in chat-message-list.tsx. */
export const SHELL_CONTEXT_OPEN = "[Shell commands I ran in the project, for context:]";
export const SHELL_CONTEXT_CLOSE = "[End shell context]";

export function sendClaudeStreamMessage(claudeStreamId: string, text: string, images?: string[], displayText?: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  // `displayText` lets callers send Claude a richer wire payload (e.g. a plan-mode
  // directive prefix) while showing only the user's own words in the bubble.
  const shown = (displayText ?? text).trim();
  // Prepend any buffered bang-mode (`!cmd`) output so Claude sees it as context —
  // invisible in the bubble (shown stays clean), then cleared.
  const session = $claudeStream.getValue().sessions[claudeStreamId];
  const bashCtx = session?.pendingBashContext;
  const wire = bashCtx ? `${SHELL_CONTEXT_OPEN}\n${bashCtx}\n${SHELL_CONTEXT_CLOSE}\n\n${trimmed}` : trimmed;
  updateClaudeStreamSession(claudeStreamId, (s) => ({
    ...s,
    messages: [...s.messages, { role: "user", content: shown, ...(images && images.length ? { images } : {}) }],
    loading: true,
    statusText: "Claude is thinking...",
    connectionError: null,
    pendingBashContext: undefined,
  }));
  wsSend("claude:stream:input", { claudeStreamId, text: wire });
}

/** Bang mode: run a shell command on the VM and show its output in the popup,
 *  bypassing Claude. Appends the command (as the user's turn) and the result
 *  (a fenced `console` block so it renders monospace without a Run button). */
export async function runClaudeStreamBash(claudeStreamId: string, command: string): Promise<void> {
  const session = $claudeStream.getValue().sessions[claudeStreamId];
  if (!session) return;
  updateClaudeStreamSession(claudeStreamId, (s) => ({
    ...s,
    messages: [...s.messages, { role: "user", content: `! ${command}` }],
    loading: true,
    statusText: "Running command…",
  }));
  try {
    const res = await wsRequest<{ output?: string; exitCode?: number }>(
      "claude:stream:bash",
      { claudeStreamId, projectId: session.projectId, instanceId: session.instanceId, command },
      35_000,
    );
    const body = (res.output ?? "").replace(/```/g, "ʼʼʼ") || "(no output)";
    const rc = res.exitCode ? `\n[exit ${res.exitCode}]` : "";
    // Buffer the raw command + output so the next message to Claude carries it as
    // context (TUI `!` behaviour).
    const block = `$ ${command}\n${res.output || "(no output)"}${res.exitCode ? `\n[exit ${res.exitCode}]` : ""}`;
    updateClaudeStreamSession(claudeStreamId, (s) => ({
      ...s,
      messages: [...s.messages, { role: "assistant", content: `\`\`\`console\n$ ${command}\n${body}${rc}\n\`\`\`` }],
      pendingBashContext: (s.pendingBashContext ? `${s.pendingBashContext}\n\n` : "") + block,
      loading: false,
      statusText: "",
    }));
  } catch {
    updateClaudeStreamSession(claudeStreamId, (s) => ({
      ...s,
      messages: [...s.messages, { role: "assistant", content: "Command failed (timed out or no connection).", isError: true }],
      loading: false,
      statusText: "",
    }));
  }
}

/** Upload a pasted clipboard image to the VM; returns its remote path (or null
 *  on failure) so the caller can reference it in the next chat message. */
export async function pasteClaudeStreamImage(
  claudeStreamId: string,
  dataB64: string,
  ext: string,
): Promise<string | null> {
  try {
    const res = await wsRequest<{ ok: boolean; remotePath?: string }>(
      "claude:stream:paste-image",
      { claudeStreamId, dataB64, ext },
      30_000,
    );
    return res.ok && res.remotePath ? res.remotePath : null;
  } catch {
    return null;
  }
}

export function stopClaudeStream(claudeStreamId: string): void {
  wsSend("claude:stream:stop", { claudeStreamId });
  updateClaudeStreamSession(claudeStreamId, (s) => ({ ...s, loading: false, statusText: "" }));
}

/** Close the window: tell the manager to detach and drop local state. */
export function closeClaudeStream(claudeStreamId: string): void {
  wsSend("claude:stream:close", { claudeStreamId });
  const state = $claudeStream.getValue();
  if (!state.sessions[claudeStreamId]) return;
  const next = { ...state.sessions };
  delete next[claudeStreamId];
  $claudeStream.next({ sessions: next });
}

// --- Reconnect resilience -------------------------------------------------

/** On WS drop, flag in-flight sessions as reconnecting so the UI keeps the
 *  streaming bubble visible instead of wiping it. */
export function handleClaudeStreamWsDisconnect(): void {
  const state = $claudeStream.getValue();
  const sessions = { ...state.sessions };
  let changed = false;
  for (const id of Object.keys(sessions)) {
    if (sessions[id].loading || sessions[id].ready) {
      sessions[id] = { ...sessions[id], reconnecting: true };
      changed = true;
    }
  }
  if (changed) $claudeStream.next({ sessions });
}

/** On reconnect, re-issue start for every open session — the manager reattaches
 *  within the grace window (replaying the transcript) or starts fresh. */
export function handleClaudeStreamWsReconnect(): void {
  const state = $claudeStream.getValue();
  for (const s of Object.values(state.sessions)) {
    wsSend("claude:stream:start", { claudeStreamId: s.claudeStreamId, projectId: s.projectId, instanceId: s.instanceId, tmuxName: s.tmuxName, resumeSessionId: s.resumeSessionId });
  }
}
