"use client";

import { useSubject } from "subjecto/react";
import { MessageCircle, Bot, Users } from "lucide-react";
import type { ConversationSummary, MentionNotification } from "@/store/types";
import { $auth, $conversationChat } from "@/store/subjects";
import { selectConversation } from "@/store/actions";
import { cn } from "@/lib/utils";

export function ConversationList() {
  const [conversationChat] = useSubject($conversationChat);
  const { conversations, activeConversationId, mentionNotifications, unreadCounts } = conversationChat;

  // Sort: DMs first, then rooms, both by updatedAt desc
  const dms = conversations.filter((c) => c.type === "dm");
  const rooms = conversations.filter((c) => c.type === "room");

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {dms.length > 0 && (
          <div className="px-2 pt-2">
            <p className="text-md font-semibold uppercase tracking-wide text-overlay0 px-2 py-1">
              Direct Messages
            </p>
            {dms.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                active={conv.id === activeConversationId}
                mentionCount={mentionNotifications.filter((n) => n.conversationId === conv.id).length}
                unreadCount={unreadCounts[conv.id] || 0}
                onClick={() => selectConversation(conv.id)}
              />
            ))}
          </div>
        )}

        {rooms.length > 0 && (
          <div className="px-2 pt-2">
            <p className="text-md font-semibold uppercase tracking-wide text-overlay0 px-2 py-1">
              Rooms
            </p>
            {rooms.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                active={conv.id === activeConversationId}
                mentionCount={mentionNotifications.filter((n) => n.conversationId === conv.id).length}
                unreadCount={unreadCounts[conv.id] || 0}
                onClick={() => selectConversation(conv.id)}
              />
            ))}
          </div>
        )}

        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-overlay0 text-md px-4 text-center">
            <MessageCircle size={24} className="mb-2 opacity-40" />
            <p>No conversations yet</p>
            <p className="text-md mt-1">Your Genie DM will be created automatically when you send a message.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationItem({
  conversation,
  active,
  mentionCount,
  unreadCount,
  onClick,
}: {
  conversation: ConversationSummary;
  active: boolean;
  mentionCount: number;
  unreadCount: number;
  onClick: () => void;
}) {
  const [auth] = useSubject($auth);
  const isDm = conversation.type === "dm";
  const currentUserId = auth.user?.id;
  const otherMember = isDm
    ? conversation.members.find((m) => m.userId !== currentUserId) || conversation.members.find((m) => m.isAgent)
    : null;
  const displayName = isDm
    ? otherMember?.name || "DM"
    : conversation.name || "Untitled Room";

  const Icon = isDm && otherMember?.isAgent ? Bot : isDm ? MessageCircle : Users;
  const hasMention = mentionCount > 0;
  const hasUnread = unreadCount > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-start gap-2 px-2 py-1.5 rounded-md border-none",
        "text-left cursor-pointer transition-colors duration-150",
        active
          ? "bg-background text-text"
          : "bg-transparent text-subtext0 hover:bg-background hover:text-text"
      )}
    >
      <Icon size={14} className={cn("shrink-0 mt-0.5", active ? "text-blue" : "text-overlay0")} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <p className={cn("text-md truncate flex-1", hasUnread && !active && "font-semibold text-text")}>{displayName}</p>
          {hasMention && (
            <span className="shrink-0 w-2 h-2 rounded-full bg-blue" />
          )}
          {!hasMention && hasUnread && (
            <span className="shrink-0 min-w-[16px] h-4 rounded-full bg-surface1 text-[10px] font-medium text-subtext0 flex items-center justify-center px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
        {conversation.lastMessage && (
          <p className={cn("text-md truncate", hasUnread && !active ? "text-subtext0" : "text-overlay0")}>
            {conversation.lastMessage.senderName}: {conversation.lastMessage.content}
          </p>
        )}
      </div>
    </button>
  );
}
