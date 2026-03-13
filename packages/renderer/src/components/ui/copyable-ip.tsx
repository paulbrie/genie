"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function CopyableIp({ ip, className }: { ip: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(ip);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title="Click to copy IP"
      className={cn("relative font-mono cursor-copy hover:text-text transition-colors", className ?? "text-md text-overlay0")}
    >
      <span className={copied ? "invisible" : ""}>{ip}</span>
      {copied && <span className="absolute inset-0 text-green">Copied!</span>}
    </span>
  );
}
