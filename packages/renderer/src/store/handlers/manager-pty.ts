/**
 * Inbound WS handlers for the manager-pty:* namespace (sidebar "Terminal"
 * button — a local shell on the manager host, superadmin-only).
 *
 * Deliberately separate from handlers/terminal.ts (VM SSH terminals): same
 * xterm bridge, but distinct subjects and lifecycle.
 */
import { disposeTerminal, refitTerminal, writeToTerminal } from "@/lib/terminal-bridge";
import { removeTerminalTab } from "../actions/terminal";
import type { HandlerMap } from "./types";

export const handlers: HandlerMap = {
  "manager-pty:ready": (payload) => {
    const { terminalId } = payload as { terminalId: string };
    // The PTY is live — refit to push the post-mount geometry back so the
    // shell prompt isn't off by a few rows.
    refitTerminal(terminalId);
  },

  "manager-pty:output": (payload) => {
    const { terminalId, dataB64 } = payload as { terminalId: string; dataB64: string };
    writeToTerminal(terminalId, dataB64);
  },

  "manager-pty:error": (payload) => {
    const { terminalId, message } = payload as { terminalId: string | null; message: string };
    // eslint-disable-next-line no-console
    console.warn(`[manager-pty] error (term=${terminalId ?? "?"}):`, message);
    // Surface the failure inline in the xterm so it's not silent. UTF-8 → bytes
    // → Latin-1 string is the standard round-trip for btoa on non-ASCII.
    if (terminalId) {
      const bytes = new TextEncoder().encode(`\r\n\x1b[31m[manager-pty] ${message}\x1b[0m\r\n`);
      writeToTerminal(terminalId, btoa(String.fromCharCode(...bytes)));
    }
  },

  "manager-pty:closed": (payload) => {
    const { terminalId } = payload as { terminalId: string; exitCode?: number | null };
    disposeTerminal(terminalId);
    removeTerminalTab(terminalId);
  },
};
