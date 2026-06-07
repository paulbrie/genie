"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { TerminalSquare, X, Minus, Maximize2, Minimize2, RotateCw } from "lucide-react";
import type { FloatingWindowState, TerminalTab } from "@/store/types";
import { $terminal, $windowManager } from "@/store/subjects";
import { closeWindow, focusWindow, minimizeWindow, openWindow, reconnectTerminalTab, registerWindow, removeTerminalTab, updateWindowPosition } from "@/store/actions";
import {
  createTerminal,
  disposeTerminal,
  hasTerminal,
  reattachTerminal,
  writeToTerminal,
  focusTerminal as focusXterm,
  refitTerminal,
  setTerminalFontSize,
} from "@/lib/terminal-bridge";
import { WindowFontSizeButton, useWindowFontSize, WINDOW_FONT_PX } from "@/components/ui/window-font-size";
import { buildTerminalSshSpawnPayload } from "@/lib/terminal-spawn";
import { wsSend } from "@/lib/ws";
import { useDraggable, useResizable } from "@/hooks/use-draggable";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const [fontSize] = useWindowFontSize();
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

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

  const position = storedPos.x >= 0 && storedPos.y >= 0 ? storedPos : initial;

  const handleDragEnd = useCallback(
    (pos: { x: number; y: number }) => updateWindowPosition(windowId, pos),
    [windowId]
  );

  const { elRef, onPointerDown } = useDraggable(position, handleDragEnd);
  const { onResizePointerDown } = useResizable(elRef, {
    w: DEFAULT_W,
    h: DEFAULT_H,
  });

  // Wrap the resize handle's pointerdown: it stopPropagation's so the parent's
  // focusWindow doesn't fire, AND preventDefault's so native focus doesn't move
  // to xterm — net effect was that grabbing the resize handle left the popup
  // un-focused and the user couldn't type even after the resize settled. Bring
  // the popup to front and hand keyboard focus to xterm explicitly on grab.
  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const beforeActive = document.activeElement;
      focusWindow(windowId);
      focusXterm(tab.id);
      const afterActive = document.activeElement;
      // eslint-disable-next-line no-console
      console.log("[term-resize] handle pointerdown", {
        tabId: tab.id,
        windowId,
        beforeActiveTag: beforeActive?.tagName,
        afterActiveTag: afterActive?.tagName,
        afterIsTextarea: afterActive?.tagName === "TEXTAREA",
      });
      onResizePointerDown(e);
    },
    [windowId, tab.id, onResizePointerDown],
  );

  // Spawn dispatcher shared by both rendering paths. xterm calls it from
  // the FitAddon callback (so cols/rows match the rendered grid); the
  // custom renderer fires at its 80×24 initial size and corrects the PTY via
  // terminal:resize once it has measured the container.
  // A tab with no ssh and no reattach is a local PTY on the manager host
  // (sidebar Terminal button). Its keystrokes/resizes/close go through the
  // distinct `manager-pty:*` namespace; everything else stays on `terminal:*`.
  const isLocalPty = !tab.ssh && !tab.reattach;

  const spawnWhenReady = useCallback((cols: number, rows: number) => {
    if (tab.reattach) {
      window.dispatchEvent(new CustomEvent("genie:terminal:data", {
        detail: { id: tab.id, data: `\x1b[2mReattaching to ${tab.id}...\x1b[0m\r\n` },
      }));
      wsSend("terminal:reattach", { id: tab.id, cols, rows });
    } else if (tab.ssh) {
      window.dispatchEvent(new CustomEvent("genie:terminal:data", {
        detail: { id: tab.id, data: `\x1b[2mConnecting to ${tab.ssh.username || "genie"}@${tab.ssh.host}:${tab.ssh.port || 22}...\x1b[0m\r\n` },
      }));
      const payload = buildTerminalSshSpawnPayload(tab, cols, rows);
      if (payload) wsSend("terminal:ssh:spawn", payload);
    } else {
      wsSend("manager-pty:start", { terminalId: tab.id, cols, rows });
    }
  }, [tab]);

  // Mount xterm when container is ready.
  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    mountedRef.current = true;

    if (hasTerminal(tab.id)) {
      reattachTerminal(tab.id, containerRef.current);
    } else {
      createTerminal(containerRef.current, tab.id, ({ cols, rows }) => {
        spawnWhenReady(cols, rows);
      }, isLocalPty ? "manager-pty" : "terminal", WINDOW_FONT_PX[fontSizeRef.current]);
    }
  }, [tab, spawnWhenReady, isLocalPty]);

  // Live-apply font-size changes (and reconcile a reattached terminal that was
  // created under a different choice). No-op when the size already matches.
  useEffect(() => {
    setTerminalFontSize(tab.id, WINDOW_FONT_PX[fontSize]);
  }, [fontSize, tab.id]);

  // Focus xterm when output arrives so keystrokes reach Claude without an extra click.
  useEffect(() => {
    let didFocus = false;
    const onData = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail;
      if (detail.id !== tab.id || didFocus) return;
      didFocus = true;
      requestAnimationFrame(() => focusXterm(tab.id));
    };
    window.addEventListener("genie:terminal:data", onData);
    return () => window.removeEventListener("genie:terminal:data", onData);
  }, [tab.id]);

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
    wsSend(isLocalPty ? "manager-pty:close" : "terminal:close", { terminalId: tab.id });
    removeTerminalTab(tab.id);
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
        left: position.x,
        top: position.y,
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
      // Stop wheel events from bubbling: a wheel over the popup's chrome
      // (header / status bar / tmux row) would otherwise reach the page
      // underneath and scroll the chat-history view behind the popup.
      // xterm.js attaches its own native wheel listener on its viewport and
      // calls preventDefault, so terminal scrollback inside the popup keeps
      // working — this guard only catches wheel events that fire OUTSIDE
      // the xterm viewport.
      onWheel={(e) => e.stopPropagation()}
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
          {tab.disconnected && tab.reattachable && (
            <button
              onClick={() => reconnectTerminalTab(tab.id)}
              className="flex items-center gap-1 px-2 py-1 rounded text-yellow bg-yellow/10 hover:bg-yellow/15 transition-colors"
              title="Connection lost — reattach the session preserved on the VM"
            >
              <RotateCw size={12} />
              <span className="text-md font-medium">Reconnect</span>
            </button>
          )}
          <WindowFontSizeButton />
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

      {/* Body — xterm pane. Outer wrapper adds breathing room around the
       *  text; FitAddon measures the inner div (no padding) so the cell
       *  count stays accurate. */}
      <div className="flex-1 min-h-0">
        <div
          className="h-full w-full px-2 py-1"
          onPointerDown={(e) => {
            e.stopPropagation();
            focusWindow(windowId);
            focusXterm(tab.id);
          }}
        >
          <div ref={containerRef} className="h-full w-full" />
        </div>
      </div>

      {/* Resize handle */}
      {!maximized && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          onPointerDown={handleResizePointerDown}
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
