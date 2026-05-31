import { describe, expect, it } from "vitest";
import { encodeKey, encodePaste, encodeFocus, encodeMouse } from "./input";
import type { TermModes } from "./grid";

function modes(over: Partial<TermModes> = {}): TermModes {
  return {
    appCursorKeys: false,
    appKeypad: false,
    bracketedPaste: false,
    mouse: "off",
    mouseSgr: false,
    focusEvents: false,
    ...over,
  };
}

function key(k: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}) {
  return { key: k, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta };
}

describe("encodeKey: cursor keys", () => {
  it("normal mode arrows use CSI", () => {
    expect(encodeKey(key("ArrowUp"), modes())).toBe("\x1b[A");
    expect(encodeKey(key("ArrowLeft"), modes())).toBe("\x1b[D");
  });

  it("application mode arrows use SS3", () => {
    expect(encodeKey(key("ArrowUp"), modes({ appCursorKeys: true }))).toBe("\x1bOA");
  });

  it("modified arrows always use CSI with a modifier param", () => {
    expect(encodeKey(key("ArrowUp", { ctrl: true }), modes({ appCursorKeys: true }))).toBe("\x1b[1;5A");
    expect(encodeKey(key("ArrowRight", { shift: true }), modes())).toBe("\x1b[1;2C");
  });
});

describe("encodeKey: special + control", () => {
  it("Enter / Tab / shift-Tab / Escape", () => {
    expect(encodeKey(key("Enter"), modes())).toBe("\r");
    expect(encodeKey(key("Tab"), modes())).toBe("\t");
    expect(encodeKey(key("Tab", { shift: true }), modes())).toBe("\x1b[Z");
    expect(encodeKey(key("Escape"), modes())).toBe("\x1b");
  });

  it("Ctrl+letter → control byte", () => {
    expect(encodeKey(key("c", { ctrl: true }), modes())).toBe("\x03");
    expect(encodeKey(key("a", { ctrl: true }), modes())).toBe("\x01");
  });

  it("Alt+char → ESC-prefixed", () => {
    expect(encodeKey(key("b", { alt: true }), modes())).toBe("\x1bb");
  });

  it("function keys", () => {
    expect(encodeKey(key("F1"), modes())).toBe("\x1bOP");
    expect(encodeKey(key("F5"), modes())).toBe("\x1b[15~");
    expect(encodeKey(key("F12"), modes())).toBe("\x1b[24~");
  });

  it("PageUp/Delete use CSI ~", () => {
    expect(encodeKey(key("PageUp"), modes())).toBe("\x1b[5~");
    expect(encodeKey(key("Delete"), modes())).toBe("\x1b[3~");
  });

  it("printable keys fall through (null)", () => {
    expect(encodeKey(key("a"), modes())).toBeNull();
  });
});

describe("encodePaste", () => {
  it("passes through when bracketed paste is off", () => {
    expect(encodePaste("hi", modes())).toBe("hi");
  });
  it("wraps when bracketed paste is on", () => {
    expect(encodePaste("hi", modes({ bracketedPaste: true }))).toBe("\x1b[200~hi\x1b[201~");
  });
  it("strips embedded end markers", () => {
    expect(encodePaste("a\x1b[201~b", modes({ bracketedPaste: true }))).toBe("\x1b[200~ab\x1b[201~");
  });
});

describe("encodeFocus", () => {
  it("null when focus events off", () => {
    expect(encodeFocus(true, modes())).toBeNull();
  });
  it("in/out when enabled", () => {
    expect(encodeFocus(true, modes({ focusEvents: true }))).toBe("\x1b[I");
    expect(encodeFocus(false, modes({ focusEvents: true }))).toBe("\x1b[O");
  });
});

describe("encodeMouse", () => {
  it("null when mouse off", () => {
    expect(encodeMouse({ type: "down", button: 0, col: 1, row: 1, shiftKey: false, altKey: false, ctrlKey: false }, modes())).toBeNull();
  });

  it("SGR left-button press/release", () => {
    const m = modes({ mouse: "button", mouseSgr: true });
    expect(encodeMouse({ type: "down", button: 0, col: 5, row: 3, shiftKey: false, altKey: false, ctrlKey: false }, m)).toBe("\x1b[<0;5;3M");
    expect(encodeMouse({ type: "up", button: 0, col: 5, row: 3, shiftKey: false, altKey: false, ctrlKey: false }, m)).toBe("\x1b[<0;5;3m");
  });

  it("SGR wheel up/down", () => {
    const m = modes({ mouse: "button", mouseSgr: true });
    expect(encodeMouse({ type: "wheel", button: 0, col: 1, row: 1, shiftKey: false, altKey: false, ctrlKey: false }, m)).toBe("\x1b[<64;1;1M");
    expect(encodeMouse({ type: "wheel", button: 1, col: 1, row: 1, shiftKey: false, altKey: false, ctrlKey: false }, m)).toBe("\x1b[<65;1;1M");
  });

  it("move only reported in drag/any modes", () => {
    expect(encodeMouse({ type: "move", button: 0, col: 1, row: 1, shiftKey: false, altKey: false, ctrlKey: false }, modes({ mouse: "button", mouseSgr: true }))).toBeNull();
    expect(encodeMouse({ type: "move", button: 0, col: 1, row: 1, shiftKey: false, altKey: false, ctrlKey: false }, modes({ mouse: "any", mouseSgr: true }))).toBe("\x1b[<32;1;1M");
  });
});
