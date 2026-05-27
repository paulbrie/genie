"use client";

import { useEffect, useRef, useCallback } from "react";
import { useSubject } from "subjecto/react";
import { Plus, X } from "lucide-react";
import type { TerminalTab } from "@/store/types";
import { $terminal } from "@/store/subjects";
import { addTerminalTab, removeTerminalTab, switchTerminalTab } from "@/store/actions";
import {
  createTerminal,
  disposeTerminal,
  disposeAllTerminals,
  writeToTerminal,
  focusTerminal,
  refitTerminal,
} from "@/lib/terminal-bridge";
import { wsSend } from "@/lib/ws";
import { cn } from "@/lib/utils";
import { ViewHeader } from "@/components/view-header";

export function TerminalPanel() {
  const [terminal] = useSubject($terminal);
  const { tabs, activeTabId } = terminal;

  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const mountedIds = useRef<Set<string>>(new Set());

  // --- Route incoming data to the right terminal instance ---
  const handleData = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    writeToTerminal(detail.id, detail.data);
  }, []);

  const handleExit = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    writeToTerminal(detail.id, `\r\n[Process exited with code ${detail.code}]\r\n`);
  }, []);

  // Register window event listeners
  useEffect(() => {
    window.addEventListener("genie:terminal:data", handleData);
    window.addEventListener("genie:terminal:exit", handleExit);
    return () => {
      window.removeEventListener("genie:terminal:data", handleData);
      window.removeEventListener("genie:terminal:exit", handleExit);
      disposeAllTerminals();
    };
  }, [handleData, handleExit]);

  // Auto-create first tab on mount if empty (only once)
  const didAutoCreate = useRef(false);
  useEffect(() => {
    if (tabs.length === 0 && !didAutoCreate.current) {
      didAutoCreate.current = true;
      addTerminalTab();
    }
  }, [tabs.length]);

  // Initialize terminal for new tabs
  useEffect(() => {
    for (const tab of tabs) {
      if (mountedIds.current.has(tab.id)) continue;
      const container = containerRefs.current.get(tab.id);
      if (!container) continue;

      mountedIds.current.add(tab.id);
      const term = createTerminal(container, tab.id);
      if (tab.reattach) {
        // Persisted server-side session: ask the manager to reattach by id.
        wsSend("terminal:reattach", { id: tab.id, cols: term.cols, rows: term.rows });
      } else if (tab.ssh) {
        wsSend("terminal:ssh:spawn", {
          id: tab.id,
          cols: term.cols,
          rows: term.rows,
          host: tab.ssh.host,
          port: tab.ssh.port,
          username: tab.ssh.username,
          privateKeyPath: tab.ssh.privateKeyPath,
          title: tab.title,
          command: tab.command,
        });
        if (tab.command) {
          const cmdToSend = tab.command;
          const tabId = tab.id;
          // Wait for SSH connection to establish, then send command
          const onData = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.id === tabId) {
              window.removeEventListener("genie:terminal:data", onData);
              setTimeout(() => wsSend("terminal:data", { id: tabId, data: cmdToSend + "\n" }), 300);
            }
          };
          window.addEventListener("genie:terminal:data", onData);
        }
      } else {
        wsSend("terminal:spawn", {
          id: tab.id,
          cols: term.cols,
          rows: term.rows,
          command: tab.command,
          cwd: tab.cwd,
        });
      }
    }
  }, [tabs]);

  // Refit + focus when switching active tab
  useEffect(() => {
    if (!activeTabId) return;
    requestAnimationFrame(() => {
      refitTerminal(activeTabId);
      focusTerminal(activeTabId);
    });
  }, [activeTabId]);

  const handleAddTab = () => {
    addTerminalTab();
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    mountedIds.current.delete(id);
    containerRefs.current.delete(id);
    disposeTerminal(id);
    wsSend("terminal:close", { id });
    removeTerminalTab(id);
  };

  const setContainerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      containerRefs.current.set(id, el);
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      <ViewHeader title="Terminal" />

      <div className="flex items-center gap-0 border-b border-surface0 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => switchTerminalTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-md font-medium border-b-2 transition-colors cursor-pointer",
              "bg-transparent shrink-0",
              tab.id === activeTabId
                ? "border-blue text-text"
                : "border-transparent text-overlay0 hover:text-subtext0"
            )}
          >
            <span>{tab.title}</span>
            <span
              onClick={(e) => handleCloseTab(tab.id, e)}
              className="hover:bg-surface1 rounded p-0.5 transition-colors"
            >
              <X size={10} />
            </span>
          </button>
        ))}
        <button
          onClick={handleAddTab}
          className="flex items-center justify-center w-6 h-6 ml-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text shrink-0"
          title="New terminal"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Terminal containers — one per tab, only active is visible */}
      <div className="flex-1 relative rounded-md overflow-hidden bg-crust">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={(el) => setContainerRef(tab.id, el)}
            className="absolute inset-0"
            style={{ display: tab.id === activeTabId ? "block" : "none" }}
          />
        ))}
      </div>
    </div>
  );
}
