"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { X, Minus, Maximize2, Minimize2, Loader2, History, GitCompareArrows } from "lucide-react";
import { $claudeStream } from "@/store/subjects/claude-stream";
import { $reviewDiff } from "@/store/subjects/review-diff";
import { openClaudeStream, closeClaudeStream, dismissClaudeStreamMessage } from "@/store/actions/claude-stream";
import { openReviewDiff } from "@/store/actions/review-diff";
import { $windowManager } from "@/store/subjects";
import { registerWindow, openWindow, minimizeWindow, closeWindow } from "@/store/actions";
import { ClaudeLogo } from "@/components/project/project-detail";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ClaudeChatSurface, type ClaudeChatSurfaceHandle } from "@/components/chat/claude-chat-surface";
import { WindowFontSizeButton, useWindowFontSize, WINDOW_FONT_SCALE } from "@/components/ui/window-font-size";
import { useDraggable, useResizable } from "@/hooks/use-draggable";

const WIN_W = 460;
const WIN_H = 600;

/** Floating, draggable chat window backed by a durable stream-json Claude
 *  session on the project VPS. Mirrors the terminal window's chrome but renders
 *  the conversation with ChatMessageList instead of xterm. */
/** Renders one floating window per open durable Claude session. Mount once per
 *  surface (extension panel, main app). Windows are driven entirely by the
 *  $claudeStream subject, so any caller can open one via openClaudeChatWindow /
 *  openClaudeStream regardless of which React tree it lives in. */
// Chat windows float above the window-manager popups (Manage VM, terminals,
// assistant), whose z-indexes start at 10000 and climb. A high fixed base keeps
// a freshly-opened chat visible on top instead of hidden behind the popup that
// launched it; the focused chat sits one above the rest.
const CHAT_Z_BASE = 2_000_000;

export function ClaudeStreamWindows() {
  const [state] = useSubject($claudeStream);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const ids = Object.keys(state.sessions);
  // Re-opening a chat (e.g. clicking the Manage "Claude" button again) brings its
  // window to the front even when it was already mounted. Keyed off the nonce so
  // re-focusing the same id fires.
  const focusReq = state.focusRequest;
  useEffect(() => {
    if (focusReq && state.sessions[focusReq.claudeStreamId]) setFocusedId(focusReq.claudeStreamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq?.nonce]);
  return (
    <>
      {ids.map((id, i) => (
        <ClaudeStreamWindow
          key={id}
          claudeStreamId={id}
          index={i}
          onClose={closeClaudeStream}
          onFocus={setFocusedId}
          focused={focusedId === id}
          zIndex={focusedId === id ? CHAT_Z_BASE + 1000 : CHAT_Z_BASE + i}
        />
      ))}
    </>
  );
}

export function ClaudeStreamWindow({
  claudeStreamId,
  index = 0,
  onClose,
  onFocus,
  focused,
  zIndex,
}: {
  claudeStreamId: string;
  index?: number;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  focused: boolean;
  zIndex: number;
}) {
  const [state] = useSubject($claudeStream);
  const session = state.sessions[claudeStreamId];
  const [reviewState] = useSubject($reviewDiff);
  const reviewOpenCount =
    reviewState.open && reviewState.claudeStreamId === claudeStreamId
      ? reviewState.comments.filter((c) => c.status === "open").length
      : 0;

  const [maximized, setMaximized] = useState(false);
  // Minimized state lives in the shared window manager (not local) so the
  // window shows up in the bottom minimized-row toolbar like every other popup,
  // and can be restored from there. The chat keeps its own z-index/focus system.
  const [windowManager] = useSubject($windowManager);
  const minimized = windowManager.windows[claudeStreamId]?.status === "minimized";
  const [fontSize] = useWindowFontSize();
  const scrollRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<ClaudeChatSurfaceHandle>(null);

  // Re-issue start on (re)mount so a fresh window reattaches + replays. Idempotent.
  // Also bring this window to the front and focus the input so the user can type
  // straight away.
  useEffect(() => {
    if (session) openClaudeStream({ claudeStreamId, projectId: session.projectId, instanceId: session.instanceId, label: session.label, tmuxName: session.tmuxName, resumeSessionId: session.resumeSessionId });
    // Track this window in the shared manager so it appears in the minimized row.
    registerWindow(claudeStreamId, session?.label ?? "Claude", "claude");
    openWindow(claudeStreamId);
    onFocus(claudeStreamId);
    const t = setTimeout(() => surfaceRef.current?.focus(), 0);
    return () => { clearTimeout(t); closeWindow(claudeStreamId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claudeStreamId]);

  // Restoring from the minimized-row toolbar flips status back to "open"; bring
  // the chat to the front (in its own z-index system) so it isn't revealed
  // behind another popup.
  const wasMinimized = useRef(false);
  useEffect(() => {
    if (wasMinimized.current && !minimized) onFocus(claudeStreamId);
    wasMinimized.current = minimized;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimized]);

  // Auto-scroll to the latest message / streaming token. The initial load —
  // whether one bulk replay or an incremental tail that drips messages in
  // one-by-one — jumps straight to the end (scrollTop, no animation): we treat
  // any update in the first ~2s after the window opens, and any multi-message
  // jump, as a non-animated pin. Only genuine live updates (you chatting after
  // the conversation has settled) scroll smoothly.
  const prevMsgLen = useRef(0);
  const openedAt = useRef(Date.now());
  useEffect(() => {
    const len = session?.messages.length ?? 0;
    const bulk = prevMsgLen.current === 0 || len - prevMsgLen.current > 1;
    prevMsgLen.current = len;
    const settling = Date.now() - openedAt.current < 2000;
    if (bulk || settling) {
      const pin = () => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; };
      pin();
      requestAnimationFrame(pin);
    } else {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [session?.messages, session?.streamingContent, session?.streamingSteps, session?.loading]);

  // Open toward the right and cascade per window, so it doesn't land dead-center
  // underneath the (centered) Manage-VM popup that launched it.
  const initial = useMemo(() => {
    const cascade = index * 32;
    const x = Math.max(20, Math.min(window.innerWidth - WIN_W - 20, Math.floor(window.innerWidth * 0.62) + cascade));
    const y = Math.max(20, Math.floor(window.innerHeight / 2 - WIN_H / 2) + cascade);
    return { x, y };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { elRef, onPointerDown } = useDraggable(initial);
  const { onResizePointerDown } = useResizable(elRef, { w: WIN_W, h: WIN_H });

  if (!session) return null;

  const containerStyle: React.CSSProperties = maximized
    ? { left: 0, top: 0, width: "100vw", height: "100vh", zIndex }
    : { left: initial.x, top: initial.y, width: WIN_W, height: WIN_H, zIndex };
  if (minimized) {
    containerStyle.visibility = "hidden";
    containerStyle.pointerEvents = "none";
    containerStyle.zIndex = -1;
  }

  // Lead with the tmux session name (e.g. `claude-paul`) so the title maps to a
  // visible session badge; trail with the account email/model (constant per VM,
  // so it's the half that can truncate away). `· `-joined, blanks dropped.
  const subtitle = [session.tmuxName, session.claudeInfo?.email || session.claudeInfo?.model]
    .filter(Boolean)
    .join(" · ");

  return createPortal(
    <div
      ref={elRef}
      className={`fixed bg-mantle flex flex-col ${maximized ? "rounded-none" : "rounded-xl"} overflow-hidden border shadow-2xl ${focused ? "border-peach/70 shadow-peach/20" : "border-peach/30 shadow-black/50"} ${session.loading ? "claude-thinking" : ""}`}
      style={containerStyle}
      onPointerDown={() => onFocus(claudeStreamId)}
    >
      {/* Title bar — drag handle */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-surface0 cursor-grab active:cursor-grabbing select-none shrink-0 bg-mantle"
        onPointerDown={(e) => { onFocus(claudeStreamId); if (!maximized) onPointerDown(e); }}
      >
        <span className="text-peach shrink-0 flex items-center"><ClaudeLogo size={13} /></span>
        <span className="text-md text-subtext0 font-medium truncate flex-1">
          {session.label}
          {subtitle && <span className="text-overlay0 font-normal"> · {subtitle}</span>}
        </span>
        {session.reconnecting && (
          <span className="px-1.5 py-0.5 rounded text-yellow bg-yellow/10 border border-yellow/30 flex items-center gap-1" style={{ fontSize: 10 }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow animate-pulse" /> Reconnecting
          </span>
        )}
        <button
          onClick={() => void openReviewDiff(claudeStreamId, session.label)}
          className="relative p-1 rounded text-overlay0 hover:text-peach hover:bg-surface0 transition-colors"
          title="Review changes"
        >
          <GitCompareArrows size={13} />
          {reviewOpenCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-peach text-crust text-[9px] font-bold leading-[13px] text-center">
              {reviewOpenCount}
            </span>
          )}
        </button>
        <WindowFontSizeButton />
        <button onClick={() => minimizeWindow(claudeStreamId)} className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors" title="Minimize">
          <Minus size={12} />
        </button>
        <button onClick={() => setMaximized((v) => !v)} className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors" title={maximized ? "Restore" : "Maximize"}>
          {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
        <button onClick={() => onClose(claudeStreamId)} className="p-1 rounded text-overlay0 hover:text-red hover:bg-red/10 transition-colors" title="Close">
          <X size={12} />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2 scrollbar-thin min-h-0"
        role="log"
        aria-live="polite"
        aria-label="Claude messages"
        style={{ zoom: WINDOW_FONT_SCALE[fontSize] } as React.CSSProperties}
      >
        <ChatMessageList
          // Cost is real spend only on the API-key fallback; on the VM's CLI
          // subscription the reported figure is a would-be cost, so hide it.
          showCost={session.claudeInfo?.plan === "API Key"}
          accent="peach"
          messages={session.messages}
          onDismissError={(msg) => dismissClaudeStreamMessage(session.claudeStreamId, msg)}
          streamingContent={session.streamingContent}
          streamingSteps={session.streamingSteps}
          toolUses={session.toolUses}
          loading={session.loading}
          statusText={session.statusText}
          emptyState={
            !session.ready ? (
              <p className="text-overlay0 text-md text-center flex items-center justify-center gap-2">
                <Loader2 size={13} className="animate-spin" /> Connecting to Claude…
              </p>
            ) : session.historyLoading ? (
              <p className="text-overlay0 text-md text-center flex items-center justify-center gap-2">
                <History size={13} className="animate-pulse" /> Loading history…
              </p>
            ) : (
              <p className="text-overlay0 text-md text-center">
                Chat with Claude on this project — full CLI, rendered as chat.
              </p>
            )
          }
        />
      </div>

      {/* Composer + HITL dialog + controls — shared with the mobile Claude screen */}
      <ClaudeChatSurface
        ref={surfaceRef}
        claudeStreamId={claudeStreamId}
        variant="desktop"
        zoom={WINDOW_FONT_SCALE[fontSize]}
      />

      {/* Resize handle */}
      {!maximized && (
        <div onPointerDown={onResizePointerDown} className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize" style={{ touchAction: "none" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" className="text-overlay0/50">
            <path d="M14 14L8 14L14 8Z" fill="currentColor" />
            <path d="M14 14L11 14L14 11Z" fill="currentColor" opacity="0.5" />
          </svg>
        </div>
      )}
    </div>,
    document.body,
  );
}
