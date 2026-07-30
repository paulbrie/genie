// --- Durable streaming Claude session (chat-mode terminal) ---
//
// State for the chat-style Claude surface backed by a durable
// `claude --input-format stream-json` session on the project VPS. Reuses the
// chat message/tool primitives so the rendering can share ChatMessageList with
// the floating Genie Assistant. Keyed by `claudeStreamId` so multiple project
// windows can be open at once.

import type { ChatMessage, StreamingStep, ToolUse, ClaudeInfo } from "./chat";

/** One AskUserQuestion question, mirrored from the manager's control request. */
export interface AskQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

/** A question dialog Claude is blocked on, awaiting the user's choice. */
export interface PendingAsk {
  requestId: string;
  toolUseId: string;
  questions: AskQuestion[];
}

export interface ClaudeStreamSession {
  claudeStreamId: string;
  projectId: string;
  instanceId: string;
  /** The specific tmux session this chat is bound to (per-session chat). */
  tmuxName?: string;
  /** When set, the manager launches Claude with `--resume <id>` on first start
   *  so this window reloads a prior on-disk session's context. */
  resumeSessionId?: string;
  /** Human label for the window title (e.g. project name). */
  label: string;
  messages: ChatMessage[];
  /** True while an assistant turn is in flight. */
  loading: boolean;
  streamingContent: string;
  streamingSteps: StreamingStep[];
  toolUses: ToolUse[];
  statusText: string;
  claudeInfo: ClaudeInfo | null;
  /** True once the manager confirmed the session is live (claude:stream:ready). */
  ready: boolean;
  /** True between `ready` and the history `replay` snapshot when this open is a
   *  reattach or resume — i.e. prior turns are being rebuilt and will arrive in
   *  one batch. Drives the "Loading history…" placeholder so the window doesn't
   *  look blank during that gap. Always cleared by the replay (every history path
   *  emits one, even when empty), so it can't get stuck. */
  historyLoading: boolean;
  /** Non-null when the last turn failed or the connection dropped. */
  connectionError: string | null;
  /** True while the WS is reconnecting with a turn in flight. */
  reconnecting: boolean;
  /** Buffered `!cmd` bang-mode output not yet handed to Claude — prepended
   *  (invisibly) to the next real message so the model gets it as context. */
  pendingBashContext?: string;
  /** Set to the pre-compaction context size when the user runs `/compact` (or
   *  `/clear`). While set, the context footer shows "compacting…" instead of the
   *  stale pre-compact number — the real post-compact size isn't known until the
   *  next turn. Cleared once a turn reports a context smaller than this baseline. */
  compactBaseline?: number;
  /** Claude asked the user something (AskUserQuestion) and is blocked until the
   *  answer (or a dismissal) is sent back. Rendered as an option dialog. */
  pendingAsk?: PendingAsk | null;
}

export interface ClaudeStreamState {
  sessions: Record<string, ClaudeStreamSession>;
  /** Set when the user (re)opens a chat so the windows container can bring that
   *  window to the front even if it was already mounted. The nonce lets the same
   *  id be re-focused on repeat clicks. */
  focusRequest?: { claudeStreamId: string; nonce: number };
}

/** A prior on-disk Claude session (from `~/.claude/projects/<cwd>/*.jsonl`),
 *  surfaced in the chat window's "Sessions" picker so the user can resume one. */
export interface ClaudeSessionSummary {
  sessionId: string;
  /** Epoch ms of the transcript's last write. */
  mtime: number;
  /** Number of transcript lines (rough message count). */
  messages: number;
  /** Short human label: session summary or first user message. */
  title: string;
}

export function emptyClaudeStreamSession(
  claudeStreamId: string,
  projectId: string,
  instanceId: string,
  label: string,
  tmuxName?: string,
  resumeSessionId?: string,
): ClaudeStreamSession {
  return {
    claudeStreamId,
    projectId,
    instanceId,
    tmuxName,
    resumeSessionId,
    label,
    messages: [],
    loading: false,
    streamingContent: "",
    streamingSteps: [],
    toolUses: [],
    statusText: "",
    claudeInfo: null,
    ready: false,
    historyLoading: false,
    connectionError: null,
    reconnecting: false,
  };
}
