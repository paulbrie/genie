import { type WebSocket } from "ws";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WsMessage } from "../types.js";


const execFileAsync = promisify(execFile);

/** Handle local-machine `fs:*` messages (Genie desktop app reading the user's
 *  local disk — distinct from `vps:fs:*` which targets remote servers).
 *  Returns true if handled. */
export async function handleLocalFsMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
): Promise<boolean> {
  switch (msg.type) {
    case "fs:homePath": {
      const reqId = msg.payload?.reqId;
      send(ws, { type: "fs:result", payload: { path: os.homedir(), reqId } });
      return true;
    }

    case "fs:readDirectory": {
      const reqId = msg.payload?.reqId;
      try {
        const dirPath = msg.payload.path as string;
        const names = await fsp.readdir(dirPath);
        const entries = await Promise.all(
          names.filter((n: string) => !n.startsWith(".")).map(async (name: string) => {
            const fullPath = path.join(dirPath, name);
            try {
              const stat = await fsp.stat(fullPath);
              return { name, path: fullPath, isDirectory: stat.isDirectory(), size: stat.size, modifiedMs: stat.mtimeMs };
            } catch {
              return null;
            }
          }),
        );
        send(ws, { type: "fs:result", payload: { ok: true, entries: entries.filter(Boolean), reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "fs:readFile": {
      const reqId = msg.payload?.reqId;
      try {
        const filePath = msg.payload.path as string;
        const stat = await fsp.stat(filePath);
        if (stat.size > 1_000_000) {
          send(ws, { type: "fs:result", payload: { ok: true, content: null, binary: false, reqId } });
          return true;
        }
        const buf = await fsp.readFile(filePath);
        const isBinary = buf.includes(0);
        send(ws, { type: "fs:result", payload: { ok: true, content: isBinary ? null : buf.toString("utf-8"), binary: isBinary, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "fs:createFolder": {
      const reqId = msg.payload?.reqId;
      try {
        await fsp.mkdir(msg.payload.path as string, { recursive: true });
        send(ws, { type: "fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "fs:renameEntry": {
      const reqId = msg.payload?.reqId;
      try {
        await fsp.rename(msg.payload.oldPath as string, msg.payload.newPath as string);
        send(ws, { type: "fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "fs:deleteEntry": {
      const reqId = msg.payload?.reqId;
      try {
        await fsp.rm(msg.payload.path as string, { recursive: true, force: true });
        send(ws, { type: "fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "fs:openInFinder": {
      const reqId = msg.payload?.reqId;
      try {
        await execFileAsync("open", ["-R", msg.payload.path as string]);
        send(ws, { type: "fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "fs:openFile": {
      const reqId = msg.payload?.reqId;
      try {
        const editor = (() => {
          try {
            const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".genie", "settings.json"), "utf-8"));
            return s.defaultEditor || "Visual Studio Code";
          } catch { return "Visual Studio Code"; }
        })();
        await execFileAsync("open", ["-a", editor, msg.payload.path as string]);
        send(ws, { type: "fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    default:
      return false;
  }
}
