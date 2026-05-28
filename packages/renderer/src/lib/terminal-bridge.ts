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

const instances = new Map<string, TerminalInstance>();

export function createTerminal(
  container: HTMLElement,
  sessionId: string,
  onFitted?: (size: { cols: number; rows: number }) => void,
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

  terminal.parser.registerOscHandler(52, (data) => {
    const semi = data.indexOf(";");
    if (semi < 0) return false;
    const payload = data.slice(semi + 1);
    if (payload === "?" || payload === "") return true;
    try {
      const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      void navigator.clipboard?.writeText(text);
    } catch {
      return false;
    }
    return true;
  });

  // Initial fit + focus (keyboard goes to the remote PTY via onData only — do not
  // inject CSI focus sequences here; they get echoed by bash and corrupt TUIs).
  requestAnimationFrame(() => {
    try {
      fitAddon.fit();
    } catch {
      // ignore during teardown
    }
    terminal.focus();
    onFitted?.({ cols: terminal.cols, rows: terminal.rows });
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

  instances.set(sessionId, { terminal, fitAddon, resizeObserver, sessionId });

  return terminal;
}

export function writeToTerminal(sessionId: string, data: string): void {
  instances.get(sessionId)?.terminal.write(data);
}

export function focusTerminal(sessionId: string): void {
  instances.get(sessionId)?.terminal.focus();
}

export function refitTerminal(sessionId: string): void {
  const inst = instances.get(sessionId);
  if (!inst) return;
  try {
    inst.fitAddon.fit();
  } catch {
    // ignore
  }
}

export function hasTerminal(sessionId: string): boolean {
  return instances.has(sessionId);
}

export function reattachTerminal(sessionId: string, newContainer: HTMLElement): boolean {
  const inst = instances.get(sessionId);
  if (!inst) return false;

  // Disconnect old observer
  inst.resizeObserver.disconnect();

  // Move xterm DOM to new container
  const xtermElement = inst.terminal.element;
  if (xtermElement && xtermElement.parentElement !== newContainer) {
    newContainer.appendChild(xtermElement);
  }

  // Create new ResizeObserver on the new container
  const resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(() => {
      try {
        inst.fitAddon.fit();
        wsSend("terminal:resize", {
          id: sessionId,
          cols: inst.terminal.cols,
          rows: inst.terminal.rows,
        });
      } catch {
        // ignore resize errors during teardown
      }
    });
  });
  resizeObserver.observe(newContainer);
  inst.resizeObserver = resizeObserver;

  // Refit + focus
  requestAnimationFrame(() => {
    try {
      inst.fitAddon.fit();
      inst.terminal.focus();
    } catch {}
  });

  return true;
}

/** Immediately detach observer and remove from map; defer xterm.dispose() */
export function disposeTerminal(sessionId: string): void {
  const inst = instances.get(sessionId);
  if (!inst) return;
  inst.resizeObserver.disconnect();
  instances.delete(sessionId);
  setTimeout(() => {
    try { inst.terminal.dispose(); } catch { /* element may already be detached */ }
  }, 0);
}

export function disposeAllTerminals(): void {
  const all = [...instances.values()];
  for (const inst of all) {
    inst.resizeObserver.disconnect();
  }
  instances.clear();
  setTimeout(() => {
    for (const inst of all) {
      try { inst.terminal.dispose(); } catch { /* ignore */ }
    }
  }, 0);
}
