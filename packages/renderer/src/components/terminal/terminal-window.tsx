"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { TerminalSquare, X, Minus, Maximize2, Minimize2, Share2, Bug } from "lucide-react";
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
  const [shareOpen, setShareOpen] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  // Diagnostic split — opt-in. Persisted in localStorage so the choice
  // survives reloads (handy when the freeze is a once-per-session event),
  // but toggled live via the bug-icon button in the title bar so flipping
  // it doesn't require a reload. Recomputed once on mount from storage.
  const [debugSplit, setDebugSplit] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem("term-debug") === "1"; } catch { return false; }
  });
  const toggleDebugSplit = useCallback(() => {
    setDebugSplit((v) => {
      const next = !v;
      try { window.localStorage.setItem("term-debug", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // When debugSplit toggles, the xterm container is a different DOM node —
  // re-attach xterm's helper element to the new container, otherwise its
  // DOM stays orphaned in the previous (now-unmounted) container. No-op on
  // first mount (the mount effect creates the terminal in this container).
  useEffect(() => {
    if (containerRef.current && hasTerminal(tab.id)) {
      reattachTerminal(tab.id, containerRef.current);
    }
  }, [debugSplit, tab.id]);

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

  // Mount xterm when container is ready
  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    mountedRef.current = true;

    if (hasTerminal(tab.id)) {
      reattachTerminal(tab.id, containerRef.current);
    } else {
      const spawnWhenFitted = (cols: number, rows: number) => {
        const isRestored = !!(tab.viewerIds && tab.viewerIds.length > 0);
        if (tab.shared || isRestored) return;
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
          wsSend("terminal:spawn", {
            id: tab.id,
            cols,
            rows,
            command: tab.command,
            cwd: tab.cwd,
          });
        }
      };

      createTerminal(containerRef.current, tab.id, ({ cols, rows }) => {
        spawnWhenFitted(cols, rows);
      });
    }
  }, [tab]);

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
          <button
            onClick={toggleDebugSplit}
            className={cn(
              "p-1 rounded transition-colors",
              debugSplit
                ? "text-yellow bg-yellow/10 hover:bg-yellow/15"
                : "text-overlay0 hover:text-text hover:bg-surface0",
            )}
            title={debugSplit ? "Hide diagnostic split" : "Show diagnostic split (xterm | dumb-pre | ws log | stats)"}
          >
            <Bug size={13} />
          </button>
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

      {/* Body — single xterm pane normally; 3-column diagnostic split when
       *  `localStorage.term-debug = "1"` (set in DevTools, reload). Built to
       *  compare xterm rendering against a dumb-pre custom renderer fed by
       *  the same genie:terminal:data stream — if xterm freezes but custom
       *  keeps painting, the freeze is xterm; if both freeze, it's upstream. */}
      {debugSplit ? (
        <div className="flex-1 min-h-0 flex flex-row">
          <div
            ref={containerRef}
            className="flex-1 min-w-0"
            onPointerDown={(e) => {
              e.stopPropagation();
              focusWindow(windowId);
              focusXterm(tab.id);
            }}
          />
          <div className="flex-1 min-w-0 border-l border-surface0 overflow-hidden">
            <CustomTerminalView sessionId={tab.id} />
          </div>
          <div className="flex-1 min-w-0 border-l border-surface0 overflow-hidden">
            <WsLogPanel sessionId={tab.id} />
          </div>
          <div className="w-56 shrink-0 border-l border-surface0 overflow-hidden">
            <DebugPanel sessionId={tab.id} containerRef={containerRef} />
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 min-h-0"
          onPointerDown={(e) => {
            e.stopPropagation();
            focusWindow(windowId);
            focusXterm(tab.id);
          }}
        />
      )}

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

/** Dumbest-possible terminal renderer: appends every byte arriving on
 *  genie:terminal:data into a <pre>, RAF-throttled, ANSI stripped. The
 *  point isn't fidelity — it's to have an independent rendering path that
 *  shares xterm's INPUT but nothing else, so when both panes are visible
 *  side-by-side the user can see which one falls behind. Diagnostic only. */
function CustomTerminalView({ sessionId }: { sessionId: string }) {
  const preRef = useRef<HTMLPreElement>(null);
  const bufferRef = useRef("");
  const pendingRef = useRef("");
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const flush = () => {
      rafRef.current = null;
      const pre = preRef.current;
      if (!pre || pendingRef.current === "") return;
      bufferRef.current = (bufferRef.current + pendingRef.current).slice(-100_000);
      pendingRef.current = "";
      pre.textContent = bufferRef.current;
      pre.scrollTop = pre.scrollHeight;
    };
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.id !== sessionId) return;
      // Strip CSI / OSC / Fp / Fs sequences so the pane stays readable as
      // plain text. Crude but enough for "is it painting?" diagnostics.
      const clean = (detail.data as string)
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b[()][\x20-\x7e]/g, "");
      pendingRef.current += clean;
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush);
    };
    window.addEventListener("genie:terminal:data", handler);
    return () => {
      window.removeEventListener("genie:terminal:data", handler);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [sessionId]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-overlay0 bg-mantle border-b border-surface0 shrink-0">
        Custom (plain &lt;pre&gt;)
      </div>
      <pre
        ref={preRef}
        className="flex-1 m-0 p-1 overflow-auto bg-crust text-text font-mono text-[10px] whitespace-pre-wrap break-all select-text"
      />
    </div>
  );
}

/** WS-message log scoped to this terminal's session. Subscribes to
 *  genie:terminal:data (the in-process re-broadcast of every terminal:data
 *  frame the manager pushed for this id) and shows one row per message
 *  with timestamp, byte count, and an escaped preview of the first ~80
 *  bytes. Useful for spotting bursts, gaps, or a sudden 0-byte stream
 *  during a "freeze" — if rows keep arriving but xterm stops painting,
 *  the wire is fine and the renderer is at fault. */
function WsLogPanel({ sessionId }: { sessionId: string }) {
  const bufRef = useRef<Array<{ ts: number; bytes: number; preview: string }>>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.id !== sessionId) return;
      const data = detail.data as string;
      // Escape control chars so binary/ANSI is visible as text. Keep first
      // ~80 chars — anything more is just noise for spotting flow problems.
      const preview = data
        .slice(0, 80)
        .replace(/\x1b/g, "\\e")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t")
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
      bufRef.current.push({ ts: Date.now(), bytes: data.length, preview });
      if (bufRef.current.length > 200) bufRef.current = bufRef.current.slice(-200);
    };
    window.addEventListener("genie:terminal:data", handler);
    // Re-render at 10fps so a bursty stream doesn't React-render per frame.
    const interval = window.setInterval(() => {
      force((n) => n + 1);
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 100);
    return () => {
      window.removeEventListener("genie:terminal:data", handler);
      window.clearInterval(interval);
    };
  }, [sessionId]);

  function fmtTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }

  const messages = bufRef.current;
  return (
    <div className="h-full flex flex-col">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-overlay0 bg-mantle border-b border-surface0 shrink-0">
        WS · terminal:data ({messages.length})
      </div>
      <div ref={listRef} className="flex-1 overflow-auto bg-crust text-[10px] font-mono">
        {messages.length === 0 ? (
          <div className="p-2 text-overlay0">No terminal:data messages yet</div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className="px-1.5 py-0.5 border-b border-surface0/30 flex gap-1.5 items-baseline">
              <span className="text-overlay0 shrink-0">{fmtTime(m.ts)}</span>
              <span className="text-mauve shrink-0">{m.bytes}b</span>
              <span className="text-text truncate flex-1 min-w-0 select-text">{m.preview}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Live debug readout for a terminal session. Polls xterm DOM + listens to
 *  genie:terminal:data to derive bytes/sec, time-since-last-write, current
 *  renderer (canvas vs DOM), focus state, and container dims. Diagnostic
 *  only — paired with CustomTerminalView in the 3-column split. */
function DebugPanel({ sessionId, containerRef }: { sessionId: string; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const statsRef = useRef({
    bytesTotal: 0,
    writeCount: 0,
    lastWriteAt: 0,
    bytesLastSec: 0,
    lastBytesSnapshot: 0,
    lastBytesTime: 0,
  });
  const [, force] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.id !== sessionId) return;
      statsRef.current.bytesTotal += detail.data.length;
      statsRef.current.writeCount++;
      statsRef.current.lastWriteAt = performance.now();
    };
    window.addEventListener("genie:terminal:data", handler);
    statsRef.current.lastBytesTime = performance.now();
    const interval = window.setInterval(() => {
      const s = statsRef.current;
      const now = performance.now();
      const dt = (now - s.lastBytesTime) / 1000;
      const dBytes = s.bytesTotal - s.lastBytesSnapshot;
      s.bytesLastSec = dt > 0 ? Math.round(dBytes / dt) : 0;
      s.lastBytesSnapshot = s.bytesTotal;
      s.lastBytesTime = now;
      force((n) => n + 1);
    }, 500);
    return () => {
      window.removeEventListener("genie:terminal:data", handler);
      window.clearInterval(interval);
    };
  }, [sessionId]);

  const s = statsRef.current;
  const xtermEl = containerRef.current?.querySelector(".xterm") as HTMLElement | null;
  const canvasCount = xtermEl?.querySelectorAll(".xterm-screen canvas").length ?? 0;
  const hasDomRows = !!xtermEl?.querySelector(".xterm-rows");
  const rect = containerRef.current?.getBoundingClientRect();
  const active = typeof document !== "undefined" ? document.activeElement : null;
  const activeInXterm = !!xtermEl?.contains(active);
  const sinceLastWrite = s.lastWriteAt ? Math.round(performance.now() - s.lastWriteAt) : null;

  const Row = ({ k, v, danger }: { k: string; v: React.ReactNode; danger?: boolean }) => (
    <div className="flex justify-between gap-2">
      <span className="text-overlay0">{k}</span>
      <span className={danger ? "text-red" : "text-text"}>{v}</span>
    </div>
  );

  return (
    <div className="h-full flex flex-col text-[10px] font-mono">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-overlay0 bg-mantle border-b border-surface0 shrink-0">
        Debug
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-2 bg-crust">
        <div>
          <div className="text-subtext0 uppercase text-[9px] mb-1">Session</div>
          <div className="text-overlay1 break-all">{sessionId}</div>
        </div>
        <div>
          <div className="text-subtext0 uppercase text-[9px] mb-1">Renderer</div>
          <Row k="canvases" v={canvasCount} danger={canvasCount === 0} />
          <Row k="dom rows" v={hasDomRows ? "yes" : "no"} danger={hasDomRows && canvasCount === 0} />
        </div>
        <div>
          <div className="text-subtext0 uppercase text-[9px] mb-1">Container</div>
          <Row k="w × h" v={rect ? `${Math.round(rect.width)} × ${Math.round(rect.height)}` : "—"} />
        </div>
        <div>
          <div className="text-subtext0 uppercase text-[9px] mb-1">Focus</div>
          <Row k="tag" v={active?.tagName ?? "—"} />
          <Row k="in xterm" v={activeInXterm ? "yes" : "no"} danger={!activeInXterm} />
        </div>
        <div>
          <div className="text-subtext0 uppercase text-[9px] mb-1">Stream</div>
          <Row k="bytes total" v={s.bytesTotal.toLocaleString()} />
          <Row k="writes" v={s.writeCount.toLocaleString()} />
          <Row k="bytes/sec" v={s.bytesLastSec.toLocaleString()} />
          <Row k="last write" v={sinceLastWrite == null ? "—" : `${sinceLastWrite} ms ago`} danger={sinceLastWrite !== null && sinceLastWrite > 2000} />
        </div>
        <div className="text-[9px] text-overlay0 pt-2 border-t border-surface0">
          Disable: <span className="text-subtext0">localStorage.removeItem("term-debug")</span> + reload
        </div>
      </div>
    </div>
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
