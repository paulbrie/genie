"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { X, Minus, Maximize2, Minimize2, Loader2, ClipboardList, History, Check, Terminal } from "lucide-react";
import { $claudeStream } from "@/store/subjects/claude-stream";
import { sendClaudeStreamMessage, stopClaudeStream, openClaudeStream, closeClaudeStream, pasteClaudeStreamImage, listClaudeSessions, openClaudeChatWindow, runClaudeStreamBash } from "@/store/actions/claude-stream";
import { $auth } from "@/store/subjects";
import type { ClaudeSessionSummary } from "@/store/types/claude-stream";
import { ClaudeLogo } from "@/components/project/project-detail";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatAutocomplete, useChatAutocomplete } from "@/components/chat/chat-autocomplete";
import { WindowFontSizeButton, useWindowFontSize, WINDOW_FONT_SCALE } from "@/components/ui/window-font-size";
import { useDraggable, useResizable } from "@/hooks/use-draggable";

const WIN_W = 460;
const WIN_H = 600;

/** Prefixed onto each message while the plan-mode pill is active. Claude has no
 *  runtime permission-mode toggle over stream-json, so we steer it with a strong
 *  per-turn directive instead — research & propose, don't mutate. */
const PLAN_DIRECTIVE =
  "[Plan mode] Research the request below and propose a concise, step-by-step plan. " +
  "Do NOT modify files, write code, or run any mutating commands — read-only investigation only. " +
  "End with the plan and wait for my approval before making changes.";

/** Context-window size (tokens) for the running model. Current Claude models are
 *  200k unless the 1M-context beta is active; default to 200k. */
function contextWindowFor(model: string): number {
  return /\[1m\]|-1m\b/i.test(model) ? 1_000_000 : 200_000;
}

/** "47.2k" / "1.2k" / "920" — compact token count. */
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return String(n);
}

/** Compact "3m ago" / "2d ago" stamp for the session picker. */
function relTime(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** A clipboard image being uploaded to the VM, then attachable to a message. */
type PendingImage = {
  id: string;
  dataUrl: string;
  remotePath: string | null;
  uploading: boolean;
  error: boolean;
  /** Briefly true while the remove animation plays before it's dropped. */
  removing?: boolean;
};

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

  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [planMode, setPlanMode] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [fontSize] = useWindowFontSize();
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ac = useChatAutocomplete({
    value: input,
    setValue: setInput,
    textareaRef: taRef,
    projectId: session?.projectId ?? "",
    instanceId: session?.instanceId ?? "",
  });

  // Re-issue start on (re)mount so a fresh window reattaches + replays. Idempotent.
  // Also bring this window to the front and focus the input so the user can type
  // straight away.
  useEffect(() => {
    if (session) openClaudeStream({ claudeStreamId, projectId: session.projectId, instanceId: session.instanceId, label: session.label, tmuxName: session.tmuxName, resumeSessionId: session.resumeSessionId });
    onFocus(claudeStreamId);
    const t = setTimeout(() => taRef.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claudeStreamId]);

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
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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

  // Paste clipboard images: upload each to the VM, keep a thumbnail + its remote
  // path, and reference the path(s) in the next message so Claude reads the file.
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    for (const file of files) {
      const localId = `${file.name || "img"}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const comma = dataUrl.indexOf(",");
        const dataB64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
        if (!dataB64) return;
        const ext = (file.type.split("/")[1] || "png").toLowerCase();
        setPendingImages((prev) => [...prev, { id: localId, dataUrl, remotePath: null, uploading: true, error: false }]);
        void pasteClaudeStreamImage(claudeStreamId, dataB64, ext).then((remotePath) => {
          setPendingImages((prev) => prev.map((im) =>
            im.id === localId ? { ...im, remotePath, uploading: false, error: !remotePath } : im));
        });
      };
      reader.readAsDataURL(file);
    }
  }, [claudeStreamId]);

  const removeImage = useCallback((id: string) => {
    // Play a quick shrink-out, then drop it from the list.
    setPendingImages((prev) => prev.map((im) => (im.id === id ? { ...im, removing: true } : im)));
    setTimeout(() => setPendingImages((prev) => prev.filter((im) => im.id !== id)), 160);
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    const ready = pendingImages.filter((im) => im.remotePath);
    if (!text && ready.length === 0) return;
    // Bang mode: `!cmd` runs a shell command on the VM and shows the output here,
    // bypassing Claude entirely.
    if (text.startsWith("!")) {
      const command = text.slice(1).trim();
      if (command) {
        void runClaudeStreamBash(claudeStreamId, command);
        setInput("");
        setPendingImages([]);
        ac.close();
      }
      return;
    }
    const parts: string[] = [];
    if (text) parts.push(text);
    for (const im of ready) parts.push(`[Image: ${im.remotePath}]`);
    // Keep the pasted thumbnails in the conversation (alongside the [Image: …]
    // text Claude reads) by attaching their data URLs to the sent message.
    const images = ready.map((im) => im.dataUrl).filter(Boolean);
    const display = parts.join("\n\n");
    // Plan mode: prefix the directive on the wire payload only — the bubble shows
    // just what the user typed.
    const wire = planMode ? `${PLAN_DIRECTIVE}\n\n${display}` : display;
    sendClaudeStreamMessage(claudeStreamId, wire, images, display);
    setInput("");
    setPendingImages([]);
    ac.close();
  }, [input, pendingImages, claudeStreamId, ac, planMode]);

  // Lazy-load the prior-session list when the picker opens.
  const toggleSessions = useCallback(() => {
    setShowSessions((open) => {
      const next = !open;
      if (next) {
        setSessionsLoading(true);
        void listClaudeSessions(claudeStreamId).then((list) => {
          setSessions(list);
          setSessionsLoading(false);
        });
      }
      return next;
    });
  }, [claudeStreamId]);

  const resumeSession = useCallback((s: ClaudeSessionSummary) => {
    const ownerId = $auth.getValue().user?.id;
    if (!ownerId || !session) return;
    void openClaudeChatWindow({
      ownerId,
      projectId: session.projectId,
      instanceId: session.instanceId,
      label: s.title ? `Resumed · ${s.title.slice(0, 40)}` : "Resumed session",
      resumeSessionId: s.sessionId,
    });
    setShowSessions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.projectId, session?.instanceId]);

  // Enter sends (AutoTextarea onSubmit); Esc stops a running generation — but let
  // the autocomplete swallow Esc first (to close its dropdown).
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && !ac.open && session?.loading) {
      e.preventDefault();
      stopClaudeStream(claudeStreamId);
      return;
    }
    ac.onKeyDown(e);
  }, [ac, session?.loading, claudeStreamId]);

  // Current context occupancy ≈ the most recent turn's prompt + output tokens
  // (the conversation so far). Updates each completed turn.
  const ctxTokens = useMemo(() => {
    const msgs = session?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const u = msgs[i]?.usage;
      if (u && (u.inputTokens > 0 || u.outputTokens > 0)) return u.inputTokens + u.outputTokens;
    }
    return 0;
  }, [session?.messages]);
  const ctxWindow = contextWindowFor(session?.claudeInfo?.model ?? "");
  const ctxPct = ctxWindow > 0 ? Math.min(1, ctxTokens / ctxWindow) : 0;
  const ctxColor = ctxPct < 0.6 ? "bg-green" : ctxPct < 0.85 ? "bg-yellow" : "bg-red";

  if (!session) return null;

  const containerStyle: React.CSSProperties = maximized
    ? { left: 0, top: 0, width: "100vw", height: "100vh", zIndex }
    : { left: initial.x, top: initial.y, width: WIN_W, height: WIN_H, zIndex };
  if (minimized) {
    containerStyle.visibility = "hidden";
    containerStyle.pointerEvents = "none";
    containerStyle.zIndex = -1;
  }

  const subtitle = session.claudeInfo?.email || session.claudeInfo?.model || "";

  return createPortal(
    <div
      ref={elRef}
      className={`fixed bg-mantle shadow-2xl shadow-black/50 flex flex-col ${maximized ? "rounded-none" : "rounded-xl"} overflow-hidden border ${focused ? "border-peach/70" : "border-peach/30"}`}
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
        <WindowFontSizeButton />
        <button onClick={() => setMinimized(true)} className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors" title="Minimize">
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
          messages={session.messages}
          streamingContent={session.streamingContent}
          streamingSteps={session.streamingSteps}
          toolUses={session.toolUses}
          loading={session.loading}
          statusText={session.statusText}
          emptyState={
            <p className="text-overlay0 text-md text-center">
              {session.ready ? "Chat with Claude on this project — full CLI, rendered as chat." : "Connecting to Claude…"}
            </p>
          }
        />
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-t border-surface0 shrink-0">
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pendingImages.map((im) => (
              <div
                key={im.id}
                className={`group relative w-12 h-12 transition-all duration-150 ease-out ${im.removing ? "scale-75 opacity-0" : "scale-100 opacity-100"}`}
                title={im.error ? "Upload failed" : im.remotePath || "Uploading…"}
              >
                <div className={`relative w-full h-full rounded border overflow-hidden bg-surface0 ${im.error ? "border-red/70" : "border-surface1"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.dataUrl} alt="pasted" className="w-full h-full object-cover" />
                  {im.uploading && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 size={14} className="text-peach animate-spin" />
                    </span>
                  )}
                </div>
                {/* Delete sits OUTSIDE the clipped thumbnail (so the corner never
                    covers it) and only fades in on hover. */}
                <button
                  onClick={() => removeImage(im.id)}
                  className={`absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-red text-white hover:bg-red/80 border border-mantle shadow-sm transition-opacity ${im.error ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
                  title="Remove image"
                  aria-label="Remove image"
                >
                  <X size={13} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <ChatAutocomplete open={ac.open} items={ac.items} index={ac.index} kind={ac.kind} onPick={ac.accept} />
          <AutoTextarea
            ref={taRef}
            value={input}
            onChange={ac.onChange}
            onKeyDown={onKeyDown}
            onSubmit={handleSend}
            onPaste={handlePaste}
            placeholder="Message Claude — / commands, @ files, !cmd to run a shell command…"
            aria-label="Message to Claude"
            className="w-full bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-md text-text placeholder:text-overlay0 outline-none focus:border-peach"
          />
        </div>
        {/* No send/stop buttons — Enter sends, Esc stops a running generation. */}
        </div>

        {/* Controls: plan-mode toggle + prior-session picker */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPlanMode((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs transition-colors ${planMode ? "bg-peach/15 border-peach/60 text-peach" : "border-surface1 text-overlay0 hover:text-text hover:border-overlay0"}`}
            title={planMode ? "Plan mode on — Claude researches and proposes a plan instead of making changes" : "Switch to plan mode — Claude proposes a plan before changing anything"}
            aria-pressed={planMode}
          >
            <ClipboardList size={11} /> Plan mode {planMode && <Check size={11} />}
          </button>

          <div className="relative">
            <button
              onClick={toggleSessions}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-overlay0 hover:text-text transition-colors"
              title="Reload a previous Claude session"
            >
              <History size={11} /> Sessions
            </button>
            {showSessions && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSessions(false)} aria-hidden />
                <div className="absolute bottom-full left-0 mb-1 w-72 max-h-64 overflow-y-auto rounded-md border border-surface1 bg-mantle shadow-xl z-20 scrollbar-thin">
                  {sessionsLoading ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-overlay0"><Loader2 size={12} className="animate-spin" /> Loading…</div>
                  ) : sessions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-overlay0">No previous sessions</div>
                  ) : (
                    sessions.map((s) => (
                      <button
                        key={s.sessionId}
                        onClick={() => resumeSession(s)}
                        className="w-full text-left px-3 py-1.5 hover:bg-surface0 border-b border-surface0/50 last:border-0"
                        title={`Resume ${s.sessionId}`}
                      >
                        <div className="text-xs text-text truncate">{s.title || s.sessionId.slice(0, 8)}</div>
                        <div className="text-[10px] text-overlay0">{relTime(s.mtime)} · {s.messages} msgs</div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {session.pendingBashContext && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-peach/80"
              title="Output from your !commands will be sent to Claude as context with your next message"
            >
              <Terminal size={10} /> shell context attached
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {session.loading && (
              <span className="text-[10px] text-overlay0/60 tabular-nums">Esc to stop</span>
            )}
            {ctxTokens > 0 && (
              <div
                className="flex items-center gap-1.5"
                title={`Context used: ${ctxTokens.toLocaleString()} / ${ctxWindow.toLocaleString()} tokens (${Math.round(ctxPct * 100)}%)`}
              >
                <span className="text-[10px] text-overlay0/70 tabular-nums">{fmtTokens(ctxTokens)} / {fmtTokens(ctxWindow)}</span>
                <div className="w-12 h-1 rounded-full bg-surface1 overflow-hidden">
                  <div className={`h-full ${ctxColor} transition-all`} style={{ width: `${Math.max(2, ctxPct * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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
