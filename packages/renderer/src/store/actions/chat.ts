import { wsSend } from "@/lib/ws";
import { $chat, $pinnedAssistantVm, persistPinnedAssistantVm } from "../subjects/chat";
import type { ChatMessage, PinnedAssistantVm } from "../types/chat";

// --- Chat actions ---

export type ChatModelId = "claude-code" | "claude-opus" | "claude-sonnet" | "deepseek-v3" | "kimi-k2";

export const CHAT_MODELS: Record<ChatModelId, string> = {
  "claude-code": "Claude Code",
  "claude-opus": "Claude Opus",
  "claude-sonnet": "Claude Sonnet",
  "deepseek-v3": "DeepSeek V3",
  "kimi-k2": "Kimi K2.5",
};

export function setChatModel(modelId: ChatModelId): void {
  const c = $chat.getValue();
  if (c.modelId !== modelId) {
    $chat.next({ messages: [], loading: false, streamingContent: "", streamingSteps: [], toolUses: [], statusText: "", modelId, maxToolRounds: 0, toolRoundsUsed: 0, claudeInfo: null, sessions: [], sessionsLoading: false, activeSessionId: null, resumedFrom: null });
  }
}

export function sendChatMessage(
  text: string,
  context?: string,
  domSnapshot?: string,
  images?: string[],
): void {
  const c = $chat.getValue();
  const userMsg: ChatMessage = images && images.length > 0
    ? { role: "user", content: text, images }
    : { role: "user", content: text };
  const newMessages = [...c.messages, userMsg];
  $chat.next({ ...c, messages: newMessages, loading: true, streamingContent: "", streamingSteps: [], toolRoundsUsed: 0 });
  // Forward `images` to the manager so the model sees them; keep `content`/`role`
  // identical to the previous wire shape for messages without images.
  const plain = newMessages.map((m: ChatMessage) => (
    m.images && m.images.length > 0
      ? { role: m.role, content: m.content, images: m.images }
      : { role: m.role, content: m.content }
  ));
  const pinnedVm = $pinnedAssistantVm.getValue();
  wsSend("chat:send", { messages: plain, context, domSnapshot, modelId: c.modelId, pinnedVm });
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
  $chat.next({ messages: [], loading: false, streamingContent: "", streamingSteps: [], toolUses: [], statusText: "", modelId, maxToolRounds: 0, toolRoundsUsed: 0, claudeInfo: null, sessions: [], sessionsLoading: false, activeSessionId: null, resumedFrom: null });
}

export function loadChatSessions(): void {
  $chat.nextAssign({ sessionsLoading: true });
  wsSend("chat:sessions:list", {});
}

export function loadChatSession(sessionId: string): void {
  $chat.nextAssign({ loading: true, activeSessionId: sessionId });
  wsSend("chat:session:load", { sessionId });
}

export function newChat(): void {
  $chat.nextAssign({
    messages: [], loading: false, streamingContent: "", streamingSteps: [],
    toolUses: [], statusText: "", activeSessionId: null, resumedFrom: null,
  });
}

export function renameChatSession(sessionId: string, name: string): void {
  wsSend("chat:session:rename", { sessionId, name });
}

export function deleteChatSession(sessionId: string): void {
  wsSend("chat:session:delete", { sessionId });
}
