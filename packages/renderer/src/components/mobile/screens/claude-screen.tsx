"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { ChevronLeft, Pin, ArrowUp, Square, SquarePen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClaudeLogo } from "@/components/mobile/claude-logo";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { $auth, $claudeStream } from "@/store/subjects";
import {
  closeClaudeStream,
  openClaudeChatWindow,
  sendClaudeStreamMessage,
  stopClaudeStream,
} from "@/store/actions";
import { QUICK_REPLIES, SUGGESTED_PROMPTS, type MockServer, type MockSession } from "@/components/mobile/mock-data";

// Mirrors the desktop's durable Claude Code session exactly: openClaudeChatWindow
// → $claudeStream (a real `claude` process in a tmux session on the VM), rendered
// with the shared ChatMessageList. A Claude-session tap reattaches that exact
// tmux session; the server-level Claude button opens a fresh blank session.
export function ClaudeScreen({
  server,
  session,
  onBack,
}: {
  server: MockServer;
  session?: MockSession;
  onBack: () => void;
}) {
  const [state] = useSubject($claudeStream);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = streamId;

  // Open (or reattach) the durable Claude session for this server/tmux session.
  useEffect(() => {
    const ownerId = $auth.getValue().user?.id;
    if (!ownerId || !server.projectId) return;
    let cancelled = false;
    openClaudeChatWindow({
      ownerId,
      projectId: server.projectId,
      instanceId: server.id,
      label: session ? session.title : server.label,
      tmuxName: session?.kind === "claude" ? session.id : undefined,
    }).then((id) => {
      if (cancelled) closeClaudeStream(id);
      else setStreamId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [server.projectId, server.id, session?.id]);

  // Detach the session when leaving the screen (the tmux session lives on).
  useEffect(() => () => {
    if (currentIdRef.current) closeClaudeStream(currentIdRef.current);
  }, []);

  const sess = streamId ? state.sessions[streamId] : null;

  useLayoutEffect(() => {
    endRef.current?.scrollIntoView({ behavior: sess?.loading ? "auto" : "smooth" });
  }, [sess?.messages, sess?.streamingContent, sess?.streamingSteps, sess?.loading]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  function send(text: string) {
    const t = text.trim();
    if (!t || !streamId || !sess?.ready || sess.loading) return;
    setInput("");
    sendClaudeStreamMessage(streamId, t);
  }

  async function newChat() {
    const ownerId = $auth.getValue().user?.id;
    if (!ownerId || !server.projectId) return;
    if (currentIdRef.current) closeClaudeStream(currentIdRef.current);
    setStreamId(null);
    const id = await openClaudeChatWindow({
      ownerId,
      projectId: server.projectId,
      instanceId: server.id,
      label: server.label,
    });
    setStreamId(id);
  }

  const busy = !!sess?.loading;
  const connecting = !sess || (!sess.ready && sess.messages.length === 0 && !sess.historyLoading);
  const isEmpty = !!sess && sess.ready && sess.messages.length === 0 && !sess.loading && !sess.streamingContent;
  const subtitle = sess?.claudeInfo?.model ?? "Claude Code";

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
          <p className="text-xs text-overlay0 truncate">{subtitle}</p>
        </div>
        <button onClick={newChat} className="p-1.5 rounded-lg text-overlay0 active:bg-surface0" aria-label="New chat">
          <SquarePen size={16} />
        </button>
      </div>

      {/* VM banner */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-peach/20 bg-peach/10 shrink-0">
        <Pin size={11} className="text-peach shrink-0" />
        <span className="text-xs text-peach font-medium truncate">
          Running on <span className="font-mono">{server.label}</span>
        </span>
        <span className="text-2xs text-overlay0 font-mono truncate ml-auto">{server.host}</span>
      </div>

      {/* Connection error */}
      {sess?.connectionError && (
        <div className="px-4 py-1.5 border-b border-red/20 bg-red/10 shrink-0 text-xs text-red truncate">
          {sess.connectionError}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="min-h-full flex flex-col px-4 py-3 gap-2">
          {connecting ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-overlay0">
              <Loader2 size={14} className="animate-spin text-peach" />
              {sess?.reconnecting ? "Reconnecting…" : "Connecting to Claude…"}
            </div>
          ) : (
            <>
              {sess?.historyLoading && (
                <div className="flex items-center justify-center gap-2 text-xs text-overlay0 py-2">
                  <Loader2 size={12} className="animate-spin text-peach" /> Replaying conversation…
                </div>
              )}
              <ChatMessageList
                messages={sess?.messages ?? []}
                streamingContent={sess?.streamingContent ?? ""}
                streamingSteps={sess?.streamingSteps ?? []}
                toolUses={sess?.toolUses ?? []}
                loading={sess?.loading ?? false}
                statusText={sess?.statusText ?? ""}
                accent="peach"
                showCost={false}
                emptyState={isEmpty ? <EmptyState onPick={send} /> : undefined}
              />
            </>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Quick replies */}
      {isEmpty && (
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
          placeholder={sess?.ready ? "Ask or run something…" : "Connecting…"}
          disabled={!sess?.ready}
          className="flex-1 resize-none bg-surface0 border border-surface1 rounded-2xl px-4 py-2 text-md text-text placeholder:text-overlay0 outline-none focus:border-peach leading-relaxed disabled:opacity-60"
        />
        {busy ? (
          <button
            onClick={() => streamId && stopClaudeStream(streamId)}
            className="w-9 h-9 rounded-full grid place-items-center shrink-0 bg-red text-background active:scale-95 transition-transform"
            aria-label="Stop"
          >
            <Square size={15} />
          </button>
        ) : (
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || !sess?.ready}
            className={cn(
              "w-9 h-9 rounded-full grid place-items-center shrink-0 transition-colors",
              input.trim() && sess?.ready ? "bg-peach text-background" : "bg-surface0 text-overlay0",
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
        <p className="text-sm text-overlay0 mt-1">It can read logs, run commands, and deploy — on this VM.</p>
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
