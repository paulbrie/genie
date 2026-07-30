import { $claudeStream } from "../subjects/claude-stream";
import { $auth } from "../subjects/auth";
import { emptyClaudeStreamSession, type ClaudeStreamSession, type ClaudeSessionSummary } from "../types/claude-stream";
import type { ChatMessage } from "../types/chat";
import { chatStreamIdForTmux } from "@/lib/claude-session-id";
import { wsSend, wsRequest } from "@/lib/ws";

// Bumped each time a chat is (re)opened so the windows container can bring the
// just-opened window to the front.
let focusNonce = 0;

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A short mixed-case alphanumeric token used as the unique session suffix. */
function randomToken(len = 4): string {
  let out = "";
  for (let i = 0; i < len; i++) out += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  return out;
}

/** tmux-safe slug for the signed-in user: the first word of their name (else the
 *  local part of their email), lowercased and stripped to [a-z0-9]. "user" if
 *  unknown. Keeps the session name readable and free of shell/tmux metacharacters. */
function currentUserSlug(): string {
  const user = $auth.getValue().user;
  const raw = user?.name?.trim().split(/\s+/)[0] || user?.email?.split("@")[0]?.split(".")[0] || "";
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
}

/** A unique tmux/session name per "new chat" so the Claude button spins up a
 *  fresh, independent session + window every click: `claude-<user>-<token>`.
 *  The `claude-` prefix makes the tmux badge render as Claude. Reattaching a
 *  specific session passes its own name instead. */
function freshGchatTmuxName(): string {
  return `claude-${currentUserSlug()}-${randomToken(4)}`;
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
  // `fresh` (no tmuxName, no resume) means a blank "new chat" — tells the manager
  // not to resume the surface's last on-disk session. Distinct from naming: every
  // open that isn't reattaching an existing badge gets its OWN fresh tmux name
  // (new chats AND resumes), so the resumed session is created with a proper
  // `claude-<user>-<token>` name and surfaces as its own session/badge — rather
  // than falling back to the manager's anonymous `claude-chat-<hash>`.
  const fresh = !args.tmuxName && !args.resumeSessionId;
  const tmuxName = args.tmuxName ?? freshGchatTmuxName();
  // Unique id per open, derived from the (unique) tmux name.
  const idSeed = tmuxName;
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

/** Context occupancy of the latest turn that reported usage — the same figure the
 *  window footer shows. Used to capture a pre-`/compact` baseline. */
export function latestContextTokens(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const u = messages[i]?.usage;
    if (u && (u.inputTokens > 0 || u.outputTokens > 0)) return u.inputTokens + u.outputTokens;
  }
  return 0;
}

/** Slash commands that shrink the live context (compaction / fresh conversation).
 *  The new size isn't known until the next turn, so the footer shows "compacting…"
 *  meanwhile instead of the stale pre-compact figure. */
function isContextResetCommand(text: string): boolean {
  return /^\/(compact|clear)\b/.test(text.trim());
}

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
  // On `/compact` (or `/clear`), capture the current context size as a baseline so
  // the footer can show "compacting…" until a turn reports a smaller context. Only
  // when there's a real prior figure to be stale about (>0).
  const compactBaseline = isContextResetCommand(trimmed)
    ? (latestContextTokens(session?.messages ?? []) || undefined)
    : undefined;
  updateClaudeStreamSession(claudeStreamId, (s) => ({
    ...s,
    messages: [...s.messages, { role: "user", content: shown, ...(images && images.length ? { images } : {}) }],
    loading: true,
    statusText: "Claude is thinking...",
    connectionError: null,
    pendingBashContext: undefined,
    ...(compactBaseline ? { compactBaseline } : {}),
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

/** Dismiss a single message (an error card) from a session's log. Error bubbles
 *  are client-only — they're never written to the on-disk transcript, so the
 *  manager's replay snapshot never carries them. Dropping one here keeps it gone:
 *  a reattach/reload rebuilds `messages` from the transcript, which has no errors.
 *  Removes by reference identity so duplicate-text errors dismiss one at a time. */
export function dismissClaudeStreamMessage(claudeStreamId: string, target: ChatMessage): void {
  updateClaudeStreamSession(claudeStreamId, (s) => ({
    ...s,
    messages: s.messages.filter((m) => m !== target),
  }));
}

export function stopClaudeStream(claudeStreamId: string): void {
  wsSend("claude:stream:stop", { claudeStreamId });
  updateClaudeStreamSession(claudeStreamId, (s) => ({ ...s, loading: false, statusText: "" }));
}

/** Answer the pending AskUserQuestion dialog. `answers` maps question text →
 *  chosen label(s); null dismisses it (Claude proceeds on its own judgment). */
export function answerClaudeStreamAsk(
  claudeStreamId: string,
  requestId: string,
  answers: Record<string, string | string[]> | null,
): void {
  wsSend("claude:stream:answer", { claudeStreamId, requestId, answers });
  // Optimistic clear; the manager's ask-resolved confirms (and a replay would
  // re-surface the dialog if the answer never reached the FIFO).
  updateClaudeStreamSession(claudeStreamId, (s) => ({ ...s, pendingAsk: null }));
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
