// Builds the shell script that writes Genie's MCP server entries into a
// project's `.mcp.json` on the VM. The entries point Claude Code at the
// manager's public REST endpoints (POST /api/vps/mcp/:service) authenticated
// with the instance's bearer token — no SSH tunnels involved. The browser MCP
// is intentionally absent: it needs the user's local Chrome extension and has
// no server-reachable transport.

import { ensureInstanceToken } from "./stats-token-service.js";

/** The genie-* MCP services exposed over REST. */
export const MCP_REST_SERVICES = ["tracker", "security", "notify", "storage"] as const;

/** Public API host of the manager, reachable from any VM. */
const DEFAULT_PUBLIC_MANAGER_URL = "https://api.genie.teleporthq.ai";

/** Base URL the VM uses to reach the manager's MCP REST endpoints. Must be
 *  publicly reachable from the VM — NOT the dev `MANAGER_URL` (localhost). So:
 *  `VPS_MANAGER_URL` override → `MANAGER_URL` when it's already public →
 *  otherwise the public API default. The serving manager must be the same one
 *  that minted the per-instance bearer token (else it 401s). */
export function mcpRestBaseUrl(): string {
  const override = process.env.VPS_MANAGER_URL?.trim();
  if (override) return override;
  const mgr = process.env.MANAGER_URL?.trim();
  if (mgr && !/(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)/.test(mgr)) return mgr;
  return DEFAULT_PUBLIC_MANAGER_URL;
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
    // Re-enable the genie-* servers: Claude Code parks .mcp.json servers it has
    // seen fail (e.g. the old localhost:9876 entries) in
    // .claude/settings.local.json → disabledMcpjsonServers, which keeps them off
    // even after we fix the URLs. Strip the genie-* names from that list.
    `if [ -f ${remoteProjectDir}/.claude/settings.local.json ]; then`,
    `  node -e "`,
    `    const fs = require('fs');`,
    `    const p = '${remoteProjectDir}/.claude/settings.local.json';`,
    `    try {`,
    `      const s = JSON.parse(fs.readFileSync(p, 'utf8'));`,
    `      if (Array.isArray(s.disabledMcpjsonServers)) {`,
    `        s.disabledMcpjsonServers = s.disabledMcpjsonServers.filter(n => !String(n).startsWith('genie-'));`,
    `        fs.writeFileSync(p, JSON.stringify(s, null, 2));`,
    `      }`,
    `    } catch (e) {}`,
    `  "`,
    `fi`,
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

/** Reset MCP state that a base-image/snapshot baked in from a DIFFERENT project.
 *  A server cloned from a snapshot inherits that snapshot's `.mcp.json` (the
 *  source project's bearer token) AND any Claude tmux sessions that were live
 *  when the snapshot was taken — both still bound to the source project, so its
 *  tracker tickets/storage show up on the new server. Kill those stale sessions
 *  (safe on a fresh deploy — no real user sessions exist yet) and rewrite
 *  `.mcp.json` for THIS instance. Best-effort; never throws. */
export async function resetSnapshotMcpState(
  exec: (cmd: string) => Promise<unknown>,
  remoteProjectDir: string,
  projectId: string,
  instanceId: string,
): Promise<void> {
  await exec(
    `for s in $(tmux ls 2>/dev/null | cut -d: -f1 | grep '^claude'); do tmux kill-session -t "$s" 2>/dev/null; done; true`,
  ).catch(() => {});
  await provisionMcpRestConfig(exec, remoteProjectDir, projectId, instanceId).catch(() => {});
}
