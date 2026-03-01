import { WebSocketServer, type WebSocket } from "ws";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WsMessage } from "./types.js";
import * as store from "./store.js";
import * as appManager from "./app-manager.js";
import { startMonitoring, stopMonitoring, getDockerBin } from "./monitor.js";
import { handleChat } from "./chat.js";

const execFileAsync = promisify(execFile);

const PORT = 9876;
const clients = new Set<WebSocket>();

function broadcast(message: WsMessage): void {
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

function send(ws: WebSocket, message: WsMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

async function handleMessage(ws: WebSocket, msg: WsMessage): Promise<void> {
  switch (msg.type) {
    case "app:add": {
      const { name, command, cwd, env } = msg.payload;
      if (!name || !command) {
        send(ws, {
          type: "error",
          payload: { message: "name and command are required" },
        });
        return;
      }
      const app = store.add({ name, command, cwd, env });
      broadcast({ type: "app:list", payload: { apps: store.getAll() } });
      break;
    }

    case "app:remove": {
      const { id } = msg.payload;
      appManager.stopApp(id);
      const removed = store.remove(id);
      if (!removed) {
        send(ws, {
          type: "error",
          payload: { message: `App ${id} not found` },
        });
        return;
      }
      broadcast({ type: "app:list", payload: { apps: store.getAll() } });
      break;
    }

    case "app:start": {
      const { id } = msg.payload;
      const started = appManager.startApp(id);
      if (!started) {
        send(ws, {
          type: "error",
          payload: { message: `Cannot start app ${id}` },
        });
      }
      break;
    }

    case "app:stop": {
      const { id } = msg.payload;
      const stopped = appManager.stopApp(id);
      if (!stopped) {
        send(ws, {
          type: "error",
          payload: { message: `Cannot stop app ${id}` },
        });
      }
      break;
    }

    case "app:list": {
      send(ws, { type: "app:list", payload: { apps: store.getAll() } });
      break;
    }

    case "process:kill": {
      const { pid } = msg.payload;
      try {
        process.kill(pid, "SIGTERM");
      } catch (err: any) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to kill process ${pid}: ${err.message}` },
        });
      }
      break;
    }

    case "docker:open": {
      try {
        await execFileAsync("/usr/bin/open", ["-a", "Docker"]);
      } catch (err: any) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to open Docker: ${err.message}` },
        });
      }
      break;
    }

    case "docker:daemon:start": {
      try {
        await execFileAsync("/usr/bin/open", ["-a", "Docker"]);
      } catch (err: any) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to start Docker: ${err.message}` },
        });
      }
      break;
    }

    case "docker:daemon:stop": {
      try {
        await execFileAsync("/usr/bin/killall", ["Docker Desktop"]);
      } catch (err: any) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to stop Docker: ${err.message}` },
        });
      }
      break;
    }

    case "docker:start": {
      const { id } = msg.payload;
      const bin = getDockerBin();
      if (!bin) {
        send(ws, { type: "error", payload: { message: "Docker CLI not found" } });
        break;
      }
      try {
        await execFileAsync(bin, ["start", id]);
      } catch (err: any) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to start container ${id}: ${err.message}` },
        });
      }
      break;
    }

    case "docker:stop": {
      const { id } = msg.payload;
      const bin = getDockerBin();
      if (!bin) {
        send(ws, { type: "error", payload: { message: "Docker CLI not found" } });
        break;
      }
      try {
        await execFileAsync(bin, ["stop", id]);
      } catch (err: any) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to stop container ${id}: ${err.message}` },
        });
      }
      break;
    }

    case "chat:send": {
      const { messages } = msg.payload;
      void handleChat(
        messages,
        (token) => send(ws, { type: "chat:token", payload: { token } }),
        () => send(ws, { type: "chat:done", payload: {} }),
        (message) => send(ws, { type: "chat:error", payload: { message } }),
        (name, input, result) => send(ws, { type: "chat:tool", payload: { name, input, result } }),
      ).catch((err) => {
        send(ws, { type: "chat:error", payload: { message: err.message || "Chat failed" } });
      });
      break;
    }

    default:
      send(ws, {
        type: "error",
        payload: { message: `Unknown message type: ${msg.type}` },
      });
  }
}

export function createServer(): WebSocketServer {
  const wss = new WebSocketServer({ port: PORT });

  appManager.setEventCallback((event) => {
    broadcast(event as WsMessage);
  });

  startMonitoring((stats) => {
    broadcast({ type: "stats", payload: stats });
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`Client connected (${clients.size} total)`);

    // Send current app list and log backlog on connect
    send(ws, { type: "app:list", payload: { apps: store.getAll() } });
    const logs = appManager.getAllLogBuffers();
    for (const [id, data] of Object.entries(logs)) {
      send(ws, { type: "app:log", payload: { id, stream: "stdout", data } });
    }

    ws.on("message", (raw) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString());
        handleMessage(ws, msg);
      } catch {
        send(ws, {
          type: "error",
          payload: { message: "Invalid JSON message" },
        });
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`Client disconnected (${clients.size} total)`);
    });
  });

  wss.on("listening", () => {
    console.log(`Genie manager WebSocket server listening on port ${PORT}`);
  });

  return wss;
}

export function shutdown(wss: WebSocketServer): void {
  stopMonitoring();
  appManager.stopAll();
  for (const ws of clients) {
    ws.close();
  }
  clients.clear();
  wss.close();
}
