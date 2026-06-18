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

/** Probe `claude auth status` to decide whether the VM has a logged-in
 *  subscription (vs needing an ANTHROPIC_API_KEY) and to surface the account. */
export async function probeClaudeAuth(exec: ExecFn, claudePath: string): Promise<ClaudeAuthInfo> {
  let hasSubscription = false;
  let email = "";
  let plan = "";
  try {
    const authOut = await exec(`${claudePath} auth status 2>&1`, { timeoutMs: 10_000 });
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
  } catch { /* auth probe best-effort */ }
  return { hasSubscription, email, plan };
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
