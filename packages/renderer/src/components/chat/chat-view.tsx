"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSubject } from "subjecto/react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import type { ConversationSummary } from "@/store/types";
import { $activeNav, $conversationChat } from "@/store/subjects";
import { createGenieDm, dismissMentionsForConversation, loadChatUsers, loadConversations } from "@/store/actions";
import { ConversationList } from "@/components/chat/conversation-list";
import { ConversationMessages } from "@/components/chat/conversation-messages";
import { ChatUsersPanel } from "@/components/chat/chat-users-panel";
import { CreateRoomDialog } from "@/components/chat/create-room-dialog";

export function ChatView({ embedded = false }: { embedded?: boolean }) {
  const [conversationChat] = useSubject($conversationChat);
  const [activeNav] = useSubject($activeNav);
  const { conversations, activeConversationId } = conversationChat;
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

  // Clear stacked toasts for the conversation the user is actively viewing.
  useEffect(() => {
    if (activeNav === "chat" && activeConversationId) {
      dismissMentionsForConversation(activeConversationId);
    }
  }, [activeNav, activeConversationId]);

  return (
    <div className="flex-1 flex min-h-0 relative flex-col">
      {embedded && (
        <div className="shrink-0 px-3 py-1.5 border-b border-surface0 bg-surface0/30 text-[11px] text-overlay0">
          All team conversations — not scoped to this instance
        </div>
      )}
      <div className="flex-1 flex min-h-0 relative">
      {/* Conversation sidebar */}
      <div className="w-[220px] shrink-0 border-r border-surface0 flex flex-col">
        <div className="px-3">
          <ViewHeader
            title="Team chat"
            subtitle={embedded ? undefined : "Messages with your team and Genie"}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setShowCreateRoom(true)} title="New Room" aria-label="New room">
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

      {/* Create room dialog */}
      {showCreateRoom && (
        <CreateRoomDialog onClose={() => setShowCreateRoom(false)} />
      )}
      </div>
    </div>
  );
}
