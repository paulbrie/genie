"use client";

import { Search, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { ToolUse } from "@/store";

export function getToolStatusText(tool: ToolUse): string {
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
  return JSON.stringify(tool.input, null, 2);
}

export function ToolPill({ tool, active }: { tool: ToolUse; active?: boolean }) {
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
      <TooltipContent side="top" className="max-w-[380px]">
        <pre className="text-[11px] font-medium mb-1 whitespace-pre-wrap break-words font-mono">{detail}</pre>
        {preview && (
          <p className="text-[10px] text-subtext1 whitespace-pre-wrap break-words border-t border-surface1 pt-1 mt-1">
            {preview}{tool.result && tool.result.length > 200 ? "..." : ""}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
