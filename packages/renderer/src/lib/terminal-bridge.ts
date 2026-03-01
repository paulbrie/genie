import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { wsSend } from "@/lib/ws";

// Catppuccin Mocha theme for xterm
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

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  resizeObserver: ResizeObserver;
  sessionId: string;
}

let activeInstance: TerminalInstance | null = null;

export function createTerminal(
  container: HTMLElement,
  sessionId: string
): Terminal {
  const terminal = new Terminal({
    theme: THEME,
    fontFamily: '"SF Mono", "Fira Code", monospace',
    fontSize: 12,
    lineHeight: 1.4,
    cursorBlink: true,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);

  // Initial fit
  requestAnimationFrame(() => {
    fitAddon.fit();
  });

  // Wire input to WS
  terminal.onData((data) => {
    wsSend("terminal:data", { id: sessionId, data });
  });

  // ResizeObserver for auto-fit
  const resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        wsSend("terminal:resize", {
          id: sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      } catch {
        // ignore resize errors during teardown
      }
    });
  });
  resizeObserver.observe(container);

  activeInstance = { terminal, fitAddon, resizeObserver, sessionId };

  return terminal;
}

export function getActiveTerminal(): TerminalInstance | null {
  return activeInstance;
}

export function writeToTerminal(data: string): void {
  activeInstance?.terminal.write(data);
}

export function disposeTerminal(): void {
  if (!activeInstance) return;
  activeInstance.resizeObserver.disconnect();
  activeInstance.terminal.dispose();
  activeInstance = null;
}
