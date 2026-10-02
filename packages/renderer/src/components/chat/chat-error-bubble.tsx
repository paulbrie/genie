"use client";

import { useCallback } from "react";
import { Copy, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ERROR_HINTS: { match: RegExp; title: string; hint: string }[] = [
  {
    match: /project|vps|claude code/i,
    title: "Project or VPS required",
    hint: "Select a project with a deployed VPS, or switch to a cloud model in the model picker.",
  },
  {
    match: /api key|unauthorized|401/i,
    title: "API configuration issue",
    hint: "Check your API keys in Settings or ask an admin to configure model access.",
  },
  {
    match: /connect|timeout|ssh|network|disconnected/i,
    title: "Connection problem",
    hint: "Verify the manager is running and the VPS is reachable, then try again.",
  },
];

function parseErrorContent(raw: string): { title: string; detail: string; hint: string | null } {
  const detail = raw.startsWith("Error:") ? raw.slice(6).trim() : raw;
  for (const entry of ERROR_HINTS) {
    if (entry.match.test(detail)) {
      return { title: entry.title, detail, hint: entry.hint };
    }
  }
  return { title: "Something went wrong", detail, hint: null };
}

interface ChatErrorBubbleProps {
  content: string;
  onRetry?: () => void;
  /** Dismiss this error card. Errors are client-only, so dismissing drops it for
   *  good — it won't return on reattach/reload. Omit to hide the close button. */
  onDismiss?: () => void;
  className?: string;
}

export function ChatErrorBubble({ content, onRetry, onDismiss, className }: ChatErrorBubbleProps) {
  const { title, detail, hint } = parseErrorContent(content);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(detail);
  }, [detail]);

  return (
    <div
      className={cn(
        "relative max-w-[90%] px-2.5 py-2 rounded-lg text-md rounded-bl-sm bg-red/10 text-red border border-red/20",
        className,
      )}
      role="alert"
    >
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded bg-transparent hover:bg-red/15 text-red/60 hover:text-red border-none cursor-pointer transition-colors"
          aria-label="Dismiss error"
        >
          <X size={13} />
        </button>
      )}
      <p className="font-medium pr-5">{title}</p>
      <p className="mt-0.5 break-words text-red/90">{detail}</p>
      {hint && <p className="mt-1.5 text-[11px] text-red/70">{hint}</p>}
      <div className="flex items-center gap-2 mt-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red/20 hover:bg-red/30 text-red text-[11px] font-medium border-none cursor-pointer transition-colors"
            aria-label="Retry last message"
          >
            <RefreshCw size={11} />
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-transparent hover:bg-red/10 text-red/70 text-[11px] border-none cursor-pointer transition-colors"
          aria-label="Copy error message"
        >
          <Copy size={11} />
          Copy
        </button>
      </div>
    </div>
  );
}
