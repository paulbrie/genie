import { MCP_BROWSER_REMOTE_PORT, MCP_SECURITY_REMOTE_PORT, MCP_NOTIFY_REMOTE_PORT, MCP_STORAGE_REMOTE_PORT } from "./mcp-tunnel-pool.js";
import { VPS_AGENT_REMOTE_BASE } from "./vps-agent-rsync.js";

/** Headers Claude Code attaches to every genie-browser MCP request so the
 *  manager can route browser actions back to the right user/session/host. */
export interface BrowserHeaders {
  "x-genie-user-id": string;
  "x-genie-session-id": string;
  "x-genie-host": string;
  "x-genie-project-id": string;
  "x-genie-instance-id": string;
}

/** Which MCP tunnels are currently live for this VPS — only tunnels that
 *  exist get registered in `.mcp.json` so Claude Code doesn't try to dial
 *  endpoints that aren't there. */
export interface McpTunnelAvailability {
  /** Path to the genie-tracker stdio multiplexer socket on the VPS, or null
   *  if the stream tunnel isn't up. */
  streamTunnelSocketPath: string | null;
  hasSecurityTunnel: boolean;
  hasNotifyTunnel: boolean;
  hasStorageTunnel: boolean;
}

/** Build the shell script that merges Genie's MCP server entries into the
 *  project's `.mcp.json` on the VPS without clobbering whatever else the user
 *  has in there. Caller wraps it in their own `sshSession.exec(...)`.
 *
 *  Single source of truth — replaces the four near-identical heredoc copies
 *  that lived in `chat/vps-agent-router.ts`, `handlers/mcp-handler.ts`, and
 *  `ws-server.ts` (extension auth + MCP reconnect). Pass `browserHeaders: null`
 *  for the warm-reconnect path that has no chat session to bind headers to. */
export function buildMcpConfigMergeScript(
  remoteProjectDir: string,
  browserHeaders: BrowserHeaders | null,
  availability: McpTunnelAvailability,
): string {
  const browserEntry = browserHeaders
    ? `{ type: 'http', url: 'http://127.0.0.1:${MCP_BROWSER_REMOTE_PORT}/mcp', headers: ${JSON.stringify(browserHeaders)} }`
    : `{ type: 'http', url: 'http://127.0.0.1:${MCP_BROWSER_REMOTE_PORT}/mcp' }`;
  return [
    `existing=$(cat ${remoteProjectDir}/.mcp.json 2>/dev/null || echo '{"mcpServers":{}}')`,
    `echo "$existing" | node -e "`,
    `  const fs = require('fs');`,
    `  let input = '';`,
    `  process.stdin.on('data', d => input += d);`,
    `  process.stdin.on('end', () => {`,
    `    const cfg = JSON.parse(input);`,
    `    if (!cfg.mcpServers) cfg.mcpServers = {};`,
    `    cfg.mcpServers['genie-browser'] = ${browserEntry};`,
    ...(availability.streamTunnelSocketPath ? [
    `    cfg.mcpServers['genie-tracker'] = { type: 'stdio', command: 'node', args: ['${VPS_AGENT_REMOTE_BASE}/dist/mcp-cli.js', 'tracker'], env: { GENIE_MCP_SOCKET: '${availability.streamTunnelSocketPath}' } };`,
    ] : []),
    ...(availability.hasSecurityTunnel ? [
    `    cfg.mcpServers['genie-security'] = { type: 'http', url: 'http://127.0.0.1:${MCP_SECURITY_REMOTE_PORT}/mcp' };`,
    ] : []),
    ...(availability.hasNotifyTunnel ? [
    `    cfg.mcpServers['genie-notify'] = { type: 'http', url: 'http://127.0.0.1:${MCP_NOTIFY_REMOTE_PORT}/mcp' };`,
    ] : []),
    ...(availability.hasStorageTunnel ? [
    `    cfg.mcpServers['genie-storage'] = { type: 'http', url: 'http://127.0.0.1:${MCP_STORAGE_REMOTE_PORT}/mcp' };`,
    ] : []),
    `    fs.writeFileSync('${remoteProjectDir}/.mcp.json', JSON.stringify(cfg, null, 2));`,
    `  });`,
    `"`,
  ].join("\n");
}
