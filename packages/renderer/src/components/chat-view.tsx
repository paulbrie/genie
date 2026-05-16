"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSubject } from "subjecto/react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/view-header";
import type { ConversationSummary } from "@/store/types";
import { $conversationChat } from "@/store/subjects";
import { createGenieDm, loadChatUsers, loadConversations } from "@/store/actions";
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

      {/* Create room dialog */}
      {showCreateRoom && (
        <CreateRoomDialog onClose={() => setShowCreateRoom(false)} />
      )}
    </div>
  );
}
