"use client";

import { useSubject } from "subjecto/react";
import { AtSign, MessageSquare, X } from "lucide-react";
import { $conversationChat, $windowManager } from "@/store/subjects";
import { dismissAllMessageNotifications, dismissMentionNotification, selectConversation, switchNav } from "@/store/actions";
import { cn } from "@/lib/utils";

const ASSISTANT_WINDOW_ID = "genie-assistant";

export function ChatNotificationToasts() {
  const [conversationChat] = useSubject($conversationChat);
  const [windowManager] = useSubject($windowManager);
  const { mentionNotifications } = conversationChat;

  const assistantWindow = windowManager.windows[ASSISTANT_WINDOW_ID];
  const fabVisible = !assistantWindow || assistantWindow.status !== "minimized";

  if (mentionNotifications.length === 0) return null;

  return (
    <div
      className={cn(
        "fixed right-4 flex flex-col gap-2 z-50 pointer-events-none transition-[bottom] max-h-[min(70vh,480px)]",
        fabVisible ? "bottom-20" : "bottom-4",
      )}
    >
      {mentionNotifications.length > 1 && (
        <div className="pointer-events-auto flex justify-end">
          <button
            type="button"
            onClick={() => dismissAllMessageNotifications()}
            className="px-2 py-1 rounded-md bg-mantle/95 border border-surface0 text-[11px] text-overlay0 hover:text-text shadow-sm cursor-pointer transition-colors"
          >
            Dismiss all ({mentionNotifications.length})
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 overflow-y-auto scrollbar-thin pointer-events-none">
        {mentionNotifications.map((n) => (
          <div
            key={n.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2 bg-mantle border rounded-lg shadow-lg px-3 py-2 max-w-[300px] animate-in slide-in-from-right cursor-pointer hover:bg-surface0/50 transition-colors",
              n.isMention ? "border-blue/40" : "border-surface0",
            )}
            onClick={() => {
              switchNav("chat");
              selectConversation(n.conversationId);
            }}
            role="status"
          >
            {n.isMention ? (
              <AtSign size={14} className="text-blue shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <MessageSquare size={14} className="text-blue shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-md font-medium text-text truncate">
                {n.senderName}
                <span className="text-overlay0 font-normal"> · {n.conversationName}</span>
              </p>
              <p className="text-md text-overlay0 truncate">{n.content}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissMentionNotification(n.id);
              }}
              className="p-0.5 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text shrink-0"
              aria-label="Dismiss notification"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
