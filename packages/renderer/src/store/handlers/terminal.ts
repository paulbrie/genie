/**
 * Inbound WS handlers for the new SSH terminal layer.
 * Routes terminal:* / vps:stats:update frames into $vmConnections + xterm.
 */
import { batch } from "subjecto";

import { clearTerminal, getTerminalSize, refitTerminal, writeToTerminal } from "@/lib/terminal-bridge";
import { wsSend } from "@/lib/ws";
import { $vmConnections } from "../subjects/vps";
import { findVmConnectionByTerminalId } from "../actions/vm-connection";
import type { HandlerMap } from "./types";

export const handlers: HandlerMap = {
  "terminal:ready": (payload) => {
    const { terminalId, reattached, tmuxSessionName } = payload as {
      terminalId: string;
      reattached?: boolean;
      tmuxSessionName?: string | null;
    };
    const conn = findVmConnectionByTerminalId(terminalId);
    if (!conn) return;
    // Fresh PTY (not a grace-window reattach): wipe any stale scrollback before
    // the new session's output streams in. On a reattach we keep the scrollback
    // — the manager replays the buffered tail right after this message.
    if (reattached === false) clearTerminal(terminalId);
    batch(() => {
      const slot = $vmConnections.getValue().connections[conn.key];
      if (!slot) return;
      slot.status = "connected";
      slot.errorMessage = null;
      // Persist the server-resolved tmux session name (may have been generated
      // server-side). This is what lets a reconnect — including across a manager
      // restart — reattach to the surviving session on the VM.
      if (tmuxSessionName) slot.tmuxSessionName = tmuxSessionName;
      // After the first tmux launch, later reconnects should attach only.
      if (slot.tmuxIntent === "new" && slot.tmuxSessionName) {
        slot.tmuxIntent = "attach";
      }
    });
    refitTerminal(terminalId);
    const size = getTerminalSize(terminalId);
    if (size) {
      wsSend("terminal:resize", { terminalId, cols: size.cols, rows: size.rows });
    }
  },

  "terminal:output": (payload) => {
    const { terminalId, dataB64 } = payload as { terminalId: string; dataB64: string };
    writeToTerminal(terminalId, dataB64);
  },

  "terminal:traffic": (payload) => {
    const { terminalId, bytesIn, bytesOut } = payload as {
      terminalId: string; bytesIn: number; bytesOut: number;
    };
    const conn = findVmConnectionByTerminalId(terminalId);
    if (!conn) return;
    batch(() => {
      const slot = $vmConnections.getValue().connections[conn.key];
      if (!slot) return;
      slot.bytesIn = bytesIn;
      slot.bytesOut = bytesOut;
    });
  },

  "terminal:error": (payload) => {
    const { terminalId, message } = payload as { terminalId: string | null; message: string };
    if (!terminalId) {
      console.warn("[terminal] error (no terminalId):", message);
      return;
    }
    const conn = findVmConnectionByTerminalId(terminalId);
    if (!conn) return;
    batch(() => {
      const slot = $vmConnections.getValue().connections[conn.key];
      if (!slot) return;
      slot.status = "error";
      slot.errorMessage = message;
    });
  },

  "terminal:closed": (payload) => {
    const { terminalId } = payload as { terminalId: string };
    const conn = findVmConnectionByTerminalId(terminalId);
    if (!conn) return;
    batch(() => {
      const slot = $vmConnections.getValue().connections[conn.key];
      if (!slot) return;
      // Mark closed but keep the row so the UI can show "disconnected" until
      // the user explicitly dismisses the popup (which calls closeVmConnection
      // and removes the entry).
      slot.status = "closed";
    });
  },

  // Result of `terminal:paste-image`. Surfaced as a DOM CustomEvent so the
  // VM-connection popup can flash a short status line without coupling the
  // store handlers to component refs.
  "terminal:paste-image:result": (payload) => {
    const { terminalId, ok, remotePath, error } = payload as {
      terminalId: string | null; ok: boolean; remotePath?: string; error?: string;
    };
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("genie:terminal:paste-image:result", {
      detail: { terminalId, ok, remotePath, error },
    }));
  },
};
