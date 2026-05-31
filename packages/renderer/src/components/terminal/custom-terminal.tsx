"use client";

/**
 * Custom terminal component (Phase 2) — grid-backed renderer.
 *
 * Wrapped in CustomTerminalErrorBoundary so a render-time throw is shown
 * inline instead of unmounting the entire popup.
 *
 * Pipeline:
 *   genie:terminal:data → VtParser.feed() → Grid (rows×cols cell model)
 *   Grid snapshot       → React render (RAF-throttled, per-row memoised,
 *                         viewport-virtualised)
 *   key/mouse/paste     → encode (modes-aware) → wsSend("terminal:data", ...)
 *   DA/DSR queries      → Grid responder → wsSend("terminal:data", ...)
 *   container resize    → grid.resize + wsSend("terminal:resize", ...)
 *
 * Models a true screen grid with absolute cursor, alt-screen, scroll regions,
 * device reports and resize — so full TUIs (Claude Code, vim, htop) render
 * correctly.
 */

import { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { wsSend } from "@/lib/ws";
import { VtParser } from "@/lib/custom-term/vt-parser";
import {
  Grid,
  isRgb,
  rgbParts,
  COLOR_DEFAULT,
  type CellAttrs,
  type Cell,
  type Row,
  type GridSnapshot,
} from "@/lib/custom-term/grid";
import { encodeKey, encodePaste, encodeFocus, encodeMouse, type MouseEventType } from "@/lib/custom-term/input";

// Catppuccin Mocha palette — matches the xterm theme. ANSI 0-7 + bright 8-15.
const PALETTE_16: readonly string[] = [
  "#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#cba6f7", "#94e2d5", "#bac2de",
  "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#cba6f7", "#94e2d5", "#a6adc8",
];

const DEFAULT_FG = "#cdd6f4";
const DEFAULT_BG = "transparent";
const PAD = 4; // matches the p-1 (0.25rem) padding on the scroll container
const OVERSCAN = 8; // extra rows rendered above/below the viewport

function color(c: number, fallback: string): string {
  if (c === COLOR_DEFAULT) return fallback;
  if (isRgb(c)) {
    const { r, g, b } = rgbParts(c);
    return `rgb(${r},${g},${b})`;
  }
  if (c >= 0 && c < PALETTE_16.length) return PALETTE_16[c];
  if (c >= 16 && c < 232) {
    const n = c - 16;
    const r = Math.floor(n / 36) % 6, g = Math.floor(n / 6) % 6, b = n % 6;
    const f = (x: number) => (x === 0 ? 0 : 55 + x * 40);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  if (c >= 232 && c <= 255) {
    const v = 8 + (c - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  return fallback;
}

function attrsToStyle(a: CellAttrs): React.CSSProperties {
  const fg = color(a.fg, DEFAULT_FG);
  const bg = color(a.bg, DEFAULT_BG);
  const s: React.CSSProperties = {
    color: a.inverse ? bg : fg,
    backgroundColor: a.inverse ? fg : bg,
  };
  if (a.bold) s.fontWeight = 700;
  if (a.dim) s.opacity = 0.6;
  if (a.italic) s.fontStyle = "italic";
  if (a.hidden) s.visibility = "hidden";
  const deco: string[] = [];
  if (a.underline) deco.push("underline");
  if (a.strike) deco.push("line-through");
  if (deco.length) s.textDecoration = deco.join(" ");
  return s;
}

function attrsEqual(a: CellAttrs, b: CellAttrs): boolean {
  return (
    a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.dim === b.dim &&
    a.italic === b.italic && a.underline === b.underline && a.inverse === b.inverse &&
    a.strike === b.strike && a.hidden === b.hidden && a.blink === b.blink
  );
}

interface RowSegment {
  text: string;
  attrs: CellAttrs;
  link?: string;
}

function buildSegments(cells: Cell[]): RowSegment[] {
  const segs: RowSegment[] = [];
  for (const cell of cells) {
    if (cell.width === 0) continue;
    const ch = cell.char === "" ? " " : cell.char;
    const last = segs[segs.length - 1];
    if (last && last.link === cell.link && attrsEqual(last.attrs, cell.attrs)) last.text += ch;
    else segs.push({ text: ch, attrs: cell.attrs, link: cell.link });
  }
  return segs;
}

interface Props {
  sessionId: string;
}

export function CustomTerminal(props: Props) {
  return (
    <CustomTerminalErrorBoundary>
      <CustomTerminalInner {...props} />
    </CustomTerminalErrorBoundary>
  );
}

function CustomTerminalInner({ sessionId }: Props) {
  const grid = useMemo(
    () => new Grid(80, 24, { respond: (s) => wsSend("terminal:data", { id: sessionId, data: s }) }),
    [sessionId]
  );
  const parser = useMemo(() => new VtParser(grid), [grid]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastRenderedVersion = useRef(-1);
  const [snapshot, setSnapshot] = useState<GridSnapshot>(() => grid.getSnapshot());
  const [metrics, setMetrics] = useState({ cw: 6.6, ch: 14.85 });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  // ── data + render loop ─────────────────────────────────────────────────────
  useEffect(() => {
    const onData = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; data: string };
      if (detail.id !== sessionId) return;
      parser.feed(detail.data);
    };
    const onScrollback = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sessionId: string; scrollback: string };
      if (detail.sessionId !== sessionId) return;
      // Historical bytes — don't let embedded DA/DSR queries trigger live
      // replies into the running program's stdin.
      grid.beginReplay();
      parser.feed(detail.scrollback);
      grid.endReplay();
    };
    window.addEventListener("genie:terminal:data", onData);
    window.addEventListener("genie:terminal:scrollback", onScrollback);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = grid.getSnapshot().version;
      if (v !== lastRenderedVersion.current) {
        lastRenderedVersion.current = v;
        setSnapshot(grid.getSnapshot());
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("genie:terminal:data", onData);
      window.removeEventListener("genie:terminal:scrollback", onScrollback);
      cancelAnimationFrame(raf);
    };
  }, [sessionId, grid, parser]);

  // ── cell metrics + resize (M3) ─────────────────────────────────────────────
  useLayoutEffect(() => {
    const measure = () => {
      const el = measureRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cw = r.width / 10;
      const ch = r.height;
      if (cw > 0 && ch > 0) setMetrics((m) => (Math.abs(m.cw - cw) > 0.01 || Math.abs(m.ch - ch) > 0.01 ? { cw, ch } : m));
    };
    measure();
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const recompute = () => {
      const w = el.clientWidth - PAD * 2;
      const h = el.clientHeight - PAD * 2;
      setViewportH(el.clientHeight);
      const cols = Math.max(1, Math.floor(w / metrics.cw));
      const rows = Math.max(1, Math.floor(h / metrics.ch));
      if (cols !== grid.cols || rows !== grid.rows) {
        grid.resize(cols, rows);
        wsSend("terminal:resize", { id: sessionId, cols, rows });
        setSnapshot(grid.getSnapshot());
      }
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sessionId, grid, metrics]);

  // ── auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < metrics.ch * 2;
    if (nearBottom || snapshot.altScreen) {
      el.scrollTop = el.scrollHeight;
      setScrollTop(el.scrollTop);
    }
  }, [snapshot, metrics.ch]);

  // ── focus ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
    let didFocus = false;
    const onFirstData = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string };
      if (detail.id !== sessionId || didFocus) return;
      didFocus = true;
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("genie:terminal:data", onFirstData);
    return () => window.removeEventListener("genie:terminal:data", onFirstData);
  }, [sessionId]);

  // ── input handlers (M4) ─────────────────────────────────────────────────────
  const send = useCallback((data: string) => wsSend("terminal:data", { id: sessionId, data }), [sessionId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // IME composition: let the browser compose and emit via beforeInput below.
    if (e.nativeEvent.isComposing || e.key === "Process") return;

    const encoded = encodeKey(
      { key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey },
      grid.modes
    );
    if (encoded !== null) {
      e.preventDefault();
      e.stopPropagation();
      send(encoded);
      return;
    }
    // Printable single character (letters, digits, punctuation AND space).
    // Handled here in keydown — not beforeInput — so space can't be swallowed
    // by an ancestor's keydown handler, and so app-level shortcuts don't fire
    // while the terminal is focused.
    if (!e.ctrlKey && !e.metaKey && e.key.length === 1) {
      e.preventDefault();
      e.stopPropagation();
      send(e.key);
    }
  }

  function handleBeforeInput(e: React.FormEvent<HTMLTextAreaElement>) {
    // Only fires for input not already handled in keydown — i.e. IME
    // composition results, dictation, autocomplete. Normal keys (incl. space)
    // are sent from handleKeyDown, which preventDefaults and blocks this.
    const ne = e.nativeEvent as InputEvent;
    if (ne.data) {
      e.preventDefault();
      send(ne.data);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const txt = e.clipboardData.getData("text/plain");
    if (txt) {
      e.preventDefault();
      send(encodePaste(txt, grid.modes));
    }
  }

  const onFocus = useCallback(() => {
    const s = encodeFocus(true, grid.modes);
    if (s) send(s);
  }, [grid, send]);
  const onBlur = useCallback(() => {
    const s = encodeFocus(false, grid.modes);
    if (s) send(s);
  }, [grid, send]);

  // Map a pointer event to 1-based viewport cell coordinates.
  const cellAt = useCallback(
    (e: React.PointerEvent | React.WheelEvent): { col: number; row: number } | null => {
      const el = scrollRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - PAD;
      const y = e.clientY - rect.top - PAD + el.scrollTop;
      const absRow = Math.floor(y / metrics.ch);
      const viewRow = absRow - snapshot.scrollbackLen;
      const col = Math.floor(x / metrics.cw) + 1;
      if (viewRow < 0) return null;
      return { col: Math.max(1, Math.min(grid.cols, col)), row: Math.max(1, Math.min(grid.rows, viewRow + 1)) };
    },
    [metrics, snapshot.scrollbackLen, grid]
  );

  const mouse = useCallback(
    (type: MouseEventType, button: number, e: React.PointerEvent | React.WheelEvent) => {
      if (grid.modes.mouse === "off") return false;
      const c = cellAt(e);
      if (!c) return false;
      const seq = encodeMouse(
        { type, button, col: c.col, row: c.row, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey },
        grid.modes
      );
      if (seq) {
        send(seq);
        return true;
      }
      return false;
    },
    [grid, cellAt, send]
  );

  function handlePointerDown(e: React.PointerEvent) {
    inputRef.current?.focus();
    if (mouse("down", e.button, e)) e.preventDefault();
  }
  function handlePointerUp(e: React.PointerEvent) {
    if (mouse("up", e.button, e)) e.preventDefault();
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (grid.modes.mouse === "drag" || grid.modes.mouse === "any") {
      const btn = e.buttons === 0 ? 3 : e.button;
      mouse("move", btn, e);
    }
  }
  function handleWheel(e: React.WheelEvent) {
    if (snapshot.altScreen && grid.modes.mouse !== "off") {
      mouse("wheel", e.deltaY < 0 ? 0 : 1, e);
    }
  }

  // ── virtualization (M6) ─────────────────────────────────────────────────────
  const { lines, cursor } = snapshot;
  const total = lines.length;
  const ch = metrics.ch;
  const first = Math.max(0, Math.floor(scrollTop / ch) - OVERSCAN);
  const visibleCount = Math.ceil(viewportH / ch) + OVERSCAN * 2;
  const last = Math.min(total, first + visibleCount);
  const topPad = first * ch;
  const bottomPad = Math.max(0, (total - last) * ch);

  const visible = [];
  for (let i = first; i < last; i++) {
    visible.push(
      <LineRow
        key={i}
        row={lines[i]}
        version={lines[i].version}
        rowHeight={ch}
        isCursor={cursor.visible && i === cursor.row}
        cursorCol={cursor.col}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-overlay0 bg-mantle border-b border-surface0 shrink-0 flex items-center gap-2">
        <span>Custom term (phase 2)</span>
        <span className="text-overlay1">{snapshot.cols}×{snapshot.rows}</span>
        {snapshot.altScreen && <span className="text-peach">alt</span>}
        {grid.title && <span className="text-mauve truncate flex-1 min-w-0">{grid.title}</span>}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-crust p-1 font-mono text-[11px] leading-[1.35] cursor-text select-text"
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onWheel={handleWheel}
      >
        {/* Hidden metric probe — 10 chars wide, one line tall. */}
        <span
          ref={measureRef}
          aria-hidden
          style={{ position: "absolute", visibility: "hidden", whiteSpace: "pre" }}
        >
          0000000000
        </span>
        <div style={{ height: topPad }} />
        {visible}
        <div style={{ height: bottomPad }} />
        <textarea
          ref={inputRef}
          onKeyDown={handleKeyDown}
          onBeforeInput={handleBeforeInput}
          onPaste={handlePaste}
          onFocus={onFocus}
          onBlur={onBlur}
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

const LineRow = memo(
  function LineRow({
    row,
    rowHeight,
    isCursor,
    cursorCol,
  }: {
    row: Row;
    version: number;
    rowHeight: number;
    isCursor: boolean;
    cursorCol: number;
  }) {
    const segs = buildSegments(row.cells);
    return (
      <div className="whitespace-pre" style={{ position: "relative", height: rowHeight }}>
        {segs.map((seg, i) =>
          seg.link ? (
            <a
              key={i}
              href={seg.link}
              target="_blank"
              rel="noreferrer noopener"
              title={seg.link}
              style={{ ...attrsToStyle(seg.attrs), textDecoration: "underline", cursor: "pointer" }}
            >
              {seg.text}
            </a>
          ) : (
            <span key={i} style={attrsToStyle(seg.attrs)}>{seg.text}</span>
          )
        )}
        {isCursor && (
          <span
            style={{
              position: "absolute",
              left: `${cursorCol}ch`,
              top: 0,
              width: "1ch",
              height: "1.2em",
              background: DEFAULT_FG,
              opacity: 0.45,
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.version === next.version &&
    prev.rowHeight === next.rowHeight &&
    prev.isCursor === next.isCursor &&
    (!next.isCursor || prev.cursorCol === next.cursorCol)
);

class CustomTerminalErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error("[custom-term] render crashed", { error, stack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col bg-crust p-2 text-[10px] font-mono">
          <div className="text-red font-bold mb-1">custom terminal crashed</div>
          <div className="text-text break-all select-text">{this.state.error.message}</div>
          <div className="text-overlay0 mt-2">
            The popup itself is fine — the bug is in the custom renderer. Toggle off via the
            bug button and try xterm, or check the WS log column for what we choked on.
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 px-2 py-1 self-start rounded border border-surface0 text-md text-overlay1 hover:text-text hover:bg-surface0"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
