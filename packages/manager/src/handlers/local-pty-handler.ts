/**
 * Local-PTY terminals — a shell spawned on the manager host itself.
 *
 * Powers the bottom-left "Terminal" button in the sidebar (superadmin-only).
 * Wire namespace is `manager-pty:*` — deliberately distinct from `terminal:*`
 * (VM SSH connections) so neither side accidentally cross-routes a frame:
 *
 *   client → server                 server → client
 *   manager-pty:start  {id,...}     manager-pty:ready   {id,...}
 *   manager-pty:data   {id,data}    manager-pty:output  {id,dataB64}
 *   manager-pty:resize {id,c,r}     manager-pty:error   {id?,message}
 *   manager-pty:close  {id}         manager-pty:closed  {id,exitCode}
 *
 * The manager IS the prod server, so the existing renderer↔manager WebSocket
 * is enough — no SSH layer is involved. Output is coalesced through the same
 * 16ms batcher the SSH path uses (`ssh/session/output-batch.ts`) so chatty
 * TUI redraws don't produce a WS frame per chunk.
 */
import os from "node:os";
import * as pty from "node-pty";
import type { WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import { clearOutputBatch, scheduleOutputBatch } from "../ssh/session/output-batch.js";

type LocalSession = {
  pty: pty.IPty;
  ws: WebSocket;
};

const sessions = new Map<string, LocalSession>();

function sendOutput(ws: WebSocket, terminalId: string, data: Buffer) {
  try {
    ws.send(JSON.stringify({
      type: "manager-pty:output",
      payload: { terminalId, dataB64: data.toString("base64") },
    }));
  } catch { /* ws closed */ }
}

function disposeLocalPty(terminalId: string, notifyWs?: WebSocket, exitCode?: number) {
  const s = sessions.get(terminalId);
  if (!s) return;
  clearOutputBatch(terminalId, sendOutput);
  try { s.pty.kill(); } catch { /* already dead */ }
  sessions.delete(terminalId);
  if (notifyWs) {
    try {
      notifyWs.send(JSON.stringify({
        type: "manager-pty:closed",
        payload: { terminalId, exitCode: exitCode ?? null },
      }));
    } catch { /* ws closed */ }
  }
}

export function closeAllLocalPtySessionsForWs(ws: WebSocket) {
  for (const [id, s] of [...sessions]) {
    if (s.ws === ws) disposeLocalPty(id);
  }
}

export async function handleLocalPtyMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, m: WsMessage) => void,
): Promise<boolean> {
  switch (msg.type) {
    case "manager-pty:start": {
      const { terminalId, cols, rows } = msg.payload as {
        terminalId?: string;
        cols?: number;
        rows?: number;
      };
      if (!terminalId) {
        send(ws, { type: "manager-pty:error", payload: { terminalId: null, message: "terminalId is required" } });
        return true;
      }
      disposeLocalPty(terminalId);

      const shell = process.env.SHELL
        ?? (process.platform === "win32" ? "powershell.exe" : "/bin/bash");
      const child = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: cols ?? 80,
        rows: rows ?? 24,
        cwd: process.env.HOME || os.homedir(),
        env: process.env as Record<string, string>,
      });

      child.onData((data) => {
        scheduleOutputBatch(ws, terminalId, Buffer.from(data, "utf-8"), sendOutput);
      });
      child.onExit(({ exitCode }) => {
        clearOutputBatch(terminalId, sendOutput);
        sessions.delete(terminalId);
        send(ws, { type: "manager-pty:closed", payload: { terminalId, exitCode } });
      });

      sessions.set(terminalId, { pty: child, ws });
      send(ws, {
        type: "manager-pty:ready",
        payload: {
          terminalId,
          host: "localhost",
          username: process.env.USER ?? "manager",
        },
      });
      return true;
    }

    case "manager-pty:data": {
      const { terminalId, data } = msg.payload as { terminalId?: string; data?: string };
      if (!terminalId) return true;
      const s = sessions.get(terminalId);
      if (!s) return true;
      if (typeof data === "string" && data.length) s.pty.write(data);
      return true;
    }

    case "manager-pty:resize": {
      const { terminalId, cols, rows } = msg.payload as { terminalId?: string; cols?: number; rows?: number };
      if (!terminalId) return true;
      const s = sessions.get(terminalId);
      if (!s) return true;
      if (cols && rows) {
        try { s.pty.resize(cols, rows); } catch { /* size race during close */ }
      }
      return true;
    }

    case "manager-pty:close": {
      const { terminalId } = msg.payload as { terminalId?: string };
      if (!terminalId) return true;
      disposeLocalPty(terminalId, ws);
      return true;
    }

    default:
      return false;
  }
}
