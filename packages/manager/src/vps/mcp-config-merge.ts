// Builds the shell script that writes Genie's MCP server entries into a
// project's `.mcp.json` on the VM. The entries point Claude Code at the
// manager's public REST endpoints (POST /api/vps/mcp/:service) authenticated
// with the instance's bearer token — no SSH tunnels involved. The browser MCP
// is intentionally absent: it needs the user's local Chrome extension and has
// no server-reachable transport.

import { ensureInstanceToken } from "./stats-token-service.js";

/** The genie-* MCP services exposed over REST. */
export const MCP_REST_SERVICES = ["tracker", "security", "notify", "storage"] as const;

/** Manager base URL the VM uses to reach the MCP REST endpoints, or null in
 *  local dev where VMs can't reach the manager (same gate as stats postback). */
export function mcpRestBaseUrl(): string | null {
  return process.env.MANAGER_URL?.trim() || null;
}

/** Build the shell script that merges Genie's MCP REST entries into the
 *  project's `.mcp.json` on the VM without clobbering the user's other entries.
 *  Caller wraps it in their own `exec(...)`. */
export function buildMcpConfigMergeScript(
  remoteProjectDir: string,
  baseUrl: string,
  token: string,
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const entries = MCP_REST_SERVICES.map(
    (svc) =>
      `    cfg.mcpServers['genie-${svc}'] = { type: 'http', url: '${base}/api/vps/mcp/${svc}', headers: { Authorization: 'Bearer ${token}' } };`,
  );
  return [
    `existing=$(cat ${remoteProjectDir}/.mcp.json 2>/dev/null || echo '{"mcpServers":{}}')`,
    `echo "$existing" | node -e "`,
    `  const fs = require('fs');`,
    `  let input = '';`,
    `  process.stdin.on('data', d => input += d);`,
    `  process.stdin.on('end', () => {`,
    `    const cfg = JSON.parse(input);`,
    `    if (!cfg.mcpServers) cfg.mcpServers = {};`,
    // Drop the legacy tunnel-era browser entry if a prior provision left one.
    `    delete cfg.mcpServers['genie-browser'];`,
    ...entries,
    `    fs.writeFileSync('${remoteProjectDir}/.mcp.json', JSON.stringify(cfg, null, 2));`,
    `  });`,
    `"`,
  ].join("\n");
}

/** Mint the instance token and merge the MCP REST entries into the VM's
 *  `.mcp.json`. `exec` runs a shell command on the VM (an SshSession.exec or an
 *  execCached binding). Returns false (writing nothing) when MANAGER_URL is
 *  unset — local dev, where VMs can't reach the manager anyway. */
export async function provisionMcpRestConfig(
  exec: (cmd: string) => Promise<unknown>,
  remoteProjectDir: string,
  projectId: string,
  instanceId: string,
): Promise<boolean> {
  const baseUrl = mcpRestBaseUrl();
  if (!baseUrl) return false;
  const token = await ensureInstanceToken(projectId, instanceId);
  await exec(buildMcpConfigMergeScript(remoteProjectDir, baseUrl, token));
  return true;
}
