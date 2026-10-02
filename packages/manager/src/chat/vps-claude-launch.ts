/**
 * Shared helpers for launching the `claude` CLI on a project VPS.
 *
 * Extracted from vps-agent-router.ts so both the one-shot assistant chat and the
 * durable streaming chat session (claude-stream) provision the VM identically:
 * locate (or install) the binary, probe auth, and write an allow-all
 * settings.local.json. The genie-* MCP REST config is provisioned separately via
 * provisionMcpRestConfig (vps/mcp-config-merge.ts).
 *
 * All helpers run over a caller-supplied `ExecFn` so they work against either a
 * one-shot connectSsh session (`sshSession.exec`) or the cached pool
 * (`execCached(shellOpts, …)`).
 */

import { buildMcpConfigMergeScript, mcpRestBaseUrl } from "../vps/mcp-config-merge.js";
import { ensureInstanceToken } from "../vps/stats-token-service.js";

/** One-shot remote command runner. Mirrors `SshSession.exec` / `execCached`. */
export type ExecFn = (command: string, opts?: { timeoutMs?: number }) => Promise<string>;

const FIND_CLAUDE =
  `bash -lc "which claude 2>/dev/null" || command -v claude 2>/dev/null || ` +
  `for p in /usr/local/bin/claude /usr/bin/claude /root/.npm-global/bin/claude "$(npm bin -g 2>/dev/null)/claude"; do ` +
  `  [ -x "$p" ] && echo "$p" && exit 0; done; echo ""`;

/** Locate the `claude` binary on the VM, installing it globally if missing.
 *  Returns the absolute path, or "" if it could not be found or installed.
 *  `onStatus` surfaces install progress to the user (best-effort). */
export async function discoverClaudePath(
  exec: ExecFn,
  onStatus?: (status: string) => void,
): Promise<string> {
  let claudePath = (await exec(FIND_CLAUDE, { timeoutMs: 10_000 })).trim();
  if (claudePath) return claudePath;

  console.log(`[claude-launch] claude binary not found on VPS, installing...`);
  onStatus?.("Installing Claude Code CLI on VPS...");
  try {
    await exec(`npm install -g @anthropic-ai/claude-code`, { timeoutMs: 120_000 });
    claudePath = (await exec(FIND_CLAUDE, { timeoutMs: 10_000 })).trim();
  } catch (installErr: unknown) {
    console.error(`[claude-launch] Failed to install Claude Code CLI:`, installErr instanceof Error ? installErr.message : String(installErr));
  }
  return claudePath;
}

export interface ClaudeAuthInfo {
  hasSubscription: boolean;
  email: string;
  plan: string;
}

/** Parse the raw output of `claude auth status` into structured auth info.
 *  Pure (no SSH) so it can be reused by both the per-exec probe and the combined
 *  one-shot provisioning script (which captures the same output inline). */
export function parseAuthOutput(authOut: string): ClaudeAuthInfo {
  let hasSubscription = false;
  let email = "";
  let plan = "";
  hasSubscription = authOut.includes('"loggedIn": true') || authOut.includes('"loggedIn":true');
  try {
    const authJson = JSON.parse(authOut.trim());
    email = authJson.email || authJson.account || "";
    plan = authJson.plan || authJson.accountType || (hasSubscription ? "Max" : "");
  } catch {
    const emailMatch = authOut.match(/"email"\s*:\s*"([^"]+)"/);
    if (emailMatch) email = emailMatch[1];
    if (hasSubscription && !plan) plan = "Max";
  }
  return { hasSubscription, email, plan };
}

/** Probe `claude auth status` to decide whether the VM has a logged-in
 *  subscription (vs needing an ANTHROPIC_API_KEY) and to surface the account. */
export async function probeClaudeAuth(exec: ExecFn, claudePath: string): Promise<ClaudeAuthInfo> {
  try {
    return parseAuthOutput(await exec(`${claudePath} auth status 2>&1`, { timeoutMs: 10_000 }));
  } catch {
    return { hasSubscription: false, email: "", plan: "" }; // best-effort
  }
}

/** Per-VM provisioning cache. Locating the `claude` binary and probing
 *  `claude auth status` (a full Claude cold-start on the VM), plus the idempotent
 *  MCP-config / allow-all-settings writes, cost several serialized SSH round-trips
 *  on every chat open. None of it changes between opens of the same VM within a
 *  short window, so cache the result keyed by project:instance and skip the whole
 *  dance on a warm hit. TTL bounds staleness (a re-login or reinstall is picked up
 *  within ITL); a stale path/auth still produces a working launch (auth re-probes
 *  lazily; the binary path rarely moves). */
export interface ClaudeProvisionState {
  claudePath: string;
  auth: ClaudeAuthInfo;
  agentMd: string;
}
const PROVISION_TTL_MS = 5 * 60_000;
const provisionCache = new Map<string, { state: ClaudeProvisionState; at: number }>();

/** Return cached provisioning state for `key` if still fresh, else null. */
export function getCachedClaudeProvision(key: string): ClaudeProvisionState | null {
  const hit = provisionCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > PROVISION_TTL_MS) { provisionCache.delete(key); return null; }
  return hit.state;
}

export function setCachedClaudeProvision(key: string, state: ClaudeProvisionState): void {
  provisionCache.set(key, { state, at: Date.now() });
}

/** Drop a VM's cached provisioning state (e.g. after a launch fails because the
 *  binary or auth turned out stale) so the next open re-provisions from scratch. */
export function invalidateClaudeProvision(key: string): void {
  provisionCache.delete(key);
}

/** Remote node one-liner that merges `permissions.allow = ["*"]` into the
 *  project's settings.local.json — the in-script equivalent of
 *  writeAllowAllSettings, so the combined provisioning runs in a single exec
 *  instead of mkdir+read+write round-trips. */
function allowAllSettingsScript(dest: string): string {
  return [
    `mkdir -p ${dest}/.claude`,
    `node -e "`,
    `  const fs=require('fs');`,
    `  const p='${dest}/.claude/settings.local.json';`,
    `  let s={}; try{ s=JSON.parse(fs.readFileSync(p,'utf8')); }catch(e){}`,
    `  s.permissions = s.permissions || {};`,
    `  s.permissions.allow = ['*'];`,
    `  fs.writeFileSync(p, JSON.stringify(s,null,2));`,
    `"`,
  ].join("\n");
}

/** Fix C: do the whole per-VM provisioning in ONE SSH exec instead of ~7 serialized
 *  round-trips. A single bash script locates claude, reads AGENT.md, merges the
 *  allow-all settings + genie MCP config (both via remote node), and captures
 *  `claude auth status` — emitting the three read-back values between markers we
 *  parse here. Falls back to the install path if the binary is missing (rare).
 *  Returns null only when claude can't be found or installed. */
export async function provisionClaudeOneShot(
  exec: ExecFn,
  opts: { dest: string; projectId: string; instanceId: string },
  onStatus?: (status: string) => void,
): Promise<ClaudeProvisionState | null> {
  const { dest, projectId, instanceId } = opts;
  // Build the MCP merge step (skipped in local dev where the manager URL/token
  // aren't reachable from the VM — same condition provisionMcpRestConfig uses).
  let mcpScript = "";
  if (mcpRestBaseUrl()) {
    try {
      mcpScript = buildMcpConfigMergeScript(dest, mcpRestBaseUrl(), await ensureInstanceToken(projectId, instanceId));
    } catch (err) {
      console.warn(`[claude-launch] MCP token mint failed, skipping MCP config: ${err instanceof Error ? err.message : err}`);
    }
  }

  const script = [
    `P="$(${FIND_CLAUDE})"`,
    `echo "__GENIE_CP_START__"; printf '%s\\n' "$P"; echo "__GENIE_CP_END__"`,
    `echo "__GENIE_AM_START__"; cat ${dest}/AGENT.md 2>/dev/null || true; echo "__GENIE_AM_END__"`,
    allowAllSettingsScript(dest),
    mcpScript,
    `if [ -n "$P" ]; then echo "__GENIE_AUTH_START__"; "$P" auth status 2>&1 || true; echo "__GENIE_AUTH_END__"; fi`,
  ].join("\n");

  const out = await exec(script, { timeoutMs: 20_000 });
  const between = (a: string, b: string) => out.match(new RegExp(`${a}\\n([\\s\\S]*?)\\n?${b}`))?.[1] ?? "";
  let claudePath = between("__GENIE_CP_START__", "__GENIE_CP_END__").trim();
  const agentMd = between("__GENIE_AM_START__", "__GENIE_AM_END__").trim();
  let authOut = between("__GENIE_AUTH_START__", "__GENIE_AUTH_END__");

  if (!claudePath) {
    // Rare: binary missing — install (the settings/MCP writes above already ran,
    // they don't need claude) then re-probe just the path + auth.
    claudePath = await discoverClaudePath(exec, onStatus);
    if (!claudePath) return null;
    authOut = await exec(`${claudePath} auth status 2>&1`, { timeoutMs: 10_000 }).catch(() => "");
  }
  return { claudePath, agentMd, auth: parseAuthOutput(authOut) };
}

/** Merge `permissions.allow = ["*"]` into the project's
 *  `.claude/settings.local.json`, preserving any existing keys. Idempotent. */
export async function writeAllowAllSettings(exec: ExecFn, dest: string): Promise<void> {
  const claudeSettingsDir = `${dest}/.claude`;
  const claudeSettingsPath = `${claudeSettingsDir}/settings.local.json`;
  try {
    await exec(`mkdir -p ${claudeSettingsDir}`, { timeoutMs: 5_000 });
    const existingRaw = await exec(`cat ${claudeSettingsPath} 2>/dev/null || echo "{}"`, { timeoutMs: 5_000 });
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(existingRaw.trim()); } catch { /* keep empty */ }
    const perms = (settings.permissions as Record<string, unknown>) || {};
    perms.allow = ["*"];
    settings.permissions = perms;
    const settingsJson = JSON.stringify(settings, null, 2);
    await exec(`cat > ${claudeSettingsPath} << 'GENIEEOF'\n${settingsJson}\nGENIEEOF`, { timeoutMs: 5_000 });
  } catch (err) {
    console.error(`[claude-launch] Failed to write settings.local.json:`, err instanceof Error ? err.message : String(err));
  }
}
