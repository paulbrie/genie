import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as projectService from "../project-service.js";
import { remoteDir } from "../vps/deploy-service.js";
import { execCached } from "../vps/ssh-session-cache.js";
import { provisionMcpRestConfig } from "../vps/mcp-config-merge.js";
import { verifyMcpInstall } from "../vps/mcp-verify.js";
import { type ClientState } from "../ws-server.js";

/** Handle `mcp:install` — (re)writes the project's `.mcp.json` so Claude on the
 *  VM points at the manager's genie-* MCP REST endpoints. No tunnels involved;
 *  this just writes the config (idempotent — safe to re-run after token
 *  rotation). Returns true if handled. */
export async function handleMcpMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  state: ClientState,
): Promise<boolean> {
  const userId = state.userId;
  switch (msg.type) {
    case "mcp:install": {
      if (!userId) return true;
      const { projectId, instanceId, reqId } = msg.payload as { projectId: string; instanceId: string; reqId?: string };
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst || !project) {
        send(ws, { type: "mcp:install:result", payload: { reqId, projectId, instanceId, ok: false, error: "No VPS deployment" } });
        return true;
      }
      try {
        const dest = remoteDir(project.name);
        const exec = (cmd: string) => execCached(vpsInst.connection, cmd);
        const wrote = await provisionMcpRestConfig(exec, dest, projectId, instanceId);
        if (!wrote) {
          send(ws, { type: "mcp:install:result", payload: { reqId, projectId, instanceId, ok: false, error: "MANAGER_URL unset — VM can't reach the manager" } });
          return true;
        }
        // Install isn't enough — verify it actually works end to end (right
        // token, right project, reachable, tracker responding) and surface any
        // running sessions still on the old config.
        const checks = await verifyMcpInstall(exec, project, instanceId);
        const ok = checks.every((c) => c.status !== "fail");
        console.log(`[mcp-rest] Config refreshed + verified for user ${userId} → ${project.name} (ok=${ok})`);
        send(ws, { type: "mcp:install:result", payload: { reqId, projectId, instanceId, ok, checks } });
      } catch (err: unknown) {
        console.error(`[mcp-rest] Config refresh failed for ${project.name}: ${(err instanceof Error ? err.message : String(err))}`);
        send(ws, { type: "mcp:install:result", payload: { reqId, projectId, instanceId, ok: false, error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
