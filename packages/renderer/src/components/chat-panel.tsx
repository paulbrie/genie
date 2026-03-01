"use client";

import { useState, useRef, useEffect } from "react";
import { useDeepSubject } from "subjecto/react";
import { Send, MessageCircle, ChevronDown, ChevronUp, Search, Globe } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { store, sendChatMessage, type ChatMessage, type ToolUse } from "@/store";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function ChatPanel() {
  const messages = useDeepSubject(store, "chat/messages") as ChatMessage[];
  const loading = useDeepSubject(store, "chat/loading") as boolean;
  const streamingContent = useDeepSubject(store, "chat/streamingContent") as string;
  const toolUses = useDeepSubject(store, "chat/toolUses") as ToolUse[];
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-expand when first message arrives
  useEffect(() => {
    if (messages.length > 0 || streamingContent) {
      setExpanded(true);
    }
  }, [messages.length, streamingContent]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (expanded) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent, expanded, toolUses]);

  function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setExpanded(true);
    sendChatMessage(text);
  }

  return (
    <div className="shrink-0 border-t border-surface0 flex flex-col">
      {/* Toggle header — only shows when there are messages */}
      {messages.length > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 px-4 py-1.5 bg-transparent border-none cursor-pointer text-left w-full hover:bg-mantle transition-colors duration-150"
        >
          <MessageCircle size={14} className="text-overlay0 shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wide text-subtext0 flex-1">
            Chat
          </span>
          {expanded ? (
            <ChevronDown size={14} className="text-overlay0" />
          ) : (
            <ChevronUp size={14} className="text-overlay0" />
          )}
        </button>
      )}

      {/* Message area — collapsible */}
      {expanded && (
        <div className="flex flex-col h-[280px]">
          <div className="flex-1 overflow-y-auto flex flex-col gap-2 px-4 py-2 scrollbar-thin">
            {messages.length === 0 && !streamingContent && !loading && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-overlay0 text-xs text-center">
                  Ask about your running apps, processes, or containers
                </p>
              </div>
            )}

            {messages.map((msg: ChatMessage, i: number) => (
              <MessageBubble key={i} message={msg} />
            ))}

            {/* Active tool pills while loading */}
            {loading && toolUses.length > 0 && (
              <div className="flex justify-start">
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {toolUses.map((tool, i) => (
                    <ToolPill key={i} tool={tool} />
                  ))}
                </div>
              </div>
            )}

            {loading && streamingContent && (
              <MessageBubble
                message={{ role: "assistant", content: streamingContent }}
                streaming
              />
            )}

            {loading && !streamingContent && (
              <div className="flex justify-start">
                <div className="px-3 py-1.5 rounded-lg text-xs text-overlay0">
                  <span className="animate-pulse">
                    {toolUses.length > 0 ? getToolStatusText(toolUses[toolUses.length - 1]) : "Thinking..."}
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Input bar — always visible */}
      <div className="flex items-center gap-2 px-4 py-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask a question..."
          disabled={loading}
          className="flex-1 bg-surface0 border border-surface1 rounded-md px-3 py-1.5 text-sm text-text placeholder:text-overlay0 outline-none focus:border-blue disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className={cn(
            "p-1.5 rounded-md border-none cursor-pointer transition-colors duration-150",
            loading || !input.trim()
              ? "bg-surface0 text-overlay0 cursor-not-allowed"
              : "bg-blue text-background hover:bg-blue/80"
          )}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

function getToolStatusText(tool: ToolUse): string {
  if (tool.name === "web_search") return "Searching...";
  if (tool.name === "browse_url") return "Browsing...";
  return "Using tool...";
}

function getToolLabel(name: string): string {
  if (name === "web_search") return "Web Search";
  if (name === "browse_url") return "Browse";
  return name;
}

function getToolDetail(tool: ToolUse): string {
  if (tool.name === "web_search") return tool.input.query || "";
  if (tool.name === "browse_url") return tool.input.url || "";
  return JSON.stringify(tool.input);
}

function ToolPill({ tool, active }: { tool: ToolUse; active?: boolean }) {
  const Icon = tool.name === "web_search" ? Search : Globe;
  const detail = getToolDetail(tool);
  const preview = tool.result ? tool.result.slice(0, 200) : "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 bg-surface0 rounded-full px-2 py-0.5 text-[10px] text-subtext0 cursor-default",
            active && "animate-pulse"
          )}
        >
          <Icon size={10} className="shrink-0" />
          {getToolLabel(tool.name)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[320px]">
        <p className="text-xs font-medium mb-1">{detail}</p>
        {preview && (
          <p className="text-[10px] text-subtext1 whitespace-pre-wrap break-words">
            {preview}{tool.result && tool.result.length > 200 ? "..." : ""}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      {/* Tool pills above assistant message */}
      {!isUser && message.toolUses && message.toolUses.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1">
          {message.toolUses.map((tool, i) => (
            <ToolPill key={i} tool={tool} />
          ))}
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] px-3 py-1.5 rounded-lg text-sm break-words",
          isUser
            ? "bg-surface0 text-text rounded-br-sm whitespace-pre-wrap"
            : "text-text rounded-bl-sm"
        )}
      >
        {isUser ? (
          message.content
        ) : (
          <div className="chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {streaming && (
          <span className="inline-block w-1.5 h-4 bg-text/50 ml-0.5 animate-pulse align-text-bottom" />
        )}
      </div>
    </div>
  );
}
