#!/usr/bin/env node
//
// genie-mcp <server>
//
// Stdio MCP relay. Claude on the VM spawns this binary, which:
//   1. Reads the manager-supplied unix-socket path from $GENIE_MCP_SOCKET
//   2. Connects, sends a 1-line handshake naming the requested server
//   3. Pipes JSON-RPC frames between Claude's stdin/stdout and the socket
//
// No TCP ports, no HTTP — Claude treats us as an ordinary stdio MCP server.
// The other end of the socket is the manager (reverse-forwarded via SSH).

import net from "node:net";

const serverName = process.argv[2];
if (!serverName) {
  process.stderr.write("genie-mcp: missing server name (usage: genie-mcp <tracker|security|notify|storage>)\n");
  process.exit(2);
}

const socketPath = process.env.GENIE_MCP_SOCKET;
if (!socketPath) {
  process.stderr.write("genie-mcp: GENIE_MCP_SOCKET env var not set — was this launched outside a Genie chat session?\n");
  process.exit(2);
}

const sock = net.connect(socketPath);

sock.on("connect", () => {
  sock.write(JSON.stringify({ server: serverName }) + "\n");
  process.stdin.pipe(sock);
  sock.pipe(process.stdout);
});

sock.on("error", (err) => {
  process.stderr.write(`genie-mcp: socket error (${socketPath}): ${err.message}\n`);
  process.exit(1);
});

sock.on("close", () => {
  process.exit(0);
});

process.stdin.on("end", () => {
  try { sock.end(); } catch { /* ignore */ }
});
