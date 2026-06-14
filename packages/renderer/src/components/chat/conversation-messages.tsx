"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSubject } from "subjecto/react";
import { Send, Bot, SmilePlus, Reply, Pencil, X, Copy, Square, MoreHorizontal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AuthUser, ConversationMember, ConversationMessage, ToolUse } from "@/store/types";
import { $auth, $conversationChat } from "@/store/subjects";
import { cancelEditingMessage, loadOlderMessages, sendConversationMessage, sendEditedMessage, setReplyingTo, startEditingMessage, stopConversationChat, toggleReaction } from "@/store/actions";
import { cn } from "@/lib/utils";
import { markdownComponents } from "@/components/ui/markdown-link";
import { ToolPill, getToolStatusText } from "@/components/ui/tool-pill";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ChatErrorBubble } from "@/components/chat/chat-error-bubble";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const EMOJI_LIST = ["👍", "❤️", "😂", "🎉", "👀", "🔥", "🚀", "✅"];

export function ConversationMessages() {
  const [conversationChat] = useSubject($conversationChat);
  const { activeConversationId, messages, members, loading, streamingContent, toolUses, replyingTo, editingMessageId, hasMoreMessages, loadingOlder } = conversationChat;
  const [auth] = useSubject($auth);
  const authUser = auth.user as AuthUser | null;
  const [input, setInput] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevMessageCountRef = useRef(0);
  const prevConvIdRef = useRef<string | null>(null);
  // Set when the conversation switches; the jump is deferred until this
  // conversation's messages actually render (they load async after selection).
  const pendingJumpRef = useRef(false);

  // Auto-scroll to bottom only for new messages (not when loading older)
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const newCount = messages.length;
    prevMessageCountRef.current = newCount;

    if (prevConvIdRef.current !== activeConversationId) {
      prevConvIdRef.current = activeConversationId;
      pendingJumpRef.current = true;
    }

    // Conversation just selected/switched: snap straight to the bottom with no
    // scroll animation. Keep snapping across renders until the messages have
    // arrived (async load), then clear the flag.
    if (pendingJumpRef.current) {
      const snap = () => {
        const c = scrollContainerRef.current;
        if (c) c.scrollTop = c.scrollHeight;
      };
      snap();
      if (newCount > 0) {
        // One more after layout settles (avatars/markdown can change height).
        requestAnimationFrame(snap);
        pendingJumpRef.current = false;
      }
      return;
    }

    // If messages were prepended (older loaded), restore scroll position instead
    if (newCount > prevCount && prevCount > 0 && loadingOlder) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, toolUses, activeConversationId]);

  // Preserve scroll position when older messages are prepended
  useEffect(() => {
    if (!loadingOlder && scrollContainerRef.current) {
      // After older messages render, the container will have new content at top
      // We don't need to do anything special since we skip auto-scroll above
    }
  }, [loadingOlder]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (el.scrollTop < 50 && hasMoreMessages && !loadingOlder) {
      const prevScrollHeight = el.scrollHeight;
      loadOlderMessages();
      // After messages prepend, restore scroll position
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const newScrollHeight = scrollContainerRef.current.scrollHeight;
            scrollContainerRef.current.scrollTop = newScrollHeight - prevScrollHeight;
          }
        });
      });
    }
  }, [hasMoreMessages, loadingOlder]);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = messageRefs.current.get(messageId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("bg-blue/10");
      setTimeout(() => el.classList.remove("bg-blue/10"), 1500);
    }
  }, []);

  // Compute mention suggestions
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return members.filter((m) => {
      if (m.userId === authUser?.id) return false;
      return m.name.toLowerCase().includes(q);
    });
  }, [mentionQuery, members, authUser?.id]);

  // Reset mention index when suggestions change
  useEffect(() => {
    setMentionIndex(0);
  }, [mentionSuggestions.length]);

  // Focus input when replying
  useEffect(() => {
    if (replyingTo) inputRef.current?.focus();
  }, [replyingTo]);

  if (!activeConversationId) {
    return (
      <div className="flex-1 flex items-center justify-center text-overlay0 text-md">
        Select a conversation to start chatting
      </div>
    );
  }

  function handleInputChange(value: string) {
    setInput(value);
    const cursorPos = inputRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1]);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(name: string) {
    const cursorPos = inputRef.current?.selectionStart ?? input.length;
    const textBeforeCursor = input.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@(\w*)$/);
    if (match) {
      const firstName = name.split(" ")[0];
      const before = textBeforeCursor.slice(0, match.index);
      const after = input.slice(cursorPos);
      const newValue = `${before}@${firstName} ${after}`;
      setInput(newValue);
      setMentionQuery(null);
      setTimeout(() => {
        inputRef.current?.focus();
        const newCursor = (before + `@${firstName} `).length;
        inputRef.current?.setSelectionRange(newCursor, newCursor);
      }, 0);
    }
  }

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMentionQuery(null);
    sendConversationMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionSuggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionSuggestions[mentionIndex].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isStreaming = !!streamingContent;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto flex flex-col gap-2 px-4 py-3 scrollbar-thin"
        role="log"
        aria-live="polite"
        aria-label="Conversation messages"
      >
        {/* Loading older messages indicator */}
        {loadingOlder && (
          <div className="flex justify-center py-2">
            <div className="w-4 h-4 border-2 border-blue border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {loading && messages.length === 0 && (
          <div className="flex items-center justify-center flex-1">
            <div className="w-5 h-5 border-2 border-blue border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-overlay0 text-md text-center gap-2">
            <Bot size={32} className="opacity-30" />
            <p>Send a message to start the conversation</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageRow
            key={msg.id}
            message={msg}
            isOwnMessage={msg.senderId === authUser?.id}
            conversationId={activeConversationId!}
            userId={authUser?.id || ""}
            editingMessageId={editingMessageId}
            scrollToMessage={scrollToMessage}
            setRef={(id, el) => {
              if (el) messageRefs.current.set(id, el);
              else messageRefs.current.delete(id);
            }}
          />
        ))}

        {/* Active tool pills while streaming */}
        {toolUses.length > 0 && (
          <div className="flex justify-start">
            <div className="flex flex-wrap gap-1.5 mb-1">
              {toolUses.map((tool, i) => (
                <ToolPill key={i} tool={tool} active />
              ))}
            </div>
          </div>
        )}

        {/* Streaming assistant content */}
        {isStreaming && (
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-blue/20 flex items-center justify-center shrink-0 mt-0.5">
              <Bot size={12} className="text-blue" />
            </div>
            <div className="text-md text-text chat-message-content">
              <div className="chat-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {streamingContent}
                </ReactMarkdown>
              </div>
              <span className="inline-block w-1.5 h-4 bg-text/50 ml-0.5 animate-pulse align-text-bottom" />
            </div>
          </div>
        )}

        {/* Thinking indicator */}
        {!isStreaming && toolUses.length > 0 && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-md text-overlay0">
              <div className="w-3.5 h-3.5 border-2 border-blue/40 border-t-blue rounded-full animate-spin" />
              <span>
                {getToolStatusText(toolUses[toolUses.length - 1])}
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Reply banner */}
      {replyingTo && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-surface0/50 border-t border-surface0">
          <Reply size={12} className="text-blue shrink-0" />
          <span className="text-md text-overlay0 truncate flex-1">
            Replying to <span className="font-medium text-text">{replyingTo.senderName}</span>: {replyingTo.content.slice(0, 60)}
          </span>
          <button
            onClick={() => setReplyingTo(null)}
            className="p-0.5 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Input bar */}
      <div className="shrink-0 relative">
        {/* @mention autocomplete popover */}
        {mentionQuery !== null && mentionSuggestions.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-mantle border border-surface0 rounded-md shadow-lg max-h-[150px] overflow-y-auto scrollbar-thin z-10">
            {mentionSuggestions.map((member, i) => (
              <button
                key={member.userId}
                onMouseDown={(e) => { e.preventDefault(); insertMention(member.name); }}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-1.5 text-left border-none cursor-pointer text-md transition-colors",
                  i === mentionIndex
                    ? "bg-surface0 text-text"
                    : "bg-transparent text-subtext0 hover:bg-surface0 hover:text-text"
                )}
              >
                {member.isAgent ? (
                  <div className="w-4 h-4 rounded-full bg-blue/20 flex items-center justify-center shrink-0">
                    <Bot size={10} className="text-blue" />
                  </div>
                ) : (
                  <div className="w-4 h-4 rounded-full bg-surface1 flex items-center justify-center shrink-0 overflow-hidden">
                    {member.avatarUrl ? (
                      <img src={member.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="text-[8px] font-medium text-subtext0">
                        {member.name[0]?.toUpperCase()}
                      </span>
                    )}
                  </div>
                )}
                {member.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 px-4 py-2 border-t border-surface0">
          <AutoTextarea
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={replyingTo ? "Type your reply…" : "Type a message…"}
            aria-label="Message input"
            className="flex-1 bg-surface0 border border-surface1 rounded-md px-3 py-1.5 text-md text-text placeholder:text-overlay0 outline-none focus:border-blue"
          />
          {isStreaming ? (
            <button
              onClick={() => activeConversationId && stopConversationChat(activeConversationId)}
              className="p-1.5 rounded-md border-none cursor-pointer bg-red text-background hover:bg-red/80 transition-colors duration-150 shrink-0"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className={cn(
                "p-1.5 rounded-md border-none cursor-pointer transition-colors duration-150 shrink-0",
                !input.trim()
                  ? "bg-surface0 text-overlay0 cursor-not-allowed"
                  : "bg-blue text-background hover:bg-blue/80"
              )}
              aria-label="Send message"
            >
              <Send size={14} />
            </button>
          )}
        </div>
        <p className="text-[10px] text-overlay0/80 px-4 pb-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}

// --- MessageRow with hover toolbar, reactions, reply preview, inline edit ---

function MessageRow({
  message,
  isOwnMessage,
  conversationId,
  userId,
  editingMessageId,
  scrollToMessage,
  setRef,
}: {
  message: ConversationMessage;
  isOwnMessage: boolean;
  conversationId: string;
  userId: string;
  editingMessageId: string | null;
  scrollToMessage: (id: string) => void;
  setRef: (id: string, el: HTMLDivElement | null) => void;
}) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const isEditing = editingMessageId === message.id;

  useEffect(() => {
    if (isEditing) setEditText(message.content);
  }, [isEditing, message.content]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleEditSave = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== message.content) {
      sendEditedMessage(conversationId, message.id, trimmed);
    } else {
      cancelEditingMessage();
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleEditSave();
    }
    if (e.key === "Escape") {
      cancelEditingMessage();
    }
  };

  const reactionEntries = Object.entries(message.reactions || {});

  if (message.senderId === "system" && message.content.startsWith("Error:")) {
    return (
      <div ref={(el) => setRef(message.id, el)} className="flex justify-start px-1">
        <ChatErrorBubble content={message.content} />
      </div>
    );
  }

  return (
    <div
      ref={(el) => setRef(message.id, el)}
      tabIndex={0}
      className={cn("group relative flex items-start gap-2 rounded-md transition-colors duration-300 outline-none focus-visible:ring-1 focus-visible:ring-blue/40", isOwnMessage && "flex-row-reverse")}
      onContextMenu={handleContextMenu}
    >
      {/* Avatar */}
      {message.isAgent ? (
        <div className="w-5 h-5 rounded-full bg-blue/20 flex items-center justify-center shrink-0 mt-0.5">
          <Bot size={12} className="text-blue" />
        </div>
      ) : (
        <div className="w-5 h-5 rounded-full bg-surface1 flex items-center justify-center shrink-0 mt-0.5 overflow-hidden">
          {message.senderAvatar ? (
            <img src={message.senderAvatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-md font-medium text-subtext0">
              {message.senderName[0]?.toUpperCase()}
            </span>
          )}
        </div>
      )}

      <div className={cn("max-w-[80%] flex flex-col", isOwnMessage ? "items-end" : "items-start")}>
        {/* Sender name for non-own messages */}
        {!isOwnMessage && (
          <p className="text-md text-overlay0 mb-0.5 font-medium">
            {message.senderName}
          </p>
        )}

        {/* Reply preview */}
        {message.replyTo && (
          <button
            onClick={() => scrollToMessage(message.replyTo!.id)}
            className="flex items-start gap-1.5 mb-1 px-2 py-1 bg-transparent border-none cursor-pointer rounded text-left hover:bg-surface0/50 transition-colors"
          >
            <div className="w-0.5 shrink-0 self-stretch bg-blue/40 rounded-full" />
            <div className="min-w-0">
              <p className="text-md font-medium text-blue/70">{message.replyTo.senderName}</p>
              <p className="text-md text-overlay0 truncate">{message.replyTo.contentPreview}</p>
            </div>
          </button>
        )}

        {isEditing ? (
          /* Inline edit mode */
          <div className="min-w-[200px]">
            <input
              ref={editInputRef}
              autoFocus
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleEditKeyDown}
              className="w-full bg-surface0 border border-blue rounded-md px-3 py-1.5 text-md text-text outline-none"
            />
            <p className="text-md text-overlay0 mt-0.5">Enter to save, Escape to cancel</p>
          </div>
        ) : (
          /* Message content */
          <div
            className={cn(
              "px-3 py-1.5 rounded-lg text-md break-words chat-message-content",
              isOwnMessage
                ? "bg-surface0 text-text rounded-br-sm whitespace-pre-wrap"
                : "text-text rounded-bl-sm"
            )}
          >
            {isOwnMessage ? (
              <>
                {message.content}
                {message.editedAt && <span className="text-md text-overlay0 ml-1">(edited)</span>}
              </>
            ) : (
              <div className="chat-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {message.content}
                </ReactMarkdown>
                {message.editedAt && <span className="text-md text-overlay0 ml-1">(edited)</span>}
              </div>
            )}
          </div>
        )}

        {/* Reaction pills */}
        {reactionEntries.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {reactionEntries.map(([emoji, userIds]) => {
              const hasReacted = userIds.includes(userId);
              return (
                <button
                  key={emoji}
                  onClick={() => toggleReaction(conversationId, message.id, emoji)}
                  className={cn(
                    "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-md border-none cursor-pointer transition-colors",
                    hasReacted
                      ? "bg-blue/20 text-blue"
                      : "bg-surface0 text-subtext0 hover:bg-surface1"
                  )}
                >
                  <span>{emoji}</span>
                  <span className="text-md">{userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Message actions toolbar */}
      <div className={cn(
        "absolute top-0 flex items-center gap-0.5 bg-mantle border border-surface0 rounded-md shadow-sm px-0.5 py-0.5 z-10 transition-opacity",
        "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:group-focus:opacity-100",
        isOwnMessage ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"
      )}>
        <button
          type="button"
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text rounded hover:bg-surface0 transition-colors sm:hidden"
          aria-label="Message actions"
        >
          <MoreHorizontal size={12} />
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text rounded hover:bg-surface0 transition-colors hidden sm:block"
              aria-label="Add reaction"
            >
              <SmilePlus size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top"><span className="text-md">React</span></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setReplyingTo(message)}
              className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text rounded hover:bg-surface0 transition-colors"
            >
              <Reply size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top"><span className="text-md">Reply</span></TooltipContent>
        </Tooltip>
        {isOwnMessage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => startEditingMessage(message.id)}
                className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text rounded hover:bg-surface0 transition-colors"
              >
                <Pencil size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><span className="text-md">Edit</span></TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Mini emoji picker */}
      {showEmojiPicker && (
        <div className={cn(
          "absolute top-7 z-20 bg-mantle border border-surface0 rounded-lg shadow-lg p-1.5 flex gap-1 flex-wrap w-[180px]",
          isOwnMessage ? "left-0" : "right-0"
        )}>
          {EMOJI_LIST.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                toggleReaction(conversationId, message.id, emoji);
                setShowEmojiPicker(false);
              }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface0 cursor-pointer bg-transparent border-none text-base transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-mantle border border-surface0 rounded-md shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { setShowEmojiPicker(true); setContextMenu(null); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-md bg-transparent border-none cursor-pointer text-subtext0 hover:bg-surface0 hover:text-text transition-colors"
          >
            <SmilePlus size={12} /> React
          </button>
          <button
            onClick={() => { setReplyingTo(message); setContextMenu(null); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-md bg-transparent border-none cursor-pointer text-subtext0 hover:bg-surface0 hover:text-text transition-colors"
          >
            <Reply size={12} /> Reply
          </button>
          {isOwnMessage && (
            <button
              onClick={() => { startEditingMessage(message.id); setContextMenu(null); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-md bg-transparent border-none cursor-pointer text-subtext0 hover:bg-surface0 hover:text-text transition-colors"
            >
              <Pencil size={12} /> Edit
            </button>
          )}
          <button
            onClick={() => { navigator.clipboard.writeText(message.content); setContextMenu(null); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-md bg-transparent border-none cursor-pointer text-subtext0 hover:bg-surface0 hover:text-text transition-colors"
          >
            <Copy size={12} /> Copy text
          </button>
        </div>
      )}
    </div>
  );
}

