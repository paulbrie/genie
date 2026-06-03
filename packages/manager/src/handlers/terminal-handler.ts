import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import {
  startSshSession,
  closeSshSession,
  handleTerminalData,
  handleTerminalResize,
  handleTerminalInject,
  handleTerminalPasteImage,
  type StartParams,
  type TmuxShellIntent,
} from "../ssh/index.js";
import { listSshConnections, killSshConnection, killSshConnectionsForHost, getSshConnectionInfo } from "../vps/ssh-metrics.js";
import { listRecentSshEvents } from "../vps/ssh-events.js";
import { evictAllSessionsForHost, evictSession, listSharedTunnels } from "../vps/ssh-session-cache.js";
/** Handle every `ssh:*` and `terminal:*` message. Returns true if handled. */
export async function handleTerminalMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  broadcast: (message: WsMessage) => void,
): Promise<boolean> {
  const sshListPayload = () => ({
    sessions: listSshConnections(),
    // genie-* MCPs run over REST now — no per-host MCP tunnels to report.
    tunnels: [],
    events: listRecentSshEvents(100),
    sharedTunnels: listSharedTunnels(),
  });

  switch (msg.type) {
    case "ssh:list": {
      send(ws, { type: "ssh:list", payload: sshListPayload() });
      return true;
    }

    case "ssh:tunnel:reconnect": {
      const { host } = msg.payload as { host?: string };
      if (!host || typeof host !== "string") {
        send(ws, { type: "ssh:tunnel:reconnect:result", payload: { host, ok: false, error: "host is required" } });
        return true;
      }
      // genie-* MCPs run over REST — nothing to reconnect. Ack so the existing
      // "Reconnect" UI control still resolves cleanly.
      send(ws, { type: "ssh:tunnel:reconnect:result", payload: { host, ok: true } });
      broadcast({ type: "ssh:list", payload: sshListPayload() });
      return true;
    }

    case "ssh:kill": {
      const { id, host: killHost } = msg.payload as { id?: string; host?: string };
      let killed = 0;
      if (typeof killHost === "string" && killHost) {
        killed = killSshConnectionsForHost(killHost);
        evictAllSessionsForHost(killHost);
      } else if (typeof id === "string") {
        const info = getSshConnectionInfo(id);
        if (killSshConnection(id)) {
          killed = 1;
          if (info) {
            evictSession({
              host: info.host,
              port: info.port,
              username: info.username,
              privateKeyPath: "",
            });
          }
        }
      }
      send(ws, { type: "ssh:kill:result", payload: { id, host: killHost, ok: killed > 0, killed } });
      broadcast({ type: "ssh:list", payload: sshListPayload() });
      return true;
    }

    case "terminal:start": {
      const { terminalId, projectId, instanceId, host, port, username, privateKeyPath,
        cols, rows, tmuxIntent, tmuxSessionName, initialCommand } = msg.payload as {
        terminalId?: string;
        projectId?: string; instanceId?: string;
        host?: string; port?: number; username?: string; privateKeyPath?: string;
        cols?: number; rows?: number;
        tmuxIntent?: TmuxShellIntent; tmuxSessionName?: string; initialCommand?: string;
      };
      if (!terminalId) {
        send(ws, { type: "terminal:error", payload: { terminalId: null, message: "terminalId is required" } });
        return true;
      }
      try {
        let startParams: StartParams;
        if (projectId && instanceId) {
          startParams = { kind: "project", projectId, instanceId };
        } else if (host && username && privateKeyPath) {
          startParams = { kind: "direct", host, port, username, privateKeyPath };
        } else {
          send(ws, { type: "terminal:error", payload: { terminalId, message: "Either (projectId+instanceId) or (host+username+privateKeyPath) is required" } });
          return true;
        }
        const intent = tmuxIntent === "attach" || tmuxIntent === "new" ? tmuxIntent : null;
        await startSshSession(ws, startParams, terminalId,
          cols ?? 80, rows ?? 24, intent, tmuxSessionName ?? null, initialCommand ?? null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start SSH session";
        send(ws, { type: "terminal:error", payload: { terminalId, message } });
      }
      return true;
    }

    case "terminal:data": {
      const { terminalId, data } = msg.payload as { terminalId?: string; data?: string };
      if (terminalId && typeof data === "string") {
        handleTerminalData(ws, terminalId, data);
      }
      return true;
    }

    case "terminal:resize": {
      const { terminalId, cols, rows } = msg.payload as { terminalId?: string; cols?: number; rows?: number };
      if (terminalId && cols && rows) handleTerminalResize(terminalId, cols, rows);
      return true;
    }

    case "terminal:inject": {
      const { terminalId, command, silent } = msg.payload as {
        terminalId?: string;
        command?: string;
        silent?: boolean;
      };
      if (terminalId && command) handleTerminalInject(ws, terminalId, command, { silent: !!silent });
      return true;
    }

    case "terminal:paste-image": {
      const { terminalId, dataB64, ext } = msg.payload as {
        terminalId?: string; dataB64?: string; ext?: string;
      };
      if (!terminalId || !dataB64) {
        send(ws, { type: "terminal:paste-image:result", payload: { terminalId: terminalId ?? null, ok: false, error: "terminalId and dataB64 are required" } });
        return true;
      }
      const result = await handleTerminalPasteImage(ws, terminalId, dataB64, ext || "png");
      send(ws, { type: "terminal:paste-image:result", payload: { terminalId, ...result } });
      return true;
    }

    case "terminal:close": {
      const { terminalId } = msg.payload as { terminalId?: string };
      if (terminalId) closeSshSession(terminalId, ws);
      return true;
    }

    default:
      return false;
  }
}
