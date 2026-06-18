import { wsSend, isWsConnected } from "@/lib/ws";
import { $chat, $pinnedAssistantVm, persistPinnedAssistantVm } from "../subjects/chat";
import type { ChatMessage, ChatSendMeta, PinnedAssistantVm } from "../types/chat";

// --- Chat actions ---

export type ChatModelId = "claude-code" | "claude-opus" | "claude-sonnet" | "deepseek-v3" | "deepseek-v4-pro" | "kimi-k2.6" | "qwen-3.6-plus";

export const CHAT_MODELS: Record<ChatModelId, string> = {
  "claude-code": "Claude Code",
  "claude-opus": "Claude Opus",
  "claude-sonnet": "Claude Sonnet",
  "deepseek-v3": "DeepSeek V3",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "kimi-k2.6": "Kimi K2.6",
  "qwen-3.6-plus": "Qwen3.6 Plus",
};

function wireMessages(messages: ChatMessage[]) {
  return messages.map((m: ChatMessage) => (
    m.images && m.images.length > 0
      ? { role: m.role, content: m.content, images: m.images }
      : { role: m.role, content: m.content }
  ));
}

export function setChatModel(modelId: ChatModelId): void {
  const c = $chat.getValue();
  if (c.modelId !== modelId) {
    $chat.next({
      messages: [], loading: false, streamingContent: "", streamingSteps: [], toolUses: [],
      statusText: "", modelId, maxToolRounds: 0, toolRoundsUsed: 0, claudeInfo: null,
      sessions: [], sessionsLoading: false, activeSessionId: null, resumedFrom: null,
      connectionError: null, reconnecting: false, lastSendMeta: null, activeTurnId: null,
    });
  }
}

export function sendChatMessage(
  text: string,
  context?: string,
  domSnapshot?: string,
  images?: string[],
): void {
  const c = $chat.getValue();
  const sendMeta: ChatSendMeta = { context, domSnapshot, images };
  const userMsg: ChatMessage = images && images.length > 0
    ? { role: "user", content: text, images }
    : { role: "user", content: text };
  const newMessages = [...c.messages, userMsg];
  // Stable id so a mid-turn socket drop can resume THIS turn on reconnect.
  const turnId = crypto.randomUUID();
  $chat.next({
    ...c,
    messages: newMessages,
    loading: true,
    streamingContent: "",
    streamingSteps: [],
    toolRoundsUsed: 0,
    connectionError: null,
    reconnecting: false,
    lastSendMeta: sendMeta,
    activeTurnId: turnId,
  });

  if (!isWsConnected()) {
    failChatSend(newMessages, "Not connected to the server. Check that the manager is running.");
    return;
  }

  const pinnedVm = $pinnedAssistantVm.getValue();
  const sent = wsSend("chat:send", {
    messages: wireMessages(newMessages),
    context,
    domSnapshot,
    modelId: c.modelId,
    pinnedVm,
    turnId,
  });
  if (!sent) {
    failChatSend(newMessages, "Could not send your message. The connection may have dropped.");
  }
}

function failChatSend(messagesWithUser: ChatMessage[], error: string): void {
  const c = $chat.getValue();
  $chat.next({
    ...c,
    messages: messagesWithUser.slice(0, -1),
    loading: false,
    streamingContent: "",
    streamingSteps: [],
    toolUses: [],
    statusText: "",
    reconnecting: false,
    connectionError: error,
  });
}

/** Resend the last user turn after a failed assistant response or disconnect. */
export function retryLastChatMessage(context?: string, domSnapshot?: string): void {
  const c = $chat.getValue();
  let messages = [...c.messages];
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && (last.isError || last.content.startsWith("Error:"))) {
    messages = messages.slice(0, -1);
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return;

  const meta = c.lastSendMeta;
  const resolvedContext = context ?? meta?.context;
  const resolvedSnapshot = domSnapshot ?? meta?.domSnapshot;
  const turnId = crypto.randomUUID();

  $chat.next({
    ...c,
    messages,
    loading: true,
    streamingContent: "",
    streamingSteps: [],
    toolUses: [],
    toolRoundsUsed: 0,
    connectionError: null,
    reconnecting: false,
    statusText: "",
    lastSendMeta: {
      context: resolvedContext,
      domSnapshot: resolvedSnapshot,
      images: meta?.images,
    },
    activeTurnId: turnId,
  });

  if (!isWsConnected()) {
    failChatSend(messages, "Not connected to the server. Check that the manager is running.");
    return;
  }

  const pinnedVm = $pinnedAssistantVm.getValue();
  const sent = wsSend("chat:send", {
    messages: wireMessages(messages),
    context: resolvedContext,
    domSnapshot: resolvedSnapshot,
    modelId: c.modelId,
    pinnedVm,
    turnId,
  });
  if (!sent) {
    failChatSend(messages, "Could not send your message. The connection may have dropped.");
  }
}

export function dismissChatConnectionError(): void {
  $chat.nextAssign({ connectionError: null });
}

/** Grace window after the WS dies before we degrade the streaming bubble into a
 *  hard "Connection lost" error. Cleared the moment we fire a `chat:resume` on
 *  reconnect, so it only ever fires when we truly never came back (e.g. offline,
 *  or auth never re-confirmed). Aligned with the manager's durable-turn grace
 *  (TURN_GRACE_MS) so the client doesn't give up while the server's buffered
 *  turn is still resumable. */
const RECONNECT_DEGRADE_MS = 120_000;
let degradeTimer: ReturnType<typeof setTimeout> | null = null;

function clearDegradeTimer(): void {
  if (degradeTimer) {
    clearTimeout(degradeTimer);
    degradeTimer = null;
  }
}

/** WS closed mid-turn. Keep the streaming bubble visible and show a subtle
 *  "Reconnecting…" indicator instead of wiping the partial response. If the
 *  socket doesn't come back within RECONNECT_DEGRADE_MS, degrade to the
 *  existing "Connection lost. Retry?" UX so the user isn't stuck. */
export function handleChatWsDisconnect(reason: string): void {
  const c = $chat.getValue();
  if (!c.loading) return;
  $chat.nextAssign({ reconnecting: true });
  clearDegradeTimer();
  degradeTimer = setTimeout(() => {
    degradeTimer = null;
    const cur = $chat.getValue();
    if (!cur.loading || !cur.reconnecting) return;
    $chat.next({
      ...cur,
      loading: false,
      streamingContent: "",
      streamingSteps: [],
      toolUses: [],
      statusText: "",
      toolRoundsUsed: 0,
      reconnecting: false,
      connectionError: reason || "Connection lost. Your message may not have completed.",
    });
  }, RECONNECT_DEGRADE_MS);
}

/** Re-auth confirmed after a reconnect. If a turn was in flight when the socket
 *  dropped, ask the manager to resume it: the durable turn kept running there,
 *  so it replays one `chat:replay` snapshot (+ the terminal event if it already
 *  finished) — no re-execution of tools, no double-billing, no stuck spinner.
 *  Fires from the `auth:success` handler (not raw socket-open) so the server has
 *  our userId before `chat:resume` arrives — otherwise the ACL drops it pre-auth.
 *
 *  The "Reconnecting…" badge stays up until the replay lands (cleared by the
 *  `chat:replay` handler). If the buffered turn is gone the manager replies
 *  `chat:resume:gone` → we degrade to the retry UX. If we can't even resume by id
 *  (older send without a turnId), the degrade timer remains the fallback. */
export function resumeChatTurnOnReconnect(): void {
  const c = $chat.getValue();
  if (!c.loading || !c.reconnecting) return; // no interrupted turn
  if (!c.activeTurnId) return;                // can't resume by id — degrade timer handles it
  clearDegradeTimer();
  const sent = wsSend("chat:resume", { turnId: c.activeTurnId });
  if (!sent) {
    // Socket vanished again before we could ask — re-arm the degrade fallback.
    handleChatWsDisconnect("Connection lost. Your message may not have completed.");
  }
}

/** The manager has no buffered turn for our id (grace expired / unknown). Degrade
 *  to the "Connection lost. Retry?" UX so the user isn't stuck loading. */
export function handleChatResumeGone(): void {
  clearDegradeTimer();
  const c = $chat.getValue();
  if (!c.loading) return;
  $chat.next({
    ...c,
    loading: false,
    streamingContent: "",
    streamingSteps: [],
    toolUses: [],
    statusText: "",
    toolRoundsUsed: 0,
    reconnecting: false,
    activeTurnId: null,
    connectionError: "Connection lost. Your message may not have completed.",
  });
}

/** Clear the degrade timer when a turn settles (done/error/replay-with-result),
 *  so a stale timer can't wipe a fresh turn. */
export function clearChatDegradeTimer(): void {
  clearDegradeTimer();
}

/** Set or clear the assistant's pinned VM. Persisted to localStorage so the
 *  pin survives reload. */
export function setPinnedAssistantVm(vm: PinnedAssistantVm | null): void {
  $pinnedAssistantVm.next(vm);
  persistPinnedAssistantVm(vm);
}

export function stopChat(): void {
  const c = $chat.getValue();
  wsSend("chat:stop", {});
  const steps = [...c.streamingSteps];
  if (c.streamingContent) steps.push({ content: c.streamingContent });
  let newMessages = c.messages;
  if (steps.length > 0) {
    const toolUses = c.toolUses.length > 0 ? [...c.toolUses] : undefined;
    newMessages = [...c.messages, { role: "assistant" as const, content: steps.map(st => st.content).join(""), toolUses, steps }];
  }
  clearDegradeTimer();
  $chat.next({ ...c, messages: newMessages, streamingContent: "", streamingSteps: [], toolUses: [], loading: false, toolRoundsUsed: 0, reconnecting: false, activeTurnId: null });
}

export function resetChat(): void {
  clearDegradeTimer();
  const modelId = $chat.getValue().modelId;
  $chat.next({
    messages: [], loading: false, streamingContent: "", streamingSteps: [], toolUses: [],
    statusText: "", modelId, maxToolRounds: 0, toolRoundsUsed: 0, claudeInfo: null,
    sessions: [], sessionsLoading: false, activeSessionId: null, resumedFrom: null,
    connectionError: null, reconnecting: false, lastSendMeta: null, activeTurnId: null,
  });
}

export function loadChatSessions(): void {
  $chat.nextAssign({ sessionsLoading: true });
  wsSend("chat:sessions:list", {});
}

export function loadChatSession(sessionId: string): void {
  $chat.nextAssign({ loading: true, activeSessionId: sessionId, connectionError: null });
  wsSend("chat:session:load", { sessionId });
}

export function newChat(): void {
  clearDegradeTimer();
  $chat.nextAssign({
    messages: [], loading: false, streamingContent: "", streamingSteps: [],
    toolUses: [], statusText: "", activeSessionId: null, resumedFrom: null,
    connectionError: null, reconnecting: false, lastSendMeta: null, activeTurnId: null,
  });
}

export function renameChatSession(sessionId: string, name: string): void {
  wsSend("chat:session:rename", { sessionId, name });
}

export function deleteChatSession(sessionId: string): void {
  wsSend("chat:session:delete", { sessionId });
}
