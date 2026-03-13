"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSubject } from "subjecto/react";
import { Plus, X, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/view-header";
import { $conversationChat, loadConversations, loadChatUsers, createGenieDm, selectConversation, dismissMentionNotification, type ConversationSummary, type MentionNotification } from "@/store";
import { ConversationList } from "@/components/conversation-list";
import { ConversationMessages } from "@/components/conversation-messages";
import { ChatUsersPanel } from "@/components/chat-users-panel";
import { CreateRoomDialog } from "@/components/create-room-dialog";

export function ChatView() {
  const [conversationChat] = useSubject($conversationChat);
  const { conversations } = conversationChat;
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const creatingGenieDmRef = useRef(false);

  useEffect(() => {
    loadConversations();
    loadChatUsers();
  }, []);

  // Auto-create Genie DM if none exists and conversations are loaded
  useEffect(() => {
    if (conversations.length === 0) return;
    if (creatingGenieDmRef.current) return;
    const hasGenie = conversations.some(
      (c) => c.type === "dm" && c.members.some((m) => m.isAgent),
    );
    if (!hasGenie) {
      creatingGenieDmRef.current = true;
      createGenieDm();
    }
  }, [conversations]);

  return (
    <div className="flex-1 flex min-h-0 relative">
      {/* Conversation sidebar */}
      <div className="w-[220px] shrink-0 border-r border-surface0 flex flex-col">
        <div className="px-3">
          <ViewHeader
            title="Chat"
            actions={
              <Button size="sm" variant="ghost" onClick={() => setShowCreateRoom(true)} title="New Room">
                <Plus size={14} />
              </Button>
            }
          />
        </div>
        <ConversationList />
      </div>

      {/* Message area */}
      <ConversationMessages />

      {/* Users panel */}
      <ChatUsersPanel />

      {/* Mention toasts */}
      <MentionToasts />

      {/* Create room dialog */}
      {showCreateRoom && (
        <CreateRoomDialog onClose={() => setShowCreateRoom(false)} />
      )}
    </div>
  );
}

function MentionToasts() {
  const [conversationChat] = useSubject($conversationChat);
  const { mentionNotifications } = conversationChat;

  // Auto-dismiss after 5s
  useEffect(() => {
    if (mentionNotifications.length === 0) return;
    const timers = mentionNotifications.map((n) => {
      return setTimeout(() => {
        dismissMentionNotification(n.id);
      }, 5000);
    });
    return () => timers.forEach(clearTimeout);
  }, [mentionNotifications]);

  if (mentionNotifications.length === 0) return null;

  return (
    <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-20 pointer-events-none">
      {mentionNotifications.slice(-3).map((n) => (
        <div
          key={n.id}
          className="pointer-events-auto flex items-start gap-2 bg-mantle border border-surface0 rounded-lg shadow-lg px-3 py-2 max-w-[280px] animate-in slide-in-from-right cursor-pointer hover:bg-surface0/50 transition-colors"
          onClick={() => {
            selectConversation(n.conversationId);
            dismissMentionNotification(n.id);
          }}
        >
          <AtSign size={14} className="text-blue shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-md font-medium text-text truncate">
              {n.senderName} in {n.conversationName}
            </p>
            <p className="text-md text-overlay0 truncate">{n.content}</p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismissMentionNotification(n.id);
            }}
            className="p-0.5 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text shrink-0"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
