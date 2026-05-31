/**
 * The performer interface the {@link VtParser} drives.
 *
 * Keeps the parser (byte → intent) decoupled from the screen model
 * (intent → cell mutation). {@link Grid} is the production implementation;
 * tests can supply a spy/stub to assert exactly which methods a byte stream
 * triggers.
 *
 * Method names follow the canonical control-function mnemonics; see
 * https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
 */
export interface Terminal {
  // writing
  print(ch: string, width?: number): void;

  // C0 controls
  bell(): void;
  backspace(): void;
  tab(): void;
  carriageReturn(): void;
  lineFeed(): void;

  // cursor movement
  cursorUp(n?: number): void;
  cursorDown(n?: number): void;
  cursorForward(n?: number): void;
  cursorBack(n?: number): void;
  cursorNextLine(n?: number): void;
  cursorPrevLine(n?: number): void;
  cursorColumn(col: number): void; // CHA / HPA, 1-based
  cursorLine(row: number): void; // VPA, 1-based
  cursorPosition(row: number, col: number): void; // CUP / HVP, 1-based
  saveCursor(): void;
  restoreCursor(): void;
  setCursorVisible(v: boolean): void;

  // index / reverse-index
  index(): void; // IND
  reverseIndex(): void; // RI
  nextLine(): void; // NEL

  // erase
  eraseInDisplay(mode: number): void; // ED
  eraseInLine(mode: number): void; // EL
  eraseChars(n: number): void; // ECH

  // insert / delete
  insertChars(n: number): void; // ICH
  deleteChars(n: number): void; // DCH
  insertLines(n: number): void; // IL
  deleteLines(n: number): void; // DL
  scrollUp(n?: number): void; // SU
  scrollDown(n?: number): void; // SD

  // scroll region
  setScrollRegion(top: number, bottom: number): void; // DECSTBM

  // attributes
  setAttributes(codes: number[]): void; // SGR

  // modes
  setMode(mode: number, on: boolean): void; // ANSI mode
  setPrivateMode(mode: number, on: boolean): void; // DEC private mode
  setAppKeypad(on: boolean): void; // DECKPAM / DECKPNM

  // charset
  selectCharset(slot: "g0" | "g1", charset: "ascii" | "dec-special"): void;
  invokeCharset(which: 0 | 1): void; // LS0 / LS1

  // OSC / misc
  setTitle(t: string): void;
  setHyperlink(url: string | undefined): void; // OSC 8
  shellMark(type: "prompt" | "command" | "output"): void; // OSC 133
  reset(): void; // RIS

  // reports (write back to the PTY via the grid's responder)
  deviceAttributes(): void; // DA
  deviceStatusReport(mode: number): void; // DSR
}
