"use client";

// Extension-side team chat tab + the share-terminal popup that gets mounted
// in the terminal toolbar. Both depend on the chat store ($conversationChat)
// and the share-terminal action — colocating them keeps the chat-related
// surface in one place.

import { useEffect, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { ArrowLeft, Bot, Loader2, Send, Share2, Users } from "lucide-react";
import type { ConversationMessage as ConvMessage, ConversationSummary, TerminalShareInvite } from "@/store/types";
import { $auth, $conversationChat } from "@/store/subjects";
import { createGenieDm, loadChatUsers, loadConversations, selectConversation, sendConversationMessage, shareTerminal } from "@/store/actions";

export function ExtTeamChat() {
  const [cc] = useSubject($conversationChat);
  const [auth] = useSubject($auth);
  const { conversations, activeConversationId, messages, members, loading, streamingContent, users, unreadCounts, mentionNotifications } = cc;
  const authUser = auth.user;
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const creatingGenieDmRef = useRef(false);

  useEffect(() => {
    loadConversations();
    loadChatUsers();
  }, []);

  // Auto-create Genie DM if none exists
  useEffect(() => {
    if (conversations.length === 0 || creatingGenieDmRef.current) return;
    const hasGenie = conversations.some((c) => c.type === "dm" && c.members.some((m) => m.isAgent));
    if (!hasGenie) {
      creatingGenieDmRef.current = true;
      createGenieDm();
    }
  }, [conversations]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendConversationMessage(text);
  }

  // Conversation list view
  if (!activeConversationId) {
    const dms = conversations.filter((c) => c.type === "dm");
    const rooms = conversations.filter((c) => c.type === "room");

    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto">
          {dms.length > 0 && (
            <div className="px-3 pt-3">
              <p className="text-overlay0 font-semibold uppercase tracking-wide px-1 pb-1" style={{ fontSize: 11 }}>Direct Messages</p>
              {dms.map((conv) => (
                <ExtConvItem key={conv.id} conv={conv} unread={unreadCounts[conv.id] || 0} hasMention={mentionNotifications.some((n) => n.conversationId === conv.id)} />
              ))}
            </div>
          )}
          {rooms.length > 0 && (
            <div className="px-3 pt-3">
              <p className="text-overlay0 font-semibold uppercase tracking-wide px-1 pb-1" style={{ fontSize: 11 }}>Rooms</p>
              {rooms.map((conv) => (
                <ExtConvItem key={conv.id} conv={conv} unread={unreadCounts[conv.id] || 0} hasMention={mentionNotifications.some((n) => n.conversationId === conv.id)} />
              ))}
            </div>
          )}
          {conversations.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-overlay0 py-12" style={{ fontSize: 13 }}>
              <Users size={24} className="mb-2 opacity-40" />
              <p>No conversations yet</p>
            </div>
          )}
        </div>

        {/* Online users */}
        <div className="border-t border-surface0 px-3 py-2 shrink-0">
          <p className="text-overlay0 font-semibold uppercase tracking-wide px-1 pb-1" style={{ fontSize: 11 }}>Online</p>
          <div className="flex flex-wrap gap-1">
            {users.filter((u) => u.online && u.id !== authUser?.id).map((u) => (
              <span key={u.id} className="flex items-center gap-1 px-1.5 py-0.5 bg-surface0 rounded-md" style={{ fontSize: 12 }}>
                <span className="w-1.5 h-1.5 rounded-full bg-green shrink-0" />
                {u.isAgent ? <Bot size={10} className="text-blue" /> : null}
                <span className="text-text truncate" style={{ maxWidth: 80 }}>{u.name}</span>
              </span>
            ))}
            {users.filter((u) => u.online && u.id !== authUser?.id).length === 0 && (
              <span className="text-overlay0" style={{ fontSize: 12 }}>No one online</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active conversation messages view
  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const convName = activeConv?.type === "dm"
    ? activeConv.members.find((m) => m.isAgent)?.name || "DM"
    : activeConv?.name || "Room";

  return (
    <div className="flex flex-col h-full">
      {/* Header with back button */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
        <button onClick={() => $conversationChat.nextAssign({ activeConversationId: null })} className="text-overlay1 hover:text-text transition-colors p-0.5">
          <ArrowLeft size={14} />
        </button>
        {activeConv?.type === "dm" ? <Bot size={13} className="text-blue" /> : <Users size={13} className="text-mauve" />}
        <span className="text-text font-medium truncate" style={{ fontSize: 13 }}>{convName}</span>
        <div className="flex-1" />
        {activeConv?.type === "room" && (
          <span className="text-overlay0" style={{ fontSize: 11 }}>{members.length} members</span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
        {loading && messages.length === 0 && (
          <div className="flex items-center justify-center flex-1">
            <Loader2 size={16} className="text-mauve animate-spin" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-overlay0" style={{ fontSize: 13 }}>
            <p>Send a message to start</p>
          </div>
        )}

        {messages.map((msg) => (
          <ExtMessageRow key={msg.id} msg={msg} isOwn={msg.senderId === authUser?.id} />
        ))}

        {streamingContent && (
          <div className="flex items-start gap-1.5">
            <div className="w-4 h-4 rounded-full bg-blue/20 flex items-center justify-center shrink-0 mt-0.5">
              <Bot size={10} className="text-blue" />
            </div>
            <div className="text-text whitespace-pre-wrap" style={{ fontSize: 13 }}>{streamingContent}<span className="inline-block w-1 h-3 bg-text/50 ml-0.5 animate-pulse align-text-bottom" /></div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-surface0 bg-mantle px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Message..."
            className="flex-1 bg-surface0 text-text rounded-md px-2.5 py-1.5 outline-none placeholder:text-overlay0 border border-surface1 focus:border-mauve/40 transition-colors"
            style={{ fontSize: 13 }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-1.5 rounded-md bg-mauve text-crust hover:bg-lavender transition-colors shrink-0 disabled:opacity-30"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ExtConvItem({ conv, unread, hasMention }: { conv: ConversationSummary; unread: number; hasMention: boolean }) {
  const isDm = conv.type === "dm";
  const name = isDm ? conv.members.find((m) => m.isAgent)?.name || "Genie" : conv.name || "Untitled Room";
  const Icon = isDm ? Bot : Users;

  return (
    <button
      onClick={() => selectConversation(conv.id)}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface0/50 transition-colors text-left"
    >
      <Icon size={13} className="text-overlay0 shrink-0" />
      <span className={`flex-1 truncate ${unread > 0 ? "text-text font-medium" : "text-subtext0"}`} style={{ fontSize: 13 }}>{name}</span>
      {hasMention && <span className="w-2 h-2 rounded-full bg-blue shrink-0" />}
      {!hasMention && unread > 0 && (
        <span className="min-w-[16px] h-4 rounded-full bg-surface1 text-subtext0 flex items-center justify-center px-1 shrink-0" style={{ fontSize: 10 }}>{unread > 99 ? "99+" : unread}</span>
      )}
    </button>
  );
}

function ExtMessageRow({ msg, isOwn }: { msg: ConvMessage; isOwn: boolean }) {
  const time = new Date(msg.createdAt);
  const timeStr = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}`;

  return (
    <div className={`flex items-start gap-1.5 ${isOwn ? "flex-row-reverse" : ""}`}>
      {!isOwn && (
        <div className="w-4 h-4 rounded-full bg-surface1 flex items-center justify-center shrink-0 mt-0.5 overflow-hidden">
          {msg.isAgent ? (
            <Bot size={10} className="text-blue" />
          ) : msg.senderAvatar ? (
            <img src={msg.senderAvatar} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="font-medium text-subtext0" style={{ fontSize: 8 }}>{msg.senderName[0]?.toUpperCase()}</span>
          )}
        </div>
      )}
      <div className={`max-w-[80%] ${isOwn ? "items-end" : ""}`}>
        {!isOwn && (
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-overlay0 font-medium" style={{ fontSize: 11 }}>{msg.senderName}</span>
            <span className="text-overlay0" style={{ fontSize: 10 }}>{timeStr}</span>
          </div>
        )}
        <div className={`rounded-lg px-2.5 py-1.5 chat-message-content ${isOwn ? "bg-mauve/15 text-text" : msg.isAgent ? "bg-surface0 text-text" : "bg-surface0 text-text"}`}>
          <div className="whitespace-pre-wrap break-words" style={{ fontSize: 13, lineHeight: 1.5 }}>{msg.content}</div>
        </div>
        {isOwn && (
          <div className="text-right">
            <span className="text-overlay0" style={{ fontSize: 10 }}>{timeStr}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Share Terminal Popup ---

export function ShareTerminalPopup({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [cc] = useSubject($conversationChat);
  const [auth] = useSubject($auth);
  const { users } = cc;
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const onlineUsers = users.filter((u) => u.online && !u.isAgent && u.id !== auth.user?.id);

  useEffect(() => {
    function handleSent() { setStatus("sent"); setTimeout(onClose, 1200); }
    function handleError(e: Event) {
      const detail = (e as CustomEvent).detail;
      setStatus("error");
      setErrorMsg(detail?.message || "Failed to share");
    }
    window.addEventListener("genie:terminal:share:sent", handleSent);
    window.addEventListener("genie:terminal:share:error", handleError);
    return () => {
      window.removeEventListener("genie:terminal:share:sent", handleSent);
      window.removeEventListener("genie:terminal:share:error", handleError);
    };
  }, [onClose]);

  return (
    <div className="absolute top-full right-0 mt-1 w-48 bg-mantle border border-surface0 rounded-lg shadow-lg z-50 overflow-hidden">
      <div className="px-3 py-2 border-b border-surface0">
        <span className="text-text font-medium" style={{ fontSize: 12 }}>Share terminal with</span>
      </div>
      {status === "sent" && (
        <div className="px-3 py-3 text-green text-center" style={{ fontSize: 12 }}>Invite sent!</div>
      )}
      {status === "error" && (
        <div className="px-3 py-2 text-red text-center" style={{ fontSize: 12 }}>{errorMsg}</div>
      )}
      {status === "idle" && (
        <div className="max-h-[200px] overflow-y-auto">
          {onlineUsers.length === 0 && (
            <div className="px-3 py-3 text-overlay0 text-center" style={{ fontSize: 12 }}>No users online</div>
          )}
          {onlineUsers.map((user) => (
            <button
              key={user.id}
              onClick={() => { shareTerminal(sessionId, user.id); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-surface0/50 transition-colors text-left"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green shrink-0" />
              <span className="text-text truncate" style={{ fontSize: 12 }}>{user.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Terminal Share Invite Banner ---

export function ShareInviteBanner({ invite, onAccept, onDecline }: { invite: TerminalShareInvite; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-blue/10 border-b border-blue/20 shrink-0">
      <Share2 size={13} className="text-blue shrink-0" />
      <span className="flex-1 text-text truncate" style={{ fontSize: 12 }}>
        <span className="font-medium">{invite.ownerName}</span> shared a terminal
      </span>
      <button
        onClick={onAccept}
        className="px-2 py-0.5 rounded bg-blue/20 text-blue hover:bg-blue/30 transition-colors font-medium"
        style={{ fontSize: 11 }}
      >Join</button>
      <button
        onClick={onDecline}
        className="px-2 py-0.5 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
        style={{ fontSize: 11 }}
      >Dismiss</button>
    </div>
  );
}
