// Shared JSON-RPC helpers for the MCP REST handlers.
//
// Each genie-* MCP service exposes a pure `handle*McpRequest(parsed, ctx)` that
// returns a JSON-RPC response object, or `null` for a notification (no id) which
// the route acks with 202. HTTP/SSE framing lives once in the manager's
// /api/vps/mcp/:service route, not in each handler.

import http from "node:http";
import { Buffer } from "node:buffer";

export interface JsonRpcRequest {
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
}

export function jsonRpcResponse(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** True when the request carries no id and is therefore a notification. */
export function isNotification(parsed: JsonRpcRequest): boolean {
  return parsed.id === undefined || parsed.id === null;
}

/** Standard `initialize` reply for an MCP server with the given name. */
export function initializeResult(id: unknown, serverName: string) {
  return jsonRpcResponse(id, {
    protocolVersion: "2024-11-05",
    serverInfo: { name: serverName, version: "1.0.0" },
    capabilities: { tools: {} },
  });
}

/** Send a JSON-RPC result as a single SSE "message" event, per Streamable HTTP spec. */
function sendSseResponse(res: http.ServerResponse, payload: object) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
  res.end();
}

/**
 * Frame one Streamable-HTTP MCP request/response over a raw Node HTTP exchange:
 * method gating, body parse, notification 202s, and JSON-vs-SSE result framing.
 * `handler` is the transport-agnostic JSON-RPC handler. Shared by the manager's
 * /api/vps/mcp/:service REST route — the only HTTP transport now that the MCP
 * servers reach the manager directly instead of through reverse tunnels.
 */
export async function respondMcp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handler: (parsed: JsonRpcRequest) => Promise<object | null>,
): Promise<void> {
  if (req.method === "GET") {
    res.writeHead(405).end();
    return;
  }
  if (req.method === "DELETE") {
    res.writeHead(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString();

  let parsed: JsonRpcRequest;
  try {
    parsed = JSON.parse(body) as JsonRpcRequest;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" })
      .end(JSON.stringify(jsonRpcError(null, -32700, "Parse error")));
    return;
  }

  if (isNotification(parsed)) {
    await handler(parsed);
    res.writeHead(202).end();
    return;
  }

  try {
    const result = await handler(parsed);
    if (!result) {
      res.writeHead(202).end();
      return;
    }
    const accept = req.headers.accept || "";
    if (accept.includes("text/event-stream")) {
      sendSseResponse(res, result);
    } else {
      res.writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(result));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const errResp = jsonRpcError(parsed.id, -32000, message || "Internal error");
    res.writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(errResp));
  }
}
