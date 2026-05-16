"use client";

import { useEffect } from "react";
import { useSubject } from "subjecto/react";
import { MessageSquare, X } from "lucide-react";
import { $conversationChat } from "@/store/subjects";
import { dismissMentionNotification, selectConversation, switchNav } from "@/store/actions";
export function ChatNotificationToasts() {
  const [conversationChat] = useSubject($conversationChat);
  const { mentionNotifications } = conversationChat;

  // Auto-dismiss after 5s
  useEffect(() => {
    if (mentionNotifications.length === 0) return;
    const timers = mentionNotifications.map((n) =>
      setTimeout(() => dismissMentionNotification(n.id), 5000),
    );
    return () => timers.forEach(clearTimeout);
  }, [mentionNotifications]);

  if (mentionNotifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 pointer-events-none">
      {mentionNotifications.slice(-3).map((n) => (
        <div
          key={n.id}
          className="pointer-events-auto flex items-start gap-2 bg-mantle border border-surface0 rounded-lg shadow-lg px-3 py-2 max-w-[300px] animate-in slide-in-from-right cursor-pointer hover:bg-surface0/50 transition-colors"
          onClick={() => {
            switchNav("chat");
            selectConversation(n.conversationId);
            dismissMentionNotification(n.id);
          }}
        >
          <MessageSquare size={14} className="text-blue shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-md font-medium text-text truncate">
              {n.senderName}
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
