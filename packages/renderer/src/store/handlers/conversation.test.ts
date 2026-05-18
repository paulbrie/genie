// Conversation (room/DM) chat handlers — the biggest remaining domain.
// Lots of "only if you're viewing this conversation" branches; tests
// pin $activeConversationId and $activeNav to drive each branch.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/ws", () => ({ wsSend: vi.fn() }));

import { handlers } from "./conversation";
import { $conversationChat } from "../subjects/chat";
import { $auth } from "../subjects/auth";
import { $activeNav } from "../subjects/common";
import { wsSend } from "@/lib/ws";
import type { ConversationChatState } from "../types/chat";

const FRESH: ConversationChatState = {
  conversations: [],
  activeConversationId: null,
  messages: [],
  members: [],
  loading: false,
  streamingContent: "",
  streamingConversationId: null,
  toolUses: [],
  users: [],
  mentionNotifications: [],
  unreadCounts: {},
  replyingTo: null,
  editingMessageId: null,
  hasMoreMessages: false,
  loadingOlder: false,
};

const me = { id: "u-me", email: "me@x", name: "Me", role: "user" as const };

function viewing(convId: string) {
  $conversationChat.next({ ...FRESH, activeConversationId: convId });
  $activeNav.next("chat");
}

beforeEach(() => {
  $conversationChat.next({ ...FRESH });
  $auth.next({ status: "authenticated", user: me, token: "jwt", impersonatedBy: null });
  $activeNav.next("chat");
  vi.clearAllMocks();
});

describe("chat:users:list / chat:presence", () => {
  it("chat:users:list replaces the user list", () => {
    handlers["chat:users:list"]({ users: [{ id: "u-1", name: "Alice", online: true }] });
    expect($conversationChat.getValue().users).toEqual([{ id: "u-1", name: "Alice", online: true }]);
  });

  it("chat:presence triggers a re-fetch of the user list", () => {
    handlers["chat:presence"]({});
    expect(wsSend).toHaveBeenCalledExactlyOnceWith("chat:users:list", {});
  });
});

describe("chat:conversations:list / created", () => {
  it("chat:conversations:list replaces the conversation list", () => {
    const conversations = [{ id: "c-1", name: "General", type: "room" }];
    handlers["chat:conversations:list"]({ conversations });
    expect($conversationChat.getValue().conversations).toEqual(conversations);
  });

  it("chat:conversation:created auto-opens the new conversation", () => {
    handlers["chat:conversation:created"]({ conversation: { id: "c-new", name: "Standup" } });
    const v = $conversationChat.getValue();
    expect(v.activeConversationId).toBe("c-new");
    expect(v.messages).toEqual([]);
    expect(v.loading).toBe(false);
  });
});

describe("chat:messages:list", () => {
  it("initial load: replaces messages, sets hasMoreMessages based on count", () => {
    viewing("c-1");
    const msgs = Array.from({ length: 25 }, (_, i) => ({ id: `m-${i}`, content: "x" }));

    handlers["chat:messages:list"]({
      conversationId: "c-1",
      messages: msgs,
      members: [{ userId: "u-1" }],
    });

    const v = $conversationChat.getValue();
    expect(v.messages).toHaveLength(25);
    expect(v.hasMoreMessages).toBe(true); // 25 >= 20
    expect(v.members).toEqual([{ userId: "u-1" }]);
    expect(v.loading).toBe(false);
  });

  it("initial load with few messages clears hasMoreMessages", () => {
    viewing("c-1");
    handlers["chat:messages:list"]({
      conversationId: "c-1",
      messages: [{ id: "m-1", content: "hi" }],
    });
    expect($conversationChat.getValue().hasMoreMessages).toBe(false);
  });

  it("loadingOlder path: prepends, sets hasMore from server, clears loadingOlder", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-1",
      messages: [{ id: "new-1", content: "newer" }],
      loadingOlder: true,
    });

    handlers["chat:messages:list"]({
      conversationId: "c-1",
      messages: [{ id: "old-1", content: "older" }],
      hasMore: false,
    });

    const v = $conversationChat.getValue();
    expect(v.messages.map((m: { id: string }) => m.id)).toEqual(["old-1", "new-1"]);
    expect(v.loadingOlder).toBe(false);
    expect(v.hasMoreMessages).toBe(false);
  });

  it("ignores messages for a conversation other than the active one", () => {
    viewing("c-1");
    handlers["chat:messages:list"]({
      conversationId: "c-other",
      messages: [{ id: "m-1", content: "leak attempt" }],
    });
    expect($conversationChat.getValue().messages).toEqual([]);
  });
});

describe("chat:message:new", () => {
  it("appends to messages when viewing the conversation", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-1",
      conversations: [{ id: "c-1", name: "General", type: "room" } as never],
    });
    $activeNav.next("chat");

    handlers["chat:message:new"]({
      conversationId: "c-1",
      message: {
        id: "m-1", senderId: "u-other", senderName: "Other", content: "hi", createdAt: "2026-05-18T10:00:00Z",
      },
    });

    expect($conversationChat.getValue().messages.map((m: { id: string }) => m.id)).toEqual(["m-1"]);
  });

  it("increments unread count when not viewing the conversation", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-other", // viewing a different conversation
      conversations: [{ id: "c-1", name: "General", type: "room" } as never],
      unreadCounts: { "c-1": 2 },
    });

    handlers["chat:message:new"]({
      conversationId: "c-1",
      message: { id: "m-1", senderId: "u-other", senderName: "Other", content: "hi", createdAt: "t" },
    });

    expect($conversationChat.getValue().unreadCounts).toEqual({ "c-1": 3 });
    expect($conversationChat.getValue().messages).toEqual([]); // not appended
  });

  it("adds a toast notification when message is from another user", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-other",
      conversations: [{ id: "c-1", name: "General", type: "room" } as never],
    });

    handlers["chat:message:new"]({
      conversationId: "c-1",
      message: {
        id: "m-1", senderId: "u-other", senderName: "Bob", content: "hi there", createdAt: "t",
      },
    });

    const notifs = $conversationChat.getValue().mentionNotifications;
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({
      conversationId: "c-1",
      conversationName: "General",
      senderName: "Bob",
      content: "hi there",
    });
  });

  it("does NOT add a toast for messages from the current user", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-other",
      conversations: [{ id: "c-1", name: "General", type: "room" } as never],
    });

    handlers["chat:message:new"]({
      conversationId: "c-1",
      message: { id: "m-1", senderId: me.id, senderName: me.name, content: "self echo", createdAt: "t" },
    });

    expect($conversationChat.getValue().mentionNotifications).toEqual([]);
  });

  it("updates the conversation list preview (lastMessage + updatedAt)", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-1",
      conversations: [{ id: "c-1", name: "General", type: "room" } as never],
    });

    handlers["chat:message:new"]({
      conversationId: "c-1",
      message: { id: "m-1", senderId: "u-other", senderName: "Bob", content: "hi", createdAt: "2026-05-18T10:00:00Z" },
    });

    const conv = $conversationChat.getValue().conversations[0];
    expect((conv as { lastMessage: object }).lastMessage).toMatchObject({
      content: "hi", senderName: "Bob",
    });
  });

  it("re-fetches the conversation list if the conversation isn't known yet", () => {
    $conversationChat.next({ ...FRESH, activeConversationId: "c-1", conversations: [] });

    handlers["chat:message:new"]({
      conversationId: "c-1",
      message: { id: "m-1", senderId: "u-other", senderName: "Bob", content: "hi", createdAt: "t" },
    });

    expect(wsSend).toHaveBeenCalledExactlyOnceWith("chat:conversations:list", {});
  });
});

describe("chat:message:token / done / tool (streaming AI replies)", () => {
  it(":token appends to streamingContent when viewing the conversation", () => {
    viewing("c-1");
    handlers["chat:message:token"]({ conversationId: "c-1", token: "Hel" });
    handlers["chat:message:token"]({ conversationId: "c-1", token: "lo" });

    expect($conversationChat.getValue().streamingContent).toBe("Hello");
    expect($conversationChat.getValue().streamingConversationId).toBe("c-1");
  });

  it(":token is ignored for non-active conversations", () => {
    viewing("c-1");
    handlers["chat:message:token"]({ conversationId: "c-other", token: "x" });
    expect($conversationChat.getValue().streamingContent).toBe("");
  });

  it(":done flushes streaming into messages and clears buffers", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-1",
      streamingContent: "partial",
      streamingConversationId: "c-1",
      toolUses: [{ name: "x", input: {}, result: "ok" }],
      conversations: [{ id: "c-1", name: "General" } as never],
    });

    handlers["chat:message:done"]({
      conversationId: "c-1",
      message: { id: "m-1", senderName: "Bot", content: "Hello", createdAt: "t" },
    });

    const v = $conversationChat.getValue();
    expect(v.messages.map((m: { id: string }) => m.id)).toEqual(["m-1"]);
    expect(v.streamingContent).toBe("");
    expect(v.streamingConversationId).toBeNull();
    expect(v.toolUses).toEqual([]);
  });

  it(":tool appends to the in-flight toolUses list", () => {
    viewing("c-1");
    handlers["chat:message:tool"]({
      conversationId: "c-1",
      name: "web_search",
      input: { query: "foo" },
      result: "200 OK",
    });
    expect($conversationChat.getValue().toolUses).toEqual([
      { name: "web_search", input: { query: "foo" }, result: "200 OK" },
    ]);
  });
});

describe("chat:members:updated", () => {
  it("updates the active conversation's members + the summary in the conversation list", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-1",
      conversations: [
        { id: "c-1", name: "General", members: [] } as never,
        { id: "c-2", name: "Other",  members: [] } as never,
      ],
    });

    handlers["chat:members:updated"]({
      conversationId: "c-1",
      members: [{ userId: "u-1" }, { userId: "u-2" }],
    });

    const v = $conversationChat.getValue();
    expect(v.members).toEqual([{ userId: "u-1" }, { userId: "u-2" }]);
    expect((v.conversations[0] as { members: unknown[] }).members).toEqual([{ userId: "u-1" }, { userId: "u-2" }]);
    expect((v.conversations[1] as { members: unknown[] }).members).toEqual([]);
  });

  it("updates only the conversation summary when it's not the active one", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-other",
      conversations: [{ id: "c-1", name: "General", members: [] } as never],
      members: [],
    });

    handlers["chat:members:updated"]({
      conversationId: "c-1",
      members: [{ userId: "u-1" }],
    });

    // members on the active conv was NOT touched
    expect($conversationChat.getValue().members).toEqual([]);
    expect(($conversationChat.getValue().conversations[0] as { members: unknown[] }).members).toHaveLength(1);
  });
});

describe("chat:mention / chat:reaction:updated / chat:message:edited / error", () => {
  it("chat:mention adds notification when conversation is not active", () => {
    $conversationChat.next({ ...FRESH, activeConversationId: "c-other" });

    handlers["chat:mention"]({
      conversationId: "c-1",
      conversationName: "General",
      senderName: "Bob",
      content: "hey @me",
      messageId: "m-1",
    });

    const notifs = $conversationChat.getValue().mentionNotifications;
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({
      conversationId: "c-1", senderName: "Bob", content: "hey @me", id: "m-1",
    });
  });

  it("chat:mention is a no-op when the user IS viewing that conversation", () => {
    viewing("c-1");
    handlers["chat:mention"]({ conversationId: "c-1", senderName: "x", content: "y", messageId: "m" });
    expect($conversationChat.getValue().mentionNotifications).toEqual([]);
  });

  it("chat:reaction:updated patches the matching message's reactions", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-1",
      messages: [{ id: "m-1", content: "msg", reactions: {} } as never],
    });

    handlers["chat:reaction:updated"]({
      conversationId: "c-1",
      messageId: "m-1",
      reactions: { "👍": ["u-1", "u-2"] },
    });

    expect(($conversationChat.getValue().messages[0] as { reactions: object }).reactions).toEqual({
      "👍": ["u-1", "u-2"],
    });
  });

  it("chat:message:edited patches content + editedAt", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-1",
      messages: [{ id: "m-1", content: "old", editedAt: null } as never],
    });

    handlers["chat:message:edited"]({
      conversationId: "c-1", messageId: "m-1", content: "new", editedAt: "2026-05-18T10:05:00Z",
    });

    const msg = $conversationChat.getValue().messages[0] as { content: string; editedAt: string };
    expect(msg.content).toBe("new");
    expect(msg.editedAt).toBe("2026-05-18T10:05:00Z");
  });

  it("chat:message:error appends a system 'Error: …' message and clears stream", () => {
    $conversationChat.next({
      ...FRESH,
      activeConversationId: "c-1",
      streamingContent: "half-typed",
      streamingConversationId: "c-1",
      toolUses: [{ name: "x", input: {}, result: "y" }],
    });

    handlers["chat:message:error"]({ conversationId: "c-1", message: "model rejected" });

    const v = $conversationChat.getValue();
    expect(v.streamingContent).toBe("");
    expect(v.streamingConversationId).toBeNull();
    expect(v.toolUses).toEqual([]);
    expect(v.messages).toHaveLength(1);
    expect(v.messages[0]).toMatchObject({
      senderId: "system", senderName: "System", content: "Error: model rejected",
    });
  });

  it("chat:message:error for an inactive conversation is a no-op", () => {
    $conversationChat.next({ ...FRESH, activeConversationId: "c-other" });
    handlers["chat:message:error"]({ conversationId: "c-1", message: "oops" });
    expect($conversationChat.getValue().messages).toEqual([]);
  });
});
