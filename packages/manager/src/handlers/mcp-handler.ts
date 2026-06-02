import { type WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { WsMessage } from "../types.js";
import * as projectService from "../project-service.js";
import { setupMcpTunnel } from "../vps/mcp-tunnel.js";
import { setupMcpStreamTunnel, type McpStreamTunnel } from "../vps/mcp-stream-tunnel.js";
import { setupMcpSecurityTunnel, type McpSecurityTunnel } from "../vps/mcp-security-tunnel.js";
import { setupMcpNotifyTunnel, type McpNotifyTunnel } from "../vps/mcp-notify-tunnel.js";
import { setupMcpStorageTunnel, type McpStorageTunnel } from "../vps/mcp-storage-tunnel.js";
import { remoteDir } from "../vps/deploy-service.js";
import { buildMcpConfigMergeScript } from "../vps/mcp-config-merge.js";
import { type ClientState, registerDomBrokerSession, createDomActionExecutor, broadcastToUsers, broadcastTrackerList } from "../ws-server.js";
import { MCP_BROWSER_REMOTE_PORT, MCP_SECURITY_REMOTE_PORT, MCP_NOTIFY_REMOTE_PORT, MCP_STORAGE_REMOTE_PORT, persistentMcpTunnels, tunnelKey, isTunnelLive, connectTunnelSsh } from "../vps/mcp-tunnel-pool.js";
/** Handle `mcp:tunnel:start` — sets up the persistent MCP tunnel pool entry
 *  for a project's VPS host on demand. Returns true if handled. */
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
      const host = vpsInst.connection.host;
      const key = tunnelKey(host);
      const tunnelSessionId = `manual-${uuidv4()}`;
      registerDomBrokerSession(tunnelSessionId, userId, host, projectId, instanceId);
      if (isTunnelLive(host)) {
        send(ws, { type: "mcp:tunnel:result", payload: { projectId, instanceId, ok: true } });
        return true;
      }
      try {
        const sshSession = await connectTunnelSsh(host, vpsInst.connection);
        const mcpTunnel = await setupMcpTunnel(
          sshSession,
          createDomActionExecutor(host),
          { remotePort: MCP_BROWSER_REMOTE_PORT },
        );

        let streamTunnel: McpStreamTunnel | undefined;
        try {
          streamTunnel = await setupMcpStreamTunnel(sshSession, { projectId: project.id, onIssueUpdated: () => { broadcastTrackerList().catch(() => { /* noop */ }); } });
        } catch (streamErr: unknown) {
          console.error(`[mcp-tunnel] Stream tunnel failed for ${project.name}: ${(streamErr instanceof Error ? streamErr.message : String(streamErr))}`);
        }

        let securityTunnel: McpSecurityTunnel | undefined;
        try {
          securityTunnel = await setupMcpSecurityTunnel(sshSession, { remotePort: MCP_SECURITY_REMOTE_PORT });
        } catch (secErr: unknown) {
          console.error(`[mcp-tunnel] Security tunnel failed for ${project.name}: ${(secErr instanceof Error ? secErr.message : String(secErr))}`);
        }

        let notifyTunnel: McpNotifyTunnel | undefined;
        try {
          notifyTunnel = await setupMcpNotifyTunnel(sshSession, (memberIds, conversationId, message) => {
            broadcastToUsers(memberIds, { type: "chat:message:new", payload: { conversationId, message } });
          }, { remotePort: MCP_NOTIFY_REMOTE_PORT });
        } catch (notifyErr: unknown) {
          console.error(`[mcp-tunnel] Notify tunnel failed for ${project.name}: ${(notifyErr instanceof Error ? notifyErr.message : String(notifyErr))}`);
        }

        let storageTunnel: McpStorageTunnel | undefined;
        try {
          storageTunnel = await setupMcpStorageTunnel(sshSession, project.name, { remotePort: MCP_STORAGE_REMOTE_PORT });
        } catch (storageErr: unknown) {
          console.error(`[mcp-tunnel] Storage tunnel failed for ${project.name}: ${(storageErr instanceof Error ? storageErr.message : String(storageErr))}`);
        }

        persistentMcpTunnels.set(key, { sshSession, mcpTunnel, streamTunnel, securityTunnel, notifyTunnel, storageTunnel, projectName: project.name, instanceHost: host, openedAt: Date.now(), alive: true });

        const dest = remoteDir(project.name);
        const mergeScript = buildMcpConfigMergeScript(
          dest,
          {
            "x-genie-user-id": userId,
            "x-genie-session-id": tunnelSessionId,
            "x-genie-host": host,
            "x-genie-project-id": projectId,
            "x-genie-instance-id": instanceId,
          },
          {
            streamTunnelSocketPath: streamTunnel?.socketPath ?? null,
            hasSecurityTunnel: !!securityTunnel,
            hasNotifyTunnel: !!notifyTunnel,
            hasStorageTunnel: !!storageTunnel,
          },
        );
        await sshSession.exec(mergeScript);

        console.log(`[mcp-tunnel] Web UI tunnel ready for user ${userId} → ${host}:${MCP_BROWSER_REMOTE_PORT} (${project.name})`);
        send(ws, { type: "mcp:tunnel:result", payload: { projectId, instanceId, ok: true } });
      } catch (err: unknown) {
        console.error(`[mcp-tunnel] Web UI tunnel failed for ${host}: ${(err instanceof Error ? err.message : String(err))}`);
        send(ws, { type: "mcp:tunnel:result", payload: { projectId, instanceId, ok: false, error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
