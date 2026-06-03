import { VPS_SSH_USERNAME } from "../types.js";
import { connectSsh, type SshConnectionConfig } from "./ssh-client.js";

export interface BootstrapOpts {
  gitlabDeployKey?: string;
}

/** Probe whether the server is already Genie-ready: can we log in as `genie`
 *  and is Docker available? Both must be true for `vpsDeploy` to work. */
async function probeGenieReady(conn: SshConnectionConfig): Promise<boolean> {
  const genieConn: SshConnectionConfig = { ...conn, username: VPS_SSH_USERNAME };
  let session;
  try {
    session = await connectSsh(genieConn, { timeoutMs: 10_000 });
  } catch {
    return false;
  }
  try {
    const out = await session.exec("command -v docker >/dev/null 2>&1 && echo OK || echo MISSING");
    return out.includes("OK");
  } catch {
    return false;
  } finally {
    session.close();
  }
}

/** Run the full bootstrap (install Docker/Node/Claude Code, create `genie` user
 *  with sudo + /opt/project + docker group) using the provided sudo-capable user.
 *  Each step is idempotent so the function is safe to re-run. Throws on failure. */
async function runBootstrap(
  conn: SshConnectionConfig,
  opts: BootstrapOpts,
  onProgress: (msg: string) => void,
): Promise<void> {
  // 1. Install runtime: Docker, Node.js 20, Claude Code, @genie/vps-agent.
  //    Same script the TazCloud provisioner uses (apt + dnf paths) — idempotent,
  //    so it's safe to run on a server that already has some of these.
  onProgress("Installing Docker, Node.js, and Claude Code (idempotent)...");
  const bootstrapScript = [
    "set -e",
    "export DEBIAN_FRONTEND=noninteractive",
    "wait_apt() { local i=0; while sudo fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock >/dev/null 2>&1; do i=$((i+1)); [ \"$i\" -gt 600 ] && { echo 'Timeout waiting for apt lock'; exit 1; }; sleep 1; done; }",
    "if command -v apt-get >/dev/null 2>&1; then",
    "  wait_apt; sudo -E apt-get -o DPkg::Lock::Timeout=300 update -qq",
    "  wait_apt; sudo -E apt-get -o DPkg::Lock::Timeout=300 install -y -qq git curl ca-certificates > /dev/null",
    // docker.io conflicts with a pre-installed docker-ce (download.docker.com repo) — only install when no engine exists.
    "  command -v docker >/dev/null 2>&1 || { wait_apt; sudo -E apt-get -o DPkg::Lock::Timeout=300 install -y -qq docker.io > /dev/null; }",
    "  if ! command -v node >/dev/null 2>&1; then",
    "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null 2>&1",
    "    wait_apt; sudo -E apt-get -o DPkg::Lock::Timeout=300 install -y -qq nodejs > /dev/null",
    "  fi",
    "elif command -v dnf >/dev/null 2>&1; then",
    "  sudo dnf install -y -q docker git curl > /dev/null",
    "  if ! command -v node >/dev/null 2>&1; then",
    "    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - > /dev/null 2>&1",
    "    sudo dnf install -y -q nodejs > /dev/null",
    "  fi",
    "else",
    "  echo 'No supported package manager (need apt-get or dnf)'; exit 1",
    "fi",
    "sudo systemctl enable --now docker > /dev/null 2>&1 || true",
    // Docker Compose v2: no consistent apt/dnf package name across distros
    // (docker-compose-v2 only on Ubuntu 24.04+, docker-compose-plugin needs
    // docker-ce repo). Grab the binary from the official GitHub release —
    // works on any apt/dnf distro and arch. IPv4 forced for Taz VMs.
    "if ! docker compose version >/dev/null 2>&1; then",
    "  COMPOSE_VER=v2.29.7; ARCH=$(uname -m)",
    "  sudo mkdir -p /usr/local/lib/docker/cli-plugins",
    "  sudo curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \"https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-linux-${ARCH}\"",
    "  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose",
    "fi",
    "sudo npm install -g --silent @anthropic-ai/claude-code @genie/vps-agent 2>&1 | tail -3",
  ].join("\n");

  const bs = await connectSsh(conn);
  try {
    await bs.exec(
      `bash -s << 'GENIE_BOOTSTRAP_EOF'\n${bootstrapScript}\nGENIE_BOOTSTRAP_EOF`,
      (chunk) => {
        const line = chunk.trimEnd();
        if (line) onProgress(line.slice(0, 200));
      },
      { timeoutMs: 600_000, idleTimeoutMs: 180_000 },
    );
  } finally {
    bs.close();
  }

  // 2. Create the `genie` user with passwordless sudo, copy authorized_keys from
  //    the current user, create /opt/project, and add to the docker group. All
  //    steps gated by `id ... &>/dev/null ||` so re-running is a no-op.
  onProgress(`Ensuring '${VPS_SSH_USERNAME}' user exists with sudo + /opt/project...`);
  const guSession = await connectSsh(conn);
  try {
    await guSession.exec(
      [
        `id ${VPS_SSH_USERNAME} &>/dev/null || sudo useradd -m -s /bin/bash ${VPS_SSH_USERNAME}`,
        `echo '${VPS_SSH_USERNAME} ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/${VPS_SSH_USERNAME} > /dev/null`,
        `sudo chmod 440 /etc/sudoers.d/${VPS_SSH_USERNAME}`,
        `sudo mkdir -p /home/${VPS_SSH_USERNAME}/.ssh`,
        // Copy authorized_keys from whatever user we logged in as.
        `sudo cp ~/.ssh/authorized_keys /home/${VPS_SSH_USERNAME}/.ssh/authorized_keys`,
        `sudo chown -R ${VPS_SSH_USERNAME}:${VPS_SSH_USERNAME} /home/${VPS_SSH_USERNAME}/.ssh`,
        `sudo chmod 700 /home/${VPS_SSH_USERNAME}/.ssh`,
        `sudo chmod 600 /home/${VPS_SSH_USERNAME}/.ssh/authorized_keys`,
        `sudo mkdir -p /opt/project`,
        `sudo chown -R ${VPS_SSH_USERNAME}:${VPS_SSH_USERNAME} /opt/project`,
        `sudo usermod -aG docker ${VPS_SSH_USERNAME} || true`,
        `sudo su - ${VPS_SSH_USERNAME} -c 'claude install 2>/dev/null || true'`,
        `grep -q 'HOME/.local/bin' /home/${VPS_SSH_USERNAME}/.bashrc 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' | sudo tee -a /home/${VPS_SSH_USERNAME}/.bashrc > /dev/null`,
      ].join(" && "),
    );
  } finally {
    guSession.close();
  }
  onProgress(`'${VPS_SSH_USERNAME}' user ready`);

  // 3. Optional: GitLab deploy key for private repos. Written to genie's ~/.ssh.
  if (opts.gitlabDeployKey) {
    onProgress("Installing GitLab deploy key...");
    const genieConn: SshConnectionConfig = { ...conn, username: VPS_SSH_USERNAME };
    const s = await connectSsh(genieConn);
    try {
      await s.exec("mkdir -p ~/.ssh && chmod 700 ~/.ssh");
      const escapedKey = opts.gitlabDeployKey.replace(/'/g, "'\\''");
      await s.exec(`printf '%s\\n' '${escapedKey}' > ~/.ssh/id_gitlab && chmod 600 ~/.ssh/id_gitlab`);
      await s.exec(`grep -q 'IdentityFile ~/.ssh/id_gitlab' ~/.ssh/config 2>/dev/null || cat >> ~/.ssh/config << 'SSHEOF'
Host gitlab.com
  HostName gitlab.com
  IdentityFile ~/.ssh/id_gitlab
  StrictHostKeyChecking no
  IdentitiesOnly yes
SSHEOF
chmod 600 ~/.ssh/config`);
    } finally {
      s.close();
    }
    onProgress("GitLab deploy key installed");
  }
}

/**
 * Make sure the target server has everything `vpsDeploy` needs: a `genie` user
 * with passwordless sudo, Docker, Node.js, Claude Code, and `/opt/project` owned
 * by `genie`. Returns a connection that uses the `genie` user — callers should
 * use it (and persist it) for all subsequent operations.
 *
 * Fast path: if SSH-as-genie already works and Docker is present, returns
 * immediately without changing anything. This is the case for servers Genie
 * provisioned itself.
 *
 * Slow path: runs the full idempotent bootstrap using the provided connection
 * (which must be a sudo-capable user — typically `ubuntu`/`debian`/`almalinux`
 * on attached Taz VMs, or `root` on a bare server).
 */
export async function ensureBootstrapped(
  conn: SshConnectionConfig,
  opts: BootstrapOpts,
  onProgress: (msg: string) => void,
): Promise<SshConnectionConfig> {
  if (conn.username === VPS_SSH_USERNAME) {
    // Already configured to use genie; sanity-check Docker is there.
    if (await probeGenieReady(conn)) {
      return conn;
    }
    throw new Error(
      `Connection is configured as '${VPS_SSH_USERNAME}' but the server isn't bootstrapped (no Docker). ` +
        `Re-attach using the image's default user so the bootstrap can run.`,
    );
  }

  if (await probeGenieReady(conn)) {
    onProgress(`Server already bootstrapped — switching to '${VPS_SSH_USERNAME}' user`);
    return { ...conn, username: VPS_SSH_USERNAME };
  }

  onProgress(`Server not bootstrapped — running first-time setup as '${conn.username}'...`);
  await runBootstrap(conn, opts, onProgress);
  onProgress("Bootstrap complete");
  return { ...conn, username: VPS_SSH_USERNAME };
}
