/**
 * xterm.js ↔ WebSocket bridge for one terminal session.
 *
 * Each interactive SSH terminal is identified by a `terminalId`. The bridge:
 *   1. Creates an xterm instance.
 *   2. Wires keystrokes → `terminal:data` over the WS.
 *   3. Decodes `terminal:output` (base64) frames into the xterm.
 *   4. Reports container resizes → `terminal:resize`.
 *
 * One xterm per terminalId; no per-VPS shared session.
 */
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import { wsSend } from "@/lib/ws";

const THEME = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  cursor: "#f5e0dc",
  cursorAccent: "#1e1e2e",
  selectionBackground: "#45475a",
  selectionForeground: "#cdd6f4",
  black: "#45475a",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#cba6f7",
  cyan: "#94e2d5",
  white: "#bac2de",
  brightBlack: "#585b70",
  brightRed: "#f38ba8",
  brightGreen: "#a6e3a1",
  brightYellow: "#f9e2af",
  brightBlue: "#89b4fa",
  brightMagenta: "#cba6f7",
  brightCyan: "#94e2d5",
  brightWhite: "#a6adc8",
};

/** Which wire namespace this xterm's outbound traffic uses.
 *  "terminal"   — VM SSH terminals (terminal:data / terminal:resize).
 *  "manager-pty" — local shell on the manager host (sidebar Terminal button). */
export type TerminalChannel = "terminal" | "manager-pty";

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  resizeObserver: ResizeObserver;
  terminalId: string;
  channel: TerminalChannel;
}

const instances = new Map<string, TerminalInstance>();

/** Wire `container` resizes to `fit() + terminal:resize` in lockstep. rAF-coalesced
 *  so multiple resize events in one frame trigger one fit. Returns the observer
 *  so the caller can disconnect on tear-down.
 *
 *  Why no setTimeout debounce: an 80ms debounce means up to 80ms of "xterm at
 *  new size, PTY at old size." During that gap a TUI like Claude Code computes
 *  its cursor-up-N math against the old size, lands in the wrong spot, and
 *  appends a fresh copy of its prompt instead of overwriting — visible as the
 *  "Enter to select..." line stacking up after a popup drag. rAF coalescing
 *  bounds the mismatch to one animation frame. */
function installFitOnResize(
  container: HTMLElement,
  terminal: Terminal,
  fitAddon: FitAddon,
  terminalId: string,
  channel: TerminalChannel,
): ResizeObserver {
  let pending = false;
  const flush = () => {
    pending = false;
    try {
      const hadFocus = !!terminal.element?.contains(document.activeElement);
      fitAddon.fit();
      wsSend(`${channel}:resize`, { terminalId, cols: terminal.cols, rows: terminal.rows });
      if (hadFocus) terminal.focus();
    } catch { /* tear-down race */ }
  };
  const observer = new ResizeObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(flush);
  });
  observer.observe(container);
  return observer;
}

export function createTerminal(
  container: HTMLElement,
  terminalId: string,
  onFitted?: (size: { cols: number; rows: number }) => void,
  channel: TerminalChannel = "terminal",
): Terminal {
  const terminal = new Terminal({
    theme: THEME,
    fontFamily: '"SF Mono", "Fira Code", monospace',
    fontSize: 13,
    lineHeight: 1.4,
    cursorBlink: true,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);

  // Canvas renderer: ~10× faster than DOM for chatty TUI output. Loaded
  // async because the addon touches `self` at module-eval time which would
  // crash Next's SSR prerender if imported statically.
  void import("@xterm/addon-canvas").then(({ CanvasAddon }) => {
    try { terminal.loadAddon(new CanvasAddon()); } catch { /* fall back to DOM */ }
  }).catch(() => { /* ignore */ });

  // In the alternate screen buffer (Claude TUI, vim, etc.) xterm's default
  // alt-scroll behavior translates mouse-wheel ticks into Up/Down arrow key
  // sequences. Claude Code interprets those as prompt-history navigation, so
  // scrolling over the popup cycles previously-sent prompts instead of doing
  // nothing. Swallow wheel events while the alt buffer is active; in the
  // normal buffer fall through so xterm scrollback still works.
  terminal.attachCustomWheelEventHandler((event) => {
    if (terminal.buffer.active.type === "alternate") {
      event.preventDefault();
      return false;
    }
    return true;
  });

  // OSC 52 → system clipboard, so tmux/Claude can write selections.
  terminal.parser.registerOscHandler(52, (data) => {
    const semi = data.indexOf(";");
    if (semi < 0) return false;
    const payload = data.slice(semi + 1);
    if (payload === "?" || payload === "") return true;
    try {
      const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
      void navigator.clipboard?.writeText(new TextDecoder().decode(bytes));
    } catch { return false; }
    return true;
  });

  requestAnimationFrame(() => {
    try { fitAddon.fit(); } catch { /* ignore */ }
    terminal.focus();
    onFitted?.({ cols: terminal.cols, rows: terminal.rows });
  });

  // keystrokes → server (channel doubles as the namespace prefix)
  terminal.onData((data) => {
    wsSend(`${channel}:data`, { terminalId, data });
  });

  const resizeObserver = installFitOnResize(container, terminal, fitAddon, terminalId, channel);

  instances.set(terminalId, { terminal, fitAddon, resizeObserver, terminalId, channel });
  return terminal;
}

/** Decode a base64 PTY output frame and feed it to xterm. */
export function writeToTerminal(terminalId: string, dataB64: string): void {
  const inst = instances.get(terminalId);
  if (!inst || !dataB64) return;
  try {
    const bytes = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
    inst.terminal.write(bytes);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[term] decode failed (term=${terminalId})`, err);
  }
}

export function focusTerminal(terminalId: string): void {
  instances.get(terminalId)?.terminal.focus();
}

export function refitTerminal(terminalId: string): void {
  const inst = instances.get(terminalId);
  if (!inst) return;
  try { inst.fitAddon.fit(); } catch { /* ignore */ }
}

export function getTerminalSize(terminalId: string): { cols: number; rows: number } | null {
  const inst = instances.get(terminalId);
  if (!inst) return null;
  return { cols: inst.terminal.cols, rows: inst.terminal.rows };
}

/** Wipe scrollback + screen — use before reconnecting so a fresh PTY doesn't
 *  append to a stale partial prompt line. */
export function clearTerminal(terminalId: string): void {
  const inst = instances.get(terminalId);
  if (!inst) return;
  inst.terminal.clear();
}

export function hasTerminal(terminalId: string): boolean {
  return instances.has(terminalId);
}

/** Move an existing xterm to a new container (used when the popup re-mounts). */
export function reattachTerminal(terminalId: string, newContainer: HTMLElement): boolean {
  const inst = instances.get(terminalId);
  if (!inst) return false;

  inst.resizeObserver.disconnect();
  const xtermEl = inst.terminal.element;
  if (xtermEl && xtermEl.parentElement !== newContainer) {
    newContainer.appendChild(xtermEl);
  }

  inst.resizeObserver = installFitOnResize(newContainer, inst.terminal, inst.fitAddon, terminalId, inst.channel);

  requestAnimationFrame(() => {
    try { inst.fitAddon.fit(); inst.terminal.focus(); } catch { /* ignore */ }
  });
  return true;
}

export function disposeTerminal(terminalId: string): void {
  const inst = instances.get(terminalId);
  if (!inst) return;
  inst.resizeObserver.disconnect();
  instances.delete(terminalId);
  setTimeout(() => { try { inst.terminal.dispose(); } catch { /* ignore */ } }, 0);
}

export function disposeAllTerminals(): void {
  const all = [...instances.values()];
  for (const inst of all) inst.resizeObserver.disconnect();
  instances.clear();
  setTimeout(() => {
    for (const inst of all) {
      try { inst.terminal.dispose(); } catch { /* ignore */ }
    }
  }, 0);
}
