import { $claudeStream } from "../subjects/claude-stream";
import { emptyClaudeStreamSession, type ClaudeStreamSession } from "../types/claude-stream";
import { chatStreamIdForTmux } from "@/lib/claude-session-id";
import { wsSend, wsRequest } from "@/lib/ws";

/** A fresh, unique chat-session tmux name — each "open chat" spawns a new session
 *  + popup (mirrors the terminal's freshClaudeTmuxName). The `claude-chat-` prefix
 *  makes the tmux badge read as Claude (logo + orange). Right-clicking an existing
 *  one reattaches to it instead (it passes its own name). */
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
}): void {
  const { claudeStreamId, projectId, instanceId, label, tmuxName } = args;
  const state = $claudeStream.getValue();
  if (!state.sessions[claudeStreamId]) {
    $claudeStream.next({
      sessions: {
        ...state.sessions,
        [claudeStreamId]: emptyClaudeStreamSession(claudeStreamId, projectId, instanceId, label, tmuxName),
      },
    });
  }
  wsSend("claude:stream:start", { claudeStreamId, projectId, instanceId, tmuxName });
}

/** Open a chat-mode Claude window. Each tmux session gets its own popup: pass
 *  `tmuxName` to bind to a specific gchat-* session (reattach + replay its
 *  content); omit it for the VM's default chat (Manage popup's "Chat" button).
 *  Returns the popup's claudeStreamId. */
export async function openClaudeChatWindow(args: {
  ownerId: string;
  projectId: string;
  instanceId: string;
  label: string;
  tmuxName?: string;
}): Promise<string> {
  const tmuxName = args.tmuxName ?? freshGchatTmuxName();
  const claudeStreamId = await chatStreamIdForTmux(args.ownerId, args.projectId, args.instanceId, tmuxName);
  openClaudeStream({ claudeStreamId, projectId: args.projectId, instanceId: args.instanceId, label: args.label, tmuxName });
  return claudeStreamId;
}

/** Send a user message (or slash command). Optimistically appends the user turn. */
export function sendClaudeStreamMessage(claudeStreamId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  updateClaudeStreamSession(claudeStreamId, (s) => ({
    ...s,
    messages: [...s.messages, { role: "user", content: trimmed }],
    loading: true,
    statusText: "Claude is thinking...",
    connectionError: null,
  }));
  wsSend("claude:stream:input", { claudeStreamId, text: trimmed });
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
    wsSend("claude:stream:start", { claudeStreamId: s.claudeStreamId, projectId: s.projectId, instanceId: s.instanceId, tmuxName: s.tmuxName });
  }
}
