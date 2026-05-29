"use client";

/**
 * Custom terminal component — alternative to xterm in the diagnostic split.
 *
 * Phase 1: linear scrollback only. The companion VtParser + TerminalBuffer
 * (in @/lib/custom-term/*) handle the ANSI parsing and styled-segment
 * state; this component pipes events between the WS data stream, the
 * buffer, and the DOM, plus forwards keyboard input back to the PTY.
 *
 *   genie:terminal:data → parser.feed() → events → buffer.apply()
 *   buffer snapshot     → React render (RAF-throttled, version-skip)
 *   keydown             → encode → wsSend("terminal:data", ...)
 *
 * No alt screen, no scroll regions, no mouse — TUIs that depend on those
 * will look broken. Streaming chat-style output (Claude in non-tmux mode)
 * is the well-supported case in this phase.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { wsSend } from "@/lib/ws";
import { VtParser, type VtEvent } from "@/lib/custom-term/vt-parser";
import { TerminalBuffer, type CellAttrs, type LineView, type Segment } from "@/lib/custom-term/buffer";

// Catppuccin Mocha palette — must match the xterm theme so a side-by-side
// comparison looks consistent. ANSI 0-7 + bright 8-15.
const PALETTE_16: readonly string[] = [
  "#45475a", // 0  black
  "#f38ba8", // 1  red
  "#a6e3a1", // 2  green
  "#f9e2af", // 3  yellow
  "#89b4fa", // 4  blue
  "#cba6f7", // 5  magenta
  "#94e2d5", // 6  cyan
  "#bac2de", // 7  white
  "#585b70", // 8  bright black
  "#f38ba8", // 9  bright red
  "#a6e3a1", // 10 bright green
  "#f9e2af", // 11 bright yellow
  "#89b4fa", // 12 bright blue
  "#cba6f7", // 13 bright magenta
  "#94e2d5", // 14 bright cyan
  "#a6adc8", // 15 bright white
];

const DEFAULT_FG = "#cdd6f4";
const DEFAULT_BG = "transparent"; // popup background shows through

function paletteColor(idx: number | null, fallback: string): string {
  if (idx === null) return fallback;
  if (idx >= 0 && idx < PALETTE_16.length) return PALETTE_16[idx];
  // 256-colour cube + greyscale (xterm extended palette).
  if (idx >= 16 && idx < 232) {
    const n = idx - 16;
    const r = Math.floor(n / 36) % 6, g = Math.floor(n / 6) % 6, b = n % 6;
    const f = (c: number) => (c === 0 ? 0 : 55 + c * 40);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  if (idx >= 232 && idx <= 255) {
    const v = 8 + (idx - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  return fallback;
}

function attrsToStyle(a: CellAttrs): React.CSSProperties {
  const fg = paletteColor(a.fg, DEFAULT_FG);
  const bg = paletteColor(a.bg, DEFAULT_BG);
  const s: React.CSSProperties = {
    color: a.inverse ? bg : fg,
    backgroundColor: a.inverse ? fg : bg,
  };
  if (a.bold) s.fontWeight = 700;
  if (a.dim) s.opacity = 0.6;
  if (a.italic) s.fontStyle = "italic";
  if (a.underline) s.textDecoration = "underline";
  return s;
}

/** Encode a keydown event to the bytes a normal terminal would expect. */
function encodeKey(e: React.KeyboardEvent<HTMLTextAreaElement>): string | null {
  const k = e.key;
  // Printable single-char keys: let the textarea's input handler catch them
  // (we keep input controlled via onBeforeInput below). This handler is for
  // control keys + modifiers only.
  switch (k) {
    case "Enter":      return "\r";
    case "Backspace":  return "\x7f";   // DEL is what most shells expect; \b is also common
    case "Tab":        return "\t";
    case "Escape":     return "\x1b";
    case "ArrowUp":    return "\x1b[A";
    case "ArrowDown":  return "\x1b[B";
    case "ArrowRight": return "\x1b[C";
    case "ArrowLeft":  return "\x1b[D";
    case "Home":       return "\x1b[H";
    case "End":        return "\x1b[F";
    case "PageUp":     return "\x1b[5~";
    case "PageDown":   return "\x1b[6~";
    case "Delete":     return "\x1b[3~";
  }
  // Ctrl + letter = control byte (A=1 .. Z=26).
  if (e.ctrlKey && !e.altKey && !e.metaKey && k.length === 1) {
    const lower = k.toLowerCase();
    const code = lower.charCodeAt(0);
    if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code - 0x60);
    if (k === "[") return "\x1b";
    if (k === "\\") return "\x1c";
    if (k === "]") return "\x1d";
    if (k === " ") return "\x00";
  }
  return null;
}

interface Props {
  sessionId: string;
}

export function CustomTerminal({ sessionId }: Props) {
  const buffer = useMemo(() => new TerminalBuffer(), []);
  const parser = useMemo(() => new VtParser(), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastRenderedVersion = useRef(-1);
  const [snapshot, setSnapshot] = useState(() => buffer.getSnapshot());

  useEffect(() => {
    const onData = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; data: string };
      if (detail.id !== sessionId) return;
      parser.feed(detail.data, (ev: VtEvent) => applyEvent(buffer, ev));
    };
    window.addEventListener("genie:terminal:data", onData);
    // RAF render loop — only commits to React when buffer.version moved.
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = (buffer as unknown as { version?: number }).version;
      if (v !== lastRenderedVersion.current) {
        lastRenderedVersion.current = v ?? 0;
        setSnapshot(buffer.getSnapshot());
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("genie:terminal:data", onData);
      cancelAnimationFrame(raf);
    };
  }, [sessionId, buffer, parser]);

  // Auto-scroll to bottom on snapshot update. The scrollRef element holds the
  // rendered lines; reading scrollHeight forces layout, which is fine — we
  // only do it once per RAF render at most.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snapshot.version]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const encoded = encodeKey(e);
    if (encoded !== null) {
      e.preventDefault();
      wsSend("terminal:data", { id: sessionId, data: encoded });
    }
    // Printable characters fall through to the textarea; we capture them in
    // onBeforeInput below so the textarea's own value never accumulates.
  }

  function handleBeforeInput(e: React.FormEvent<HTMLTextAreaElement>) {
    const ne = e.nativeEvent as InputEvent;
    if (ne.data) {
      e.preventDefault();
      wsSend("terminal:data", { id: sessionId, data: ne.data });
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const txt = e.clipboardData.getData("text/plain");
    if (txt) {
      e.preventDefault();
      wsSend("terminal:data", { id: sessionId, data: txt });
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-overlay0 bg-mantle border-b border-surface0 shrink-0 flex items-center gap-2">
        <span>Custom term (phase 1)</span>
        {snapshot.lines.length > 1 && <span className="text-overlay1">{snapshot.lines.length} lines</span>}
        {buffer.title && <span className="text-mauve truncate flex-1 min-w-0">{buffer.title}</span>}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-crust p-1 font-mono text-[11px] leading-[1.35] cursor-text select-text"
        onClick={() => inputRef.current?.focus()}
      >
        {snapshot.lines.map((line, i) => (
          <LineRow key={i} line={line} isCursor={i === snapshot.cursor.line} cursorCol={snapshot.cursor.col} />
        ))}
        {/* Hidden input — focus target for keyboard. Always present so
            tabbing into the pane works. */}
        <textarea
          ref={inputRef}
          onKeyDown={handleKeyDown}
          onBeforeInput={handleBeforeInput}
          onPaste={handlePaste}
          aria-label="Custom terminal input"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}

function LineRow({ line, isCursor, cursorCol }: { line: LineView; isCursor: boolean; cursorCol: number }) {
  // Render segments inline. For the cursor line, draw a thin block at the
  // cursor column on top of whatever is there.
  return (
    <div className="whitespace-pre" style={{ position: "relative" }}>
      {line.segments.length === 0 && !isCursor ? " " : null}
      {line.segments.map((seg, i) => (
        <span key={i} style={attrsToStyle(seg.attrs)}>{seg.text}</span>
      ))}
      {isCursor && (
        <span
          style={{
            position: "absolute",
            left: `${cursorCol}ch`,
            top: 0,
            width: "1ch",
            height: "1em",
            background: DEFAULT_FG,
            opacity: 0.45,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

/** Map parser events to buffer mutations. Centralised here so the buffer
 *  and parser stay decoupled. */
function applyEvent(buf: TerminalBuffer, e: VtEvent): void {
  switch (e.type) {
    case "print":         buf.print(e.ch); return;
    case "bs":            buf.bs(); return;
    case "cr":            buf.cr(); return;
    case "lf":            buf.lf(); return;
    case "tab":           buf.tab(); return;
    case "bell":          /* silent — no audio on purpose */ return;
    case "sgr":           buf.applySgr(e.codes); return;
    case "cursor-pos":    buf.cursorPos(e.row, e.col); return;
    case "cursor-move":   buf.cursorMove(e.dRow, e.dCol); return;
    case "erase-line":    buf.eraseLine(e.mode); return;
    case "erase-display": buf.eraseDisplay(e.mode); return;
    case "set-title":     buf.setTitle(e.title); return;
    case "unknown":       /* skip silently */ return;
  }
}

// Marker to ensure tree-shaking keeps the Segment type referenced.
export type { Segment };
