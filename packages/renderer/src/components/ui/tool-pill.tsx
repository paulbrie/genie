"use client";

import { useEffect, useState } from "react";
import { Search, Globe, ChefHat, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { ToolUse } from "@/store/types";
/** Human-readable elapsed time. <60s → "Xs" (or "X.Ys" when <10s for precision);
 *  ≥60s → "MmSs". Keeps the badge short. */
function formatElapsed(ms: number): string {
  if (ms < 0) return "0s";
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m${rem.toString().padStart(2, "0")}s`;
}

/** Live ticker for in-flight tools: re-renders every 500 ms while `startedAt`
 *  is set and `completedAt` isn't. Once complete, formats the final duration
 *  from `durationMs` (server-authoritative) or falls back to client deltas. */
function useElapsed(tool: ToolUse): string {
  const [tick, setTick] = useState(0);
  const running = tool.startedAt && !tool.completedAt;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
    // tick is read on each render; we only need to (re)start when running flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  void tick;
  if (tool.durationMs != null) return formatElapsed(tool.durationMs);
  if (tool.startedAt && tool.completedAt) return formatElapsed(tool.completedAt - tool.startedAt);
  if (tool.startedAt) return formatElapsed(Date.now() - tool.startedAt);
  return "";
}

const RECIPE_TOOLS = new Set(["list_recipes", "get_recipe", "create_recipe", "update_recipe", "delete_recipe"]);

export function getToolStatusText(tool: ToolUse): string {
  if (tool.name === "web_search") return "Searching...";
  if (tool.name === "browse_url") return "Browsing...";
  if (RECIPE_TOOLS.has(tool.name)) return "Working on recipe...";
  return "Using tool...";
}

function getToolLabel(name: string): string {
  if (name === "web_search") return "Web Search";
  if (name === "browse_url") return "Browse";
  if (name === "list_recipes") return "List Recipes";
  if (name === "get_recipe") return "Read Recipe";
  if (name === "create_recipe") return "Create Recipe";
  if (name === "update_recipe") return "Update Recipe";
  if (name === "delete_recipe") return "Delete Recipe";
  return name;
}

function getToolDetail(tool: ToolUse): string {
  if (tool.name === "web_search") return tool.input.query || "";
  if (tool.name === "browse_url") return tool.input.url || "";
  if (tool.name === "get_recipe" || tool.name === "create_recipe") return String(tool.input.slug ?? "");
  if (tool.name === "update_recipe" || tool.name === "delete_recipe") return String(tool.input.id ?? "");
  return JSON.stringify(tool.input, null, 2);
}

export function ToolPill({ tool, active }: { tool: ToolUse; active?: boolean }) {
  const Icon = tool.name === "web_search" ? Search
    : RECIPE_TOOLS.has(tool.name) ? ChefHat
    : Globe;
  const detail = getToolDetail(tool);
  const preview = tool.result ? tool.result.slice(0, 200) : "";
  const isRunning = tool.startedAt != null && tool.completedAt == null;
  const elapsed = useElapsed(tool);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 bg-surface0 rounded-full px-2 py-0.5 text-[10px] text-subtext0 cursor-default",
            (active || isRunning) && "animate-pulse"
          )}
        >
          {isRunning ? (
            <Loader2 size={10} className="shrink-0 animate-spin" />
          ) : (
            <Icon size={10} className="shrink-0" />
          )}
          {getToolLabel(tool.name)}
          {elapsed && (
            <span
              className={cn(
                "tabular-nums font-mono",
                isRunning ? "text-blue" : "text-overlay0",
              )}
            >
              {elapsed}
            </span>
          )}
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
