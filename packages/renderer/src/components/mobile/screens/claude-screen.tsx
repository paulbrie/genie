"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { ChevronLeft, Pin, ArrowUp, Square, SquarePen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClaudeLogo } from "@/components/mobile/claude-logo";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { $auth, $chat, $pinnedAssistantVm } from "@/store/subjects";
import {
  CHAT_MODELS,
  newChat,
  retryLastChatMessage,
  sendChatMessage,
  setChatModel,
  setPinnedAssistantVm,
  stopChat,
  type ChatModelId,
} from "@/store/actions";
import { QUICK_REPLIES, SUGGESTED_PROMPTS, type MockServer } from "@/components/mobile/mock-data";
import type { PinnedAssistantVm } from "@/store/types";

/** Build the manager-side pin so the assistant's ssh_exec runs on this server. */
function pinFor(server: MockServer): PinnedAssistantVm {
  const provider: PinnedAssistantVm["provider"] =
    server.provider === "digitalocean" ? "digitalocean" : server.provider === "tazcloud" ? "tazcloud" : "other";
  return {
    projectId: server.projectId ?? null,
    projectName: server.project,
    instanceId: server.id,
    label: server.label,
    host: server.host,
    provider,
  };
}

/** Lightweight context string sent with each turn (mobile has no DOM snapshot).
 *  Must carry the project id in a form the manager parses (`Project ID:` /
 *  `(id: …)`) — Claude Code routes to the VPS off the context, not the pinnedVm
 *  object, so omitting it makes the assistant report "requires a VPS instance". */
function buildContext(server: MockServer): string {
  const lines = ["=== Genie mobile · assistant context ==="];
  const user = $auth.getValue().user;
  if (user) lines.push(`User: ${user.name} (${user.email})`);
  if (server.projectId) {
    lines.push(`Project: ${server.project} (id: ${server.projectId})`);
    lines.push(`Project ID: ${server.projectId}`);
  }
  lines.push(`Instance ID: ${server.id}`);
  lines.push(`Server: ${server.label} (${server.host}) · project ${server.project} (${server.provider})`);
  lines.push("All ssh_exec calls run on this VM. Do not propose commands for another VM.");
  return lines.join("\n");
}

export function ClaudeScreen({
  server,
  onBack,
}: {
  server: MockServer;
  onBack: () => void;
}) {
  const [chat] = useSubject($chat);
  const [pin] = useSubject($pinnedAssistantVm);
  const [input, setInput] = useState("");

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Pin the assistant to this server while the screen is open.
  useEffect(() => {
    setPinnedAssistantVm(pinFor(server));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  // Keep pinned to the latest message as content streams in.
  useLayoutEffect(() => {
    endRef.current?.scrollIntoView({ behavior: chat.loading ? "auto" : "smooth" });
  }, [chat.messages, chat.streamingContent, chat.streamingSteps, chat.loading]);

  // Auto-grow the input.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  function send(text: string) {
    const t = text.trim();
    if (!t || chat.loading) return;
    setInput("");
    sendChatMessage(t, buildContext(server));
  }

  const busy = chat.loading;
  const isEmpty = chat.messages.length === 0 && !chat.loading && !chat.streamingContent;
  const pinLabel = pin?.label ?? server.label;
  const pinHost = pin?.host ?? server.host;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface0 shrink-0">
        <button onClick={onBack} className="p-1 -ml-1 rounded-lg text-overlay0 active:bg-surface0" aria-label="Back">
          <ChevronLeft size={22} />
        </button>
        <span className="text-peach shrink-0">
          <ClaudeLogo size={17} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-md font-semibold text-subtext0 leading-tight">Claude</p>
          <p className="text-xs text-overlay0 truncate">knows what you&apos;re looking at</p>
        </div>
        <select
          value={chat.modelId}
          onChange={(e) => setChatModel(e.target.value as ChatModelId)}
          className="bg-surface0 border border-surface1 rounded-full px-2 py-1 text-xs text-subtext0 outline-none focus:border-peach"
          aria-label="Model"
        >
          {Object.entries(CHAT_MODELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <button onClick={newChat} className="p-1.5 rounded-lg text-overlay0 active:bg-surface0" aria-label="New chat">
          <SquarePen size={16} />
        </button>
      </div>

      {/* Pinned VM banner */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-peach/20 bg-peach/10 shrink-0">
        <Pin size={11} className="text-peach shrink-0" />
        <span className="text-xs text-peach font-medium truncate">
          Commands run on <span className="font-mono">{pinLabel}</span>
        </span>
        <span className="text-2xs text-overlay0 font-mono truncate ml-auto">{pinHost}</span>
      </div>

      {/* Connection error */}
      {chat.connectionError && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-red/20 bg-red/10 shrink-0 text-xs text-red">
          <span className="flex-1 truncate">{chat.connectionError}</span>
          <button onClick={() => retryLastChatMessage(buildContext(server))} className="font-medium underline">
            Retry
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="min-h-full flex flex-col px-4 py-3 gap-2">
          <ChatMessageList
            messages={chat.messages}
            streamingContent={chat.streamingContent}
            streamingSteps={chat.streamingSteps}
            toolUses={chat.toolUses}
            loading={chat.loading}
            statusText={chat.statusText}
            maxToolRounds={chat.maxToolRounds}
            toolRoundsUsed={chat.toolRoundsUsed}
            onRetry={() => retryLastChatMessage(buildContext(server))}
            accent="peach"
            emptyState={<EmptyState onPick={send} />}
          />
          <div ref={endRef} />
        </div>
      </div>

      {/* Quick replies */}
      {!isEmpty && !busy && (
        <div className="flex gap-2 px-4 py-2 overflow-x-auto scrollbar-thin shrink-0">
          {QUICK_REPLIES.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="shrink-0 text-sm text-peach bg-mantle border border-surface0 rounded-full px-3 py-1.5 active:scale-95 transition-transform"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div
        className="flex items-end gap-2 px-3 py-2.5 border-t border-surface0 shrink-0"
        style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask or run something…"
          className="flex-1 resize-none bg-surface0 border border-surface1 rounded-2xl px-4 py-2 text-md text-text placeholder:text-overlay0 outline-none focus:border-peach leading-relaxed"
        />
        {busy ? (
          <button
            onClick={stopChat}
            className="w-9 h-9 rounded-full grid place-items-center shrink-0 bg-red text-background active:scale-95 transition-transform"
            aria-label="Stop"
          >
            <Square size={15} />
          </button>
        ) : (
          <button
            onClick={() => send(input)}
            disabled={!input.trim()}
            className={cn(
              "w-9 h-9 rounded-full grid place-items-center shrink-0 transition-colors",
              input.trim() ? "bg-peach text-background" : "bg-surface0 text-overlay0",
            )}
            aria-label="Send"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-2 text-center">
      <div className="w-14 h-14 rounded-2xl bg-peach/15 grid place-items-center text-peach">
        <ClaudeLogo size={28} />
      </div>
      <div>
        <p className="text-xl font-semibold text-text">Ask Claude anything</p>
        <p className="text-sm text-overlay0 mt-1">It can read logs, run commands, and deploy — on your VMs.</p>
      </div>
      <div className="flex flex-col gap-2 w-full">
        {SUGGESTED_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="w-full text-left text-md text-subtext0 bg-mantle border border-surface0 rounded-xl px-3.5 py-3 active:bg-surface0 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
