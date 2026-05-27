// VPS database handlers: detect connection URL from common env files, list
// databases/tables, run ad-hoc queries (CSV-parsed), and manage pg_dump-based
// backups under /opt/genie-backups. Every case opens its own SSH session;
// commands run host-native (psql/pg_dump) when available and fall back to the
// postgres:16-alpine docker image otherwise.

import { type WebSocket } from "ws";
import type { WsMessage as WsMessageBase } from "../types.js";
import { getVpsConnection } from "../vps/connection-resolver.js";
import { connectSsh } from "../vps/ssh-client.js";
import { parseTableList, parseCsvResult } from "./db-handler.js";
import * as projectService from "../project-service.js";

export interface WsMessage extends Omit<WsMessageBase, "payload"> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
}

export async function handleVpsDbMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
): Promise<boolean> {
  if (!msg.type.startsWith("vps:db:")) return false;
  // Project-membership gate (resolves a server from projectId+instanceId only).
  const dbProjectId = msg.payload?.projectId as string | undefined;
  if (dbProjectId && !(await projectService.userCanSeeProject(userId, dbProjectId))) {
    send(ws, { type: "error", payload: { message: "Not authorized for this project" } });
    return true;
  }
  switch (msg.type) {
    case "vps:db:detect": {
      const { projectId, instanceId, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 15_000 });
        try {
          const envOut = await session.exec(
            `cat /opt/project/.env 2>/dev/null; cat /opt/project/.env.local 2>/dev/null; cat /opt/project/.env.production 2>/dev/null`
          );
          const match = envOut.match(/(?:DATABASE_URL|POSTGRES_URL|DB_URL)\s*=\s*['"]?(postgres(?:ql)?:\/\/[^\s'"]+)/);
          if (match) {
            send(ws, { type: "vps:db:detect:result", payload: { ok: true, url: match[1], reqId } });
          } else {
            const pgOut = await session.exec(`docker exec $(docker ps --filter 'ancestor=postgres' -q 2>/dev/null | head -1) printenv 2>/dev/null || echo ""`);
            const pgUser = pgOut.match(/POSTGRES_USER=(\S+)/)?.[1] || "postgres";
            const pgPass = pgOut.match(/POSTGRES_PASSWORD=(\S+)/)?.[1];
            const pgDb = pgOut.match(/POSTGRES_DB=(\S+)/)?.[1] || pgUser;
            if (pgPass) {
              send(ws, { type: "vps:db:detect:result", payload: { ok: true, url: `postgres://${pgUser}:${pgPass}@localhost:5432/${pgDb}`, reqId } });
            } else {
              send(ws, { type: "vps:db:detect:result", payload: { ok: false, reqId } });
            }
          }
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:detect:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:db:databases": {
      const { projectId, instanceId, dbUrl, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 15_000 });
        try {
          const escapedUrl = (dbUrl as string).replace(/'/g, "'\\''");
          let out = await session.exec(
            `psql '${escapedUrl}' -t -A -c "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname" 2>&1`
          );
          if (out.includes("command not found")) {
            out = await session.exec(
              `docker run --rm --network host postgres:16-alpine psql '${escapedUrl}' -t -A -c "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname" 2>&1`
            );
          }
          const databases = out.trim().split("\n").filter(Boolean).filter(d => !d.includes("FATAL") && !d.includes("ERROR"));
          send(ws, { type: "vps:db:databases:result", payload: { ok: true, databases, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:databases:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:db:tables": {
      const { projectId, instanceId, dbUrl, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 15_000 });
        try {
          const escaped = (dbUrl as string).replace(/'/g, "'\\''");
          const out = await session.exec(
            `psql '${escaped}' -t -A -c "SELECT c.relname, c.reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname" 2>&1`
          );
          if (out.includes("command not found")) {
            const dockerOut = await session.exec(
              `docker run --rm --network host postgres:16-alpine psql '${escaped}' -t -A -c "SELECT c.relname, c.reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname" 2>&1`
            );
            const tables = parseTableList(dockerOut);
            send(ws, { type: "vps:db:tables:result", payload: { ok: true, tables, reqId } });
          } else if (out.includes("FATAL") || out.includes("could not connect")) {
            send(ws, { type: "vps:db:tables:result", payload: { ok: false, error: out.trim(), reqId } });
          } else {
            const tables = parseTableList(out);
            send(ws, { type: "vps:db:tables:result", payload: { ok: true, tables, reqId } });
          }
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:tables:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:db:query": {
      const { projectId, instanceId, dbUrl, query, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 30_000 });
        try {
          const escapedUrl = (dbUrl as string).replace(/'/g, "'\\''");
          const escapedQuery = (query as string).replace(/'/g, "'\\''");
          const out = await session.exec(
            `psql '${escapedUrl}' -c '${escapedQuery}' --csv 2>&1`
          );
          if (out.includes("command not found")) {
            const dockerOut = await session.exec(
              `docker run --rm --network host postgres:16-alpine psql '${escapedUrl}' -c '${escapedQuery}' --csv 2>&1`
            );
            const result = parseCsvResult(dockerOut);
            send(ws, { type: "vps:db:query:result", payload: { ok: !result.error, result, reqId } });
          } else if (out.includes("ERROR") || out.includes("FATAL")) {
            send(ws, { type: "vps:db:query:result", payload: { ok: false, error: out.trim(), reqId } });
          } else {
            const result = parseCsvResult(out);
            send(ws, { type: "vps:db:query:result", payload: { ok: !result.error, result, reqId } });
          }
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:query:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:db:backup:create": {
      const { projectId, instanceId, dbUrl, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 120_000 });
        try {
          const escapedUrl = (dbUrl as string).replace(/'/g, "'\\''");
          // /opt is root-owned; create dir via sudo and chown to ssh user so subsequent
          // pg_dump/gzip redirection and rm can run without sudo.
          await session.exec('sudo mkdir -p /opt/genie-backups && sudo chown "$(id -un):$(id -gn)" /opt/genie-backups');
          const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const fileName = `backup-${ts}.sql.gz`;
          const filePath = `/opt/genie-backups/${fileName}`;
          const testPgDump = await session.exec("which pg_dump 2>/dev/null || echo 'notfound'");
          const cmd = testPgDump.trim() === "notfound"
            ? `docker run --rm --network host postgres:16-alpine pg_dump '${escapedUrl}' 2>&1 | gzip > '${filePath}'`
            : `pg_dump '${escapedUrl}' 2>&1 | gzip > '${filePath}'`;
          await session.exec(cmd);
          const sizeOut = await session.exec(`stat -c%s '${filePath}' 2>/dev/null || stat -f%z '${filePath}' 2>/dev/null || echo 0`);
          const size = parseInt(sizeOut.trim()) || 0;
          if (size < 20) {
            await session.exec(`rm -f '${filePath}'`);
            send(ws, { type: "vps:db:backup:result", payload: { ok: false, error: "Backup failed — dump file is empty", reqId } });
          } else {
            send(ws, { type: "vps:db:backup:result", payload: { ok: true, fileName, size, reqId } });
          }
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:backup:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:db:backup:list": {
      const { projectId, instanceId, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 15_000 });
        try {
          await session.exec('sudo mkdir -p /opt/genie-backups && sudo chown "$(id -un):$(id -gn)" /opt/genie-backups');
          const out = await session.exec("ls -lh --time-style=long-iso /opt/genie-backups/*.sql.gz 2>/dev/null || echo ''");
          const backups = out.trim().split("\n").filter(Boolean).filter(l => !l.startsWith("total")).map((line) => {
            const parts = line.split(/\s+/);
            const size = parts[4] || "0";
            const date = parts[5] || "";
            const time = parts[6] || "";
            const fullPath = parts[7] || "";
            const name = fullPath.split("/").pop() || "";
            return { name, size, date: `${date} ${time}`, path: fullPath };
          }).filter(b => b.name);
          send(ws, { type: "vps:db:backup:result", payload: { ok: true, backups, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:backup:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:db:backup:download": {
      const { projectId, instanceId, fileName, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 60_000 });
        try {
          const safeName = (fileName as string).replace(/[^a-zA-Z0-9._-]/g, "");
          const filePath = `/opt/genie-backups/${safeName}`;
          const data = await session.exec(`base64 '${filePath}'`);
          send(ws, { type: "vps:db:backup:result", payload: { ok: true, data: data.replace(/\s/g, ""), fileName: safeName, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:backup:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:db:backup:delete": {
      const { projectId, instanceId, fileName, reqId } = msg.payload;
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn, { timeoutMs: 15_000 });
        try {
          const safeName = (fileName as string).replace(/[^a-zA-Z0-9._-]/g, "");
          await session.exec(`rm -f '/opt/genie-backups/${safeName}'`);
          send(ws, { type: "vps:db:backup:result", payload: { ok: true, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:db:backup:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    default:
      return false;
  }
}
