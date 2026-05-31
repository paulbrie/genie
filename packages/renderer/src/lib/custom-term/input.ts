/**
 * Input encoding for the custom terminal (Phase 2, M4).
 *
 * Pure functions that turn UI key/mouse/paste/focus events into the byte
 * sequences a PTY expects, honouring the terminal's current modes
 * (application cursor keys, bracketed paste, mouse reporting, focus events).
 * Kept free of React types so it can be unit-tested directly.
 */

import type { TermModes } from "./grid";

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** xterm modifier parameter: 1 + bitmask(shift=1, alt=2, ctrl=4, meta=8). */
function modParam(k: KeyInput): number {
  let m = 0;
  if (k.shiftKey) m += 1;
  if (k.altKey) m += 2;
  if (k.ctrlKey) m += 4;
  if (k.metaKey) m += 8;
  return m + 1;
}

const CURSOR_FINAL: Record<string, string> = {
  ArrowUp: "A",
  ArrowDown: "B",
  ArrowRight: "C",
  ArrowLeft: "D",
  Home: "H",
  End: "F",
};

// CSI ~ keys: key → numeric code.
const TILDE_CODE: Record<string, number> = {
  Insert: 2,
  Delete: 3,
  PageUp: 5,
  PageDown: 6,
  F5: 15,
  F6: 17,
  F7: 18,
  F8: 19,
  F9: 20,
  F10: 21,
  F11: 23,
  F12: 24,
};

// F1–F4 use SS3 finals (or CSI with modifiers).
const SS3_FN: Record<string, string> = { F1: "P", F2: "Q", F3: "R", F4: "S" };

/**
 * Encode a key event to terminal bytes, or null to let it fall through to the
 * textarea's input handler (printable characters).
 */
export function encodeKey(k: KeyInput, modes: TermModes): string | null {
  const key = k.key;
  const mod = modParam(k);
  const hasMod = mod > 1;

  // Cursor / Home / End — application mode swaps CSI for SS3 when unmodified.
  const cursorFinal = CURSOR_FINAL[key];
  if (cursorFinal) {
    if (hasMod) return `\x1b[1;${mod}${cursorFinal}`;
    return modes.appCursorKeys ? `\x1bO${cursorFinal}` : `\x1b[${cursorFinal}`;
  }

  // CSI ~ keys.
  const tilde = TILDE_CODE[key];
  if (tilde !== undefined) {
    return hasMod ? `\x1b[${tilde};${mod}~` : `\x1b[${tilde}~`;
  }

  // F1–F4.
  const ss3 = SS3_FN[key];
  if (ss3) {
    return hasMod ? `\x1b[1;${mod}${ss3}` : `\x1bO${ss3}`;
  }

  switch (key) {
    case "Enter": return "\r";
    case "Backspace": return k.altKey ? "\x1b\x7f" : "\x7f";
    case "Tab": return k.shiftKey ? "\x1b[Z" : "\t";
    case "Escape": return "\x1b";
  }

  // Ctrl + key → control byte.
  if (k.ctrlKey && !k.altKey && !k.metaKey && key.length === 1) {
    const lower = key.toLowerCase();
    const code = lower.charCodeAt(0);
    if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code - 0x60);
    if (key === "[") return "\x1b";
    if (key === "\\") return "\x1c";
    if (key === "]") return "\x1d";
    if (key === "^") return "\x1e";
    if (key === "_") return "\x1f";
    if (key === " ") return "\x00";
  }

  // Alt + printable → ESC-prefixed (Meta).
  if (k.altKey && !k.ctrlKey && !k.metaKey && key.length === 1) {
    return "\x1b" + key;
  }

  return null;
}

/** Wrap pasted text in bracketed-paste markers when the app enabled ?2004. */
export function encodePaste(text: string, modes: TermModes): string {
  if (!modes.bracketedPaste) return text;
  // Strip any embedded end-marker so a malicious paste can't break out.
  const safe = text.replace(/\x1b\[201~/g, "");
  return `\x1b[200~${safe}\x1b[201~`;
}

/** Focus / blur reporting when the app enabled ?1004. */
export function encodeFocus(focused: boolean, modes: TermModes): string | null {
  if (!modes.focusEvents) return null;
  return focused ? "\x1b[I" : "\x1b[O";
}

export type MouseEventType = "down" | "up" | "move" | "wheel";

export interface MouseInput {
  type: MouseEventType;
  button: number; // 0 left, 1 middle, 2 right; wheel: 0 up / 1 down
  col: number; // 1-based cell column
  row: number; // 1-based cell row
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}

/**
 * Encode a mouse event per the active mouse mode, or null when the event
 * should not be reported. Emits SGR (?1006) when enabled, else legacy X10.
 */
export function encodeMouse(m: MouseInput, modes: TermModes): string | null {
  if (modes.mouse === "off") return null;
  if (m.type === "move" && modes.mouse !== "any" && modes.mouse !== "drag") return null;

  let cb: number;
  if (m.type === "wheel") {
    cb = 64 + (m.button === 1 ? 1 : 0); // 64 = up, 65 = down
  } else {
    cb = m.button & 3;
  }
  if (m.type === "move") cb += 32; // motion flag
  if (m.shiftKey) cb += 4;
  if (m.altKey) cb += 8;
  if (m.ctrlKey) cb += 16;

  if (modes.mouseSgr) {
    const final = m.type === "up" ? "m" : "M";
    return `\x1b[<${cb};${m.col};${m.row}${final}`;
  }
  // Legacy X10: byte values offset by 32, release reports button 3.
  const b = m.type === "up" ? 3 + (cb & ~3) : cb;
  return `\x1b[M${String.fromCharCode(32 + b)}${String.fromCharCode(32 + m.col)}${String.fromCharCode(32 + m.row)}`;
}
