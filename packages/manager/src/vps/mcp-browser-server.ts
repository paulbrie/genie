import http from "node:http";
import type { DomActionExecutor, DomAction, DomActionParams } from "../types.js";

const TOOLS = [
  {
    name: "browser_get_snapshot",
    description: "Get an accessibility snapshot of the current page (elements with selectors, text, roles)",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_click",
    description: "Click an element on the page",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string", description: "CSS selector" } },
      required: ["selector"],
    },
  },
  {
    name: "browser_type",
    description: "Type text into an input element",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector" },
        value: { type: "string", description: "Text to type" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "browser_select",
    description: "Select an option from a dropdown",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the select element" },
        value: { type: "string", description: "Value to select" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the page or an element",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector (optional, defaults to page)" },
        direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
        amount: { type: "number", description: "Pixels to scroll (default 500)" },
      },
      required: ["direction"],
    },
  },
  {
    name: "browser_read_text",
    description: "Read text content of an element",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string", description: "CSS selector" } },
      required: ["selector"],
    },
  },
  {
    name: "browser_read_attr",
    description: "Read an attribute of an element",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector" },
        attribute: { type: "string", description: "Attribute name" },
      },
      required: ["selector", "attribute"],
    },
  },
  {
    name: "browser_navigate",
    description: "Navigate to a URL",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "URL to navigate to" } },
      required: ["url"],
    },
  },
  {
    name: "browser_wait_for",
    description: "Wait for an element to appear on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector to wait for" },
        timeout: { type: "number", description: "Timeout in ms (default 5000)" },
      },
      required: ["selector"],
    },
  },
];

const TOOL_TO_ACTION: Record<string, DomAction> = {
  browser_get_snapshot: "get_snapshot",
  browser_click: "click",
  browser_type: "type",
  browser_select: "select",
  browser_scroll: "scroll",
  browser_read_text: "read_text",
  browser_read_attr: "read_attr",
  browser_navigate: "navigate",
  browser_wait_for: "wait_for",
};

function jsonRpcResponse(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
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

export function createMcpBrowserServer(
  domExecutor: DomActionExecutor,
): Promise<{ port: number; close(): void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // Streamable HTTP: GET opens an SSE stream (we don't need server-initiated messages)
      if (req.method === "GET") {
        res.writeHead(405).end();
        return;
      }

      // Streamable HTTP: DELETE terminates session
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

      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify(jsonRpcError(null, -32700, "Parse error")));
        return;
      }

      const { id, method, params } = parsed;

      // Notifications (no id) — acknowledge with 202
      if (id === undefined || id === null) {
        res.writeHead(202).end();
        return;
      }

      try {
        let result: object;

        if (method === "initialize") {
          result = jsonRpcResponse(id, {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "genie-browser-mcp", version: "1.0.0" },
            capabilities: { tools: {} },
          });
        } else if (method === "tools/list") {
          result = jsonRpcResponse(id, { tools: TOOLS });
        } else if (method === "tools/call") {
          const toolName: string = params?.name;
          const action = TOOL_TO_ACTION[toolName];
          if (!action) {
            result = jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
          } else {
            const toolArgs: DomActionParams = params?.arguments ?? {};
            const domResult = await domExecutor(action, toolArgs);
            result = jsonRpcResponse(id, {
              content: [{ type: "text", text: domResult.result }],
              isError: !domResult.success,
            });
          }
        } else {
          result = jsonRpcError(id, -32601, `Method not found: ${method}`);
        }

        // Respond as SSE if client accepts it, otherwise plain JSON
        const accept = req.headers.accept || "";
        if (accept.includes("text/event-stream")) {
          sendSseResponse(res, result);
        } else {
          res.writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify(result));
        }
      } catch (err: any) {
        const errResp = jsonRpcError(id, -32000, err.message || "Internal error");
        res.writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify(errResp));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      console.log(`[mcp-browser] Local HTTP server on port ${addr.port}`);
      resolve({
        port: addr.port,
        close() { server.close(); },
      });
    });

    server.on("error", reject);
  });
}
