// Reconciles the on-VM git-autosave daemon to match the DB state for one
// (project, instance). Called whenever a row in vps_git_repos for that VM
// changes: enable/disable, token rotation, path change.
//
// The on-VM state is a pure function of `listAutoSaveWithTokens(...)`. The
// reconciler never reads the on-VM state — it overwrites unconditionally.
//
// Files written on the VM:
//   - /etc/genie/git-autosave.json        manifest of repo paths
//   - /home/genie/.git-credentials        plaintext tokens, 0600, genie:genie
//   - /usr/local/bin/git-autosave.sh      hourly script
//   - /etc/systemd/system/git-autosave.{service,timer}
//   - /var/log/git-autosave.log           daemon log, 0644, genie:genie
//
// When the manifest is empty, the timer is disabled and the files are removed.

import type { SshSession } from "./ssh-client.js";
import { listAutoSaveWithTokens, type VpsGitRepoWithToken } from "./git-repo-service.js";

interface ManifestEntry {
  path: string;
  repoUrl: string;
  provider: "github" | "gitlab" | "other";
}

const SCRIPT_BODY = `#!/usr/bin/env bash
set -u
MANIFEST=/etc/genie/git-autosave.json
[ -f "$MANIFEST" ] || exit 0
TS=$(date -u +"%Y-%m-%d %H:%M UTC")
jq -r '.[].path' "$MANIFEST" | while IFS= read -r REPO; do
  [ -d "$REPO/.git" ] || continue
  cd "$REPO" || continue
  git add -A 2>/dev/null || continue
  if [ -n "$(git status --porcelain)" ]; then
    git -c user.email=autosave@genie -c user.name=Genie commit -m "Auto-save $TS" --quiet || continue
    if git remote | head -1 | grep -q .; then
      git push --quiet 2>&1 || true
    fi
  fi
done
`;

const TIMER_UNIT = `[Unit]
Description=Genie git auto-save hourly timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
Persistent=true
Unit=git-autosave.service

[Install]
WantedBy=timers.target
`;

const SERVICE_UNIT = `[Unit]
Description=Genie git auto-save
After=network-online.target

[Service]
Type=oneshot
User=genie
ExecStart=/usr/local/bin/git-autosave.sh
StandardOutput=append:/var/log/git-autosave.log
StandardError=append:/var/log/git-autosave.log
`;

/** Username to embed in the https://USER:TOKEN@host credentials line. GitHub
 *  fine-grained PATs ignore the user but it must be present; the conventional
 *  value is `x-access-token`. GitLab + others use `oauth2`. */
function credentialUser(provider: ManifestEntry["provider"], host: string): string {
  if (provider === "github" || host === "github.com") return "x-access-token";
  return "oauth2";
}

function hostOf(repoUrl: string): string {
  try {
    return new URL(repoUrl).host;
  } catch {
    return "";
  }
}

/** Encode a base64 payload and `sudo tee` it to `dest`. `mode` is applied
 *  via chmod. Uses base64 so the payload can contain any byte — including
 *  the heredoc-killing newline-EOF combination — without quoting hassles. */
function writeFileCmd(dest: string, content: string, opts: { mode?: string; owner?: string } = {}): string {
  const b64 = Buffer.from(content, "utf-8").toString("base64");
  const parts = [
    `sudo mkdir -p $(dirname ${shellQuote(dest)})`,
    `echo ${shellQuote(b64)} | base64 -d | sudo tee ${shellQuote(dest)} > /dev/null`,
  ];
  if (opts.mode) parts.push(`sudo chmod ${opts.mode} ${shellQuote(dest)}`);
  if (opts.owner) parts.push(`sudo chown ${opts.owner} ${shellQuote(dest)}`);
  return parts.join(" && ");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Render the .git-credentials body — one https://user:token@host line per
 *  repo that has a token, deduped by host so a host with multiple repos
 *  shares one credential line. Skips entries without a token. */
function renderGitCredentials(repos: VpsGitRepoWithToken[]): string {
  const lines = new Set<string>();
  for (const r of repos) {
    if (!r.token) continue;
    const host = hostOf(r.repoUrl);
    if (!host) continue;
    const user = credentialUser(r.provider, host);
    lines.add(`https://${user}:${r.token}@${host}`);
  }
  return Array.from(lines).join("\n") + (lines.size ? "\n" : "");
}

/** Bring the on-VM daemon into agreement with the DB state for this
 *  (project, instance). Idempotent; safe to call after every CRUD op. */
export async function syncAutoSaveOnVm(
  session: SshSession,
  projectId: string,
  instanceId: string,
): Promise<void> {
  const repos = await listAutoSaveWithTokens(projectId, instanceId);

  if (repos.length === 0) {
    await session.exec(
      [
        "sudo systemctl disable --now git-autosave.timer 2>/dev/null || true",
        "sudo rm -f /etc/systemd/system/git-autosave.timer /etc/systemd/system/git-autosave.service /usr/local/bin/git-autosave.sh /etc/genie/git-autosave.json",
        "sudo systemctl daemon-reload",
      ].join(" && "),
      undefined,
      { timeoutMs: 30_000 },
    );
    return;
  }

  const manifest: ManifestEntry[] = repos.map((r) => ({
    path: r.repoPath,
    repoUrl: r.repoUrl,
    provider: r.provider,
  }));
  const credentials = renderGitCredentials(repos);

  const cmd = [
    writeFileCmd("/etc/genie/git-autosave.json", JSON.stringify(manifest), { mode: "0644" }),
    writeFileCmd("/usr/local/bin/git-autosave.sh", SCRIPT_BODY, { mode: "0755" }),
    writeFileCmd("/etc/systemd/system/git-autosave.timer", TIMER_UNIT, { mode: "0644" }),
    writeFileCmd("/etc/systemd/system/git-autosave.service", SERVICE_UNIT, { mode: "0644" }),
    // .git-credentials lives in the genie user's home; no sudo, write directly.
    credentials
      ? `printf %s ${shellQuote(credentials)} > /home/genie/.git-credentials && chmod 600 /home/genie/.git-credentials`
      : "rm -f /home/genie/.git-credentials",
    "git config --global credential.helper store",
    "sudo touch /var/log/git-autosave.log && sudo chown genie:genie /var/log/git-autosave.log",
    "sudo systemctl daemon-reload",
    "sudo systemctl enable --now git-autosave.timer",
  ].join(" && ");

  await session.exec(cmd, undefined, { timeoutMs: 60_000 });
}
