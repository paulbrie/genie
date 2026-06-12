import type http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { verifyToken, getUserById } from "../auth/auth.js";
import { getErrorBuffer, getLogBuffer, LOG_CAPTURE_MAX_BUFFER } from "../logging/log-capture.js";

export type DebugLogSource = "errors" | "manager" | "all";

export interface DebugServerLogsResponse {
  fetchedAt: string;
  maxBufferBytes: number;
  /** stderr-only error stream (superadmin WS feed) */
  errors?: { bytes: number; data: string };
  /** stdout manager stream (admin-visible WS feed) */
  manager?: { bytes: number; data: string };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function authorizeDebugAccess(
  req: http.IncomingMessage,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const debugSecret = process.env.GENIE_DEBUG_SECRET?.trim();
  const headerKey = req.headers["x-genie-debug-key"];
  const suppliedKey = typeof headerKey === "string" ? headerKey : Array.isArray(headerKey) ? headerKey[0] : undefined;
  if (debugSecret && suppliedKey && safeEqual(suppliedKey, debugSecret)) {
    return { ok: true };
  }

  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (debugSecret && token && safeEqual(token, debugSecret)) {
      return { ok: true };
    }
    const decoded = verifyToken(token);
    if (!decoded) return { ok: false, status: 401, error: "Invalid token" };
    const user = await getUserById(decoded.userId);
    if (!user) return { ok: false, status: 401, error: "User not found" };
    if (user.role !== "superadmin") {
      return { ok: false, status: 403, error: "Superadmin role required" };
    }
    return { ok: true };
  }

  return {
    ok: false,
    status: 401,
    error: "Authorization required — Bearer <superadmin JWT>, Bearer <GENIE_DEBUG_SECRET>, or X-Genie-Debug-Key",
  };
}

function tailText(data: string, tail?: number): string {
  if (tail == null || !Number.isFinite(tail) || tail <= 0) return data;
  const n = Math.floor(tail);
  return data.length <= n ? data : data.slice(-n);
}

function parseSource(raw: string | null): DebugLogSource | null {
  if (!raw || raw === "errors") return "errors";
  if (raw === "manager" || raw === "all") return raw;
  return null;
}

function buildPayload(source: DebugLogSource, tail?: number): DebugServerLogsResponse {
  const body: DebugServerLogsResponse = {
    fetchedAt: new Date().toISOString(),
    maxBufferBytes: LOG_CAPTURE_MAX_BUFFER,
  };
  if (source === "errors" || source === "all") {
    const data = getErrorBuffer();
    body.errors = { bytes: data.length, data: tailText(data, tail) };
  }
  if (source === "manager" || source === "all") {
    const data = getLogBuffer();
    body.manager = { bytes: data.length, data: tailText(data, tail) };
  }
  return body;
}

/**
 * GET /api/debug/server-logs
 *   ?source=errors|manager|all   (default: errors)
 *   ?tail=<chars>                optional suffix trim
 *
 * Auth (any one):
 *   - Authorization: Bearer <superadmin JWT>
 *   - Authorization: Bearer <GENIE_DEBUG_SECRET> or X-Genie-Debug-Key: <GENIE_DEBUG_SECRET>
 */
export async function handleDebugServerLogs(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const match = req.url?.match(/^\/api\/debug\/server-logs(?:\?|$)/);
  if (!match || req.method !== "GET") return false;

  const auth = await authorizeDebugAccess(req);
  if (!auth.ok) {
    res.writeHead(auth.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: auth.error }));
    return true;
  }

  try {
    const url = new URL(req.url!, "http://127.0.0.1");
    const source = parseSource(url.searchParams.get("source"));
    if (!source) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid source — use errors, manager, or all" }));
      return true;
    }
    const tailRaw = url.searchParams.get("tail");
    const tail = tailRaw != null ? Number(tailRaw) : undefined;
    if (tailRaw != null && (!Number.isFinite(tail) || tail! < 0)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid tail — must be a non-negative number" }));
      return true;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(buildPayload(source, tail)));
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (err instanceof Error ? err.message : String(err)) }));
  }
  return true;
}

/** @internal test hook */
export const _debugApiTest = {
  authorizeDebugAccess,
  buildPayload,
  parseSource,
  tailText,
};
