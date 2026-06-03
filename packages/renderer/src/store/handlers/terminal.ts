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
    const { terminalId } = payload as { terminalId: string };
    const conn = findVmConnectionByTerminalId(terminalId);
    if (!conn) return;
    batch(() => {
      const slot = $vmConnections.getValue().connections[conn.key];
      if (!slot) return;
      slot.status = "connected";
      slot.errorMessage = null;
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
