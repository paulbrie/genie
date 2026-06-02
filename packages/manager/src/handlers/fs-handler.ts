// VPS file-system handlers: read/list directories, read/write files, chunked
// SFTP uploads (with cancel + stale-timer cleanup), download as tar.gz,
// rename, delete. All cases open a per-request SSH session (the upload path
// keeps it open across chunks via `pendingUploads`); errors uniformly reply
// on `vps:fs:result` with `ok: false`.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import { getVpsConnection } from "../vps/connection-resolver.js";
import { connectSsh, type SftpWriteHandle, type SshSession } from "../vps/ssh-client.js";
import { execCached } from "../vps/ssh-session-cache.js";
import * as projectService from "../project-service.js";


interface PendingUpload {
  session: SshSession;
  handle: SftpWriteHandle;
  offset: number;
  filePath: string;
  staleTimer: ReturnType<typeof setTimeout>;
}
const pendingUploads = new Map<string, PendingUpload>();

async function cleanupUpload(uploadId: string, opts: { deletePartial?: boolean } = {}) {
  const p = pendingUploads.get(uploadId);
  if (!p) return;
  clearTimeout(p.staleTimer);
  pendingUploads.delete(uploadId);
  try { await p.handle.close(); } catch { /* ignore */ }
  if (opts.deletePartial) {
    try {
      const escaped = p.filePath.replace(/'/g, "'\\''");
      await p.session.exec(`rm -f '${escaped}'`);
    } catch { /* ignore */ }
  }
  try { p.session.close(); } catch { /* ignore */ }
}

export async function handleFsMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
): Promise<boolean> {
  if (!msg.type.startsWith("vps:fs:")) return false;
  // Project-membership gate (these handlers resolve a server purely from
  // projectId+instanceId, so without this any user could touch any project's
  // files). userCanSeeProject admin-bypasses for admins/superadmins.
  const fsProjectId = msg.payload?.projectId as string | undefined;
  if (fsProjectId && !(await projectService.userCanSeeProject(userId, fsProjectId))) {
    send(ws, { type: "vps:fs:result", payload: { ok: false, error: "Not authorized for this project", reqId: msg.payload?.reqId } });
    return true;
  }
  switch (msg.type) {
    case "vps:fs:readDirectory": {
      const { projectId, instanceId, path: dirPath, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const escaped = dirPath.replace(/'/g, "'\\''");
        const out = await execCached(
          conn,
          `find '${escaped}' -maxdepth 1 -not -path '${escaped}' -printf '%T@ %s %y %f\\n' 2>/dev/null | sort -k4`,
          undefined,
          { timeoutMs: 20_000 },
        );
        const entries = out.trim().split("\n").filter(Boolean).map((line: string) => {
          const parts = line.split(" ");
          const modifiedMs = parseFloat(parts[0]) * 1000;
          const size = parseInt(parts[1]) || 0;
          const isDir = parts[2] === "d";
          const name = parts.slice(3).join(" ");
          return { name, path: dirPath.replace(/\/$/, "") + "/" + name, isDirectory: isDir, size, modifiedMs };
        });
        send(ws, { type: "vps:fs:result", payload: { ok: true, entries, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:fs:readFile": {
      const { projectId, instanceId, path: filePath, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const escaped = filePath.replace(/'/g, "'\\''");
        // Check size first
        const sizeOut = await execCached(conn, `stat -c '%s' '${escaped}' 2>/dev/null || echo 0`, undefined, { timeoutMs: 20_000 });
        const fileSize = parseInt(sizeOut.trim()) || 0;
        if (fileSize > 1_000_000) {
          send(ws, { type: "vps:fs:result", payload: { ok: true, content: null, binary: false, tooLarge: true, reqId } });
        } else {
          const content = await execCached(conn, `cat '${escaped}'`, undefined, { timeoutMs: 30_000 });
          const isBinary = /[\x00-\x08\x0E-\x1F]/.test(content.slice(0, 1000));
          send(ws, { type: "vps:fs:result", payload: { ok: true, content: isBinary ? null : content, binary: isBinary, reqId } });
        }
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:fs:writeFile": {
      const { projectId, instanceId, path: filePath, content, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const escaped = filePath.replace(/'/g, "'\\''");
        const b64 = Buffer.from(content as string).toString("base64");
        await execCached(conn, `echo '${b64}' | base64 -d > '${escaped}'`, undefined, { timeoutMs: 30_000 });
        send(ws, { type: "vps:fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:fs:upload": {
      // Chunked upload over SFTP. Client sends chunks (base64-encoded on the wire,
      // decoded here) with a shared uploadId. SFTP has proper flow control so chunk
      // writes ack reliably — unlike piping into `base64 -d` via execStreaming, which
      // can stall under SSH channel-window backpressure.
      const { uploadId, projectId, instanceId, path: uploadDir, fileName, dataBase64, chunkIndex, totalChunks, reqId } = msg.payload;
      try {
        if (typeof uploadId !== "string" || typeof chunkIndex !== "number" || typeof totalChunks !== "number") {
          throw new Error("upload requires uploadId, chunkIndex, totalChunks");
        }
        if (chunkIndex === 0) {
          await cleanupUpload(uploadId); // wipe any stale leftover with the same id
          const conn = await getVpsConnection(projectId, instanceId);
          const session = await connectSsh(conn);
          const filePath = `${(uploadDir as string).replace(/\/$/, "")}/${fileName}`;
          const handle = await session.sftpOpenWrite(filePath);
          const staleTimer = setTimeout(() => { cleanupUpload(uploadId, { deletePartial: true }).catch(() => {}); }, 10 * 60 * 1000);
          pendingUploads.set(uploadId, { session, handle, offset: 0, filePath, staleTimer });
        }
        const pending = pendingUploads.get(uploadId);
        if (!pending) throw new Error("no pending upload for this uploadId");

        const buf = Buffer.from(dataBase64, "base64");
        // SFTP single write is capped at the negotiated max packet (~32 KB). Fire the
        // sub-writes in parallel — SFTP allows ~64 outstanding requests, so this
        // pipelines over the SSH round-trip latency instead of paying it per packet.
        const SFTP_WRITE = 32 * 1024;
        const writes: Promise<void>[] = [];
        for (let p = 0; p < buf.length; p += SFTP_WRITE) {
          const slice = buf.subarray(p, Math.min(p + SFTP_WRITE, buf.length));
          writes.push(pending.handle.write(slice, pending.offset + p));
        }
        await Promise.all(writes);
        pending.offset += buf.length;

        if (chunkIndex + 1 === totalChunks) {
          await cleanupUpload(uploadId);
        }
        send(ws, { type: "vps:fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        if (typeof uploadId === "string") await cleanupUpload(uploadId, { deletePartial: true }).catch(() => {});
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:fs:upload-cancel": {
      const { uploadId } = msg.payload;
      if (typeof uploadId === "string") {
        await cleanupUpload(uploadId, { deletePartial: true }).catch(() => {});
      }
      return true;
    }

    case "vps:fs:rename": {
      const { projectId, instanceId, oldPath, newPath, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const escapedOld = (oldPath as string).replace(/'/g, "'\\''");
        const escapedNew = (newPath as string).replace(/'/g, "'\\''");
        await execCached(conn, `mv '${escapedOld}' '${escapedNew}'`, undefined, { timeoutMs: 20_000 });
        send(ws, { type: "vps:fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:fs:download": {
      const { projectId, instanceId, path: dlPath, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const name = (dlPath as string).split("/").pop() || "download";
        const parentDir = (dlPath as string).replace(/\/[^/]+$/, "") || "/";
        const escapedParent = parentDir.replace(/'/g, "'\\''");
        const data = await execCached(conn, `tar -czf - -C '${escapedParent}' '${name}' 2>/dev/null | base64`, undefined, { timeoutMs: 60_000 });
        send(ws, { type: "vps:fs:result", payload: { ok: true, data: data.replace(/\s/g, ""), fileName: `${name}.tar.gz`, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:fs:delete": {
      const { projectId, instanceId, path: delPath, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const escaped = (delPath as string).replace(/'/g, "'\\''");
        await execCached(conn, `rm -rf '${escaped}'`, undefined, { timeoutMs: 20_000 });
        send(ws, { type: "vps:fs:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:fs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    default:
      return false;
  }
}
