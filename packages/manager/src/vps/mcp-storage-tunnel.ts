import net from "node:net";
import type { SshSession } from "./ssh-client.js";
import { createMcpStorageServer } from "./mcp-storage-server.js";

export interface McpStorageTunnel {
  remotePort: number;
  close(): void;
}

export async function setupMcpStorageTunnel(
  sshSession: SshSession,
  projectName: string,
  opts?: { remotePort?: number },
): Promise<McpStorageTunnel> {
  // 1. Start local MCP HTTP server for storage
  const mcpServer = await createMcpStorageServer(sshSession, projectName);
  const localPort = mcpServer.port;

  // 2. Request a reverse tunnel on the VPS
  const remotePort = await sshSession.forwardIn("127.0.0.1", opts?.remotePort ?? 0);
  console.log(`[mcp-storage-tunnel] Reverse tunnel: VPS 127.0.0.1:${remotePort} → local 127.0.0.1:${localPort}`);

  // 3. Pipe incoming TCP connections to local MCP server
  sshSession.onTcpConnection((info, accept) => {
    if (info.destPort !== remotePort) return;

    const sshChannel = accept();
    const localConn = net.connect(localPort, "127.0.0.1", () => {
      sshChannel.pipe(localConn);
      localConn.pipe(sshChannel);
    });

    localConn.on("error", (err) => {
      console.error(`[mcp-storage-tunnel] Local connect error: ${err.message}`);
      try { sshChannel.close(); } catch {}
    });

    sshChannel.on("error", (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mcp-storage-tunnel] SSH channel error: ${message}`);
      localConn.destroy();
    });
  });

  return {
    remotePort,
    close() {
      sshSession.unforwardIn("127.0.0.1", remotePort).catch(() => {});
      mcpServer.close();
      console.log(`[mcp-storage-tunnel] Tunnel closed (remote port ${remotePort})`);
    },
  };
}
