// Stdio MCP transport over an OpenSSH unix-socket reverse forward.
//
// One unix socket on the VM ( /tmp/genie-mcp-<random>.sock ) multiplexes every
// MCP server (tracker, security, notify, storage, ...). On the VM, the
// `genie-mcp <server>` binary connects to the socket, sends a 1-line JSON
// handshake naming the server, then pipes line-delimited JSON-RPC frames
// between Claude's stdio and the socket. Manager dispatches each socket
// connection to the matching handler module.
//
// Compared to the per-server HTTP reverse tunnels this replaces:
//   - no port-allocation (no MCP_*_REMOTE_PORT constants)
//   - no HTTP server on either side (just JSON-RPC over a stream)
//   - one channel to debug instead of N
//   - adding a new MCP server = register a handler, no tunnel plumbing

import crypto from "node:crypto";
import type { SshSession } from "./ssh-client.js";
import { handleTrackerRequest } from "./mcp-tracker-server.js";

export interface McpStreamHandler {
  /** Pure JSON-RPC dispatcher. Returns the response envelope (with id) or null
   *  for notifications. Errors are converted to JSON-RPC errors by the handler. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(req: { id?: unknown; method?: string; params?: Record<string, unknown> }): Promise<object | null>;
}

export interface McpStreamTunnelContext {
  projectId: string;
  /** Called whenever an MCP handler mutates state the renderer cares about
   *  (e.g. tracker writes). */
  onIssueUpdated?: () => void;
}

export interface McpStreamTunnel {
  /** The unix-socket path bound on the VM. Pass via GENIE_MCP_SOCKET to
   *  whatever process spawns `genie-mcp` so it knows where to connect. */
  socketPath: string;
  close(): void;
}

/** Build the per-server handler table. Adding a new server = add an entry here
 *  plus its handleXRequest export. No tunnel/port changes needed. */
function buildHandlers(ctx: McpStreamTunnelContext): Record<string, McpStreamHandler> {
  return {
    tracker: {
      handle: (req) => handleTrackerRequest(ctx.projectId, req, { onIssueUpdated: ctx.onIssueUpdated }),
    },
  };
}

export async function setupMcpStreamTunnel(
  sshSession: SshSession,
  ctx: McpStreamTunnelContext,
): Promise<McpStreamTunnel> {
  const socketPath = `/tmp/genie-mcp-${crypto.randomBytes(6).toString("hex")}.sock`;
  const handlers = buildHandlers(ctx);

  await sshSession.forwardInUnixSocket(socketPath);
  console.log(`[mcp-stream] reverse unix socket bound on VM at ${socketPath}`);

  sshSession.onUnixConnection((info, accept) => {
    if (info.socketPath !== socketPath) return;
    const channel = accept();

    // Per-connection line buffer. The first line is the handshake
    // ({"server": "tracker"}), every line after is a JSON-RPC frame.
    let buf = "";
    let handler: McpStreamHandler | null = null;

    channel.on("data", async (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line);
        } catch {
          // Don't kill the connection on a stray non-JSON line — log and skip.
          console.warn(`[mcp-stream] non-JSON line discarded: ${line.slice(0, 120)}`);
          continue;
        }

        if (!handler) {
          const serverName = parsed.server as string | undefined;
          const candidate = serverName ? handlers[serverName] : undefined;
          if (!candidate) {
            console.warn(`[mcp-stream] unknown server in handshake: ${serverName}`);
            try { channel.close(); } catch { /* ignore */ }
            return;
          }
          handler = candidate;
          continue;
        }

        try {
          const resp = await handler.handle(parsed as Parameters<McpStreamHandler["handle"]>[0]);
          if (resp !== null) channel.write(JSON.stringify(resp) + "\n");
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const id = parsed.id ?? null;
          channel.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n");
        }
      }
    });

    channel.on("error", (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mcp-stream] channel error: ${message}`);
    });
  });

  return {
    socketPath,
    close() {
      sshSession.unforwardInUnixSocket(socketPath).catch(() => {});
      console.log(`[mcp-stream] tunnel closed (${socketPath})`);
    },
  };
}
