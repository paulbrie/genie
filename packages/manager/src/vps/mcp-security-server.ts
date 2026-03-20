import http from "node:http";
import * as securityService from "../security-service.js";

const TOOLS = [
  {
    name: "security_scan",
    description:
      "Run a security scan on a target URL. Performs port scanning and web vulnerability checks. Returns findings and open ports when complete. This can take a few minutes.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "The target URL to scan (e.g. http://1.2.3.4:3000)",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "security_list_scans",
    description:
      "List previous security scan results. Returns scan summaries with status, target, findings count, and open ports count.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "security_get_scan",
    description:
      "Get a specific security scan by its ID. Returns full details including all findings and open ports.",
    inputSchema: {
      type: "object",
      properties: {
        scanId: {
          type: "string",
          description: "The scan ID to retrieve",
        },
      },
      required: ["scanId"],
    },
  },
];

function jsonRpcResponse(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

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
 * Create a local MCP HTTP server that exposes security scanning tools.
 * This server is tunneled to the VPS so Claude Code can use it as an MCP server.
 */
export function createMcpSecurityServer(): Promise<{ port: number; close(): void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
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

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify(jsonRpcError(null, -32700, "Parse error")));
        return;
      }

      const { id, method, params } = parsed as {
        id?: unknown;
        method?: string;
        params?: Record<string, unknown>;
      };

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
            serverInfo: { name: "genie-security-mcp", version: "1.0.0" },
            capabilities: { tools: {} },
          });
        } else if (method === "tools/list") {
          result = jsonRpcResponse(id, { tools: TOOLS });
        } else if (method === "tools/call") {
          const toolName = params?.name as string;
          const args = (params?.arguments ?? {}) as Record<string, unknown>;

          if (toolName === "security_scan") {
            const target = args.target as string;
            if (!target) {
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: "Error: target is required." }],
                isError: true,
              });
            } else {
              // Run a full scan (blocking) with a no-op progress callback
              const ac = new AbortController();
              const scan = await securityService.runSecurityScan(target, {
                onProgress: () => {},
                signal: ac.signal,
              });

              // Save scan to DB under "system" user
              await securityService.saveScan("system", scan);

              const summary = {
                id: scan.id,
                target: scan.target,
                status: scan.status,
                startedAt: scan.startedAt,
                completedAt: scan.completedAt,
                openPorts: scan.ports.filter((p) => p.state === "open").map((p) => ({ port: p.port, service: p.service, banner: p.banner })),
                findings: scan.findings.map((f) => ({
                  severity: f.severity,
                  category: f.category,
                  title: f.title,
                  description: f.description,
                  url: f.url,
                  evidence: f.evidence,
                })),
                error: scan.error,
              };

              result = jsonRpcResponse(id, {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(summary, null, 2),
                  },
                ],
              });
            }
          } else if (toolName === "security_list_scans") {
            const scans = await securityService.listScans("system");

            const summary = scans.map((s) => ({
              id: s.id,
              target: s.target,
              status: s.status,
              startedAt: s.startedAt,
              completedAt: s.completedAt,
              findingsCount: s.findings.length,
              openPortsCount: s.ports.filter((p) => p.state === "open").length,
            }));

            result = jsonRpcResponse(id, {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(summary, null, 2),
                },
              ],
            });
          } else if (toolName === "security_get_scan") {
            const scanId = args.scanId as string;
            if (!scanId) {
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: "Error: scanId is required." }],
                isError: true,
              });
            } else {
              const scans = await securityService.listScans("system", 1000);
              const scan = scans.find((s) => s.id === scanId);

              if (!scan) {
                result = jsonRpcResponse(id, {
                  content: [{ type: "text", text: `Scan ${scanId} not found.` }],
                  isError: true,
                });
              } else {
                result = jsonRpcResponse(id, {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(
                        {
                          id: scan.id,
                          target: scan.target,
                          status: scan.status,
                          startedAt: scan.startedAt,
                          completedAt: scan.completedAt,
                          openPorts: scan.ports.filter((p) => p.state === "open").map((p) => ({ port: p.port, service: p.service, banner: p.banner })),
                          findings: scan.findings,
                          error: scan.error,
                        },
                        null,
                        2,
                      ),
                    },
                  ],
                });
              }
            }
          } else {
            result = jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
          }
        } else {
          result = jsonRpcError(id, -32601, `Method not found: ${method}`);
        }

        const accept = req.headers.accept || "";
        if (accept.includes("text/event-stream")) {
          sendSseResponse(res, result);
        } else {
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const errResp = jsonRpcError(id, -32000, message || "Internal error");
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(errResp));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      console.log(`[mcp-security] Local HTTP server on port ${addr.port}`);
      resolve({
        port: addr.port,
        close() {
          server.close();
        },
      });
    });

    server.on("error", reject);
  });
}
