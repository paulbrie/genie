// --- Durable streaming Claude session (chat-mode terminal) ---
//
// State for the chat-style Claude surface backed by a durable
// `claude --input-format stream-json` session on the project VPS. Reuses the
// chat message/tool primitives so the rendering can share ChatMessageList with
// the floating Genie Assistant. Keyed by `claudeStreamId` so multiple project
// windows can be open at once.

import type { ChatMessage, StreamingStep, ToolUse, ClaudeInfo } from "./chat";

export interface ClaudeStreamSession {
  claudeStreamId: string;
  projectId: string;
  instanceId: string;
  /** The specific tmux session this chat is bound to (per-session chat). */
  tmuxName?: string;
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
  /** Non-null when the last turn failed or the connection dropped. */
  connectionError: string | null;
  /** True while the WS is reconnecting with a turn in flight. */
  reconnecting: boolean;
}

export interface ClaudeStreamState {
  sessions: Record<string, ClaudeStreamSession>;
}

export function emptyClaudeStreamSession(
  claudeStreamId: string,
  projectId: string,
  instanceId: string,
  label: string,
  tmuxName?: string,
): ClaudeStreamSession {
  return {
    claudeStreamId,
    projectId,
    instanceId,
    tmuxName,
    label,
    messages: [],
    loading: false,
    streamingContent: "",
    streamingSteps: [],
    toolUses: [],
    statusText: "",
    claudeInfo: null,
    ready: false,
    connectionError: null,
    reconnecting: false,
  };
}
