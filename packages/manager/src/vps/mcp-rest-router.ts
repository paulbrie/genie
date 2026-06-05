// Manager-side REST endpoint for the genie-* MCP services.
//
// The VM's Claude reaches these over HTTPS (POST /api/vps/mcp/:service) using
// its per-instance bearer token — the same token the stats daemon posts with.
// No reverse SSH tunnels: the config is static and survives manager restarts.
//
// Auth resolves the token to its (projectId, instanceId) owner, then each
// service's pure `handle*` is invoked with the context it needs, built here.
// genie-browser is intentionally absent — it needs the user's local Chrome
// extension and has no server-reachable transport.

import http from "node:http";
import { type JsonRpcRequest, jsonRpcError, respondMcp } from "./mcp-jsonrpc.js";
import { resolveStatsToken } from "./stats-token-service.js";
import { getCachedSession } from "./ssh-session-cache.js";
import * as projectService from "../project-service.js";
import { handleTrackerRequest } from "./mcp-tracker-server.js";
import { handleSecurityMcpRequest } from "./mcp-security-server.js";
import { handleNotifyMcpRequest } from "./mcp-notify-server.js";
import { handleStorageMcpRequest } from "./mcp-storage-server.js";

/** The genie-* services served over REST. Mirrors MCP_REST_SERVICES in
 *  mcp-config-merge.ts (the set written into the VM's .mcp.json). */
export type McpRestService = "tracker" | "security" | "notify" | "storage";

/** Manager-side side effects the handlers need, injected to avoid importing
 *  ws-server here (which would form an import cycle). */
export interface McpRestDeps {
  /** Broadcast a saved chat message to the connected WS clients of these users. */
  broadcastChatMessage: (memberIds: string[], conversationId: string, message: unknown) => void;
  /** Nudge connected clients to refresh the tracker list after an issue change. */
  onIssueUpdated: () => void;
}

/**
 * Handle one `/api/vps/mcp/:service` request: authenticate the bearer token,
 * build the service context from its owner, and frame the JSON-RPC reply. The
 * caller has already matched `service` from the URL.
 */
export async function handleMcpRestRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  service: McpRestService,
  deps: McpRestDeps,
): Promise<void> {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.writeHead(401, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "Missing bearer token" }));
    return;
  }
  const owner = await resolveStatsToken(authHeader.slice(7).trim());
  if (!owner) {
    res.writeHead(401, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "Invalid token" }));
    return;
  }

  await respondMcp(req, res, (parsed) => dispatch(service, parsed, owner.projectId, owner.instanceId, deps));
}

function dispatch(
  service: McpRestService,
  parsed: JsonRpcRequest,
  projectId: string,
  instanceId: string,
  deps: McpRestDeps,
): Promise<object | null> {
  switch (service) {
    case "security":
      return handleSecurityMcpRequest(parsed, projectId);
    case "notify":
      return handleNotifyMcpRequest(parsed, { broadcastChatMessage: deps.broadcastChatMessage });
    case "tracker":
      return handleTrackerRequest(projectId, parsed, { onIssueUpdated: deps.onIssueUpdated });
    case "storage":
      return handleStorageMcpRequest2(parsed, projectId, instanceId);
  }
}

/** Storage needs an SSH session back into the VM (for screenshots + reading
 *  files to upload) and the project name as the storage key prefix — both
 *  resolved from the token's owner. */
async function handleStorageMcpRequest2(
  parsed: JsonRpcRequest,
  projectId: string,
  instanceId: string,
): Promise<object | null> {
  const project = await projectService.getById(projectId);
  const instance = project?.vpsInstances.find((v) => v.id === instanceId);
  if (!project || !instance) {
    return jsonRpcError(parsed.id, -32000, "VPS instance not found for this token");
  }
  const sshSession = await getCachedSession(instance.connection);
  return handleStorageMcpRequest(parsed, { sshSession, projectName: project.name });
}
