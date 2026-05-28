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

  // ResizeObserver for auto-fit, debounced. Each pointermove during a popup
  // resize fires the observer, and a per-frame fit() (a) thrashes xterm's
  // renderer enough to look like a freeze in production, and (b) detaches the
  // hidden helper textarea so fast that the focus-restore race keeps losing
  // — once focus is lost mid-drag the next observer's hadFocus check is
  // already false. Coalesce all observer fires from a drag into one fit
  // after the resize settles for SETTLE_MS; the CSS still resizes the
  // popup visually in real time, the terminal just reflows on release.
  const SETTLE_MS = 80;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let observerFireCount = 0; // [debug] reset each settle window
  const settledFit = () => {
    const fires = observerFireCount;
    observerFireCount = 0;
    settleTimer = null;
    requestAnimationFrame(() => {
      try {
        const rect = container.getBoundingClientRect();
        const beforeCols = terminal.cols;
        const beforeRows = terminal.rows;
        const active = document.activeElement;
        const hadFocus = !!terminal.element?.contains(active);
        // eslint-disable-next-line no-console
        console.log("[term-resize] settledFit RUN", {
          sessionId,
          observerFires: fires,
          container: { w: Math.round(rect.width), h: Math.round(rect.height) },
          before: { cols: beforeCols, rows: beforeRows },
          hadFocus,
          activeTag: active?.tagName,
          activeIsInTerminal: hadFocus,
        });
        fitAddon.fit();
        // eslint-disable-next-line no-console
        console.log("[term-resize] fit() done", {
          sessionId,
          after: { cols: terminal.cols, rows: terminal.rows },
          changed: beforeCols !== terminal.cols || beforeRows !== terminal.rows,
        });
        wsSend("terminal:resize", {
          id: sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
        if (hadFocus) {
          terminal.focus();
          const afterActive = document.activeElement;
          const focusRestored = !!terminal.element?.contains(afterActive);
          // eslint-disable-next-line no-console
          console.log("[term-resize] focus restore", {
            sessionId,
            focusRestored,
            activeTag: afterActive?.tagName,
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[term-resize] fit threw", { sessionId, err });
      }
    });
  };
  let lastW = -1;
  let lastH = -1;
  let unchangedRun = 0;
  const resizeObserver = new ResizeObserver((entries) => {
    observerFireCount++;
    const e = entries[0];
    const w = e?.contentRect ? Math.round(e.contentRect.width) : -1;
    const h = e?.contentRect ? Math.round(e.contentRect.height) : -1;
    const changed = w !== lastW || h !== lastH;
    if (changed) {
      // eslint-disable-next-line no-console
      console.log(`[term-resize] observer fire #${observerFireCount} w=${w} h=${h} dW=${w - lastW} dH=${h - lastH} (sess=${sessionId})`);
      lastW = w;
      lastH = h;
      unchangedRun = 0;
    } else {
      unchangedRun++;
      if (unchangedRun === 1 || unchangedRun === 5 || unchangedRun === 20) {
        // eslint-disable-next-line no-console
        console.warn(`[term-resize] observer fire #${observerFireCount} w=${w} h=${h} NO CHANGE (run=${unchangedRun}) — false fire (sess=${sessionId})`);
      }
    }
    if (settleTimer != null) clearTimeout(settleTimer);
    settleTimer = setTimeout(settledFit, SETTLE_MS);
  });
  resizeObserver.observe(container);

  instances.set(sessionId, { terminal, fitAddon, resizeObserver, sessionId });

  return terminal;
}

// [debug] write timing — log roughly every 32nd write AND any write whose
// synchronous portion takes >16ms (a dropped frame), so we can see if a
// single chunk is blocking the main thread and making the popup look frozen.
let __writeCount = 0;
export function writeToTerminal(sessionId: string, data: string): void {
  const inst = instances.get(sessionId);
  __writeCount++;
  const t0 = performance.now();
  inst?.terminal.write(data);
  const dt = performance.now() - t0;
  const sampled = (__writeCount & 31) === 0;
  const slow = dt > 16;
  if (sampled || slow) {
    // eslint-disable-next-line no-console
    (slow ? console.warn : console.log)(
      `[term-write] ${slow ? "SLOW " : ""}n=${__writeCount} bytes=${data.length} sync=${dt.toFixed(1)}ms cols=${inst?.terminal.cols} rows=${inst?.terminal.rows} hasInstance=${!!inst} (sess=${sessionId})`,
    );
  }
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

  // Create new ResizeObserver on the new container — debounced + instrumented
  // for the same reasons as in createTerminal.
  const SETTLE_MS = 80;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let observerFireCount = 0;
  const settledFit = () => {
    const fires = observerFireCount;
    observerFireCount = 0;
    settleTimer = null;
    requestAnimationFrame(() => {
      try {
        const rect = newContainer.getBoundingClientRect();
        const before = { cols: inst.terminal.cols, rows: inst.terminal.rows };
        const hadFocus = !!inst.terminal.element?.contains(document.activeElement);
        // eslint-disable-next-line no-console
        console.log("[term-resize:reattach] settledFit RUN", {
          sessionId,
          observerFires: fires,
          container: { w: Math.round(rect.width), h: Math.round(rect.height) },
          before,
          hadFocus,
        });
        inst.fitAddon.fit();
        // eslint-disable-next-line no-console
        console.log("[term-resize:reattach] fit() done", {
          sessionId,
          after: { cols: inst.terminal.cols, rows: inst.terminal.rows },
        });
        wsSend("terminal:resize", {
          id: sessionId,
          cols: inst.terminal.cols,
          rows: inst.terminal.rows,
        });
        if (hadFocus) inst.terminal.focus();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[term-resize:reattach] fit threw", { sessionId, err });
      }
    });
  };
  const resizeObserver = new ResizeObserver((entries) => {
    observerFireCount++;
    const e = entries[0];
    // eslint-disable-next-line no-console
    console.log("[term-resize:reattach] observer fire", {
      sessionId,
      n: observerFireCount,
      contentBox: e?.contentRect ? { w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) } : null,
    });
    if (settleTimer != null) clearTimeout(settleTimer);
    settleTimer = setTimeout(settledFit, SETTLE_MS);
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
