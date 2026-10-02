import { Subject } from "subjecto/core";
import type { ChatState, ConversationChatState, PinnedAssistantVm } from "../types/chat";

export const $chat = new Subject<ChatState>({
  messages: [], loading: false, streamingContent: "", streamingSteps: [],
  toolUses: [], statusText: "", modelId: "claude-code", maxToolRounds: 0, toolRoundsUsed: 0,
  claudeInfo: null, sessions: [], sessionsLoading: false, activeSessionId: null,
  resumedFrom: null, connectionError: null, reconnecting: false, lastSendMeta: null,
  activeTurnId: null,
});

export const $conversationChat = new Subject<ConversationChatState>({
  conversations: [], activeConversationId: null, messages: [], members: [],
  loading: false, streamingContent: "", streamingConversationId: null, toolUses: [],
  users: [], mentionNotifications: [], unreadCounts: {}, replyingTo: null,
  editingMessageId: null, hasMoreMessages: false, loadingOlder: false,
});

/** Pinned VM for the floating assistant. Hydrated from localStorage on first
 *  read so the pin survives reload. The store's setter writes back to storage
 *  so all writes go through one place. */
const PINNED_VM_STORAGE_KEY = "genie.assistant.pinnedVm";

function loadPinFromStorage(): PinnedAssistantVm | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PINNED_VM_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PinnedAssistantVm;
  } catch {
    return null;
  }
}

export const $pinnedAssistantVm = new Subject<PinnedAssistantVm | null>(loadPinFromStorage());

/** Internal helper invoked by the action setter — kept here so storage I/O
 *  lives next to the subject. */
export function persistPinnedAssistantVm(vm: PinnedAssistantVm | null): void {
  if (typeof window === "undefined") return;
  try {
    if (vm) window.localStorage.setItem(PINNED_VM_STORAGE_KEY, JSON.stringify(vm));
    else window.localStorage.removeItem(PINNED_VM_STORAGE_KEY);
  } catch { /* storage full / disabled — fail silently */ }
}
