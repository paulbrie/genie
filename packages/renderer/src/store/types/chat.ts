// --- Chat types (1-on-1 AI chat + conversation chat) ---

export type ConversationType = "dm" | "room";

export interface ToolUse {
  /** Stable per-call id from the SDK (`toolCallId`). Used to correlate the
   *  `chat:tool:start` and `chat:tool` messages so the live elapsed-time
   *  ticker can flip from running → done on the right pill. Older code paths
   *  (e.g. the Claude Code VPS bridge in ws-server lines ~799/821) don't
   *  emit an id, hence optional. */
  id?: string;
  name: string;
  input: Record<string, string>;
  result: string;
  /** Client clock — set when the renderer receives `chat:tool:start`. */
  startedAt?: number;
  /** Client clock — set when the renderer receives the final `chat:tool`. */
  completedAt?: number;
  /** Server-authoritative duration (Date.now() in the manager between
   *  tool-call and tool-result). Preferred over `completedAt - startedAt` when
   *  available because it isn't affected by client-side queueing. */
  durationMs?: number;
}

export interface StreamingStep {
  content: string;
  toolUse?: ToolUse;
}

export interface ChatMessageUsage {
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  modelLabel: string;
  cost: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolUses?: ToolUse[];
  steps?: StreamingStep[];
  usage?: ChatMessageUsage;
  /** Wall-clock the assistant spent on this turn (manager-reported `duration_ms`
   *  from the stream-json `result` event). Shown in the message footer. */
  thinkingMs?: number;
  /** Pasted/attached images as data URLs ("data:image/png;base64,..."). Only
   *  set on user messages — the manager forwards these to the model and they're
   *  rendered inline above the user's text bubble. */
  images?: string[];
  /** Set on assistant messages that represent a failed turn. */
  isError?: boolean;
}

export interface ChatSendMeta {
  context?: string;
  domSnapshot?: string;
  images?: string[];
}

export interface ClaudeInfo {
  model: string;
  email: string;
  plan: string;
  version: string;
}

export interface ChatSessionSummary {
  sessionId: string;
  projectId: string | null;
  modelId: string | null;
  userName: string | null;
  name: string | null;
  firstMessage: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResumedFrom {
  /** Claude Code session id being resumed (matches --resume flag). */
  sessionId: string;
  /** ISO timestamp of the previous activity on this session. */
  lastActivity: string;
}

export interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  streamingContent: string;
  streamingSteps: StreamingStep[];
  toolUses: ToolUse[];
  statusText: string;
  modelId: string;
  maxToolRounds: number;
  toolRoundsUsed: number;
  claudeInfo: ClaudeInfo | null;
  sessions: ChatSessionSummary[];
  sessionsLoading: boolean;
  activeSessionId: string | null;
  /** Non-null when the current chat is continuing a previously persisted Claude
   *  Code session via `claude --resume`. Set by the `chat:resumed` event the
   *  manager sends before each turn that uses a saved session id. Cleared on
   *  newChat / resetChat / model switch. */
  resumedFrom: ResumedFrom | null;
  /** Non-null when the last send failed or the connection dropped mid-turn. */
  connectionError: string | null;
  /** True while the WS is reconnecting and a chat turn was in flight when the
   *  drop happened. UI uses this to keep `streamingContent` visible and show a
   *  subtle "Reconnecting…" inline instead of wiping the bubble. Cleared on
   *  successful reconnect or after a degradation timeout. */
  reconnecting: boolean;
  /** Metadata for the most recent user turn — used to retry after errors. */
  lastSendMeta: ChatSendMeta | null;
}

/** A VM the assistant should pin its `ssh_exec` tool calls to. Selected from
 *  the renderer's project list (project-attached VMs) or — for tazcloud admins —
 *  from the bare admin TazCloud VM list. `projectId` is null in the bare case;
 *  the manager then routes ssh_exec via TAZCLOUD_SSH_PRIVATE_KEY directly
 *  instead of looking up an instance in projectService. Persists across reloads
 *  via localStorage. */
export interface PinnedAssistantVm {
  /** Null when this pin points at a bare cloud VM not attached to any project. */
  projectId: string | null;
  projectName: string | null;
  /** Project-instance id when projectId is set; otherwise the cloud VM id (e.g. TazCloud vmId). */
  instanceId: string;
  /** Human display label (typically `${project.name} / ${instance.label}` for attached VMs,
   *  or just the VM name for bare admin pins). */
  label: string;
  /** Connection host — IPv4 for DO, IPv6 for TazCloud. Surfaced in the banner. */
  host: string;
  provider: "digitalocean" | "tazcloud" | "other";
  /** SSH user the manager should connect as for bare pins (where there's no
   *  project instance carrying a `connection.username`). Ignored when projectId
   *  is set. */
  sshUser?: string;
}

// --- Conversation chat types ---

export interface ConversationMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
  isAgent: boolean;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  isAgent: boolean;
  content: string;
  metadata: string | null;
  replyToId: string | null;
  replyTo: { id: string; senderName: string; contentPreview: string } | null;
  editedAt: string | null;
  reactions: Record<string, string[]>;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  type: ConversationType;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessage: {
    content: string;
    senderName: string;
    createdAt: string;
  } | null;
  members: ConversationMember[];
}

export interface ChatUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isAgent: boolean;
  online: boolean;
}

export interface MentionNotification {
  id: string;
  conversationId: string;
  conversationName: string;
  senderName: string;
  content: string;
  createdAt: string;
  /** True when the user was @mentioned (vs a general message toast). */
  isMention?: boolean;
}

export interface ConversationChatState {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  messages: ConversationMessage[];
  members: ConversationMember[];
  loading: boolean;
  streamingContent: string;
  streamingConversationId: string | null;
  toolUses: ToolUse[];
  users: ChatUser[];
  mentionNotifications: MentionNotification[];
  unreadCounts: Record<string, number>;
  replyingTo: ConversationMessage | null;
  editingMessageId: string | null;
  hasMoreMessages: boolean;
  loadingOlder: boolean;
}
