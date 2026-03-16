"use client";

import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorMessageProps {
  children: React.ReactNode;
  className?: string;
  /** Display variant: "inline" for text-only, "banner" for full-width bar */
  variant?: "inline" | "banner";
}

export function ErrorMessage({ children, className, variant = "inline" }: ErrorMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = typeof children === "string" ? children : (children as any)?.toString?.() || "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [children]);

  return (
    <div
      className={cn(
        "flex items-start gap-2 group",
        variant === "banner"
          ? "px-3 py-2 text-red bg-red/10 border-b border-red/20 text-md"
          : "text-red text-md",
        className,
      )}
    >
      <span className="flex-1 min-w-0 select-text break-words whitespace-pre-wrap">{children}</span>
      <button
        onClick={handleCopy}
        className="shrink-0 p-0.5 text-red/50 hover:text-red transition-colors opacity-0 group-hover:opacity-100 mt-0.5"
        title="Copy error"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}
