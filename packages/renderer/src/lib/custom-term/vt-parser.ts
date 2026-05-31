/**
 * VT100/VT500-family escape-sequence parser (Phase 2).
 *
 * A state machine modelled on Paul Williams' VT500 parser
 * (https://vt100.net/emu/dec_ansi_parser) — the design xterm.js and vte use.
 * It is stream-oriented: feed it decoded strings and it drives a
 * {@link Terminal} performer. Parser state lives on the instance, so a
 * control sequence split across chunk boundaries is handled correctly.
 *
 * Scope: everything a real TUI needs — SGR (incl. 256/true colour), absolute
 * & relative cursor motion, scroll regions, insert/delete, alt-screen, charset
 * selection, and the device reports (DA/DSR) apps block on. DCS/APC/PM/SOS
 * bodies are consumed and ignored.
 */

import type { Terminal } from "./terminal";

type State =
  | "ground"
  | "escape"
  | "escape_intermediate"
  | "csi_entry"
  | "csi_param"
  | "csi_intermediate"
  | "csi_ignore"
  | "osc"
  | "dcs"
  | "string_ignore"; // APC / PM / SOS bodies

const MAX_PARAMS = 32;

export class VtParser {
  private state: State = "ground";
  private params: number[] = [];
  private curParam = 0;
  private hasParam = false;
  private prefix = ""; // private-marker byte: ? > < ! (CSI) or first OSC bytes
  private intermediates = "";
  private oscBuf = "";
  private stringEsc = false; // saw ESC inside a string, awaiting ST terminator \
  private pendingHighSurrogate = "";

  constructor(private term: Terminal) {}

  reset(): void {
    this.state = "ground";
    this.params = [];
    this.curParam = 0;
    this.hasParam = false;
    this.prefix = "";
    this.intermediates = "";
    this.oscBuf = "";
    this.stringEsc = false;
    this.pendingHighSurrogate = "";
  }

  feed(data: string): void {
    if (this.pendingHighSurrogate) {
      data = this.pendingHighSurrogate + data;
      this.pendingHighSurrogate = "";
    }
    for (let i = 0; i < data.length; i++) {
      const cc = data.charCodeAt(i);

      // Hold a trailing lone high surrogate until its pair arrives next chunk.
      if (cc >= 0xd800 && cc <= 0xdbff && this.state === "ground") {
        if (i === data.length - 1) {
          this.pendingHighSurrogate = data[i];
          return;
        }
        const next = data.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          this.printChar(data[i] + data[i + 1]);
          i++;
          continue;
        }
      }

      this.step(data[i], cc);
    }
  }

  // ── core dispatch ────────────────────────────────────────────────────────

  private step(ch: string, cc: number): void {
    // C0 controls (except ESC) are acted on immediately in most states.
    if (cc === 0x1b) {
      // ESC: start (or restart) an escape, unless we're in a string that uses
      // ESC \ as terminator.
      if (this.state === "osc" || this.state === "dcs" || this.state === "string_ignore") {
        this.stringEsc = true;
        return;
      }
      this.beginEscape();
      return;
    }

    switch (this.state) {
      case "ground":
        this.ground(ch, cc);
        return;

      case "escape":
        this.escape(ch, cc);
        return;

      case "escape_intermediate":
        if (cc >= 0x20 && cc <= 0x2f) {
          this.intermediates += ch;
        } else if (cc >= 0x30 && cc <= 0x7e) {
          this.escDispatch(ch);
          this.toGround();
        } else {
          this.execute(cc);
        }
        return;

      case "csi_entry":
      case "csi_param":
      case "csi_intermediate":
      case "csi_ignore":
        this.csi(ch, cc);
        return;

      case "osc":
        this.oscByte(ch, cc);
        return;

      case "dcs":
      case "string_ignore":
        this.stringByte(cc);
        return;
    }
  }

  private toGround(): void {
    this.state = "ground";
  }

  private beginEscape(): void {
    this.state = "escape";
    this.intermediates = "";
    this.prefix = "";
    this.params = [];
    this.curParam = 0;
    this.hasParam = false;
  }

  // ── ground ─────────────────────────────────────────────────────────────────

  private ground(ch: string, cc: number): void {
    if (cc < 0x20 || cc === 0x7f) {
      this.execute(cc);
      return;
    }
    // High surrogate handled in feed(); here cc>=0x20.
    this.printChar(ch);
  }

  private printChar(ch: string): void {
    this.term.print(ch, charWidth(ch));
  }

  /** Execute a C0 control byte. */
  private execute(cc: number): void {
    switch (cc) {
      case 0x07: this.term.bell(); return;
      case 0x08: this.term.backspace(); return;
      case 0x09: this.term.tab(); return;
      case 0x0a: // LF
      case 0x0b: // VT
      case 0x0c: this.term.lineFeed(); return; // FF
      case 0x0d: this.term.carriageReturn(); return;
      case 0x0e: this.term.invokeCharset(1); return; // SO / LS1
      case 0x0f: this.term.invokeCharset(0); return; // SI / LS0
      default: return; // swallow other C0
    }
  }

  // ── escape ───────────────────────────────────────────────────────────────

  private escape(ch: string, cc: number): void {
    if (ch === "[") { this.state = "csi_entry"; return; }
    if (ch === "]") { this.state = "osc"; this.oscBuf = ""; this.stringEsc = false; return; }
    if (ch === "P") { this.state = "dcs"; this.oscBuf = ""; this.stringEsc = false; return; }
    if (ch === "X" || ch === "^" || ch === "_") {
      // SOS / PM / APC — consume and ignore the body.
      this.state = "string_ignore";
      this.stringEsc = false;
      return;
    }
    if (cc >= 0x20 && cc <= 0x2f) {
      this.intermediates += ch;
      this.state = "escape_intermediate";
      return;
    }
    if (cc >= 0x30 && cc <= 0x7e) {
      this.escDispatch(ch);
      this.toGround();
      return;
    }
    if (cc < 0x20) { this.execute(cc); return; }
    this.toGround();
  }

  private escDispatch(final: string): void {
    const t = this.term;
    // Charset designation: ESC ( B / ESC ( 0 etc.
    if (this.intermediates === "(" || this.intermediates === ")") {
      const slot = this.intermediates === "(" ? "g0" : "g1";
      t.selectCharset(slot, final === "0" ? "dec-special" : "ascii");
      return;
    }
    if (this.intermediates === "*" || this.intermediates === "+") return; // G2/G3 — ignore

    switch (final) {
      case "D": t.index(); return; // IND
      case "M": t.reverseIndex(); return; // RI
      case "E": t.nextLine(); return; // NEL
      case "7": t.saveCursor(); return; // DECSC
      case "8": t.restoreCursor(); return; // DECRC
      case "c": t.reset(); return; // RIS
      case "=": t.setAppKeypad(true); return; // DECKPAM
      case ">": t.setAppKeypad(false); return; // DECKPNM
      default: return;
    }
  }

  // ── CSI ────────────────────────────────────────────────────────────────────

  private csi(ch: string, cc: number): void {
    if (cc < 0x20) { this.execute(cc); return; }

    if (this.state === "csi_ignore") {
      if (cc >= 0x40 && cc <= 0x7e) this.toGround();
      return;
    }

    // Private / prefix markers (only valid right after CSI).
    if (this.state === "csi_entry" && cc >= 0x3c && cc <= 0x3f) {
      this.prefix = ch; // < = > ?
      this.state = "csi_param";
      return;
    }

    // Parameter digits.
    if (cc >= 0x30 && cc <= 0x39) {
      this.curParam = this.curParam * 10 + (cc - 0x30);
      this.hasParam = true;
      this.state = "csi_param";
      return;
    }
    // Parameter separator (';' and ':' sub-param — collapsed to ';').
    if (cc === 0x3b || cc === 0x3a) {
      this.pushParam();
      this.state = "csi_param";
      return;
    }
    // Intermediate bytes.
    if (cc >= 0x20 && cc <= 0x2f) {
      this.intermediates += ch;
      this.state = "csi_intermediate";
      return;
    }
    // Final byte.
    if (cc >= 0x40 && cc <= 0x7e) {
      this.pushParam();
      this.csiDispatch(ch);
      this.toGround();
      return;
    }
    this.state = "csi_ignore";
  }

  private pushParam(): void {
    if (this.params.length < MAX_PARAMS) {
      this.params.push(this.hasParam ? this.curParam : 0);
    }
    this.curParam = 0;
    this.hasParam = false;
  }

  private csiDispatch(final: string): void {
    const t = this.term;
    const params = this.params;
    const n = (i: number, def = 1) => {
      const v = params[i];
      return v === undefined || v === 0 ? def : v;
    };

    // Private-mode sequences: CSI ? Pm h/l
    if (this.prefix === "?") {
      if (final === "h" || final === "l") {
        const on = final === "h";
        for (const m of params.length ? params : [0]) t.setPrivateMode(m, on);
      }
      // CSI ? Ps n (DSR variants) etc. — ignore the rest for now.
      return;
    }
    if (this.prefix === ">" || this.prefix === "<" || this.prefix === "=") {
      // Secondary DA query (CSI > c) → respond like xterm.
      if (final === "c") t.deviceAttributes();
      return;
    }

    switch (final) {
      case "@": t.insertChars(n(0)); return; // ICH
      case "A": t.cursorUp(n(0)); return; // CUU
      case "B": t.cursorDown(n(0)); return; // CUD
      case "C": t.cursorForward(n(0)); return; // CUF
      case "D": t.cursorBack(n(0)); return; // CUB
      case "E": t.cursorNextLine(n(0)); return; // CNL
      case "F": t.cursorPrevLine(n(0)); return; // CPL
      case "G": case "`": t.cursorColumn(n(0)); return; // CHA / HPA
      case "H": case "f": t.cursorPosition(n(0), n(1)); return; // CUP / HVP
      case "I": t.cursorForward(n(0)); return; // CHT (approx: tab forward)
      case "J": t.eraseInDisplay(params[0] ?? 0); return; // ED
      case "K": t.eraseInLine(params[0] ?? 0); return; // EL
      case "L": t.insertLines(n(0)); return; // IL
      case "M": t.deleteLines(n(0)); return; // DL
      case "P": t.deleteChars(n(0)); return; // DCH
      case "S": t.scrollUp(n(0)); return; // SU
      case "T": t.scrollDown(n(0)); return; // SD
      case "X": t.eraseChars(n(0)); return; // ECH
      case "Z": t.cursorBack(n(0)); return; // CBT (approx)
      case "b": return; // REP — repeat (rare; skip)
      case "d": t.cursorLine(n(0)); return; // VPA
      case "c": t.deviceAttributes(); return; // DA
      case "g": return; // TBC — tab clear (default tabs assumed)
      case "h": for (const m of params.length ? params : [0]) t.setMode(m, true); return;
      case "l": for (const m of params.length ? params : [0]) t.setMode(m, false); return;
      case "m": t.setAttributes(params); return; // SGR
      case "n": t.deviceStatusReport(params[0] ?? 0); return; // DSR
      case "r": t.setScrollRegion(params[0] ?? 0, params[1] ?? 0); return; // DECSTBM
      case "s": t.saveCursor(); return; // SCOSC
      case "u": t.restoreCursor(); return; // SCORC
      default: return;
    }
  }

  // ── OSC ──────────────────────────────────────────────────────────────────

  private oscByte(ch: string, cc: number): void {
    if (this.stringEsc) {
      // We saw ESC; ST is "ESC \". Any byte here terminates.
      this.oscDispatch();
      this.stringEsc = false;
      this.toGround();
      return;
    }
    if (cc === 0x07) {
      // BEL terminator.
      this.oscDispatch();
      this.toGround();
      return;
    }
    this.oscBuf += ch;
  }

  private oscDispatch(): void {
    const m = /^(\d+);([\s\S]*)$/.exec(this.oscBuf);
    if (!m) return;
    const ps = m[1];
    const body = m[2];

    if (ps === "0" || ps === "1" || ps === "2") {
      this.term.setTitle(body);
      return;
    }
    if (ps === "8") {
      // OSC 8 ; params ; URI  — empty URI ends the hyperlink run.
      const sep = body.indexOf(";");
      const uri = sep >= 0 ? body.slice(sep + 1) : "";
      this.term.setHyperlink(uri || undefined);
      return;
    }
    if (ps === "133") {
      // FinalTerm/iTerm shell integration: A=prompt, B=command, C=output.
      const kind = body.charAt(0);
      if (kind === "A") this.term.shellMark("prompt");
      else if (kind === "B") this.term.shellMark("command");
      else if (kind === "C") this.term.shellMark("output");
      return;
    }
    // OSC 52 (clipboard) and others — Phase 2+.
  }

  // ── DCS / string-ignore ─────────────────────────────────────────────────────

  private stringByte(cc: number): void {
    if (this.stringEsc) {
      this.stringEsc = false;
      this.toGround();
      return;
    }
    if (cc === 0x07) {
      this.toGround();
      return;
    }
    // body byte — ignored
  }
}

// ── character width (minimal; full wcwidth table lands in M5) ─────────────────

/** Returns 0 for combining/zero-width marks, 2 for wide, else 1. */
export function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x300) return 1;
  if (isZeroWidth(cp)) return 0;
  if (cp < 0x1100) return 1;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, Kangxi
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana..CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & symbols
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Ext B+
  ) {
    return 2;
  }
  return 1;
}

/** Combining marks, variation selectors and zero-width spaces/joiners. */
function isZeroWidth(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacriticals
    (cp >= 0x0483 && cp <= 0x0489) ||
    (cp >= 0x0591 && cp <= 0x05bd) ||
    (cp >= 0x0610 && cp <= 0x061a) ||
    (cp >= 0x064b && cp <= 0x065f) ||
    (cp >= 0x06d6 && cp <= 0x06dc) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) || // combining ext
    (cp >= 0x1dc0 && cp <= 0x1dff) || // combining supplement
    (cp >= 0x200b && cp <= 0x200f) || // zero-width space/joiner/marks
    cp === 0x2060 ||
    (cp >= 0x20d0 && cp <= 0x20ff) || // combining for symbols
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0xfe20 && cp <= 0xfe2f) // combining half marks
  );
}
