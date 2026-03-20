import net from "node:net";
import type { SshSession } from "./ssh-client.js";
import { createMcpSecurityServer } from "./mcp-security-server.js";

export interface McpSecurityTunnel {
  remotePort: number;
  close(): void;
}

export async function setupMcpSecurityTunnel(
  sshSession: SshSession,
  opts?: { remotePort?: number },
): Promise<McpSecurityTunnel> {
  // 1. Start local MCP HTTP server for security scanning
  const mcpServer = await createMcpSecurityServer();
  const localPort = mcpServer.port;

  // 2. Request a reverse tunnel on the VPS
  const remotePort = await sshSession.forwardIn("127.0.0.1", opts?.remotePort ?? 0);
  console.log(`[mcp-security-tunnel] Reverse tunnel: VPS 127.0.0.1:${remotePort} → local 127.0.0.1:${localPort}`);

  // 3. Pipe incoming TCP connections to local MCP server
  sshSession.onTcpConnection((info, accept) => {
    if (info.destPort !== remotePort) return;

    const sshChannel = accept();
    const localConn = net.connect(localPort, "127.0.0.1", () => {
      sshChannel.pipe(localConn);
      localConn.pipe(sshChannel);
    });

    localConn.on("error", (err) => {
      console.error(`[mcp-security-tunnel] Local connect error: ${err.message}`);
      try { sshChannel.close(); } catch {}
    });

    sshChannel.on("error", (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mcp-security-tunnel] SSH channel error: ${message}`);
      localConn.destroy();
    });
  });

  return {
    remotePort,
    close() {
      sshSession.unforwardIn("127.0.0.1", remotePort).catch(() => {});
      mcpServer.close();
      console.log(`[mcp-security-tunnel] Tunnel closed (remote port ${remotePort})`);
    },
  };
}
