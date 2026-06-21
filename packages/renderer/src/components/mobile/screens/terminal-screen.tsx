"use client";

import { useState } from "react";
import { TerminalSquare, Plus, ChevronDown, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_TERM_LINES, MOCK_TERM_TABS, type TermLine } from "@/components/mobile/mock-data";

const TONE: Record<NonNullable<TermLine["tone"]>, string> = {
  dim: "text-subtext0",
  green: "text-green",
  blue: "text-blue",
  yellow: "text-yellow",
  red: "text-red",
  mauve: "text-mauve",
};

// Mobile-friendly key strip — the keys you actually reach for over SSH but that
// a phone keyboard hides or makes painful. Static in the prototype.
const KEY_STRIP = ["esc", "tab", "ctrl", "/", "-", "|", "~", "↑", "↓"];

export function TerminalScreen({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState(MOCK_TERM_TABS[0].id);

  return (
    <div className="flex flex-col h-full bg-mantle">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface0 shrink-0">
        <button onClick={onBack} className="p-1 -ml-1 rounded-lg text-overlay0 active:bg-surface0" aria-label="Back">
          <ChevronLeft size={22} />
        </button>
        <TerminalSquare size={16} className="text-green shrink-0" />
        <span className="text-md font-semibold text-subtext0 truncate">Terminal</span>
        <button className="ml-auto p-1.5 rounded-lg text-overlay0 active:bg-surface0" aria-label="New session">
          <Plus size={16} />
        </button>
      </div>

      {/* Session tabs */}
      <div className="flex gap-2 px-4 py-2 overflow-x-auto scrollbar-thin border-b border-surface0/60 shrink-0">
        {MOCK_TERM_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              "shrink-0 flex items-center gap-1.5 text-sm rounded-lg px-3 py-1.5 border transition-colors",
              activeTab === t.id
                ? "bg-surface0 text-text border-surface1"
                : "bg-transparent text-overlay0 border-surface0",
            )}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                t.running ? "bg-green tmux-running-glow-green" : "bg-overlay0",
              )}
            />
            {t.title}
          </button>
        ))}
      </div>

      {/* Terminal body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 font-mono text-sm leading-relaxed bg-crust">
        {MOCK_TERM_LINES.map((l, i) => (
          <div key={i} className={cn("whitespace-pre-wrap break-words", TONE[l.tone ?? "dim"])}>
            {l.text}
          </div>
        ))}
        <div className="flex items-center gap-0 text-green">
          <span>genie@api-prod-01:~$&nbsp;</span>
          <span className="inline-block w-2 h-4 bg-green/80 animate-pulse" />
        </div>
      </div>

      {/* Mobile key strip */}
      <div className="flex gap-1.5 px-3 py-2 overflow-x-auto scrollbar-thin border-t border-surface0 bg-mantle shrink-0">
        {KEY_STRIP.map((k) => (
          <button
            key={k}
            className="shrink-0 min-w-9 px-2.5 py-1.5 rounded-md bg-surface0 text-subtext0 text-sm font-mono active:bg-surface1"
          >
            {k}
          </button>
        ))}
      </div>

      {/* Input line */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-surface0 bg-mantle shrink-0">
        <ChevronDown size={14} className="text-green rotate-[-90deg] shrink-0" />
        <input
          placeholder="type a command…"
          className="flex-1 bg-transparent text-md text-text placeholder:text-overlay0 outline-none font-mono"
        />
      </div>
    </div>
  );
}
