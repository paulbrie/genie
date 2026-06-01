/**
 * Inbound WS handlers for the new SSH terminal layer.
 * Routes terminal:* / vps:stats:update frames into $vmConnections + xterm.
 */
import { batch } from "subjecto";

import { writeToTerminal } from "@/lib/terminal-bridge";
import { $vmConnections } from "../subjects/vps";
import { findVmConnectionByTerminalId } from "../actions/vm-connection";
import type { HandlerMap } from "./types";
import type { VmTmuxSession } from "../types/vps";

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
    });
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

  // One-shot SSH stats probe result (tmux sessions + a cpu/mem/disk snapshot),
  // requested via `vps:stats:refresh`. Distinct from the live daemon push
  // (`vps:stats:update`, handled in handlers/vps.ts) because only the SSH probe
  // can enumerate tmux sessions — the daemon payload carries no tmux.
  "vm:conn:stats": (payload) => {
    const { projectId, instanceId, stats, tmux, error } = payload as {
      projectId: string; instanceId: string;
      stats: { cpu: number; mem: number; disk: number } | null;
      tmux: VmTmuxSession[];
      error: string | null;
    };
    // Multiple popups can target the same VM — fan out to every matching slot
    // so each popup's gauges and tmux row stay in sync from one stats poll.
    const state = $vmConnections.getValue();
    const now = Date.now();
    batch(() => {
      for (const slot of Object.values(state.connections)) {
        if (slot.projectId !== projectId || slot.instanceId !== instanceId) continue;
        slot.stats = stats;
        slot.tmuxSessions = tmux || [];
        slot.statsError = error;
        slot.lastStatsAt = now;
      }
    });
  },
};
