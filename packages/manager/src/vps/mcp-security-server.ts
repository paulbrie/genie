import * as securityService from "../security-service.js";
import { type JsonRpcRequest, jsonRpcResponse, jsonRpcError, isNotification, initializeResult } from "./mcp-jsonrpc.js";

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

/**
 * Handle one JSON-RPC request for the genie-security MCP service. The bearer
 * token scopes the caller to one project, so scans are stored against and
 * listed for that `projectId` only — a project's VM can't see another's scans.
 * Returns a JSON-RPC response object, or null for a notification.
 */
export async function handleSecurityMcpRequest(parsed: JsonRpcRequest, projectId: string): Promise<object | null> {
  if (isNotification(parsed)) return null;
  const { id, method, params } = parsed;

  try {
    if (method === "initialize") {
      return initializeResult(id, "genie-security-mcp");
    }
    if (method === "tools/list") {
      return jsonRpcResponse(id, { tools: TOOLS });
    }
    if (method !== "tools/call") {
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }

    const toolName = params?.name as string;
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    if (toolName === "security_scan") {
      const target = args.target as string;
      if (!target) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Error: target is required." }],
          isError: true,
        });
      }
      // Run a full scan (blocking) with a no-op progress callback
      const ac = new AbortController();
      const scan = await securityService.runSecurityScan(target, {
        onProgress: () => {},
        signal: ac.signal,
      });

      // Stored under the system user but tagged with the caller's project so
      // list/get only surface this project's scans.
      await securityService.saveScan("system", scan, projectId);

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

      return jsonRpcResponse(id, {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      });
    }

    if (toolName === "security_list_scans") {
      const scans = await securityService.listScansByProject(projectId);
      const summary = scans.map((s) => ({
        id: s.id,
        target: s.target,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        findingsCount: s.findings.length,
        openPortsCount: s.ports.filter((p) => p.state === "open").length,
      }));
      return jsonRpcResponse(id, {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      });
    }

    if (toolName === "security_get_scan") {
      const scanId = args.scanId as string;
      if (!scanId) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Error: scanId is required." }],
          isError: true,
        });
      }
      const scans = await securityService.listScansByProject(projectId, 1000);
      const scan = scans.find((s) => s.id === scanId);
      if (!scan) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Scan ${scanId} not found.` }],
          isError: true,
        });
      }
      return jsonRpcResponse(id, {
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

    return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
  } catch (err: unknown) {
    console.error("[mcp-security] tool call failed:", err);
    return jsonRpcError(id, -32000, "Internal error — the request could not be completed.");
  }
}
