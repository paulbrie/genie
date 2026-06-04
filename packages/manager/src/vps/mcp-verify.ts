// Post-install verification for the genie-* MCP REST config on a VM. The
// "Install Genie MCPs" button writes /opt/project/.mcp.json; these read-only
// checks confirm it actually works end to end — the right token, scoped to the
// right project, reachable from the VM, tracker responding. (Clearing stale
// Claude sessions is a side-effect the handler performs separately.)

import { ensureInstanceToken, resolveStatsToken } from "./stats-token-service.js";
import { mcpRestBaseUrl, MCP_REST_SERVICES } from "./mcp-config-merge.js";
import { handleTrackerRequest } from "./mcp-tracker-server.js";
import type { ProjectDef } from "../types.js";

export interface McpCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/** Run the install verification suite. `exec` runs a shell command on the VM.
 *  Never throws — every probe degrades to a fail/warn check. */
export async function verifyMcpInstall(
  exec: (cmd: string) => Promise<string>,
  project: ProjectDef,
  instanceId: string,
): Promise<McpCheck[]> {
  const checks: McpCheck[] = [];
  const token = await ensureInstanceToken(project.id, instanceId);
  const base = mcpRestBaseUrl().replace(/\/+$/, "");

  // 1. Config written — read .mcp.json back and confirm all genie-* entries are
  //    present and the tracker token matches the one we just minted.
  let raw = "";
  try { raw = await exec(`cat /opt/project/.mcp.json 2>/dev/null`); } catch { /* unreadable */ }
  let servers: Record<string, { headers?: { Authorization?: string } }> = {};
  try { servers = (JSON.parse(raw)?.mcpServers ?? {}); } catch { /* not json yet */ }
  const present = MCP_REST_SERVICES.filter((s) => servers[`genie-${s}`]);
  const fileToken = (servers["genie-tracker"]?.headers?.Authorization ?? "").replace(/^Bearer\s+/, "");
  if (present.length === MCP_REST_SERVICES.length && fileToken === token) {
    checks.push({ name: "Config written", status: "ok", detail: `genie-${MCP_REST_SERVICES.join(", genie-")}` });
  } else if (fileToken && fileToken !== token) {
    checks.push({ name: "Config written", status: "fail", detail: "token on disk doesn't match — re-run install" });
  } else if (present.length > 0) {
    checks.push({ name: "Config written", status: "fail", detail: `only ${present.length}/${MCP_REST_SERVICES.length} genie-* entries in .mcp.json` });
  } else {
    checks.push({ name: "Config written", status: "fail", detail: "no genie-* entries found in /opt/project/.mcp.json" });
  }

  // 2. Token scope — the token must resolve to THIS project (the leak class we
  //    just fixed was a token resolving to a different project).
  const owner = await resolveStatsToken(token);
  if (owner && owner.projectId === project.id) {
    checks.push({ name: "Token scope", status: "ok", detail: `scoped to "${project.name}"` });
  } else {
    checks.push({ name: "Token scope", status: "fail", detail: owner ? "resolves to a DIFFERENT project" : "token does not resolve" });
  }

  // 3. VM → manager — curl the tracker endpoint from the VM with the token.
  //    200 = reachable + authenticated; 401 = reached but token rejected.
  let httpCode = "";
  try {
    httpCode = (await exec(
      `curl -s -m 10 -o /dev/null -w "%{http_code}" -X POST ${base}/api/vps/mcp/tracker ` +
      `-H "Authorization: Bearer ${token}" -H "Content-Type: application/json" ` +
      `-d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    )).trim();
  } catch { /* curl missing / network */ }
  if (httpCode === "200") {
    checks.push({ name: "VM → manager", status: "ok", detail: `${base} reachable (HTTP 200)` });
  } else if (httpCode === "401") {
    checks.push({ name: "VM → manager", status: "fail", detail: "reached manager but token rejected (401)" });
  } else {
    checks.push({ name: "VM → manager", status: "fail", detail: httpCode ? `unexpected HTTP ${httpCode}` : `could not reach ${base} from the VM` });
  }

  // 4. Tracker — list this project's issues in-process to show the scope the VM
  //    will see (the count is the human-meaningful confirmation).
  try {
    const resp = await handleTrackerRequest(project.id, { id: 1, method: "tools/call", params: { name: "tracker_list_issues", arguments: {} } });
    const text = (resp as { result?: { content?: { text?: string }[] } })?.result?.content?.[0]?.text ?? "[]";
    const arr = JSON.parse(text);
    const n = Array.isArray(arr) ? arr.length : 0;
    checks.push({ name: "Tracker", status: "ok", detail: `${n} ticket${n === 1 ? "" : "s"} in "${project.name}"` });
  } catch {
    checks.push({ name: "Tracker", status: "warn", detail: "could not list tickets" });
  }

  return checks;
}
