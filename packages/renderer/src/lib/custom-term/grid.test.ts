import { describe, expect, it } from "vitest";
import { Grid, rgbColor, COLOR_DEFAULT } from "./grid";
import { VtParser } from "./vt-parser";

/** Build a grid + parser and feed a stream; return the grid for assertions. */
function run(data: string, cols = 20, rows = 6): Grid {
  const g = new Grid(cols, rows);
  const p = new VtParser(g);
  p.feed(data);
  return g;
}

/** Active viewport as an array of trimmed lines. */
function lines(g: Grid): string[] {
  return g.toText().split("\n");
}

describe("grid: basic printing", () => {
  it("prints text on the first row", () => {
    const g = run("hello");
    expect(lines(g)[0]).toBe("hello");
  });

  it("CR/LF moves to next line start", () => {
    const g = run("abc\r\ndef");
    expect(lines(g)).toEqual(["abc", "def"]);
  });

  it("autowraps at the right margin", () => {
    const g = run("abcde", 3, 4);
    expect(lines(g)[0]).toBe("abc");
    expect(lines(g)[1]).toBe("de");
  });

  it("backspace moves the cursor back without erasing", () => {
    const g = run("abc\b\bX");
    expect(lines(g)[0]).toBe("aXc");
  });

  it("tab advances to the next multiple of 8", () => {
    const g = run("a\tb", 20);
    expect(lines(g)[0]).toBe("a       b");
  });
});

describe("grid: absolute cursor positioning", () => {
  it("CUP places the cursor at row;col (1-based)", () => {
    const g = run("\x1b[2;3HX");
    expect(lines(g)[1]).toBe("  X");
  });

  it("CUU/CUD/CUF/CUB move relatively", () => {
    // go to 3,3, up 1, write — should land at row 2 col 3.
    const g = run("\x1b[3;3H\x1b[AX");
    expect(lines(g)[1]).toBe("  X");
  });

  it("CHA sets the absolute column", () => {
    const g = run("abcdef\x1b[3GZ");
    expect(lines(g)[0]).toBe("abZdef");
  });

  it("VPA sets the absolute row", () => {
    const g = run("\x1b[4dX");
    expect(lines(g)[3]).toBe("X");
  });

  it("save/restore cursor (DECSC/DECRC) round-trips", () => {
    const g = run("\x1b[2;2H\x1b7\x1b[5;5HQ\x1b8R");
    expect(lines(g)[1]).toBe(" R");
    expect(lines(g)[4]).toBe("    Q");
  });
});

describe("grid: erase", () => {
  it("EL mode 0 erases cursor to end of line", () => {
    const g = run("abcdef\x1b[4G\x1b[0K");
    expect(lines(g)[0]).toBe("abc");
  });

  it("EL mode 1 erases start to cursor", () => {
    const g = run("abcdef\x1b[4G\x1b[1K");
    expect(lines(g)[0]).toBe("    ef");
  });

  it("EL mode 2 erases the whole line", () => {
    const g = run("abcdef\x1b[2K");
    expect(lines(g)[0]).toBe("");
  });

  it("ED mode 2 clears the screen", () => {
    const g = run("a\r\nb\r\nc\x1b[2J");
    expect(g.toText()).toBe("");
  });

  it("ECH erases n chars in place", () => {
    const g = run("abcdef\x1b[1G\x1b[3X");
    expect(lines(g)[0]).toBe("   def");
  });
});

describe("grid: insert / delete", () => {
  it("ICH inserts blanks shifting right", () => {
    const g = run("abcdef\x1b[1G\x1b[2@");
    expect(lines(g)[0]).toBe("  abcdef".slice(0, 8));
  });

  it("DCH deletes chars shifting left", () => {
    const g = run("abcdef\x1b[1G\x1b[2P");
    expect(lines(g)[0]).toBe("cdef");
  });

  it("IL inserts a blank line", () => {
    const g = run("a\r\nb\r\nc\x1b[1;1H\x1b[L", 20, 6);
    expect(lines(g)[0]).toBe("");
    expect(lines(g)[1]).toBe("a");
  });

  it("DL deletes a line", () => {
    const g = run("a\r\nb\r\nc\x1b[1;1H\x1b[M", 20, 6);
    expect(lines(g)[0]).toBe("b");
    expect(lines(g)[1]).toBe("c");
  });
});

describe("grid: scroll region", () => {
  it("DECSTBM constrains LF scrolling", () => {
    // region rows 1..2 (1-based), fill and overflow.
    const g = run("\x1b[1;2r\x1b[1;1Haa\r\nbb\r\ncc", 20, 4);
    const ls = lines(g);
    // bb scrolled into row 0, cc into row 1; row 2/3 untouched.
    expect(ls[0]).toBe("bb");
    expect(ls[1]).toBe("cc");
  });

  it("RI scrolls the region down at the top", () => {
    const g = run("\x1b[1;1Haa\r\nbb\x1b[1;1H\x1bM", 20, 4);
    const ls = lines(g);
    expect(ls[0]).toBe("");
    expect(ls[1]).toBe("aa");
    expect(ls[2]).toBe("bb");
  });
});

describe("grid: SGR attributes", () => {
  it("parses bold + 256-colour + true-colour pens", () => {
    const g = new Grid(40, 4);
    const p = new VtParser(g);
    p.feed("\x1b[1;38;5;202mA\x1b[0m\x1b[38;2;10;20;30mB");
    const snap = g.getSnapshot();
    const rowCells = snap.lines[0].cells;
    expect(rowCells[0].attrs.bold).toBe(true);
    expect(rowCells[0].attrs.fg).toBe(202);
    expect(rowCells[1].attrs.fg).toBe(rgbColor(10, 20, 30));
    expect(rowCells[1].attrs.bold).toBe(false);
  });

  it("SGR 0 resets to defaults", () => {
    const g = new Grid(10, 2);
    new VtParser(g).feed("\x1b[31mX\x1b[0mY");
    const cells = g.getSnapshot().lines[0].cells;
    expect(cells[0].attrs.fg).toBe(1);
    expect(cells[1].attrs.fg).toBe(COLOR_DEFAULT);
  });
});

describe("grid: alt screen", () => {
  it("switches to a blank alt buffer and restores on exit", () => {
    const g = new Grid(20, 4);
    const p = new VtParser(g);
    p.feed("primary\x1b[?1049h");
    expect(g.getSnapshot().altScreen).toBe(true);
    expect(g.toText()).toBe(""); // alt starts blank
    p.feed("alt-content\x1b[?1049l");
    expect(g.getSnapshot().altScreen).toBe(false);
    expect(g.toText()).toBe("primary"); // primary preserved
  });
});

describe("grid: charset (DEC special graphics)", () => {
  it("maps q/x to box-drawing glyphs", () => {
    const g = run("\x1b(0qx\x1b(B");
    expect(lines(g)[0]).toBe("─│");
  });
});

describe("grid: device reports", () => {
  it("DA responds with a VT100 identity", () => {
    const replies: string[] = [];
    const g = new Grid(10, 2, { respond: (s) => replies.push(s) });
    new VtParser(g).feed("\x1b[c");
    expect(replies).toEqual(["\x1b[?1;2c"]);
  });

  it("DSR 6 reports the cursor position", () => {
    const replies: string[] = [];
    const g = new Grid(10, 4, { respond: (s) => replies.push(s) });
    new VtParser(g).feed("\x1b[2;5H\x1b[6n");
    expect(replies).toEqual(["\x1b[2;5R"]);
  });

  it("suppresses DA/DSR replies while replaying scrollback", () => {
    const replies: string[] = [];
    const g = new Grid(10, 4, { respond: (s) => replies.push(s) });
    const p = new VtParser(g);
    g.beginReplay();
    p.feed("history\x1b[c\x1b[6n"); // DA + DSR embedded in replayed history
    g.endReplay();
    expect(replies).toEqual([]); // no junk injected into the live PTY
    // Live queries after replay still get answered.
    p.feed("\x1b[c");
    expect(replies).toEqual(["\x1b[?1;2c"]);
  });
});

describe("grid: scrollback", () => {
  it("rows scrolled off the top land in scrollback", () => {
    const g = new Grid(10, 2);
    new VtParser(g).feed("a\r\nb\r\nc");
    const snap = g.getSnapshot();
    expect(snap.scrollbackLen).toBe(1);
    expect(snap.lines.map((r) => r.cells.map((c) => c.char).join("").trimEnd())).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("grid: combining marks", () => {
  it("attaches a combining accent to the preceding cell", () => {
    const g = run("é"); // e + combining acute
    const cells = g.getSnapshot().lines[0].cells;
    expect(cells[0].char).toBe("é");
    expect(cells[1].char).toBe(" "); // no extra cell consumed
  });
});

describe("grid: wide characters", () => {
  it("a CJK glyph occupies two cells", () => {
    const g = run("中x");
    const cells = g.getSnapshot().lines[0].cells;
    expect(cells[0].char).toBe("中");
    expect(cells[0].width).toBe(2);
    expect(cells[1].width).toBe(0); // spacer
    expect(cells[2].char).toBe("x");
  });
});

describe("grid: resize + reflow", () => {
  it("rewraps a soft-wrapped line when widened", () => {
    const g = new Grid(4, 4);
    new VtParser(g).feed("abcdefgh"); // wraps to "abcd","efgh" at width 4
    g.resize(8, 4);
    expect(g.toText().split("\n")[0]).toBe("abcdefgh");
  });

  it("rewraps when narrowed", () => {
    const g = new Grid(8, 4);
    new VtParser(g).feed("abcdefgh");
    g.resize(4, 4);
    const ls = g.toText().split("\n");
    expect(ls).toEqual(["abcd", "efgh"]);
  });

  it("preserves hard newlines across reflow", () => {
    const g = new Grid(10, 4);
    new VtParser(g).feed("hello\r\nworld");
    g.resize(3, 4);
    const ls = g.toText().split("\n");
    expect(ls).toEqual(["hel", "lo", "wor", "ld"]);
  });

  it("keeps the cursor on its content after reflow", () => {
    const g = new Grid(8, 4);
    new VtParser(g).feed("abcdefgh"); // cursor parked after h
    g.resize(4, 4);
    new VtParser(g).feed("Z");
    // After reflow to width 4, content is abcd/efgh; cursor was at end → Z on a new wrapped row.
    expect(g.toText()).toContain("Z");
  });
});

describe("grid: OSC 8 hyperlinks", () => {
  it("attaches a link to printed cells between begin and end", () => {
    const g = run("\x1b]8;;https://x.test\x07link\x1b]8;;\x07!");
    const cells = g.getSnapshot().lines[0].cells;
    expect(cells[0].link).toBe("https://x.test");
    expect(cells[3].link).toBe("https://x.test");
    expect(cells[4].link).toBeUndefined(); // "!" after the link ended
  });
});

describe("grid: OSC 133 shell integration", () => {
  it("records prompt/command/output marks", () => {
    const g = run("\x1b]133;A\x07$ \x1b]133;B\x07ls\r\n\x1b]133;C\x07out");
    const marks = g.getShellMarks();
    expect(marks.map((m) => m.type)).toEqual(["prompt", "command", "output"]);
  });
});

describe("conformance: a synthetic full-screen TUI (alt screen + box + status)", () => {
  it("renders a bordered box with a status line", () => {
    const g = new Grid(12, 5);
    const p = new VtParser(g);
    // Enter alt screen, hide cursor, draw a box with DEC line-drawing, status.
    p.feed("\x1b[?1049h\x1b[?25l\x1b[2J");
    p.feed("\x1b[1;1H\x1b(0lqqqqqqqqqqk\x1b(B"); // top border (12 wide)
    p.feed("\x1b[2;1H\x1b(0x\x1b(B Hi \x1b[1;33mthere\x1b[0m");
    p.feed("\x1b[5;1H\x1b[7m status \x1b[0m");
    const text = g.toText().split("\n");
    expect(text[0]).toBe("┌──────────┐");
    expect(text[1]).toContain("Hi");
    expect(text[1]).toContain("there");
    expect(text[4]).toContain("status");
    expect(g.getSnapshot().cursor.visible).toBe(false);
    // Leaving alt screen restores the (blank) primary buffer.
    p.feed("\x1b[?25h\x1b[?1049l");
    expect(g.getSnapshot().altScreen).toBe(false);
    expect(g.toText()).toBe("");
  });
});

describe("parser: UTF-8 / surrogate safety across chunks", () => {
  it("reassembles a surrogate pair split across feed() calls", () => {
    const g = new Grid(10, 2);
    const p = new VtParser(g);
    const emoji = "😀"; // U+1F600, two UTF-16 units
    p.feed(emoji[0]); // lone high surrogate
    p.feed(emoji[1]); // low surrogate
    expect(g.toText()).toBe(emoji);
  });

  it("handles an escape sequence split across feed() calls", () => {
    const g = new Grid(10, 2);
    const p = new VtParser(g);
    p.feed("a\x1b[2");
    p.feed(";1HX");
    expect(lines(g)[1]).toBe("X");
  });
});
