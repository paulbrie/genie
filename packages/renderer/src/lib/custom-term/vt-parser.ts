/**
 * Tiny ANSI / VT100 parser.
 *
 * Stream-oriented: feed it bytes (as strings) and it emits structured events
 * via a callback. Holds no rendering or buffer state — that's the consumer's
 * job (see ./buffer.ts). Designed to be small and exhaustive enough for
 * Claude's streaming output (SGR colors, BS/CR/LF/TAB/BEL, erase line/disp,
 * cursor positioning), not a full xterm emulator.
 *
 * Phase 1 scope: well-defined event for everything we KNOW how to honour;
 * Unknown CSI/OSC sequences emit an `unknown` event so the buffer can skip
 * them silently instead of leaking the escape into the rendered output.
 *
 * State machine — kept minimal:
 *   GROUND      → printable / C0
 *   ESC         → after 0x1b
 *   CSI_PARAM   → after ESC [, accumulating digits ; ? > !
 *   OSC_STRING  → after ESC ], accumulating until BEL or ESC \
 *
 * Refs: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
 */

export type VtEvent =
  | { type: "print"; ch: string }                          // a single printable character
  | { type: "bs" }                                          // backspace (0x08)
  | { type: "cr" }                                          // carriage return (0x0d)
  | { type: "lf" }                                          // line feed (0x0a)
  | { type: "tab" }                                         // horizontal tab (0x09)
  | { type: "bell" }                                        // 0x07
  | { type: "sgr"; codes: number[] }                        // ESC [ … m
  | { type: "cursor-pos"; row: number; col: number }        // ESC [ r ; c H  (1-based)
  | { type: "cursor-move"; dRow: number; dCol: number }     // CUU/CUD/CUF/CUB
  | { type: "erase-line"; mode: 0 | 1 | 2 }                 // ESC [ n K
  | { type: "erase-display"; mode: 0 | 1 | 2 | 3 }          // ESC [ n J
  | { type: "set-title"; title: string }                    // OSC 0/2 ; … BEL
  | { type: "unknown"; raw: string };                       // anything we don't understand

type State = "ground" | "esc" | "csi" | "osc";

export class VtParser {
  private state: State = "ground";
  private params: string = ""; // raw param accumulator for CSI
  private osc: string = "";    // raw OSC body
  private oscEsc: boolean = false; // saw ESC inside OSC, awaiting \

  /** Feed a chunk; events fire synchronously through `out`. */
  feed(data: string, out: (e: VtEvent) => void): void {
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      const cc = data.charCodeAt(i);
      switch (this.state) {
        case "ground":
          if (cc === 0x1b) { this.state = "esc"; }
          else if (cc === 0x08) out({ type: "bs" });
          else if (cc === 0x0d) out({ type: "cr" });
          else if (cc === 0x0a) out({ type: "lf" });
          else if (cc === 0x09) out({ type: "tab" });
          else if (cc === 0x07) out({ type: "bell" });
          else if (cc < 0x20) { /* swallow other C0 — vertical tab, form feed, SO/SI: rare and ignorable for our use */ }
          else out({ type: "print", ch });
          break;

        case "esc":
          if (ch === "[") { this.state = "csi"; this.params = ""; }
          else if (ch === "]") { this.state = "osc"; this.osc = ""; this.oscEsc = false; }
          else if (ch === "(" || ch === ")" || ch === "*" || ch === "+") {
            // SCS — character set designation. Skip the next byte.
            i++;
            this.state = "ground";
          }
          else if (ch === "=" || ch === ">") {
            // application / normal keypad — ignore for now.
            this.state = "ground";
          }
          else if (ch === "7" || ch === "8") {
            // DECSC / DECRC — save/restore cursor. Not yet supported.
            out({ type: "unknown", raw: `ESC ${ch}` });
            this.state = "ground";
          }
          else {
            out({ type: "unknown", raw: `ESC ${ch}` });
            this.state = "ground";
          }
          break;

        case "csi":
          // CSI parameter bytes: 0x30–0x3F. Final byte: 0x40–0x7E.
          if (cc >= 0x30 && cc <= 0x3f) {
            this.params += ch;
          } else if (cc >= 0x40 && cc <= 0x7e) {
            this.dispatchCsi(ch, out);
            this.state = "ground";
            this.params = "";
          } else {
            // Bad sequence — abort.
            out({ type: "unknown", raw: `CSI ${this.params}${ch}` });
            this.state = "ground";
            this.params = "";
          }
          break;

        case "osc":
          // OSC string body — terminated by BEL (0x07) or ST (ESC \).
          if (cc === 0x07) {
            this.dispatchOsc(out);
            this.state = "ground";
            this.osc = "";
            this.oscEsc = false;
          } else if (this.oscEsc) {
            // Expecting \ to complete ST.
            this.dispatchOsc(out);
            this.state = "ground";
            this.osc = "";
            this.oscEsc = false;
          } else if (cc === 0x1b) {
            this.oscEsc = true;
          } else {
            this.osc += ch;
          }
          break;
      }
    }
  }

  private dispatchCsi(final: string, out: (e: VtEvent) => void): void {
    // Parameters are ';'-separated; empty params default to whatever the
    // command's default is. We pass them as numbers (0 for missing).
    const params = this.params.startsWith("?") || this.params.startsWith(">") || this.params.startsWith("!")
      ? null // private/prefix sequences — not handled below, emit unknown
      : this.params.split(";").map((p) => (p === "" ? 0 : parseInt(p, 10)));

    if (!params) {
      out({ type: "unknown", raw: `CSI ${this.params}${final}` });
      return;
    }

    switch (final) {
      case "m":
        out({ type: "sgr", codes: params.length === 0 ? [0] : params });
        return;
      case "H":
      case "f": {
        const row = Math.max(1, params[0] || 1);
        const col = Math.max(1, params[1] || 1);
        out({ type: "cursor-pos", row, col });
        return;
      }
      case "A": out({ type: "cursor-move", dRow: -(params[0] || 1), dCol: 0 }); return;
      case "B": out({ type: "cursor-move", dRow:  (params[0] || 1), dCol: 0 }); return;
      case "C": out({ type: "cursor-move", dRow: 0, dCol:  (params[0] || 1) }); return;
      case "D": out({ type: "cursor-move", dRow: 0, dCol: -(params[0] || 1) }); return;
      case "K": {
        const m = (params[0] || 0) as 0 | 1 | 2;
        out({ type: "erase-line", mode: m });
        return;
      }
      case "J": {
        const m = (params[0] || 0) as 0 | 1 | 2 | 3;
        out({ type: "erase-display", mode: m });
        return;
      }
      default:
        out({ type: "unknown", raw: `CSI ${this.params}${final}` });
        return;
    }
  }

  private dispatchOsc(out: (e: VtEvent) => void): void {
    // Common OSC 0/1/2: ESC ] (0|1|2) ; title ST/BEL → set window title.
    const m = /^(0|1|2);(.*)$/s.exec(this.osc);
    if (m) {
      out({ type: "set-title", title: m[2] });
      return;
    }
    out({ type: "unknown", raw: `OSC ${this.osc}` });
  }
}
