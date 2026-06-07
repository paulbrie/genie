"use client";

/**
 * Floating-window wrapper around <VmConnectionPopup>. Lives in the shared
 * window manager so multiple connections can be open side-by-side; closing
 * the window also disposes the SSH session.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { Maximize2, Minimize2, Minus, Terminal, X } from "lucide-react";

import { $vmConnections, $windowManager } from "@/store/subjects";
import {
  closeVmConnection,
  closeWindow,
  focusWindow,
  minimizeWindow,
  openProjectVmConnection,
  openWindow,
  registerWindow,
  updateWindowPosition,
} from "@/store/actions";
import { useDraggable, useResizable } from "@/hooks/use-draggable";
import { useIsWindowFocused } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { VmConnectionPopup } from "./vm-connection-popup";
import { WindowFontSizeButton } from "@/components/ui/window-font-size";

const VM_CONN_WINDOW_PREFIX = "vm-conn-";
const W = 760;
const H = 560;
const CASCADE = 30;

export function openVmConnectionWindow(args: {
  projectId: string;
  instanceId: string;
  host: string;
  port?: number;
  username: string;
  vmLabel: string;
  initialCommand?: string;
  tmuxIntent?: "new" | "attach";
  tmuxSessionName?: string;
}): void {
  const key = openProjectVmConnection(args);
  const wid = VM_CONN_WINDOW_PREFIX + key;
  registerWindow(wid, `SSH ${args.username}@${args.vmLabel}`, "terminal");
  openWindow(wid);
  focusWindow(wid);
}

function VmConnectionWindowInstance({ windowId }: { windowId: string }) {
  const [windowManager] = useSubject($windowManager);
  const windowState = windowManager.windows[windowId];
  const key = windowId.slice(VM_CONN_WINDOW_PREFIX.length);
  // Read connection metadata without subscribing to live stats/traffic — those
  // updates re-render the shell and used to reset left/top mid-drag (xterm flicker).
  const conn = $vmConnections.getValue().connections[key];

  const [maximized, setMaximized] = useState(false);
  const storedPos = windowState?.position;
  const allWindows = windowManager.windows;

  const initial = useMemo(() => {
    if (storedPos && storedPos.x >= 0 && storedPos.y >= 0) return storedPos;
    const taken = Object.values(allWindows)
      .filter((w) => w.id !== windowId && w.status === "open" && w.position.x >= 0)
      .map((w) => w.position);
    let pos = {
      x: Math.max(window.innerWidth / 2 - W / 2, 20),
      y: Math.max(window.innerHeight / 2 - H / 2, 20),
    };
    while (taken.some((p) => Math.abs(p.x - pos.x) < 20 && Math.abs(p.y - pos.y) < 20)) {
      pos = { x: pos.x + CASCADE, y: pos.y + CASCADE };
    }
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const position =
    storedPos && storedPos.x >= 0 && storedPos.y >= 0 ? storedPos : initial;

  useEffect(() => {
    if (!windowState) return;
    if (storedPos && (storedPos.x < 0 || storedPos.y < 0)) {
      updateWindowPosition(windowId, initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragEnd = useCallback(
    (pos: { x: number; y: number }) => updateWindowPosition(windowId, pos),
    [windowId],
  );
  const { elRef, onPointerDown } = useDraggable(position, handleDragEnd);
  const { onResizePointerDown } = useResizable(elRef, { w: W, h: H });
  const isFocused = useIsWindowFocused(windowState ?? null);

  if (!windowState || windowState.status !== "open") return null;
  if (!conn) return null;

  const containerStyle: React.CSSProperties = maximized
    ? { left: 0, top: 0, width: "100vw", height: "100vh", zIndex: windowState.zIndex }
    : { left: position.x, top: position.y, width: W, height: H, zIndex: windowState.zIndex };

  const handleClose = () => {
    closeVmConnection(key);
    closeWindow(windowId);
  };

  return createPortal(
    <div
      ref={elRef}
      className={cn(
        "fixed bg-mantle border flex flex-col transition-[border-color,box-shadow] duration-150 overflow-hidden",
        maximized ? "rounded-none" : "rounded-lg",
        isFocused ? "border-blue/60 shadow-2xl shadow-blue/20" : "border-surface0 shadow-2xl shadow-black/50",
      )}
      style={containerStyle}
      onPointerDown={() => focusWindow(windowId)}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-surface0 cursor-grab active:cursor-grabbing select-none shrink-0"
        onPointerDown={maximized ? undefined : onPointerDown}
      >
        <Terminal size={14} className="text-blue shrink-0" />
        <span className="text-text font-medium text-md">{conn.vmLabel}</span>
        <span className="text-overlay0 text-xs font-mono">
          {conn.username}@{conn.host}
        </span>
        <div className="flex-1" />
        <WindowFontSizeButton className="flex items-center gap-0.5 px-1 py-1 rounded text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer" />
        <button
          onClick={() => minimizeWindow(windowId)}
          className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer p-1"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => setMaximized((v) => !v)}
          className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer p-1"
          title={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          onClick={handleClose}
          className="text-overlay1 hover:text-red transition-colors bg-transparent border-none cursor-pointer p-1"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <VmConnectionPopup connectionKey={key} />
      </div>

      {!maximized && (
        <div
          className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
          onPointerDown={onResizePointerDown}
        />
      )}
    </div>,
    document.body,
  );
}

export function VmConnectionWindows() {
  const [windowManager] = useSubject($windowManager);
  const windowIds = Object.keys(windowManager.windows).filter((id) =>
    id.startsWith(VM_CONN_WINDOW_PREFIX),
  );
  return (
    <>
      {windowIds.map((id) => (
        <VmConnectionWindowInstance key={id} windowId={id} />
      ))}
    </>
  );
}
