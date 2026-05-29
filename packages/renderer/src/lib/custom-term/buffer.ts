/**
 * Linear scrollback buffer for the custom terminal renderer.
 *
 * Phase 1: line-oriented. Each line is a sequence of styled segments. We
 * track a cursor column within the bottom line; CR sends it to 0, BS
 * backs up one column. LF appends a new line. Cursor row movement
 * (CUU/CUD/CUP) is acknowledged but clamps to the current visible window
 * — alt-screen / scroll-region semantics come in Phase 2.
 *
 * The buffer keeps the last MAX_LINES lines so a very long stream doesn't
 * blow memory. Consumers render via getSnapshot() which returns a stable
 * read-only view of all lines + a hash that changes on every mutation,
 * so React can skip re-rendering when nothing changed.
 */

export interface CellAttrs {
  fg: number | null;        // 0-255 palette index or null = default
  bg: number | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

export interface Segment {
  text: string;
  attrs: CellAttrs;
}

export interface LineView {
  segments: Segment[];
}

export const DEFAULT_ATTRS: CellAttrs = {
  fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false,
};

const MAX_LINES = 5000;

function cloneAttrs(a: CellAttrs): CellAttrs {
  return { ...a };
}

function attrsEqual(a: CellAttrs, b: CellAttrs): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.dim === b.dim
    && a.italic === b.italic && a.underline === b.underline && a.inverse === b.inverse;
}

export class TerminalBuffer {
  private lines: Segment[][] = [[]];
  private attrs: CellAttrs = cloneAttrs(DEFAULT_ATTRS);
  private col: number = 0;
  private version: number = 0;
  private titleStr: string = "";

  get title(): string { return this.titleStr; }

  setTitle(t: string): void {
    this.titleStr = t;
    this.version++;
  }

  /** Reset SGR codes per ECMA-48 8.3.117 — only the bits we understand. */
  applySgr(codes: number[]): void {
    let i = 0;
    while (i < codes.length) {
      const c = codes[i];
      switch (c) {
        case 0:  this.attrs = cloneAttrs(DEFAULT_ATTRS); break;
        case 1:  this.attrs.bold = true; break;
        case 2:  this.attrs.dim = true; break;
        case 3:  this.attrs.italic = true; break;
        case 4:  this.attrs.underline = true; break;
        case 7:  this.attrs.inverse = true; break;
        case 22: this.attrs.bold = false; this.attrs.dim = false; break;
        case 23: this.attrs.italic = false; break;
        case 24: this.attrs.underline = false; break;
        case 27: this.attrs.inverse = false; break;
        case 39: this.attrs.fg = null; break;
        case 49: this.attrs.bg = null; break;
        default:
          // 30-37 fg, 40-47 bg (8 basic), 90-97 / 100-107 (bright).
          if (c >= 30 && c <= 37) { this.attrs.fg = c - 30; }
          else if (c >= 90 && c <= 97) { this.attrs.fg = c - 90 + 8; }
          else if (c >= 40 && c <= 47) { this.attrs.bg = c - 40; }
          else if (c >= 100 && c <= 107) { this.attrs.bg = c - 100 + 8; }
          // 38;5;n / 48;5;n — 256-colour palette.
          else if (c === 38 && codes[i + 1] === 5) { this.attrs.fg = codes[i + 2]; i += 2; }
          else if (c === 48 && codes[i + 1] === 5) { this.attrs.bg = codes[i + 2]; i += 2; }
          // 38;2;r;g;b — true-colour. Phase 1: skip RGB params (3 of them).
          else if (c === 38 && codes[i + 1] === 2) { i += 4; }
          else if (c === 48 && codes[i + 1] === 2) { i += 4; }
          break;
      }
      i++;
    }
    this.version++;
  }

  print(ch: string): void {
    const line = this.lines[this.lines.length - 1];
    const flat = flatten(line);

    if (this.col < flat.length) {
      // Overwrite mode: replace char at this.col with the new styled char.
      const replaced = replaceCharAt(line, this.col, ch, this.attrs);
      this.lines[this.lines.length - 1] = replaced;
    } else {
      // Append at end. Pad with spaces (default attrs) if cursor is past line end.
      if (this.col > flat.length) {
        const padCount = this.col - flat.length;
        appendSegment(line, " ".repeat(padCount), DEFAULT_ATTRS);
      }
      appendSegment(line, ch, this.attrs);
    }
    this.col++;
    this.version++;
  }

  cr(): void { this.col = 0; this.version++; }
  bs(): void { if (this.col > 0) this.col--; this.version++; }
  tab(): void {
    // Tabs go to next multiple of 8.
    this.col = Math.floor(this.col / 8 + 1) * 8;
    this.version++;
  }

  lf(): void {
    this.lines.push([]);
    if (this.lines.length > MAX_LINES) this.lines.shift();
    this.col = 0;
    this.version++;
  }

  /** Move cursor by relative row/col. Row movement clamped to current line
   *  for now — we don't yet model an absolute row coordinate beyond "bottom
   *  visible line." dRow != 0 is largely a no-op in Phase 1. */
  cursorMove(_dRow: number, dCol: number): void {
    this.col = Math.max(0, this.col + dCol);
    this.version++;
  }

  cursorPos(_row: number, col: number): void {
    // Same Phase 1 caveat: row is acknowledged but not stored. col is 1-based.
    this.col = Math.max(0, col - 1);
    this.version++;
  }

  /** ESC [ n K — erase in line.
   *  0: cursor → end of line
   *  1: start of line → cursor
   *  2: entire line  */
  eraseLine(mode: 0 | 1 | 2): void {
    const lineIdx = this.lines.length - 1;
    const line = this.lines[lineIdx];
    const flat = flatten(line);
    if (mode === 2) {
      this.lines[lineIdx] = [];
    } else if (mode === 0) {
      this.lines[lineIdx] = sliceLine(line, 0, this.col);
    } else if (mode === 1) {
      const head = " ".repeat(Math.min(this.col + 1, flat.length));
      const tail = sliceLine(line, this.col + 1, flat.length);
      this.lines[lineIdx] = [...wrapText(head, DEFAULT_ATTRS), ...tail];
    }
    this.version++;
  }

  /** ESC [ n J — erase in display.
   *  Phase 1: 2/3 clear everything; 0/1 equivalent to the per-line variant. */
  eraseDisplay(mode: 0 | 1 | 2 | 3): void {
    if (mode === 2 || mode === 3) {
      this.lines = [[]];
      this.col = 0;
    } else if (mode === 0) {
      this.eraseLine(0);
    } else if (mode === 1) {
      this.eraseLine(1);
    }
    this.version++;
  }

  /** Snapshot for rendering. Lines are read-only views; version is monotonic. */
  getSnapshot(): { lines: LineView[]; cursor: { line: number; col: number }; version: number } {
    return {
      lines: this.lines.map((segs) => ({ segments: segs })),
      cursor: { line: this.lines.length - 1, col: this.col },
      version: this.version,
    };
  }

  reset(): void {
    this.lines = [[]];
    this.attrs = cloneAttrs(DEFAULT_ATTRS);
    this.col = 0;
    this.titleStr = "";
    this.version++;
  }
}

// ── segment helpers ─────────────────────────────────────────────────────────

function flatten(line: Segment[]): string {
  let s = "";
  for (const seg of line) s += seg.text;
  return s;
}

/** Append `text` to the line, merging with the trailing segment when attrs
 *  match — keeps the segment count down on heavy streams (one SGR set + many
 *  chars → one segment, not N). */
function appendSegment(line: Segment[], text: string, attrs: CellAttrs): void {
  const last = line[line.length - 1];
  if (last && attrsEqual(last.attrs, attrs)) {
    last.text += text;
  } else {
    line.push({ text, attrs: cloneAttrs(attrs) });
  }
}

function wrapText(text: string, attrs: CellAttrs): Segment[] {
  return text.length === 0 ? [] : [{ text, attrs: cloneAttrs(attrs) }];
}

/** Return a new segment array containing chars [start, end) of the line. */
function sliceLine(line: Segment[], start: number, end: number): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  for (const seg of line) {
    const segEnd = pos + seg.text.length;
    if (segEnd <= start) { pos = segEnd; continue; }
    if (pos >= end) break;
    const lo = Math.max(0, start - pos);
    const hi = Math.min(seg.text.length, end - pos);
    out.push({ text: seg.text.slice(lo, hi), attrs: cloneAttrs(seg.attrs) });
    pos = segEnd;
  }
  return out;
}

/** Overwrite one character at flat column `col` with `ch`/`attrs`. */
function replaceCharAt(line: Segment[], col: number, ch: string, attrs: CellAttrs): Segment[] {
  const before = sliceLine(line, 0, col);
  const after = sliceLine(line, col + 1, Number.MAX_SAFE_INTEGER);
  appendSegment(before, ch, attrs);
  for (const seg of after) appendSegment(before, seg.text, seg.attrs);
  return before;
}
