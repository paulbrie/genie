"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { TerminalSquare, X, Minus, Maximize2, Minimize2, Share2 } from "lucide-react";
import type { ChatUser, FloatingWindowState, TerminalTab } from "@/store/types";
import { $auth, $conversationChat, $terminal, $windowManager } from "@/store/subjects";
import { closeWindow, focusWindow, leaveSharedTerminal, minimizeWindow, openWindow, registerWindow, removeTerminalTab, shareTerminal, updateWindowPosition } from "@/store/actions";
import {
  createTerminal,
  disposeTerminal,
  hasTerminal,
  reattachTerminal,
  writeToTerminal,
  focusTerminal as focusXterm,
  refitTerminal,
} from "@/lib/terminal-bridge";
import { wsSend } from "@/lib/ws";
import { useDraggable, useResizable } from "@/components/use-draggable";
import { useIsWindowFocused } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export const WINDOW_PREFIX = "terminal-";
const DEFAULT_W = 600;
const DEFAULT_H = 400;
const CASCADE_OFFSET = 30;

function SingleTerminalWindow({
  tab,
  windowState,
}: {
  tab: TerminalTab;
  windowState: FloatingWindowState;
}) {
  const windowId = WINDOW_PREFIX + tab.id;
  const [maximized, setMaximized] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  const [conversationChat] = useSubject($conversationChat);
  const chatUsers = conversationChat.users as ChatUser[];
  const [auth] = useSubject($auth);
  const authUserId = (auth.user as { id: string } | null)?.id;
  const onlineUsers = useMemo(
    () => chatUsers.filter((u) => u.online && u.id !== authUserId && !u.isAgent),
    [chatUsers, authUserId]
  );

  // Close share dropdown on outside click / Escape
  useEffect(() => {
    if (!shareOpen) return;
    const close = (e: MouseEvent) => { if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShareOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", onKey); };
  }, [shareOpen]);

  const [windowManager] = useSubject($windowManager);
  const allWindows = windowManager.windows;
  const storedPos = windowState.position;

  const initial = useMemo(() => {
    if (storedPos.x >= 0 && storedPos.y >= 0) return storedPos;
    const takenPositions = Object.values(allWindows)
      .filter((w) => w.id !== windowId && w.status === "open" && w.position.x >= 0)
      .map((w) => w.position);
    let pos = {
      x: Math.max(window.innerWidth / 2 - DEFAULT_W / 2, 20),
      y: Math.max(window.innerHeight / 2 - DEFAULT_H / 2, 20),
    };
    while (
      takenPositions.some(
        (p) => Math.abs(p.x - pos.x) < 20 && Math.abs(p.y - pos.y) < 20
      )
    ) {
      pos = { x: pos.x + CASCADE_OFFSET, y: pos.y + CASCADE_OFFSET };
    }
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the cascaded initial position so subsequently-opened windows can see it and cascade past it
  useEffect(() => {
    if (storedPos.x < 0 || storedPos.y < 0) updateWindowPosition(windowId, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragEnd = useCallback(
    (pos: { x: number; y: number }) => updateWindowPosition(windowId, pos),
    [windowId]
  );

  const { elRef, onPointerDown } = useDraggable(initial, handleDragEnd);
  const { onResizePointerDown } = useResizable(elRef, {
    w: DEFAULT_W,
    h: DEFAULT_H,
  });

  // Mount xterm when container is ready
  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    mountedRef.current = true;

    if (hasTerminal(tab.id)) {
      reattachTerminal(tab.id, containerRef.current);
    } else {
      const term = createTerminal(containerRef.current, tab.id);
      const isRestored = !!(tab.viewerIds && tab.viewerIds.length > 0);
      if (!tab.shared && !isRestored) {
        if (tab.reattach) {
          // Persisted server-side session: ask the manager to reattach by id.
          // The manager looks up the row and spawns SSH+tmux against the right host.
          window.dispatchEvent(new CustomEvent("genie:terminal:data", {
            detail: { id: tab.id, data: `\x1b[2mReattaching to ${tab.id}...\x1b[0m\r\n` },
          }));
          wsSend("terminal:reattach", { id: tab.id, cols: term.cols, rows: term.rows });
        } else if (tab.ssh) {
          // Show feedback so the pane isn't blank during connect (especially over
          // slow links or when IPv6 is hanging at TCP timeout).
          window.dispatchEvent(new CustomEvent("genie:terminal:data", {
            detail: { id: tab.id, data: `\x1b[2mConnecting to ${tab.ssh.username || "genie"}@${tab.ssh.host}:${tab.ssh.port || 22}...\x1b[0m\r\n` },
          }));
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
            ...(tab.ssh.bastion ? { bastion: tab.ssh.bastion } : {}),
          });
          if (tab.command) {
            const cmdToSend = tab.command;
            const tabId = tab.id;
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
    }
  }, [tab]);

  // Refit when window becomes visible (restored from minimize)
  useEffect(() => {
    if (windowState.status === "open") {
      requestAnimationFrame(() => {
        refitTerminal(tab.id);
        focusXterm(tab.id);
      });
    }
  }, [windowState.status, tab.id]);

  function handleClose() {
    mountedRef.current = false;
    disposeTerminal(tab.id);
    if (tab.shared) {
      leaveSharedTerminal(tab.id);
    } else {
      wsSend("terminal:close", { id: tab.id });
      removeTerminalTab(tab.id);
    }
    closeWindow(windowId);
  }

  const containerStyle: React.CSSProperties = maximized
    ? {
        left: 0,
        top: 0,
        width: "100vw",
        height: "100vh",
        zIndex: windowState.zIndex,
      }
    : {
        left: initial.x,
        top: initial.y,
        width: DEFAULT_W,
        height: DEFAULT_H,
        zIndex: windowState.zIndex,
      };

  const isFocused = useIsWindowFocused(windowState);

  return createPortal(
    <div
      ref={elRef}
      className={cn(
        "fixed bg-mantle border flex flex-col transition-[border-color,box-shadow] duration-150 overflow-hidden",
        maximized ? "rounded-none" : "rounded-xl",
        isFocused
          ? "border-blue/60 shadow-2xl shadow-blue/20"
          : "border-surface0 shadow-2xl shadow-black/50",
      )}
      style={containerStyle}
      onPointerDown={() => focusWindow(windowId)}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-surface0 cursor-grab active:cursor-grabbing select-none shrink-0"
        onPointerDown={maximized ? undefined : onPointerDown}
      >
        <div className="flex items-center gap-2 text-md font-semibold text-subtext0 min-w-0 truncate">
          <TerminalSquare size={14} className="text-green shrink-0" />
          <span className="truncate">{tab.title}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!tab.shared && (
            <div className="relative" ref={shareRef}>
              <button
                onClick={() => setShareOpen(!shareOpen)}
                className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
                title="Share terminal"
              >
                <Share2 size={13} />
              </button>
              {shareOpen && (
                <div className="absolute top-full right-0 mt-1 bg-mantle border border-surface0 rounded-md shadow-lg z-50 min-w-[160px] py-1">
                  <p className="px-3 py-1 text-md text-overlay0 font-medium">Share with:</p>
                  {onlineUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => {
                        shareTerminal(tab.id, u.id);
                        setShareOpen(false);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-md bg-transparent border-none cursor-pointer text-subtext0 hover:bg-surface0 hover:text-text transition-colors"
                    >
                      <div className="w-4 h-4 rounded-full bg-surface1 flex items-center justify-center shrink-0 overflow-hidden">
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="text-[8px] font-medium text-subtext0">{u.name[0]?.toUpperCase()}</span>
                        )}
                      </div>
                      <span>{u.name}</span>
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green" />
                    </button>
                  ))}
                  {onlineUsers.length === 0 && (
                    <p className="px-3 py-1.5 text-md text-overlay0">No users online</p>
                  )}
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => minimizeWindow(windowId)}
            className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
            title="Minimize"
          >
            <Minus size={13} />
          </button>
          <button
            onClick={() => setMaximized((v) => !v)}
            className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
            title={maximized ? "Restore" : "Maximize"}
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            onClick={handleClose}
            className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Terminal container */}
      <div ref={containerRef} className="flex-1 min-h-0" />

      {/* Resize handle */}
      {!maximized && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          onPointerDown={onResizePointerDown}
        />
      )}
    </div>,
    document.body
  );
}

export function TerminalWindows() {
  const [terminal] = useSubject($terminal);
  const [windowManager] = useSubject($windowManager);
  const windows = windowManager.windows;

  // Register + open windows for new tabs
  useEffect(() => {
    for (const tab of terminal.tabs) {
      const windowId = WINDOW_PREFIX + tab.id;
      if (!windows[windowId]) {
        registerWindow(windowId, tab.title, "terminal");
        openWindow(windowId);
      }
    }
    // Clean up windows for removed tabs (skip already-closed to avoid infinite loop)
    const tabIds = new Set(terminal.tabs.map((t) => t.id));
    for (const wid of Object.keys(windows)) {
      if (wid.startsWith(WINDOW_PREFIX) && windows[wid].status !== "closed") {
        const tabId = wid.slice(WINDOW_PREFIX.length);
        if (!tabIds.has(tabId)) {
          closeWindow(wid);
        }
      }
    }
  }, [terminal.tabs, windows]);

  // Route terminal data/exit events globally
  const handleData = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    writeToTerminal(detail.id, detail.data);
  }, []);

  const handleExit = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    writeToTerminal(
      detail.id,
      `\r\n[Process exited with code ${detail.code}]\r\n`
    );
  }, []);

  useEffect(() => {
    window.addEventListener("genie:terminal:data", handleData);
    window.addEventListener("genie:terminal:exit", handleExit);
    return () => {
      window.removeEventListener("genie:terminal:data", handleData);
      window.removeEventListener("genie:terminal:exit", handleExit);
    };
  }, [handleData, handleExit]);

  return (
    <>
      {terminal.tabs.map((tab) => {
        const windowId = WINDOW_PREFIX + tab.id;
        const ws = windows[windowId] as FloatingWindowState | undefined;
        if (!ws || ws.status !== "open") return null;
        return (
          <SingleTerminalWindow key={tab.id} tab={tab} windowState={ws} />
        );
      })}
    </>
  );
}
