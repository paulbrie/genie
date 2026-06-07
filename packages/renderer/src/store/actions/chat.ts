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
      connectionError: null, lastSendMeta: null,
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
  $chat.next({
    ...c,
    messages: newMessages,
    loading: true,
    streamingContent: "",
    streamingSteps: [],
    toolRoundsUsed: 0,
    connectionError: null,
    lastSendMeta: sendMeta,
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

  $chat.next({
    ...c,
    messages,
    loading: true,
    streamingContent: "",
    streamingSteps: [],
    toolUses: [],
    toolRoundsUsed: 0,
    connectionError: null,
    statusText: "",
    lastSendMeta: {
      context: resolvedContext,
      domSnapshot: resolvedSnapshot,
      images: meta?.images,
    },
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
  });
  if (!sent) {
    failChatSend(messages, "Could not send your message. The connection may have dropped.");
  }
}

export function dismissChatConnectionError(): void {
  $chat.nextAssign({ connectionError: null });
}

export function handleChatWsDisconnect(reason: string): void {
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
    connectionError: reason || "Connection lost. Your message may not have completed.",
  });
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
  $chat.next({ ...c, messages: newMessages, streamingContent: "", streamingSteps: [], toolUses: [], loading: false, toolRoundsUsed: 0 });
}

export function resetChat(): void {
  const modelId = $chat.getValue().modelId;
  $chat.next({
    messages: [], loading: false, streamingContent: "", streamingSteps: [], toolUses: [],
    statusText: "", modelId, maxToolRounds: 0, toolRoundsUsed: 0, claudeInfo: null,
    sessions: [], sessionsLoading: false, activeSessionId: null, resumedFrom: null,
    connectionError: null, lastSendMeta: null,
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
  $chat.nextAssign({
    messages: [], loading: false, streamingContent: "", streamingSteps: [],
    toolUses: [], statusText: "", activeSessionId: null, resumedFrom: null,
    connectionError: null, lastSendMeta: null,
  });
}

export function renameChatSession(sessionId: string, name: string): void {
  wsSend("chat:session:rename", { sessionId, name });
}

export function deleteChatSession(sessionId: string): void {
  wsSend("chat:session:delete", { sessionId });
}
