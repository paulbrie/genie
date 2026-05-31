/**
 * Grid-based screen model for the custom terminal renderer (Phase 2).
 *
 * Replaces the Phase-1 line-oriented buffer with a true `rows × cols` cell
 * grid and an absolute cursor — the model a real TUI (Claude Code, vim,
 * htop) needs. Implements the {@link Terminal} performer interface that the
 * VtParser drives.
 *
 * Layout:
 *   - The active screen is exactly `rows` Row objects (the viewport).
 *   - The primary buffer additionally keeps a `scrollback` ring of rows that
 *     scrolled off the top. The alternate buffer has no scrollback.
 *   - Cursor row/col are 0-based and index the viewport directly.
 *   - A scroll region (DECSTBM) constrains scrolling / index / insert-delete
 *     to rows [scrollTop, scrollBottom] (0-based, inclusive).
 *
 * Colours are packed into a single number per channel:
 *   -1                = default
 *   0..255            = palette index (16 ANSI + 216 cube + 24 grey)
 *   >= RGB_FLAG       = 24-bit true colour (lower 24 bits = r<<16|g<<8|b)
 */

import type { Terminal } from "./terminal";

// ── colour ──────────────────────────────────────────────────────────────────

export const COLOR_DEFAULT = -1;
const RGB_FLAG = 1 << 24;

export function rgbColor(r: number, g: number, b: number): number {
  return RGB_FLAG | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}
export function isRgb(c: number): boolean {
  return c >= RGB_FLAG;
}
export function rgbParts(c: number): { r: number; g: number; b: number } {
  return { r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff };
}

// ── attributes & cells ───────────────────────────────────────────────────────

export interface CellAttrs {
  fg: number; // COLOR_DEFAULT | 0..255 | rgb
  bg: number;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strike: boolean;
  hidden: boolean;
  blink: boolean;
}

export const DEFAULT_ATTRS: CellAttrs = Object.freeze({
  fg: COLOR_DEFAULT,
  bg: COLOR_DEFAULT,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strike: false,
  hidden: false,
  blink: false,
});

export interface Cell {
  char: string; // grapheme; "" marks the right half of a wide (2-col) char
  attrs: CellAttrs;
  width: 0 | 1 | 2; // 0 = continuation (right half), 2 = wide left half
  link?: string; // OSC 8 hyperlink target, if any
}

// A single shared blank with default attrs — never mutated.
const BLANK: Cell = Object.freeze({ char: " ", attrs: DEFAULT_ATTRS, width: 1 });

function blankCell(attrs: CellAttrs): Cell {
  // Erased cells keep the current background (bce — background colour erase)
  // but otherwise reset; matches xterm behaviour apps rely on.
  if (attrs.bg === COLOR_DEFAULT) return BLANK;
  return { char: " ", attrs: { ...DEFAULT_ATTRS, bg: attrs.bg }, width: 1 };
}

// ── rows ─────────────────────────────────────────────────────────────────────

export class Row {
  cells: Cell[];
  version = 0;
  /** True when this row soft-wrapped into the next (used by reflow). */
  wrapped = false;

  constructor(cols: number) {
    this.cells = new Array(cols).fill(BLANK);
  }

  touch(): void {
    this.version++;
  }

  resize(cols: number): void {
    if (cols === this.cells.length) return;
    if (cols < this.cells.length) {
      this.cells.length = cols;
    } else {
      while (this.cells.length < cols) this.cells.push(BLANK);
    }
    this.touch();
  }
}

function makeRows(count: number, cols: number): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < count; i++) out.push(new Row(cols));
  return out;
}

// ── snapshot (read-only view for the renderer) ───────────────────────────────

export interface GridSnapshot {
  /** scrollback rows followed by the viewport rows. */
  lines: Row[];
  cols: number;
  rows: number;
  /** Cursor position in absolute (scrollback-included) coordinates. */
  cursor: { row: number; col: number; visible: boolean };
  scrollbackLen: number;
  version: number;
  title: string;
  altScreen: boolean;
}

// ── the grid ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_SCROLLBACK = 5000;

interface Charsets {
  g0: "ascii" | "dec-special";
  g1: "ascii" | "dec-special";
  active: 0 | 1;
}

export type MouseMode = "off" | "button" | "drag" | "any";

/** Input-relevant terminal modes the renderer's input layer reads. */
export interface TermModes {
  appCursorKeys: boolean; // DECCKM (?1) — arrows send SS3 O.. not CSI [..
  appKeypad: boolean; // DECKPAM
  bracketedPaste: boolean; // ?2004
  mouse: MouseMode; // ?1000 / ?1002 / ?1003
  mouseSgr: boolean; // ?1006 — SGR-encoded mouse reports
  focusEvents: boolean; // ?1004
}

function defaultModes(): TermModes {
  return {
    appCursorKeys: false,
    appKeypad: false,
    bracketedPaste: false,
    mouse: "off",
    mouseSgr: false,
    focusEvents: false,
  };
}

export class Grid implements Terminal {
  cols: number;
  rows: number;

  // Primary screen.
  private primary: Row[];
  private scrollback: Row[] = [];
  // Alternate screen.
  private alt: Row[];
  private onAlt = false;

  private cursorRow = 0;
  private cursorCol = 0;
  private cursorVisible = true;
  private pendingWrap = false; // DEC autowrap: cursor parked past last col

  private saved = { row: 0, col: 0, attrs: DEFAULT_ATTRS, charsets: null as Charsets | null };

  private scrollTop = 0; // region top (0-based, inclusive)
  private scrollBottom: number; // region bottom (0-based, inclusive)

  private pen: CellAttrs = DEFAULT_ATTRS;
  private autowrap = true;
  private titleStr = "";

  private charsets: Charsets = { g0: "ascii", g1: "ascii", active: 0 };

  private termModes: TermModes = defaultModes();

  private currentLink: string | undefined;
  /** Shell-integration (OSC 133) marks, keyed by absolute row index. */
  private shellMarks: { row: number; type: "prompt" | "command" | "output" }[] = [];

  private maxScrollback: number;
  private version = 0;

  private respond?: (s: string) => void;
  private suppressResponses = false;

  constructor(cols = 80, rows = 24, opts?: { maxScrollback?: number; respond?: (s: string) => void }) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.scrollBottom = this.rows - 1;
    this.maxScrollback = opts?.maxScrollback ?? DEFAULT_MAX_SCROLLBACK;
    this.respond = opts?.respond;
    this.primary = makeRows(this.rows, this.cols);
    this.alt = makeRows(this.rows, this.cols);
  }

  setResponder(fn: (s: string) => void): void {
    this.respond = fn;
  }

  /**
   * Feeding replayed scrollback (historical output) must not generate live
   * device replies — the queries embedded in that history were already
   * answered in the past, and re-answering injects junk (e.g. the DA reply
   * `ESC[?1;2c`) into the running program's stdin. Wrap a replay feed in
   * begin/endReplay so DA/DSR stay silent.
   */
  beginReplay(): void {
    this.suppressResponses = true;
  }
  endReplay(): void {
    this.suppressResponses = false;
  }

  get title(): string {
    return this.titleStr;
  }

  /** Snapshot of input-relevant modes (read by the component's input layer). */
  get modes(): TermModes {
    return { ...this.termModes };
  }

  // ── internal helpers ───────────────────────────────────────────────────────

  private get lines(): Row[] {
    return this.onAlt ? this.alt : this.primary;
  }

  private bump(): void {
    this.version++;
  }

  private row(r: number): Row {
    return this.lines[r];
  }

  private clampCursor(): void {
    if (this.cursorRow < 0) this.cursorRow = 0;
    if (this.cursorRow > this.rows - 1) this.cursorRow = this.rows - 1;
    if (this.cursorCol < 0) this.cursorCol = 0;
    if (this.cursorCol > this.cols - 1) this.cursorCol = this.cols - 1;
  }

  /** Scroll the region up by n rows (content moves up, blanks at bottom).
   *  Full-screen region on the primary buffer feeds the scrollback. */
  private scrollRegionUp(n: number): void {
    const top = this.scrollTop;
    const bottom = this.scrollBottom;
    const fullScreen = top === 0 && bottom === this.rows - 1;
    for (let k = 0; k < n; k++) {
      if (fullScreen && !this.onAlt) {
        const removed = this.lines.shift()!;
        this.scrollback.push(removed);
        if (this.scrollback.length > this.maxScrollback) this.scrollback.shift();
        this.lines.push(this.makeBlankRow());
      } else {
        this.lines.splice(top, 1);
        this.lines.splice(bottom, 0, this.makeBlankRow());
      }
    }
    this.bump();
  }

  /** Scroll the region down by n rows (content moves down, blanks at top). */
  private scrollRegionDown(n: number): void {
    const top = this.scrollTop;
    const bottom = this.scrollBottom;
    for (let k = 0; k < n; k++) {
      this.lines.splice(bottom, 1);
      this.lines.splice(top, 0, this.makeBlankRow());
    }
    this.bump();
  }

  private makeBlankRow(): Row {
    const r = new Row(this.cols);
    if (this.pen.bg !== COLOR_DEFAULT) {
      const c = blankCell(this.pen);
      r.cells.fill(c);
    }
    return r;
  }

  private fillRow(row: Row, from: number, to: number): void {
    const c = blankCell(this.pen);
    for (let i = from; i <= to && i < this.cols; i++) row.cells[i] = c;
    row.touch();
  }

  // ── Terminal: writing ────────────────────────────────────────────────────

  print(ch: string, width = 1): void {
    // Combining mark / zero-width: attach to the cell left of the cursor.
    if (width === 0) {
      const row = this.row(this.cursorRow);
      const target = this.cursorCol > 0 ? this.cursorCol - 1 : 0;
      const prev = row.cells[target];
      if (prev && prev.width !== 0) {
        row.cells[target] = { char: prev.char + ch, attrs: prev.attrs, width: prev.width };
        row.touch();
        this.bump();
      }
      return;
    }
    if (this.pendingWrap && this.autowrap) {
      this.row(this.cursorRow).wrapped = true;
      this.carriageReturn();
      this.lineFeedNoCR();
      this.pendingWrap = false;
    }
    // Wide char that won't fit on the current line: wrap first.
    if (width === 2 && this.cursorCol === this.cols - 1) {
      if (this.autowrap) {
        this.row(this.cursorRow).wrapped = true;
        this.carriageReturn();
        this.lineFeedNoCR();
      } else {
        // No room and no wrap — overwrite last cell as narrow.
        width = 1;
      }
    }

    const row = this.row(this.cursorRow);
    const mapped = this.mapChar(ch);
    row.cells[this.cursorCol] = { char: mapped, attrs: this.pen, width: width as 0 | 1 | 2, link: this.currentLink };
    if (width === 2) {
      if (this.cursorCol + 1 < this.cols) {
        row.cells[this.cursorCol + 1] = { char: "", attrs: this.pen, width: 0, link: this.currentLink };
      }
      this.advance(2);
    } else {
      this.advance(1);
    }
    row.touch();
    this.bump();
  }

  private advance(n: number): void {
    if (this.cursorCol + n > this.cols - 1) {
      // Park at last column; the next print triggers the wrap.
      this.cursorCol = this.cols - 1;
      this.pendingWrap = true;
    } else {
      this.cursorCol += n;
      this.pendingWrap = false;
    }
  }

  private mapChar(ch: string): string {
    const cs = this.charsets.active === 0 ? this.charsets.g0 : this.charsets.g1;
    if (cs === "dec-special") return DEC_SPECIAL[ch] ?? ch;
    return ch;
  }

  // ── Terminal: C0 controls ─────────────────────────────────────────────────

  bell(): void {
    /* intentionally silent */
  }

  backspace(): void {
    if (this.cursorCol > 0) this.cursorCol--;
    this.pendingWrap = false;
    this.bump();
  }

  tab(): void {
    // Next tab stop (every 8 columns), clamped to last column.
    const next = Math.min(this.cols - 1, Math.floor(this.cursorCol / 8 + 1) * 8);
    this.cursorCol = next;
    this.pendingWrap = false;
    this.bump();
  }

  carriageReturn(): void {
    this.cursorCol = 0;
    this.pendingWrap = false;
    this.bump();
  }

  /** LF / VT / FF: move down one row, scrolling the region if at the bottom. */
  lineFeed(): void {
    this.lineFeedNoCR();
  }

  private lineFeedNoCR(): void {
    if (this.cursorRow === this.scrollBottom) {
      this.scrollRegionUp(1);
    } else if (this.cursorRow < this.rows - 1) {
      this.cursorRow++;
    }
    this.pendingWrap = false;
    this.bump();
  }

  // ── Terminal: cursor movement ─────────────────────────────────────────────

  cursorUp(n = 1): void {
    this.cursorRow = Math.max(this.scrollTop, this.cursorRow - n);
    this.pendingWrap = false;
    this.bump();
  }
  cursorDown(n = 1): void {
    this.cursorRow = Math.min(this.scrollBottom, this.cursorRow + n);
    this.pendingWrap = false;
    this.bump();
  }
  cursorForward(n = 1): void {
    this.cursorCol = Math.min(this.cols - 1, this.cursorCol + n);
    this.pendingWrap = false;
    this.bump();
  }
  cursorBack(n = 1): void {
    this.cursorCol = Math.max(0, this.cursorCol - n);
    this.pendingWrap = false;
    this.bump();
  }
  cursorNextLine(n = 1): void {
    this.cursorDown(n);
    this.cursorCol = 0;
  }
  cursorPrevLine(n = 1): void {
    this.cursorUp(n);
    this.cursorCol = 0;
  }
  /** CHA / HPA — absolute column, 1-based. */
  cursorColumn(col: number): void {
    this.cursorCol = Math.max(0, Math.min(this.cols - 1, col - 1));
    this.pendingWrap = false;
    this.bump();
  }
  /** VPA — absolute row, 1-based. */
  cursorLine(row: number): void {
    this.cursorRow = Math.max(0, Math.min(this.rows - 1, row - 1));
    this.pendingWrap = false;
    this.bump();
  }
  /** CUP / HVP — absolute row & col, 1-based. */
  cursorPosition(row: number, col: number): void {
    this.cursorRow = Math.max(0, Math.min(this.rows - 1, row - 1));
    this.cursorCol = Math.max(0, Math.min(this.cols - 1, col - 1));
    this.pendingWrap = false;
    this.bump();
  }

  saveCursor(): void {
    this.saved = {
      row: this.cursorRow,
      col: this.cursorCol,
      attrs: this.pen,
      charsets: { ...this.charsets },
    };
  }
  restoreCursor(): void {
    this.cursorRow = Math.min(this.saved.row, this.rows - 1);
    this.cursorCol = Math.min(this.saved.col, this.cols - 1);
    this.pen = this.saved.attrs;
    if (this.saved.charsets) this.charsets = { ...this.saved.charsets };
    this.pendingWrap = false;
    this.bump();
  }

  setCursorVisible(v: boolean): void {
    this.cursorVisible = v;
    this.bump();
  }

  // ── Terminal: index / reverse-index ───────────────────────────────────────

  index(): void {
    // IND — like LF but no CR.
    this.lineFeedNoCR();
  }
  reverseIndex(): void {
    // RI — move up; scroll region down if at top.
    if (this.cursorRow === this.scrollTop) {
      this.scrollRegionDown(1);
    } else if (this.cursorRow > 0) {
      this.cursorRow--;
    }
    this.pendingWrap = false;
    this.bump();
  }
  nextLine(): void {
    // NEL — CR + LF.
    this.carriageReturn();
    this.lineFeedNoCR();
  }

  // ── Terminal: erase ────────────────────────────────────────────────────────

  /** ED — erase in display. 0: cursor→end, 1: start→cursor, 2: all, 3: all+scrollback. */
  eraseInDisplay(mode: number): void {
    if (mode === 0) {
      this.fillRow(this.row(this.cursorRow), this.cursorCol, this.cols - 1);
      for (let r = this.cursorRow + 1; r < this.rows; r++) this.fillRow(this.row(r), 0, this.cols - 1);
    } else if (mode === 1) {
      for (let r = 0; r < this.cursorRow; r++) this.fillRow(this.row(r), 0, this.cols - 1);
      this.fillRow(this.row(this.cursorRow), 0, this.cursorCol);
    } else if (mode === 2 || mode === 3) {
      for (let r = 0; r < this.rows; r++) this.fillRow(this.row(r), 0, this.cols - 1);
      if (mode === 3) this.scrollback = [];
    }
    this.pendingWrap = false;
    this.bump();
  }

  /** EL — erase in line. 0: cursor→end, 1: start→cursor, 2: whole line. */
  eraseInLine(mode: number): void {
    const row = this.row(this.cursorRow);
    if (mode === 0) this.fillRow(row, this.cursorCol, this.cols - 1);
    else if (mode === 1) this.fillRow(row, 0, this.cursorCol);
    else if (mode === 2) this.fillRow(row, 0, this.cols - 1);
    this.pendingWrap = false;
    this.bump();
  }

  /** ECH — erase n chars from cursor (no shift). */
  eraseChars(n: number): void {
    const row = this.row(this.cursorRow);
    this.fillRow(row, this.cursorCol, this.cursorCol + n - 1);
    this.bump();
  }

  // ── Terminal: insert / delete ──────────────────────────────────────────────

  /** ICH — insert n blanks at cursor, shifting the rest right. */
  insertChars(n: number): void {
    const row = this.row(this.cursorRow);
    const blank = blankCell(this.pen);
    for (let k = 0; k < n; k++) {
      row.cells.splice(this.cursorCol, 0, blank);
    }
    row.cells.length = this.cols;
    row.touch();
    this.bump();
  }

  /** DCH — delete n chars at cursor, shifting the rest left. */
  deleteChars(n: number): void {
    const row = this.row(this.cursorRow);
    const blank = blankCell(this.pen);
    row.cells.splice(this.cursorCol, n);
    while (row.cells.length < this.cols) row.cells.push(blank);
    row.touch();
    this.bump();
  }

  /** IL — insert n blank lines at cursor (within scroll region). */
  insertLines(n: number): void {
    if (this.cursorRow < this.scrollTop || this.cursorRow > this.scrollBottom) return;
    const count = Math.min(n, this.scrollBottom - this.cursorRow + 1);
    for (let k = 0; k < count; k++) {
      this.lines.splice(this.scrollBottom, 1);
      this.lines.splice(this.cursorRow, 0, this.makeBlankRow());
    }
    this.cursorCol = 0;
    this.bump();
  }

  /** DL — delete n lines at cursor (within scroll region). */
  deleteLines(n: number): void {
    if (this.cursorRow < this.scrollTop || this.cursorRow > this.scrollBottom) return;
    const count = Math.min(n, this.scrollBottom - this.cursorRow + 1);
    for (let k = 0; k < count; k++) {
      this.lines.splice(this.cursorRow, 1);
      this.lines.splice(this.scrollBottom, 0, this.makeBlankRow());
    }
    this.cursorCol = 0;
    this.bump();
  }

  /** SU — scroll the region up n lines. */
  scrollUp(n = 1): void {
    this.scrollRegionUp(n);
  }
  /** SD — scroll the region down n lines. */
  scrollDown(n = 1): void {
    this.scrollRegionDown(n);
  }

  // ── Terminal: scroll region ────────────────────────────────────────────────

  /** DECSTBM — set top/bottom margins (1-based). 0/0 resets to full screen. */
  setScrollRegion(top: number, bottom: number): void {
    const t = top > 0 ? top - 1 : 0;
    const b = bottom > 0 ? bottom - 1 : this.rows - 1;
    if (t < b && b < this.rows) {
      this.scrollTop = t;
      this.scrollBottom = b;
    } else {
      this.scrollTop = 0;
      this.scrollBottom = this.rows - 1;
    }
    // DECSTBM homes the cursor.
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.pendingWrap = false;
    this.bump();
  }

  // ── Terminal: SGR ──────────────────────────────────────────────────────────

  setAttributes(codes: number[]): void {
    const a: CellAttrs = { ...this.pen };
    if (codes.length === 0) codes = [0];
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      switch (c) {
        case 0: Object.assign(a, DEFAULT_ATTRS); break;
        case 1: a.bold = true; break;
        case 2: a.dim = true; break;
        case 3: a.italic = true; break;
        case 4: a.underline = true; break;
        case 5: case 6: a.blink = true; break;
        case 7: a.inverse = true; break;
        case 8: a.hidden = true; break;
        case 9: a.strike = true; break;
        case 22: a.bold = false; a.dim = false; break;
        case 23: a.italic = false; break;
        case 24: a.underline = false; break;
        case 25: a.blink = false; break;
        case 27: a.inverse = false; break;
        case 28: a.hidden = false; break;
        case 29: a.strike = false; break;
        case 39: a.fg = COLOR_DEFAULT; break;
        case 49: a.bg = COLOR_DEFAULT; break;
        default:
          if (c >= 30 && c <= 37) a.fg = c - 30;
          else if (c >= 90 && c <= 97) a.fg = c - 90 + 8;
          else if (c >= 40 && c <= 47) a.bg = c - 40;
          else if (c >= 100 && c <= 107) a.bg = c - 100 + 8;
          else if (c === 38) i = this.applyExtendedColor(codes, i, a, true);
          else if (c === 48) i = this.applyExtendedColor(codes, i, a, false);
          break;
      }
    }
    this.pen = a;
    this.bump();
  }

  /** Parse 38/48 extended colour (5;n palette or 2;r;g;b true colour).
   *  Returns the new index to continue from. */
  private applyExtendedColor(codes: number[], i: number, a: CellAttrs, fg: boolean): number {
    const mode = codes[i + 1];
    if (mode === 5) {
      const idx = codes[i + 2] ?? 0;
      if (fg) a.fg = idx; else a.bg = idx;
      return i + 2;
    }
    if (mode === 2) {
      const r = codes[i + 2] ?? 0, g = codes[i + 3] ?? 0, b = codes[i + 4] ?? 0;
      const col = rgbColor(r, g, b);
      if (fg) a.fg = col; else a.bg = col;
      return i + 4;
    }
    return i + 1;
  }

  // ── Terminal: modes ────────────────────────────────────────────────────────

  /** DEC private mode set/reset (CSI ? Pm h/l). */
  setPrivateMode(mode: number, on: boolean): void {
    switch (mode) {
      case 1: this.termModes.appCursorKeys = on; break; // DECCKM
      case 7: this.autowrap = on; break;
      case 25: this.setCursorVisible(on); break;
      case 47:
      case 1047:
        this.useAltScreen(on, false);
        break;
      case 1049:
        this.useAltScreen(on, true);
        break;
      case 2004: this.termModes.bracketedPaste = on; break;
      case 1000: this.termModes.mouse = on ? "button" : "off"; break;
      case 1002: this.termModes.mouse = on ? "drag" : "off"; break;
      case 1003: this.termModes.mouse = on ? "any" : "off"; break;
      case 1006: this.termModes.mouseSgr = on; break;
      case 1004: this.termModes.focusEvents = on; break;
      default:
        break;
    }
    this.bump();
  }

  setAppKeypad(on: boolean): void {
    this.termModes.appKeypad = on;
  }

  /** ANSI mode set/reset (CSI Pm h/l) — rarely needed; no-ops for now. */
  setMode(_mode: number, _on: boolean): void {
    /* IRM (4) etc. — not yet modelled */
  }

  private useAltScreen(on: boolean, withCursor: boolean): void {
    if (on && !this.onAlt) {
      if (withCursor) this.saveCursor();
      this.alt = makeRows(this.rows, this.cols);
      this.onAlt = true;
      this.scrollTop = 0;
      this.scrollBottom = this.rows - 1;
      if (withCursor) {
        this.cursorRow = 0;
        this.cursorCol = 0;
      }
    } else if (!on && this.onAlt) {
      this.onAlt = false;
      this.scrollTop = 0;
      this.scrollBottom = this.rows - 1;
      if (withCursor) this.restoreCursor();
    }
    this.pendingWrap = false;
  }

  // ── Terminal: charset ──────────────────────────────────────────────────────

  selectCharset(slot: "g0" | "g1", charset: "ascii" | "dec-special"): void {
    this.charsets[slot] = charset;
  }
  invokeCharset(which: 0 | 1): void {
    this.charsets.active = which;
  }

  // ── Terminal: OSC / misc ───────────────────────────────────────────────────

  setTitle(t: string): void {
    this.titleStr = t;
    this.bump();
  }

  /** OSC 8 — begin (url set) or end (url undefined) a hyperlink run. */
  setHyperlink(url: string | undefined): void {
    this.currentLink = url && url.length ? url : undefined;
  }

  /** OSC 133 — record a shell-integration mark at the cursor's row. */
  shellMark(type: "prompt" | "command" | "output"): void {
    const abs = (this.onAlt ? 0 : this.scrollback.length) + this.cursorRow;
    this.shellMarks.push({ row: abs, type });
    if (this.shellMarks.length > 1000) this.shellMarks.shift();
  }

  getShellMarks(): readonly { row: number; type: "prompt" | "command" | "output" }[] {
    return this.shellMarks;
  }

  /** RIS — full reset. */
  reset(): void {
    this.scrollback = [];
    this.primary = makeRows(this.rows, this.cols);
    this.alt = makeRows(this.rows, this.cols);
    this.onAlt = false;
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.cursorVisible = true;
    this.pendingWrap = false;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.pen = DEFAULT_ATTRS;
    this.autowrap = true;
    this.charsets = { g0: "ascii", g1: "ascii", active: 0 };
    this.titleStr = "";
    this.currentLink = undefined;
    this.shellMarks = [];
    this.termModes = defaultModes();
    this.bump();
  }

  // ── Terminal: reports ──────────────────────────────────────────────────────

  /** DA — primary device attributes. Claim a VT100 with Advanced Video. */
  deviceAttributes(): void {
    if (this.suppressResponses) return;
    this.respond?.("\x1b[?1;2c");
  }

  /** DSR — device status report. 5: ready, 6: cursor position. */
  deviceStatusReport(mode: number): void {
    if (this.suppressResponses) return;
    if (mode === 5) this.respond?.("\x1b[0n");
    else if (mode === 6) this.respond?.(`\x1b[${this.cursorRow + 1};${this.cursorCol + 1}R`);
  }

  // ── resize (M1: truncate/pad, no reflow yet — reflow lands in M3) ──────────

  resize(cols: number, rows: number): void {
    cols = Math.max(1, cols);
    rows = Math.max(1, rows);
    if (cols === this.cols && rows === this.rows) return;

    const widthChanged = cols !== this.cols;
    if (widthChanged) {
      // Reflow the primary buffer (rewrap soft-wrapped lines at the new width).
      this.reflowPrimary(cols, rows);
    } else {
      this.resizeBuffer(this.primary, this.scrollback, cols, rows, true);
    }
    // The alt buffer is repainted by the app — never reflowed.
    this.resizeBuffer(this.alt, [], cols, rows, false);

    this.cols = cols;
    this.rows = rows;
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    this.cursorRow = Math.min(this.cursorRow, rows - 1);
    this.cursorCol = Math.min(this.cursorCol, cols - 1);
    this.pendingWrap = false;
    this.bump();
  }

  /**
   * Rewrap the primary buffer (scrollback + viewport) to `newCols`, preserving
   * logical lines via the per-row `wrapped` flag. Cursor is re-anchored to the
   * row that previously held it (best effort).
   */
  private reflowPrimary(newCols: number, newRows: number): void {
    const all = [...this.scrollback, ...this.primary];
    const cursorAbs = this.scrollback.length + this.cursorRow;

    // 1. Collapse soft-wrapped rows into logical lines, remembering where the
    //    cursor sat so we can place it back afterwards.
    interface Logical { cells: Cell[]; cursorOffset: number | null }
    const logicals: Logical[] = [];
    let curCells: Cell[] = [];
    let curCursorOffset: number | null = null;
    for (let i = 0; i < all.length; i++) {
      const row = all[i];
      let cells = row.cells.slice(0, this.cols);
      if (!row.wrapped) cells = trimTrailingBlanks(cells);
      if (i === cursorAbs) curCursorOffset = curCells.length + Math.min(this.cursorCol, cells.length);
      curCells = curCells.concat(cells);
      if (!row.wrapped) {
        logicals.push({ cells: curCells, cursorOffset: curCursorOffset });
        curCells = [];
        curCursorOffset = null;
      }
    }
    if (curCells.length || curCursorOffset !== null) {
      logicals.push({ cells: curCells, cursorOffset: curCursorOffset });
    }

    // Trailing blank rows below the last content (and not holding the cursor)
    // are screen padding, not logical lines — drop them so they don't get
    // pushed into scrollback on reflow.
    let lastKeep = -1;
    for (let i = 0; i < logicals.length; i++) {
      if (logicals[i].cells.length > 0 || logicals[i].cursorOffset !== null) lastKeep = i;
    }
    logicals.length = lastKeep + 1;

    // 2. Re-wrap each logical line into rows of `newCols`.
    const out: Row[] = [];
    let newCursorAbs = 0;
    let newCursorCol = 0;
    for (const ll of logicals) {
      if (ll.cells.length === 0) {
        if (ll.cursorOffset !== null) { newCursorAbs = out.length; newCursorCol = 0; }
        out.push(new Row(newCols));
        continue;
      }
      let idx = 0;
      while (idx < ll.cells.length) {
        let take = Math.min(newCols, ll.cells.length - idx);
        // Don't split a wide char across the wrap boundary.
        if (take === newCols && ll.cells[idx + take - 1]?.width === 2) take -= 1;
        const chunk = ll.cells.slice(idx, idx + take);
        const r = new Row(newCols);
        for (let c = 0; c < chunk.length; c++) r.cells[c] = chunk[c];
        if (ll.cursorOffset !== null && ll.cursorOffset >= idx && ll.cursorOffset < idx + take) {
          newCursorAbs = out.length;
          newCursorCol = ll.cursorOffset - idx;
        }
        idx += take;
        r.wrapped = idx < ll.cells.length;
        out.push(r);
      }
    }

    // 3. Split into scrollback (all but the last newRows) + viewport.
    while (out.length < newRows) out.push(new Row(newCols));
    const viewStart = out.length - newRows;
    this.scrollback = out.slice(0, viewStart);
    while (this.scrollback.length > this.maxScrollback) this.scrollback.shift();
    this.primary = out.slice(viewStart);

    // 4. Re-anchor the cursor relative to the new viewport.
    this.cursorRow = Math.max(0, Math.min(newRows - 1, newCursorAbs - viewStart));
    this.cursorCol = Math.max(0, Math.min(newCols - 1, newCursorCol));
  }

  private resizeBuffer(buf: Row[], scrollback: Row[], cols: number, rows: number, isPrimary: boolean): void {
    for (const row of buf) row.resize(cols);
    if (isPrimary) for (const row of scrollback) row.resize(cols);

    if (rows < buf.length) {
      // Shrinking: push the top rows into scrollback (primary) or drop them.
      const overflow = buf.length - rows;
      const removed = buf.splice(0, overflow);
      if (isPrimary) {
        scrollback.push(...removed);
        while (scrollback.length > this.maxScrollback) scrollback.shift();
      }
    } else if (rows > buf.length) {
      // Growing: pull rows back from scrollback first (primary), then add blanks.
      let need = rows - buf.length;
      if (isPrimary) {
        while (need > 0 && scrollback.length > 0) {
          buf.unshift(scrollback.pop()!);
          need--;
        }
      }
      while (need > 0) {
        buf.push(new Row(cols));
        need--;
      }
    }
  }

  // ── snapshot ────────────────────────────────────────────────────────────────

  getSnapshot(): GridSnapshot {
    const lines = this.onAlt ? this.alt : [...this.scrollback, ...this.primary];
    const base = this.onAlt ? 0 : this.scrollback.length;
    return {
      lines,
      cols: this.cols,
      rows: this.rows,
      cursor: { row: base + this.cursorRow, col: this.cursorCol, visible: this.cursorVisible },
      scrollbackLen: this.onAlt ? 0 : this.scrollback.length,
      version: this.version,
      title: this.titleStr,
      altScreen: this.onAlt,
    };
  }

  /** Render the active viewport to a string — used by tests/snapshots. */
  toText(): string {
    const out: string[] = [];
    for (const row of this.lines) {
      let s = "";
      for (const cell of row.cells) {
        if (cell.width === 0) continue;
        s += cell.char || " ";
      }
      out.push(s.replace(/\s+$/, ""));
    }
    return out.join("\n").replace(/\n+$/, "");
  }
}

/** Drop trailing default-blank cells (used when collapsing logical lines). */
function trimTrailingBlanks(cells: Cell[]): Cell[] {
  let end = cells.length;
  while (end > 0) {
    const c = cells[end - 1];
    if (c.width === 0) break; // keep wide-char spacers
    if (c.char !== " " && c.char !== "") break;
    if (c.attrs.bg !== COLOR_DEFAULT) break; // preserve coloured background runs
    end--;
  }
  return end === cells.length ? cells : cells.slice(0, end);
}

// ── DEC special graphics (line-drawing) charset, 0x60–0x7e ───────────────────

const DEC_SPECIAL: Record<string, string> = {
  "`": "◆", a: "▒", b: "␉", c: "␌", d: "␍", e: "␊", f: "°", g: "±",
  h: "␤", i: "␋", j: "┘", k: "┐", l: "┌", m: "└", n: "┼", o: "⎺",
  p: "⎻", q: "─", r: "⎼", s: "⎽", t: "├", u: "┤", v: "┴", w: "┬",
  x: "│", y: "≤", z: "≥", "{": "π", "|": "≠", "}": "£", "~": "·",
};
