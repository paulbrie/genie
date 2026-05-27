import { VPS_SSH_USERNAME } from "../types.js";
import { createTazClient, defaultSshUserForVm, type TazVm } from "./tazcloud-api-client.js";
import { connectSsh, type SshConnectionConfig } from "./ssh-client.js";
import { vpsDeploy } from "./deploy-service.js";
import { buildUfwRules } from "./do-provision.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TAZCLOUD_KEY_PATH = path.join(os.homedir(), ".genie", "ssh", "tazcloud_ed25519");

/** Write the env-provided TazCloud private key to disk so the existing SSH plumbing
 *  (which stores `privateKeyPath` in DB-persisted instance config) can re-connect later
 *  without holding the key in memory. Idempotent. */
export function ensureTazcloudKeyOnDisk(privateKey: string): string {
  fs.mkdirSync(path.dirname(TAZCLOUD_KEY_PATH), { recursive: true });
  const normalized = privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`;
  let needsWrite = true;
  try {
    needsWrite = fs.readFileSync(TAZCLOUD_KEY_PATH, "utf-8") !== normalized;
  } catch { /* file doesn't exist yet */ }
  if (needsWrite) {
    fs.writeFileSync(TAZCLOUD_KEY_PATH, normalized, { mode: 0o600 });
  }
  return TAZCLOUD_KEY_PATH;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TazProvisionOpts {
  token: string;
  privateKey: string;          // PEM/OpenSSH text from env (TAZCLOUD_SSH_PRIVATE_KEY)
  projectName: string;
  image?: string;              // ubuntu-22 / ubuntu-24 / almalinux-9 / debian-12 (default: ubuntu-22)
  size?: string;               // small / medium / large / xlarge (default: small)
  signal?: AbortSignal;
  gitlabDeployKey?: string;
  envVars?: Record<string, string>;
  setupFiles?: Record<string, string>;
}

export interface TazProvisionResult {
  vmId: string;
  /** Public IPv6 on legacy tenants; falls back to the private ssh_host
   *  (10.128.N.x) on v2.0.0 vxlan-bastion tenants reached via WireGuard. */
  ipv6: string;
  image: string;
  size: string;
  sshUser: string;
  /** v2.0.0 only. Taz project the VM was created in. */
  projectId?: string;
}

/**
 * Provision a TazCloud VM and run the standard Genie deploy on it.
 *
 * Differences vs. DO:
 *   - No provider-side SSH key registration (pubkey is on file with TazCloud team out-of-band).
 *   - SSH is IPv6-only; ssh2 takes the literal IPv6 string as the host.
 *   - VM images don't include Docker/Node — installed in the bootstrap step below.
 *   - UFW is applied via SSH after boot (no cloud-init user_data API).
 *   - Image defines initial SSH user (ubuntu/debian/almalinux); we then create a `genie`
 *     user so deploy-service.ts's existing chown/sudo logic keeps working.
 */
export async function tazcloudProvisionAndDeploy(
  opts: TazProvisionOpts,
  onProgress: (msg: string) => void,
): Promise<TazProvisionResult> {
  const {
    token,
    privateKey,
    projectName,
    image = "ubuntu-22",
    size = "small",
    signal,
    gitlabDeployKey,
    envVars: optsEnvVars,
    setupFiles,
  } = opts;

  if (!privateKey) throw new Error("TAZCLOUD_SSH_PRIVATE_KEY is not set");
  if (!token) throw new Error("TAZCLOUD_API_TOKEN is not set");

  const keyPath = ensureTazcloudKeyOnDisk(privateKey);
  const client = createTazClient(token);
  let vmIdForCleanup: string | null = null;

  function checkAbort() {
    if (signal?.aborted) throw new Error("Deployment cancelled");
  }

  async function cleanupVm() {
    if (vmIdForCleanup) {
      try {
        onProgress(`Cleaning up VM ${vmIdForCleanup}...`);
        await client.deleteVm(vmIdForCleanup);
        onProgress("VM destroyed");
      } catch { /* ignore */ }
    }
  }

  try {
    // 1. Validate image/size against the live capabilities endpoint.
    onProgress("Checking TazCloud capabilities...");
    const caps = await client.getCapabilities();
    if (!caps.images.includes(image)) {
      throw new Error(`Unsupported image "${image}". Available: ${caps.images.join(", ")}`);
    }
    if (!caps.sizes.includes(size)) {
      throw new Error(`Unsupported size "${size}". Available: ${caps.sizes.join(", ")}`);
    }

    checkAbort();

    // 2. Create the VM. /v1/vm returns immediately with status=ACTIVE per API contract,
    //    though SSH may take 25-70s more to become available.
    const vmName = `genie-${projectName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}-${Date.now()}`.slice(0, 63);
    onProgress(`Creating VM "${vmName}" (image: ${image}, size: ${size})...`);
    const vm: TazVm = await client.createVm({ name: vmName, image, size });
    vmIdForCleanup = vm.id;
    onProgress(`VM created (id: ${vm.id}, host: ${vm.ssh_host})`);

    checkAbort();

    // v2.0.0 vxlan-bastion VMs ship with `genie` + key and are reached over
    // WireGuard directly. Legacy v6 uses the image-default user + direct SSH.
    const initialUser = defaultSshUserForVm(vm);
    const sshHost = vm.ssh_host;

    // 3. Wait for SSH to actually accept connections (TazCloud says 25-70s boot).
    onProgress(`Waiting for SSH on ${sshHost}:22 as ${initialUser}...`);
    const SSH_TIMEOUT = 180_000;
    const SSH_ATTEMPT_TIMEOUT = 15_000;
    const POLL = 5_000;
    const sshStart = Date.now();
    let sshReady = false;
    let attempt = 0;

    while (Date.now() - sshStart < SSH_TIMEOUT) {
      checkAbort();
      attempt++;
      const elapsed = Math.round((Date.now() - sshStart) / 1000);
      try {
        const ok = await Promise.race([
          (async () => {
            const session = await connectSsh({
              host: sshHost,
              port: 22,
              username: initialUser,
              privateKeyPath: "",
              privateKey,
            });
            try { await session.exec("true"); return true; }
            finally { session.close(); }
          })(),
          sleep(SSH_ATTEMPT_TIMEOUT).then(() => { throw new Error("attempt timeout (15s)"); }),
        ]);
        if (ok) {
          sshReady = true;
          onProgress("SSH ready");
          break;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        onProgress(`[${attempt}] ${elapsed}s — ${msg.slice(0, 120)}`);
      }
      await sleep(POLL);
    }

    if (!sshReady) throw new Error("Timed out waiting for SSH (180s)");

    checkAbort();

    const initialConn: SshConnectionConfig = {
      host: sshHost,
      port: 22,
      username: initialUser,
      privateKeyPath: keyPath,
    };

    // 4. UFW hardening — default-deny, then open ports 22 and 3000 to the world.
    //    No source-IP restriction on SSH: TazCloud hosts are v6-only and our manager
    //    (Railway) doesn't expose a stable v6 egress, so locking by source IP would
    //    leave us unable to reconnect. TazCloud's sshd enforces key-only auth, which
    //    is the security boundary here.
    onProgress("Configuring UFW: default-deny incoming, allow 22 and 3000...");
    try {
      const fwSession = await connectSsh(initialConn);
      await fwSession.exec(`sudo bash -c "${buildUfwRules().join(" && ").replace(/"/g, "\\\"")}"`);
      fwSession.close();
      onProgress("UFW configured (SSH key-only auth is the access control)");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress(`Warning: UFW configuration failed: ${message}`);
    }

    checkAbort();

    // 5. Install Docker + Node.js + Claude Code. TazCloud images are bare, so we
    //    bootstrap the runtime that deploy-service.ts expects.
    onProgress("Installing Docker, Node.js, and Claude Code...");
    const bootstrapScript = [
      "set -e",
      "export DEBIAN_FRONTEND=noninteractive",
      "wait_apt() { local i=0; while sudo fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock >/dev/null 2>&1; do i=$((i+1)); [ \"$i\" -gt 600 ] && { echo 'Timeout waiting for apt lock'; exit 1; }; sleep 1; done; }",
      "if command -v apt-get >/dev/null 2>&1; then",
      "  wait_apt; sudo -E apt-get -o DPkg::Lock::Timeout=300 update -qq",
      "  wait_apt; sudo -E apt-get -o DPkg::Lock::Timeout=300 install -y -qq docker.io git curl ca-certificates > /dev/null",
      "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null 2>&1",
      "  wait_apt; sudo -E apt-get -o DPkg::Lock::Timeout=300 install -y -qq nodejs > /dev/null",
      "elif command -v dnf >/dev/null 2>&1; then",
      "  sudo dnf install -y -q docker git curl > /dev/null",
      "  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - > /dev/null 2>&1",
      "  sudo dnf install -y -q nodejs > /dev/null",
      "else",
      "  echo 'No supported package manager (need apt-get or dnf)'; exit 1",
      "fi",
      "sudo systemctl enable --now docker > /dev/null 2>&1",
      // Docker Compose v2 — no consistent apt/dnf package across distros.
      // GitHub-release CLI plugin is the portable answer.
      "if ! docker compose version >/dev/null 2>&1; then",
      "  COMPOSE_VER=v2.29.7; ARCH=$(uname -m)",
      "  sudo mkdir -p /usr/local/lib/docker/cli-plugins",
      "  sudo curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \"https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-linux-${ARCH}\"",
      "  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose",
      "fi",
      "sudo npm install -g --silent @anthropic-ai/claude-code @genie/vps-agent 2>&1 | tail -3",
    ].join("\n");

    try {
      const bs = await connectSsh(initialConn);
      const out = await bs.exec(`bash -s << 'GENIE_BOOTSTRAP_EOF'\n${bootstrapScript}\nGENIE_BOOTSTRAP_EOF`, (chunk) => {
        const line = chunk.trimEnd();
        if (line) onProgress(line.slice(0, 200));
      }, { timeoutMs: 600_000, idleTimeoutMs: 180_000 });
      bs.close();
      onProgress(`Bootstrap done: ${out.trim().split("\n").pop()?.slice(0, 120) || "ok"}`);
    } catch (err: unknown) {
      throw new Error(`Bootstrap install failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    checkAbort();

    // 6. Ensure the `genie` user exists with sudo, /opt/project, docker group, and
    //    Claude. v2.0.0 vxlan-bastion images ship with `genie` already (we're
    //    even connecting as it), so most steps are no-ops; on legacy images we
    //    bootstrap from the image-default user. The script is idempotent except
    //    for the authorized_keys copy, which we skip when initialUser is already
    //    `genie` (a self-copy would fail).
    onProgress(initialUser === VPS_SSH_USERNAME ? "Configuring genie user (sudo, /opt/project, docker)..." : "Creating genie user...");
    try {
      const guSession = await connectSsh(initialConn);
      const copyAuthKeys = initialUser !== VPS_SSH_USERNAME
        ? `sudo cp ~${initialUser}/.ssh/authorized_keys /home/${VPS_SSH_USERNAME}/.ssh/authorized_keys`
        : "true";
      await guSession.exec([
        `id ${VPS_SSH_USERNAME} &>/dev/null || sudo useradd -m -s /bin/bash ${VPS_SSH_USERNAME}`,
        `echo '${VPS_SSH_USERNAME} ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/${VPS_SSH_USERNAME} > /dev/null`,
        `sudo chmod 440 /etc/sudoers.d/${VPS_SSH_USERNAME}`,
        `sudo mkdir -p /home/${VPS_SSH_USERNAME}/.ssh`,
        copyAuthKeys,
        `sudo chown -R ${VPS_SSH_USERNAME}:${VPS_SSH_USERNAME} /home/${VPS_SSH_USERNAME}/.ssh`,
        `sudo chmod 700 /home/${VPS_SSH_USERNAME}/.ssh`,
        `sudo chmod 600 /home/${VPS_SSH_USERNAME}/.ssh/authorized_keys`,
        `sudo mkdir -p /opt/project`,
        `sudo chown -R ${VPS_SSH_USERNAME}:${VPS_SSH_USERNAME} /opt/project`,
        `sudo usermod -aG docker ${VPS_SSH_USERNAME} || true`,
        `sudo su - ${VPS_SSH_USERNAME} -c 'claude install 2>/dev/null || true'`,
        `echo 'export PATH="$HOME/.local/bin:$PATH"' | sudo tee -a /home/${VPS_SSH_USERNAME}/.bashrc > /dev/null`,
      ].join(" && "));
      guSession.close();
      onProgress("genie user ready");
    } catch (err: unknown) {
      throw new Error(`Failed to configure genie user: ${err instanceof Error ? err.message : String(err)}`);
    }

    // From here on, use the genie user.
    const genieConn: SshConnectionConfig = { ...initialConn, username: VPS_SSH_USERNAME };

    checkAbort();

    // 7. Optional GitLab deploy key.
    if (gitlabDeployKey) {
      onProgress("Installing GitLab deploy key...");
      try {
        const s = await connectSsh(genieConn);
        await s.exec("mkdir -p ~/.ssh && chmod 700 ~/.ssh");
        const escapedKey = gitlabDeployKey.replace(/'/g, "'\\''");
        await s.exec(`printf '%s\\n' '${escapedKey}' > ~/.ssh/id_gitlab && chmod 600 ~/.ssh/id_gitlab`);
        await s.exec(`cat >> ~/.ssh/config << 'SSHEOF'
Host gitlab.com
  HostName gitlab.com
  IdentityFile ~/.ssh/id_gitlab
  StrictHostKeyChecking no
  IdentitiesOnly yes
SSHEOF
chmod 600 ~/.ssh/config`);
        s.close();
        onProgress("GitLab deploy key installed");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        onProgress(`Warning: GitLab deploy key install failed: ${message}`);
      }
    }

    checkAbort();

    // 8. Standard deploy via the shared pipeline.
    onProgress("Starting deployment...");
    const envVars: Record<string, string> = { ...optsEnvVars };
    // GIT_TOKEN is no longer auto-injected from settings — apply the
    // Git Credentials add-on after deploy if private clones are needed.
    await vpsDeploy(projectName, genieConn, onProgress, envVars, setupFiles);

    return {
      // ipv6 is null on tenants with vm_access.mode === "vxlan-bastion"; fall
      // back to the resolved ssh_host (private IPv4 reached via WireGuard) so
      // downstream code that stores this for display has something non-empty.
      vmId: vm.id,
      ipv6: vm.ipv6 ?? vm.ssh_host ?? "",
      image,
      size,
      sshUser: VPS_SSH_USERNAME,
      projectId: vm.project_id,
    };
  } catch (err: unknown) {
    const errObj = err instanceof Error ? err : new Error(String(err));
    if (errObj.message === "Deployment cancelled") {
      await cleanupVm();
    } else if (vmIdForCleanup) {
      (errObj as Error & { vmId?: string; vmIpv6?: string }).vmId = vmIdForCleanup;
    }
    throw errObj;
  }
}

export async function tazcloudDestroyVm(
  token: string,
  vmId: string,
  onProgress: (msg: string) => void,
): Promise<void> {
  const client = createTazClient(token);
  onProgress(`Destroying TazCloud VM ${vmId}...`);
  await client.deleteVm(vmId);
  onProgress("VM destroyed");
}
