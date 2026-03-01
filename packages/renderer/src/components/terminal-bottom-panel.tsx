"use client";

import { useEffect, useRef, useCallback } from "react";
import { useDeepSubject } from "subjecto/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { store, toggleTerminalBottomPanel, type NavKey } from "@/store";
import { createTerminal, disposeTerminal, writeToTerminal, getActiveTerminal } from "@/lib/terminal-bridge";
import { wsSend } from "@/lib/ws";

let counter = 0;
function generateId(): string {
  return `bterm-${Date.now()}-${++counter}`;
}

export function TerminalBottomPanel() {
  const bottomPanelOpen = useDeepSubject(store, "terminal/bottomPanelOpen") as boolean;
  const activeNav = useDeepSubject(store, "activeNav") as NavKey;
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  // Auto-hide when full terminal tab is active
  const hidden = activeNav === "terminal";

  const handleData = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail.id === sessionIdRef.current) {
      writeToTerminal(detail.data);
    }
  }, []);

  const handleExit = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail.id === sessionIdRef.current) {
      writeToTerminal(`\r\n[Process exited with code ${detail.code}]\r\n`);
    }
  }, []);

  useEffect(() => {
    if (!bottomPanelOpen || hidden || !containerRef.current || initializedRef.current) return;

    // Only if no active terminal instance (avoids conflict with full-size terminal)
    if (getActiveTerminal()) return;

    const id = generateId();
    sessionIdRef.current = id;
    initializedRef.current = true;

    const term = createTerminal(containerRef.current, id);
    wsSend("terminal:spawn", { id, cols: term.cols, rows: term.rows });

    window.addEventListener("genie:terminal:data", handleData);
    window.addEventListener("genie:terminal:exit", handleExit);

    return () => {
      window.removeEventListener("genie:terminal:data", handleData);
      window.removeEventListener("genie:terminal:exit", handleExit);
      disposeTerminal();
      initializedRef.current = false;
    };
  }, [bottomPanelOpen, hidden, handleData, handleExit]);

  if (hidden) return null;

  return (
    <div className="shrink-0 border-t border-surface0 flex flex-col">
      {/* Toggle header */}
      <button
        onClick={toggleTerminalBottomPanel}
        className="flex items-center gap-2 px-4 py-1.5 bg-transparent border-none cursor-pointer text-left w-full hover:bg-mantle transition-colors duration-150"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-subtext0 flex-1">
          Terminal
        </span>
        {bottomPanelOpen ? (
          <ChevronDown size={14} className="text-overlay0" />
        ) : (
          <ChevronUp size={14} className="text-overlay0" />
        )}
      </button>

      {/* Terminal area — collapsible */}
      {bottomPanelOpen && (
        <div
          ref={containerRef}
          className="overflow-hidden bg-crust"
          style={{ height: 200 }}
        />
      )}
    </div>
  );
}
