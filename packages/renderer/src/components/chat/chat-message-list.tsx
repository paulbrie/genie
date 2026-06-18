"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Play } from "lucide-react";
import type { ChatMessage, StreamingStep, ToolUse } from "@/store/types";
import { $terminal } from "@/store/subjects";
import { wsSend } from "@/lib/ws";
import { cn } from "@/lib/utils";
import { markdownComponents } from "@/components/ui/markdown-link";
import { ToolPill, getToolStatusText } from "@/components/ui/tool-pill";
import { UsageLine, formatDuration } from "@/components/ui/usage-line";
import { ChatErrorBubble } from "@/components/chat/chat-error-bubble";

// --- Runnable code blocks ---

/** When a fenced code block in an assistant message is shell-flavored (or
 *  unlabeled), show a hovering "Run" button that pipes it into whichever
 *  terminal tab is currently active. */
function RunnableCode({ className, children }: { className?: string; children: React.ReactNode }) {
  const [terminal] = useSubject($terminal);
  const lang = (className || "").match(/language-(\S+)/)?.[1]?.toLowerCase() ?? "";
  const text = String(children).replace(/\n$/, "");
  // react-markdown v10 dropped the `inline` prop — distinguish a real fenced
  // block (has a language class or spans multiple lines) from an inline span.
  // Without this, every inline `code` rendered as a block and broke the text
  // flow (each span dropped onto its own line).
  const isBlock = !!lang || text.includes("\n");
  if (!isBlock) {
    return <code className={className}>{children}</code>;
  }
  const isShell = lang === "" || lang === "bash" || lang === "sh" || lang === "shell" || lang === "zsh";
  const activeTab = terminal.tabs.find((t) => t.id === terminal.activeTabId);
  const canRun = isShell && !!activeTab;

  function run() {
    if (!activeTab) return;
    wsSend("terminal:data", { id: activeTab.id, data: text + "\n" });
  }

  return (
    <span className="relative group block">
      <code className={className}>{children}</code>
      {canRun && (
        <button
          onClick={run}
          className="absolute top-1 right-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue/20 text-blue text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue/30"
          title={`Run in ${activeTab!.title}`}
        >
          <Play size={10} /> Run
        </button>
      )}
    </span>
  );
}

export const assistantMarkdownComponents = {
  ...markdownComponents,
  code: RunnableCode as unknown as React.ComponentType<React.HTMLAttributes<HTMLElement> & { inline?: boolean }>,
  // Tighter, calmer lists than the browser default — subtle markers, compact
  // spacing, and no oversized gaps between items.
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="my-1.5 ml-4 list-disc space-y-1 marker:text-overlay0" {...props} />
  ),
  ol: (props: React.OlHTMLAttributes<HTMLOListElement>) => (
    <ol className="my-1.5 ml-4 list-decimal space-y-1 marker:text-overlay0" {...props} />
  ),
  li: (props: React.LiHTMLAttributes<HTMLLIElement>) => <li className="pl-1 leading-snug" {...props} />,
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => <p className="my-1.5 first:mt-0 last:mb-0 leading-snug" {...props} />,
};

/** Render a turn's steps: markdown content as blocks, and runs of consecutive
 *  tool calls grouped into a single inline (flex-wrap) row of pills — so
 *  back-to-back tool uses sit side by side instead of stacking one per line. */
/** Hide wire-only markup we splice into the message text for Claude — the
 *  `[Image: /tmp/…]` paths (the pasted thumbnails already render above the
 *  bubble) and a leading `[Plan mode] …` directive (when plan mode is on) — so
 *  the user's bubble shows only what they typed, even after a transcript replay. */
function stripImageRefs(content: string): string {
  return content
    .replace(/^\[Plan mode\][^\n]*\n+/, "")
    .replace(/\n*\[Image:[^\]]*\]/g, "")
    .trim();
}

function StepBlocks({ steps }: { steps: StreamingStep[] }) {
  const out: React.ReactNode[] = [];
  let pills: React.ReactNode[] = [];
  const flush = (key: string) => {
    if (pills.length === 0) return;
    out.push(<div key={`pills-${key}`} className="flex flex-wrap gap-1.5 my-1">{pills}</div>);
    pills = [];
  };
  steps.forEach((step, j) => {
    if (step.content) {
      flush(`c${j}`);
      out.push(
        <div key={`c${j}`} className="chat-markdown select-text cursor-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
            {step.content}
          </ReactMarkdown>
        </div>,
      );
    }
    if (step.toolUse) pills.push(<ToolPill key={`t${j}`} tool={step.toolUse} />);
  });
  flush("end");
  return <>{out}</>;
}

export interface ChatMessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
  streamingSteps: StreamingStep[];
  toolUses: ToolUse[];
  loading: boolean;
  statusText: string;
  maxToolRounds?: number;
  toolRoundsUsed?: number;
  onRetry?: () => void;
  /** Rendered when there are no messages and nothing is streaming. */
  emptyState?: React.ReactNode;
}

/** Shared conversation renderer for the Genie Assistant and the durable
 *  chat-mode Claude session. Renders the message log, the live streaming bubble,
 *  and the "thinking" spinner. The parent owns the scroll container + auto-scroll
 *  anchor so each surface controls its own layout. */
export function ChatMessageList({
  messages,
  streamingContent,
  streamingSteps,
  toolUses,
  loading,
  statusText,
  maxToolRounds = 0,
  toolRoundsUsed = 0,
  onRetry,
  emptyState,
}: ChatMessageListProps) {
  // Continuous elapsed timer for the in-flight turn — starts when `loading`
  // flips true and ticks until it clears, so the count survives the
  // thinking → streaming → tool-use transitions without resetting.
  const startedRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!loading) { startedRef.current = null; setElapsedMs(0); return; }
    if (startedRef.current == null) startedRef.current = Date.now();
    const tick = () => setElapsedMs(Date.now() - (startedRef.current ?? Date.now()));
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [loading]);

  return (
    <>
      {messages.length === 0 && !streamingContent && !loading && emptyState && (
        <div className="flex-1 flex items-center justify-center py-8">{emptyState}</div>
      )}

      {messages.map((msg: ChatMessage, i: number) => (
        <div key={`${msg.role}-${i}-${msg.content.slice(0, 24)}`} className={cn("flex flex-col", msg.role === "user" ? "items-end" : "items-start")}>
          {msg.role === "user" ? (
            <div className="max-w-[90%] flex flex-col items-end gap-1">
              {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-1 justify-end">
                  {msg.images.map((url, k) => (
                    <img key={k} src={url} alt={`sent ${k + 1}`} className="max-h-48 max-w-full rounded border border-surface1" />
                  ))}
                </div>
              )}
              {stripImageRefs(msg.content) && (
                <div className="px-2.5 py-1.5 rounded-lg text-md break-words chat-message-content bg-surface0 text-text rounded-br-sm whitespace-pre-wrap">
                  {stripImageRefs(msg.content)}
                </div>
              )}
            </div>
          ) : msg.isError || msg.content.startsWith("Error:") ? (
            <ChatErrorBubble content={msg.content} onRetry={onRetry} />
          ) : msg.steps ? (
            <div className={cn("max-w-[90%] px-2.5 py-1.5 rounded-lg text-md break-words select-text cursor-text text-text rounded-bl-sm")}>
              <StepBlocks steps={msg.steps} />
            </div>
          ) : (
            <>
              {msg.toolUses && msg.toolUses.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-0.5">
                  {msg.toolUses.map((tool, j) => (
                    <ToolPill key={j} tool={tool} />
                  ))}
                </div>
              )}
              <div className="max-w-[90%] px-2.5 py-1.5 rounded-lg text-md break-words select-text cursor-text text-text rounded-bl-sm">
                <div className="chat-markdown select-text cursor-text">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            </>
          )}
          {msg.role === "assistant" && (msg.usage || msg.thinkingMs) && (
            <UsageLine usage={msg.usage} thinkingMs={msg.thinkingMs} />
          )}
        </div>
      ))}

      {/* Streaming: step-by-step rendering */}
      {loading && (streamingSteps.length > 0 || streamingContent) && (
        <div className="flex flex-col items-start">
          <div className="max-w-[90%] px-2.5 py-1.5 rounded-lg text-md text-text rounded-bl-sm select-text cursor-text">
            <StepBlocks steps={streamingSteps} />
            {streamingContent && (
              <div className="chat-markdown select-text cursor-text">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
                  {streamingContent}
                </ReactMarkdown>
              </div>
            )}
            <span className="inline-block w-1.5 h-3 bg-text/50 ml-0.5 animate-pulse align-text-bottom" />
            {elapsedMs > 0 && (
              <span className="ml-2 text-[10px] text-overlay0/60 tabular-nums align-text-bottom">{formatDuration(elapsedMs)}</span>
            )}
          </div>
        </div>
      )}

      {loading && !streamingContent && streamingSteps.length === 0 && (
        <div className="flex justify-start">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-md text-overlay0">
            <div className="w-3.5 h-3.5 border-2 border-mauve/40 border-t-mauve rounded-full animate-spin" />
            <span>
              {statusText || (toolUses.length > 0 ? getToolStatusText(toolUses[toolUses.length - 1]) : "Thinking...")}
            </span>
            {elapsedMs > 0 && (
              <span className="text-[11px] text-overlay0/70 tabular-nums">{formatDuration(elapsedMs)}</span>
            )}
            {maxToolRounds > 0 && toolRoundsUsed > 0 && (
              <span className="text-[11px] text-overlay0 ml-1">
                {toolRoundsUsed}/{maxToolRounds} tools
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
