import { wsSend } from "@/lib/ws";
import { $auth } from "../subjects/auth";
import { $activeNav } from "../subjects/common";
import { $conversationChat } from "../subjects/chat";
import type { ConversationChatState } from "../types/chat";
import type { HandlerMap } from "./types";

// --- Conversation Chat messages ---

export const handlers: HandlerMap = {
  "chat:users:list": (payload) => {
    $conversationChat.nextAssign({ users: payload.users });
  },

  "chat:presence": (_payload) => {
    // Re-fetch full user list so online status is accurate
    wsSend("chat:users:list", {});
  },

  "chat:conversations:list": (payload) => {
    $conversationChat.nextAssign({ conversations: payload.conversations });
  },

  "chat:conversation:created": (payload) => {
    const { conversation } = payload;
    // Auto-open the new conversation
    $conversationChat.nextAssign({
      activeConversationId: conversation.id,
      messages: [],
      loading: false,
    });
  },

  "chat:messages:list": (payload) => {
    const { conversationId, messages: msgs, members, hasMore } = payload;
    const cc = $conversationChat.getValue();
    if (cc.activeConversationId === conversationId) {
      if (cc.loadingOlder) {
        // Prepend older messages
        $conversationChat.nextAssign({
          messages: [...msgs, ...cc.messages],
          loadingOlder: false,
          hasMoreMessages: hasMore ?? false,
          ...(members ? { members } : {}),
        });
      } else {
        // Initial load
        $conversationChat.nextAssign({
          messages: msgs,
          hasMoreMessages: msgs.length >= 20,
          loading: false,
          ...(members ? { members } : {}),
        });
      }
    }
  },

  "chat:message:new": (payload) => {
    const { conversationId, message } = payload;
    const cc = $conversationChat.getValue();
    const isViewingThisConv = cc.activeConversationId === conversationId && $activeNav.getValue() === "chat";
    if (isViewingThisConv) {
      $conversationChat.nextAssign({ messages: [...cc.messages, message] });
    } else {
      // Increment unread count for conversations we're not viewing
      $conversationChat.nextAssign({
        unreadCounts: {
          ...cc.unreadCounts,
          [conversationId]: (cc.unreadCounts[conversationId] || 0) + 1,
        },
      });

      // Show toast notification if message is from someone else
      const currentUser = $auth.getValue().user;
      if (currentUser && message.senderId !== currentUser.id) {
        const conv = cc.conversations.find((c) => c.id === conversationId);
        const convName = conv?.name || (conv?.type === "dm" ? "DM" : "Chat");
        $conversationChat.nextAssign({
          mentionNotifications: [
            ...cc.mentionNotifications,
            {
              id: message.id || `msg-${Date.now()}`,
              conversationId,
              conversationName: convName,
              senderName: message.senderName,
              content: message.content.slice(0, 100),
              createdAt: message.createdAt,
            },
          ],
        });
      }
    }
    // Update conversation list preview immutably
    const convIdx = cc.conversations.findIndex((c) => c.id === conversationId);
    if (convIdx >= 0) {
      $conversationChat.nextAssign({
        conversations: cc.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                lastMessage: {
                  content: message.content.slice(0, 100),
                  senderName: message.senderName,
                  createdAt: message.createdAt,
                },
                updatedAt: message.createdAt,
              }
            : c
        ),
      });
    } else {
      // Conversation not in our list yet — re-fetch
      wsSend("chat:conversations:list", {});
    }
  },

  "chat:message:token": (payload) => {
    const { conversationId, token } = payload;
    const cc = $conversationChat.getValue();
    if (cc.activeConversationId === conversationId) {
      $conversationChat.nextAssign({
        streamingContent: cc.streamingContent + token,
        streamingConversationId: conversationId,
      });
    }
  },

  "chat:message:done": (payload) => {
    const { conversationId, message } = payload;
    const cc = $conversationChat.getValue();
    if (cc.activeConversationId === conversationId) {
      $conversationChat.nextAssign({
        messages: [...cc.messages, message],
        streamingContent: "",
        streamingConversationId: null,
        toolUses: [],
      });
    }
    // Update conversation list preview immutably
    $conversationChat.nextAssign({
      conversations: cc.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              lastMessage: {
                content: message.content.slice(0, 100),
                senderName: message.senderName,
                createdAt: message.createdAt,
              },
            }
          : c
      ),
    });
  },

  "chat:message:tool": (payload) => {
    const { conversationId } = payload;
    const cc = $conversationChat.getValue();
    if (cc.activeConversationId === conversationId) {
      $conversationChat.nextAssign({
        toolUses: [...cc.toolUses, {
          name: payload.name,
          input: payload.input,
          result: payload.result,
        }],
      });
    }
  },

  "chat:members:updated": (payload) => {
    const { conversationId, members: updatedMembers } = payload;
    const cc = $conversationChat.getValue();
    // Update members if this is the active conversation
    const memberUpdate: Partial<ConversationChatState> = {};
    if (cc.activeConversationId === conversationId) {
      memberUpdate.members = updatedMembers;
    }
    // Update conversation summary members immutably
    memberUpdate.conversations = cc.conversations.map((c) =>
      c.id === conversationId ? { ...c, members: updatedMembers } : c
    );
    $conversationChat.nextAssign(memberUpdate);
  },

  "chat:mention": (payload) => {
    const { conversationId, conversationName, senderName, content, messageId } = payload;
    const cc = $conversationChat.getValue();
    // Only add notification if not currently viewing that conversation
    if (cc.activeConversationId !== conversationId) {
      $conversationChat.nextAssign({
        mentionNotifications: [
          ...cc.mentionNotifications,
          {
            id: messageId || `mention-${Date.now()}`,
            conversationId,
            conversationName,
            senderName,
            content,
            createdAt: new Date().toISOString(),
          },
        ],
      });
    }
  },

  "chat:reaction:updated": (payload) => {
    const { conversationId, messageId, reactions } = payload;
    const cc = $conversationChat.getValue();
    if (cc.activeConversationId === conversationId) {
      $conversationChat.nextAssign({
        messages: cc.messages.map((m) =>
          m.id === messageId ? { ...m, reactions } : m
        ),
      });
    }
  },

  "chat:message:edited": (payload) => {
    const { conversationId, messageId, content, editedAt } = payload;
    const cc = $conversationChat.getValue();
    if (cc.activeConversationId === conversationId) {
      $conversationChat.nextAssign({
        messages: cc.messages.map((m) =>
          m.id === messageId ? { ...m, content, editedAt } : m
        ),
      });
    }
  },

  "chat:message:error": (payload) => {
    const { conversationId, message: errMsg } = payload;
    const cc = $conversationChat.getValue();
    if (cc.activeConversationId === conversationId) {
      $conversationChat.nextAssign({
        streamingContent: "",
        streamingConversationId: null,
        toolUses: [],
        // Add error as a system message
        messages: [...cc.messages, {
          id: `error-${Date.now()}`,
          conversationId,
          senderId: "system",
          senderName: "System",
          senderAvatar: null,
          isAgent: false,
          content: `Error: ${errMsg}`,
          metadata: null,
          replyToId: null,
          replyTo: null,
          editedAt: null,
          reactions: {},
          createdAt: new Date().toISOString(),
        }],
      });
    }
  },
};
