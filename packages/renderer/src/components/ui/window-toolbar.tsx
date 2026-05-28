"use client";

import { useSubject } from "subjecto/react";
import { Bot, StickyNote, Loader2, Rocket, Terminal, AppWindow, type LucideIcon } from "lucide-react";
import type { FloatingWindowState } from "@/store/types";
import { $windowManager } from "@/store/subjects";
import { restoreWindow } from "@/store/actions";
export const iconMap: Record<string, LucideIcon> = {
  bot: Bot,
  "sticky-note": StickyNote,
  rocket: Rocket,
  terminal: Terminal,
};

export function WindowToolbar() {
  const [windowManager] = useSubject($windowManager);
  const windows = windowManager.windows as Record<string, FloatingWindowState>;

  const minimized = Object.values(windows).filter((w) => w.status === "minimized");
  if (minimized.length === 0) return null;

  return (
    <div className="shrink-0 bg-mantle border-t border-surface0 px-3 py-1.5 flex items-center gap-2">
      {minimized.map((win) => {
        const Icon = iconMap[win.icon] || AppWindow;
        return (
          <button
            key={win.id}
            onClick={() => restoreWindow(win.id)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface0 hover:bg-surface1 text-md text-subtext0 transition-colors"
          >
            {win.busy && <Loader2 size={13} className="text-blue animate-spin" />}
            {!win.busy && Icon && <Icon size={13} className="text-mauve" />}
            {win.title}
          </button>
        );
      })}
    </div>
  );
}
