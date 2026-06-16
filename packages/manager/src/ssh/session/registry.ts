/**
 * In-memory map of active SSH terminal sessions, keyed by terminalId.
 * sessionMeta stores the (projectId, instanceId, ws) tuple so output can be
 * routed back to the originating WebSocket and per-VPS counts are cheap.
 */
import type { WebSocket } from "ws";

import type { SshShellSession } from "./shell.js";

export const sessions = new Map<string, SshShellSession>();
export const sessionMeta = new Map<
  string,
  {
    projectId: string | null;
    instanceId: string | null;
    host: string;
    /** The WebSocket currently receiving this terminal's output. `null` while
     *  the session is *orphaned* — the client socket dropped but the PTY is kept
     *  alive during the grace window so a reconnect can reattach. Output is
     *  buffered (see `outputTail`) and replayed on reattach. */
    ws: WebSocket | null;
    /** Terminal flavour, for analytics: "claude" for a Claude Code session,
     *  "shell" for a plain SSH shell. Authoritative value comes from the
     *  client's terminal:start payload (so reattaches stay correctly tagged). */
    kind: "claude" | "shell";
    /** Set when the session was orphaned (socket dropped); cleared on reattach. */
    orphanedAt?: number | null;
  }
>();

export function getSshSession(terminalId: string) {
  return sessions.get(terminalId);
}

/** Find an active shell session for a (project, instance) so stats polling
 *  can piggyback on it instead of opening a second SSH dial. */
export function findShellSessionForVps(
  projectId: string,
  instanceId: string,
): SshShellSession | null {
  for (const [terminalId, meta] of sessionMeta) {
    if (meta.projectId !== projectId || meta.instanceId !== instanceId) continue;
    const session = sessions.get(terminalId);
    if (session?.isExecReady()) return session;
  }
  return null;
}

export function findTerminalIdForVps(
  projectId: string,
  instanceId: string,
): string | null {
  for (const [terminalId, meta] of sessionMeta) {
    if (meta.projectId === projectId && meta.instanceId === instanceId) return terminalId;
  }
  return null;
}

export function getSessionCountForHost(host: string): number {
  let n = 0;
  for (const meta of sessionMeta.values()) {
    if (meta.host === host) n++;
  }
  return n;
}
