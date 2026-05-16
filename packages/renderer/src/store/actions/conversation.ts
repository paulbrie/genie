import { wsSend } from "@/lib/ws";
import { $conversationChat } from "../subjects/chat";
import type { ConversationChatState, ConversationMessage } from "../types/chat";

// --- Conversation Chat actions ---

export function loadConversations(): void {
  wsSend("chat:conversations:list", {});
}

export function loadChatUsers(): void {
  wsSend("chat:users:list", {});
}

export function selectConversation(id: string): void {
  const cc = $conversationChat.getValue();
  const { [id]: _, ...restCounts } = cc.unreadCounts;
  $conversationChat.next({
    ...cc, activeConversationId: id, messages: [], loading: true,
    streamingContent: "", toolUses: [],
    mentionNotifications: cc.mentionNotifications.filter((n) => n.conversationId !== id),
    unreadCounts: restCounts, hasMoreMessages: false, loadingOlder: false,
  });
  wsSend("chat:conversation:open", { conversationId: id, limit: 20 });
}

export function loadOlderMessages(): void {
  const cc = $conversationChat.getValue();
  const convId = cc.activeConversationId;
  if (!convId || cc.loadingOlder || !cc.hasMoreMessages) return;
  if (cc.messages.length === 0) return;
  $conversationChat.nextAssign({ loadingOlder: true });
  wsSend("chat:messages:load", { conversationId: convId, limit: 20, before: cc.messages[0].createdAt });
}

export function stopConversationChat(conversationId: string): void {
  wsSend("chat:message:stop", { conversationId });
  $conversationChat.nextAssign({ streamingContent: "", streamingConversationId: null, toolUses: [] });
}

export function sendConversationMessage(text: string): void {
  const cc = $conversationChat.getValue();
  const convId = cc.activeConversationId;
  if (!convId) return;
  const replyToId = cc.replyingTo?.id || undefined;
  wsSend("chat:message:send", { conversationId: convId, content: text, replyToId });
  $conversationChat.nextAssign({ replyingTo: null });
}

export function createGenieDm(): void {
  wsSend("chat:conversation:create", { type: "dm" });
}

export function openDmWith(targetUserId: string): void {
  wsSend("chat:conversation:create", { type: "dm", targetUserId });
}

export function createRoom(name: string, memberIds: string[]): void {
  wsSend("chat:conversation:create", { type: "room", name, memberIds });
}

export function addMemberToConversation(conversationId: string, userId: string): void {
  wsSend("chat:member:add", { conversationId, targetUserId: userId });
}

export function removeMemberFromConversation(conversationId: string, userId: string): void {
  wsSend("chat:member:remove", { conversationId, targetUserId: userId });
}

export function dismissMentionNotification(id: string): void {
  const cc = $conversationChat.getValue();
  $conversationChat.nextAssign({ mentionNotifications: cc.mentionNotifications.filter((n) => n.id !== id) });
}

export function dismissMentionsForConversation(conversationId: string): void {
  const cc = $conversationChat.getValue();
  $conversationChat.nextAssign({ mentionNotifications: cc.mentionNotifications.filter((n) => n.conversationId !== conversationId) });
}

// --- Reply / Edit / Reaction actions ---

export function setReplyingTo(message: ConversationMessage | null): void {
  $conversationChat.nextAssign({ replyingTo: message, editingMessageId: null });
}

export function startEditingMessage(messageId: string): void {
  $conversationChat.nextAssign({ editingMessageId: messageId, replyingTo: null });
}

export function cancelEditingMessage(): void {
  $conversationChat.nextAssign({ editingMessageId: null });
}

export function toggleReaction(conversationId: string, messageId: string, emoji: string): void {
  wsSend("chat:reaction:toggle", { conversationId, messageId, emoji });
}

export function sendEditedMessage(conversationId: string, messageId: string, content: string): void {
  wsSend("chat:message:edit", { conversationId, messageId, content });
  $conversationChat.nextAssign({ editingMessageId: null });
}

// Re-export of ConversationChatState type used by handlers; not strictly needed
// here but keeps the action module self-contained for consumers.
export type { ConversationChatState };
