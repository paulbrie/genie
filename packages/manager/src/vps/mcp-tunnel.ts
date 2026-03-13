import net from "node:net";
import type { SshSession } from "./ssh-client.js";
import type { DomActionExecutor } from "../types.js";
import { createMcpBrowserServer } from "./mcp-browser-server.js";

export interface McpTunnel {
  remotePort: number;
  close(): void;
}

export async function setupMcpTunnel(
  sshSession: SshSession,
  domExecutor: DomActionExecutor,
  opts?: { remotePort?: number },
): Promise<McpTunnel> {
  // 1. Start local MCP HTTP server
  const mcpServer = await createMcpBrowserServer(domExecutor);
  const localPort = mcpServer.port;

  // 2. Request a reverse tunnel on the VPS (fixed or random port)
  const remotePort = await sshSession.forwardIn("127.0.0.1", opts?.remotePort ?? 0);
  console.log(`[mcp-tunnel] Reverse tunnel: VPS 127.0.0.1:${remotePort} → local 127.0.0.1:${localPort}`);

  // 3. Pipe incoming TCP connections to local MCP server
  sshSession.onTcpConnection((info, accept) => {
    if (info.destPort !== remotePort) return;

    const sshChannel = accept();
    const localConn = net.connect(localPort, "127.0.0.1", () => {
      sshChannel.pipe(localConn);
      localConn.pipe(sshChannel);
    });

    localConn.on("error", (err) => {
      console.error(`[mcp-tunnel] Local connect error: ${err.message}`);
      try { sshChannel.close(); } catch {}
    });

    sshChannel.on("error", (err: any) => {
      console.error(`[mcp-tunnel] SSH channel error: ${err.message}`);
      localConn.destroy();
    });
  });

  return {
    remotePort,
    close() {
      sshSession.unforwardIn("127.0.0.1", remotePort).catch(() => {});
      mcpServer.close();
      console.log(`[mcp-tunnel] Tunnel closed (remote port ${remotePort})`);
    },
  };
}
