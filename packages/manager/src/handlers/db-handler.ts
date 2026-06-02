import { type WebSocket } from "ws";
import { spawn } from "node:child_process";
import path from "node:path";
import type { WsMessage } from "../types.js";
import * as adminService from "../admin-service.js";
import * as backupService from "../backup-service.js";


export function parseTableList(out: string): { name: string; rowCount: number | null }[] {
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const parts = line.split("|");
    const name = parts[0]?.trim();
    if (!name || name.startsWith("(") || name.includes("ERROR") || name.includes("FATAL")) return null;
    const count = parts[1] ? parseInt(parts[1].trim()) : null;
    return { name, rowCount: count !== null && count >= 0 ? count : null };
  }).filter(Boolean) as { name: string; rowCount: number | null }[];
}

export function parseCsvResult(out: string): { columns: string[]; rows: Record<string, unknown>[]; rowCount: number; error?: string } {
  const lines = out.trim().split("\n");
  if (lines.length === 0 || out.includes("ERROR") || out.includes("FATAL")) {
    return { columns: [], rows: [], rowCount: 0, error: out.trim() };
  }

  // First line is header
  const headerLine = lines[0];
  const columns = parseCsvLine(headerLine);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("(") || line.startsWith("--")) continue;
    const values = parseCsvLine(line);
    const row: Record<string, unknown> = {};
    columns.forEach((col, j) => { row[col] = values[j] ?? null; });
    rows.push(row);
  }

  return { columns, rows, rowCount: rows.length };
}

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export async function handleDbMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void
): Promise<boolean> {
  switch (msg.type) {
    case "admin:tables": {
      try {
        const tables = await adminService.listTables();
        send(ws, { type: "admin:tables", payload: { tables } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:table:columns": {
      try {
        const { tableName } = msg.payload;
        const columns = await adminService.getTableColumns(tableName);
        const primaryKey = await adminService.getPrimaryKey(tableName);
        send(ws, { type: "admin:table:columns", payload: { tableName, columns, primaryKey } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:table:rows": {
      try {
        const { tableName, page, pageSize, orderBy, orderDir } = msg.payload;
        const result = await adminService.getTableRows(tableName, { page, pageSize, orderBy, orderDir });
        send(ws, { type: "admin:table:rows", payload: result });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:row:get": {
      try {
        const { tableName, pkCol, pkVal } = msg.payload;
        const row = await adminService.getRow(tableName, pkCol, pkVal);
        send(ws, { type: "admin:row:get", payload: { row } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:row:insert": {
      try {
        const { tableName, data } = msg.payload;
        const row = await adminService.insertRow(tableName, data);
        send(ws, { type: "admin:row:inserted", payload: { tableName, row } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:row:update": {
      try {
        const { tableName, pkCol, pkVal, data } = msg.payload;
        const row = await adminService.updateRow(tableName, pkCol, pkVal, data);
        send(ws, { type: "admin:row:updated", payload: { tableName, row } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:row:delete": {
      try {
        const { tableName, pkCol, pkVal } = msg.payload;
        const row = await adminService.deleteRow(tableName, pkCol, pkVal);
        send(ws, { type: "admin:row:deleted", payload: { tableName, row } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:sql:execute": {
      try {
        const { query } = msg.payload;
        const result = await adminService.executeRawSql(query);
        send(ws, { type: "admin:sql:result", payload: result });
      } catch (err: unknown) {
        send(ws, { type: "admin:sql:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:drizzle:push": {
      try {
        // Backup DB before push
        send(ws, { type: "admin:drizzle:push:output", payload: { data: "Creating database backup...\n" } });
        try {
          const backupPath = await backupService.createBackup();
          send(ws, { type: "admin:drizzle:push:output", payload: { data: `Backup saved: ${backupPath}\n\n` } });
        } catch (backupErr: unknown) {
          send(ws, { type: "admin:drizzle:push:output", payload: { data: `Backup warning: ${(backupErr instanceof Error ? backupErr.message : String(backupErr))}\n\n` } });
        }

        const dir = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
        const cwd = path.resolve(dir, "../..");
        const child = spawn("npx", ["drizzle-kit", "push", "--force"], {
          cwd,
          shell: true,
          env: { ...process.env },
        });
        const sendChunk = (data: string) => {
          send(ws, { type: "admin:drizzle:push:output", payload: { data } });
        };
        child.stdout?.on("data", (buf: Buffer) => sendChunk(buf.toString()));
        child.stderr?.on("data", (buf: Buffer) => sendChunk(buf.toString()));
        child.on("close", (code) => {
          sendChunk(`\nProcess exited with code ${code}\n`);
          send(ws, { type: "admin:drizzle:push:done", payload: { code } });
        });
        child.on("error", (err) => {
          sendChunk(`\nError: ${(err instanceof Error ? err.message : String(err))}\n`);
          send(ws, { type: "admin:drizzle:push:done", payload: { code: 1 } });
        });
      } catch (err: unknown) {
        send(ws, { type: "admin:drizzle:push:output", payload: { data: `Error: ${(err instanceof Error ? err.message : String(err))}\n` } });
        send(ws, { type: "admin:drizzle:push:done", payload: { code: 1 } });
      }
      return true;
    }

    default:
      return false;
  }
}
