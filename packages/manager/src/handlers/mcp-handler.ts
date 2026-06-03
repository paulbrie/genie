import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as projectService from "../project-service.js";
import { remoteDir } from "../vps/deploy-service.js";
import { execCached } from "../vps/ssh-session-cache.js";
import { provisionMcpRestConfig } from "../vps/mcp-config-merge.js";
import { type ClientState } from "../ws-server.js";

/** Handle `mcp:tunnel:start` — (re)writes the project's `.mcp.json` so Claude on
 *  the VM points at the manager's MCP REST endpoints. There are no tunnels to
 *  build anymore; this just refreshes the config (e.g. after a token rotation).
 *  Returns true if handled. */
export async function handleMcpMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  state: ClientState,
): Promise<boolean> {
  const userId = state.userId;
  switch (msg.type) {
    case "mcp:tunnel:start": {
      if (!userId) return true;
      const { projectId, instanceId } = msg.payload as { projectId: string; instanceId: string };
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst || !project) {
        send(ws, { type: "mcp:tunnel:result", payload: { projectId, instanceId, ok: false, error: "No VPS deployment" } });
        return true;
      }
      try {
        const dest = remoteDir(project.name);
        const wrote = await provisionMcpRestConfig(
          (cmd) => execCached(vpsInst.connection, cmd),
          dest,
          projectId,
          instanceId,
        );
        if (!wrote) {
          send(ws, { type: "mcp:tunnel:result", payload: { projectId, instanceId, ok: false, error: "MANAGER_URL unset — VM can't reach the manager" } });
          return true;
        }
        console.log(`[mcp-rest] Config refreshed for user ${userId} → ${project.name}`);
        send(ws, { type: "mcp:tunnel:result", payload: { projectId, instanceId, ok: true } });
      } catch (err: unknown) {
        console.error(`[mcp-rest] Config refresh failed for ${project.name}: ${(err instanceof Error ? err.message : String(err))}`);
        send(ws, { type: "mcp:tunnel:result", payload: { projectId, instanceId, ok: false, error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
