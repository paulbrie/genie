"use client";

import { useEffect, useRef, useCallback } from "react";
import { createTerminal, disposeTerminal, writeToTerminal } from "@/lib/terminal-bridge";
import { wsSend } from "@/lib/ws";

let counter = 0;
function generateId(): string {
  return `term-${Date.now()}-${++counter}`;
}

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);

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
    if (!containerRef.current) return;

    const id = generateId();
    sessionIdRef.current = id;

    const term = createTerminal(containerRef.current, id);

    // Spawn PTY on server
    wsSend("terminal:spawn", { id, cols: term.cols, rows: term.rows });

    // Listen for terminal data from WS via window events
    window.addEventListener("genie:terminal:data", handleData);
    window.addEventListener("genie:terminal:exit", handleExit);

    return () => {
      window.removeEventListener("genie:terminal:data", handleData);
      window.removeEventListener("genie:terminal:exit", handleExit);
      disposeTerminal();
      // Keep PTY alive on server for reconnection
    };
  }, [handleData, handleExit]);

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-surface0">
        <h2 className="text-2xl font-semibold text-text">Terminal</h2>
      </div>
      <div
        ref={containerRef}
        className="flex-1 mt-4 rounded-md overflow-hidden bg-crust"
      />
    </div>
  );
}
