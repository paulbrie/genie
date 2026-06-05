"use client";

import { useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { MessageSquare, Minus, X } from "lucide-react";

import { $auth, $conversationChat, $windowManager } from "@/store/subjects";
import {
  closeWindow,
  focusWindow,
  minimizeWindow,
  openDmWith,
  openWindow,
  registerWindow,
  updateWindowPosition,
} from "@/store/actions";
import { useDraggable } from "@/hooks/use-draggable";
import { useIsWindowFocused } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { ConversationMessages } from "@/components/chat/conversation-messages";

const WINDOW_ID = "dm-popup";
const W = 400;
const H = 520;
const CASCADE = 30;

/** Open the DM popup window for `targetUserId`. Triggers the server-side
 *  upsert of a 1:1 conversation; the `chat:conversation:created` handler sets
 *  it as active, so the popup (which mirrors $conversationChat.activeConversationId)
 *  switches to that DM. */
export function openDmPopup(targetUserId: string): void {
  openDmWith(targetUserId);
  openWindow(WINDOW_ID);
  focusWindow(WINDOW_ID);
}

export function DmPopup() {
  const [windowManager] = useSubject($windowManager);
  const [cc] = useSubject($conversationChat);
  const [auth] = useSubject($auth);
  const windowState = windowManager.windows[WINDOW_ID];

  useEffect(() => {
    registerWindow(WINDOW_ID, "Direct Messages", "bot");
  }, []);

  const isOpen = windowState?.status === "open";
  const storedPos = windowState?.position;
  const allWindows = windowManager.windows;

  const initial = useMemo(() => {
    if (storedPos && storedPos.x >= 0 && storedPos.y >= 0) return storedPos;
    const taken = Object.values(allWindows)
      .filter((w) => w.id !== WINDOW_ID && w.status === "open" && w.position.x >= 0)
      .map((w) => w.position);
    let pos = {
      x: Math.max(window.innerWidth - W - 40, 40),
      y: Math.max(window.innerHeight - H - 80, 40),
    };
    while (taken.some((p) => Math.abs(p.x - pos.x) < 20 && Math.abs(p.y - pos.y) < 20)) {
      pos = { x: pos.x - CASCADE, y: pos.y - CASCADE };
      if (pos.x < 20) pos.x = 20 + CASCADE;
      if (pos.y < 20) pos.y = 20 + CASCADE;
    }
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const position = storedPos && storedPos.x >= 0 && storedPos.y >= 0 ? storedPos : initial;

  useEffect(() => {
    if (!isOpen) return;
    if (storedPos && (storedPos.x < 0 || storedPos.y < 0)) {
      updateWindowPosition(WINDOW_ID, initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleDragEnd = useCallback((pos: { x: number; y: number }) => {
    updateWindowPosition(WINDOW_ID, pos);
  }, []);

  const { elRef, onPointerDown } = useDraggable(position, handleDragEnd);
  const isFocused = useIsWindowFocused(windowState ?? null);

  if (!isOpen) return null;

  // Look up the DM peer name for the title bar.
  const activeConv = cc.conversations.find((c) => c.id === cc.activeConversationId);
  const me = auth.user?.id;
  const peer = activeConv?.type === "dm"
    ? activeConv.members.find((m) => m.userId !== me) ?? activeConv.members[0]
    : null;
  const titleName = peer?.name ?? (activeConv?.type === "room" ? activeConv.name : "Direct messages");

  return createPortal(
    <div
      ref={elRef}
      className={cn(
        "fixed bg-mantle border rounded-lg flex flex-col overflow-hidden",
        "transition-[border-color,box-shadow] duration-150",
        isFocused ? "border-blue/60 shadow-2xl shadow-blue/20" : "border-surface0 shadow-2xl shadow-black/50",
      )}
      style={{ left: position.x, top: position.y, width: W, height: H, zIndex: windowState.zIndex }}
      onPointerDown={() => focusWindow(WINDOW_ID)}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-surface0 cursor-grab active:cursor-grabbing select-none shrink-0"
        onPointerDown={onPointerDown}
      >
        <MessageSquare size={14} className="text-mauve shrink-0" />
        <span className="text-text font-medium text-md truncate">{titleName}</span>
        <div className="flex-1" />
        <button
          onClick={() => minimizeWindow(WINDOW_ID)}
          className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer p-1"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => closeWindow(WINDOW_ID)}
          className="text-overlay1 hover:text-red transition-colors bg-transparent border-none cursor-pointer p-1"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {cc.activeConversationId ? (
          <ConversationMessages />
        ) : (
          <div className="flex-1 flex items-center justify-center text-overlay0 text-md px-6 text-center">
            Pick a user to start a direct message.
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
