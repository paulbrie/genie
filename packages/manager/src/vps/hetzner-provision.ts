import { VPS_SSH_USERNAME } from "../types.js";
import { createHetznerClient, getServerPublicIp } from "./hetzner-api-client.js";
import { connectSsh } from "./ssh-client.js";
import { vpsDeploy } from "./deploy-service.js";
// Reuse the shared Genie key + firewall helpers — they are provider-agnostic.
import {
  ensureGenieKeyPair,
  ensureGenieKeyOnDisk,
  sshKeyFingerprint,
  buildUfwRules,
} from "./do-provision.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Hetzner ships plain OS images (no Docker preinstalled, unlike DO's
 *  `docker-20-04` marketplace image). Cloud-init installs Docker on first boot
 *  and locks the firewall down to the manager IP(s) + the public app port. */
function buildCloudInit(): string {
  const ufw = buildUfwRules(
    process.env.MANAGER_PUBLIC_IP,
    process.env.MANAGER_PUBLIC_IP_DEV,
    process.env.MANAGER_PUBLIC_IP_V6,
    process.env.MANAGER_PUBLIC_IP_V6_DEV,
  ).join("\n");
  return [
    "#!/bin/bash",
    "set -e",
    "export DEBIAN_FRONTEND=noninteractive",
    "# Install Docker (get.docker.com handles apt repo + engine + compose plugin)",
    "curl -fsSL https://get.docker.com | sh",
    "systemctl enable --now docker",
    "# Lock down the firewall",
    ufw,
    "",
  ].join("\n");
}

export interface HetznerProvisionOpts {
  token: string;
  projectName: string;
  location?: string;
  serverType?: string;
  image?: string;
  signal?: AbortSignal;
  gitlabDeployKey?: string;
  envVars?: Record<string, string>;
  setupFiles?: Record<string, string>;
}

export interface HetznerProvisionResult {
  serverId: number;
  ipAddress: string;
  location: string;
  serverType: string;
}

export async function hetznerProvisionAndDeploy(
  opts: HetznerProvisionOpts,
  onProgress: (msg: string) => void,
): Promise<HetznerProvisionResult> {
  const {
    token,
    projectName,
    location = "nbg1",
    // cpx22 (not cpx21) — the classic cpx*1 line is US-only; nbg1/hel1/sin only
    // place the cpx*2 line. See lib/hetzner-options.ts (renderer) for the map.
    serverType = "cpx22",
    image = "ubuntu-22.04",
    signal,
    gitlabDeployKey,
    envVars: optsEnvVars,
    setupFiles,
  } = opts;

  const client = createHetznerClient(token);
  let serverIdForCleanup: number | null = null;
  let ipAddressForCleanup: string | undefined;

  function checkAbort() {
    if (signal?.aborted) {
      throw new Error("Deployment cancelled");
    }
  }

  async function cleanupServer() {
    if (serverIdForCleanup) {
      try {
        onProgress(`Cleaning up server ${serverIdForCleanup}...`);
        await client.deleteServer(serverIdForCleanup);
        onProgress("Server destroyed");
      } catch {}
    }
  }

  try {
    // 1. Ensure dedicated Genie SSH key exists (DB-persisted, shared across providers)
    onProgress("Ensuring Genie SSH key...");
    const keyPair = await ensureGenieKeyPair();
    const resolvedPrivateKey = await ensureGenieKeyOnDisk();
    const pubKeyContent = keyPair.publicKey;
    const fingerprint = sshKeyFingerprint(pubKeyContent);

    onProgress("Checking SSH keys on Hetzner...");
    const existingKeys = await client.listSshKeys();
    let keyId: number;
    const existing = existingKeys.find((k) => k.fingerprint === fingerprint);
    if (existing) {
      keyId = existing.id;
      onProgress(`SSH key already registered (${existing.name})`);
    } else {
      onProgress("Uploading SSH key to Hetzner...");
      const created = await client.createSshKey(`genie-${Date.now()}`, pubKeyContent.trim());
      keyId = created.id;
      onProgress("SSH key uploaded");
    }

    checkAbort();

    // 2. Create server
    const serverName = `genie-${projectName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}-${Date.now()}`;
    onProgress(`Creating server "${serverName}" (${serverType} in ${location}, image: ${image})...`);
    const server = await client.createServer({
      name: serverName,
      serverType,
      image,
      location,
      sshKeyIds: [keyId],
      labels: { genie: "true" },
      userData: buildCloudInit(),
    });
    const serverId = server.id;
    serverIdForCleanup = serverId;
    onProgress(`Server created (id: ${serverId}), waiting for it to become running...`);

    // 3. Poll until running + public IP
    const SERVER_TIMEOUT = 120_000;
    const POLL_INTERVAL = 5_000;
    let ipAddress = getServerPublicIp(server) || "";
    const pollStart = Date.now();

    while (Date.now() - pollStart < SERVER_TIMEOUT) {
      checkAbort();
      const current = await client.getServer(serverId);
      const ip = getServerPublicIp(current);
      if (current.status === "running" && ip) {
        ipAddress = ip;
        ipAddressForCleanup = ip;
        onProgress(`Server running at ${ip}`);
        break;
      }
      onProgress(`Server status: ${current.status}...`);
      await sleep(POLL_INTERVAL);
    }

    if (!ipAddress) {
      throw new Error("Timed out waiting for server to become running (120s)");
    }
    ipAddressForCleanup = ipAddress;

    // 4. Wait for SSH + Docker. Cloud-init installs Docker on first boot, so this
    //    takes longer than DO's preinstalled image — allow up to 5 minutes.
    onProgress(`Waiting for SSH on ${ipAddress}:22 as root (Docker installing via cloud-init)...`);
    onProgress(`Using key: ${resolvedPrivateKey}`);
    const SSH_TIMEOUT = 300_000;
    const SSH_ATTEMPT_TIMEOUT = 15_000;
    const sshStart = Date.now();
    let sshReady = false;
    let attempt = 0;

    while (Date.now() - sshStart < SSH_TIMEOUT) {
      checkAbort();
      attempt++;
      const elapsed = Math.round((Date.now() - sshStart) / 1000);
      try {
        const sshResult = await Promise.race([
          (async () => {
            const session = await connectSsh({
              host: ipAddress,
              port: 22,
              username: "root",
              privateKeyPath: resolvedPrivateKey,
              privateKey: keyPair.privateKey,
            });
            try {
              const dockerVersion = await session.exec("docker --version 2>/dev/null || echo no-docker");
              session.close();
              return dockerVersion;
            } catch (e) {
              session.close();
              throw e;
            }
          })(),
          sleep(SSH_ATTEMPT_TIMEOUT).then(() => {
            throw new Error("attempt timeout (15s)");
          }),
        ]);
        if (typeof sshResult === "string" && sshResult.includes("Docker")) {
          sshReady = true;
          onProgress("SSH ready, Docker available");
          break;
        }
        onProgress(`[${attempt}] ${elapsed}s — SSH up, waiting for Docker (cloud-init still running)...`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        onProgress(`[${attempt}] ${elapsed}s — ${msg.slice(0, 120)}`);
      }
      await sleep(POLL_INTERVAL);
    }

    if (!sshReady) {
      throw new Error("Timed out waiting for SSH/Docker to be ready (300s)");
    }

    checkAbort();

    const connConfig = {
      host: ipAddress,
      port: 22,
      username: "root",
      privateKeyPath: resolvedPrivateKey,
      privateKey: keyPair.privateKey,
    };

    // 5. Wait for cloud-init to fully finish (sshd/firewall settle during finalization)
    onProgress("Waiting for cloud-init to finish...");
    for (let ci = 1; ci <= 24; ci++) {
      checkAbort();
      try {
        const s = await connectSsh(connConfig);
        const result = await s.exec("cloud-init status 2>/dev/null || echo done");
        s.close();
        if (result.includes("done")) {
          onProgress("Cloud-init complete");
          break;
        }
        onProgress(`Cloud-init: ${result.trim().slice(0, 60)}...`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        onProgress(`Waiting for cloud-init (${ci}/24): ${message.slice(0, 60)}`);
      }
      await sleep(5_000);
    }

    onProgress("Stabilizing (5s)...");
    await sleep(5_000);

    checkAbort();

    // 5b. Create non-root genie user for Claude Code (--dangerously-skip-permissions requires non-root)
    onProgress("Creating genie user...");
    try {
      const guSession = await connectSsh(connConfig);
      await guSession.exec([
        "id genie &>/dev/null || useradd -m -s /bin/bash genie",
        "echo 'genie ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/genie",
        "chmod 440 /etc/sudoers.d/genie",
        "mkdir -p /home/genie/.ssh",
        "cp /root/.ssh/authorized_keys /home/genie/.ssh/authorized_keys",
        "chown -R genie:genie /home/genie/.ssh",
        "chmod 700 /home/genie/.ssh",
        "chmod 600 /home/genie/.ssh/authorized_keys",
        "mkdir -p /opt/project",
        "chown -R genie:genie /opt/project",
        "usermod -aG docker genie || true",
        "su - genie -c 'claude install 2>/dev/null || true'",
        "echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> /home/genie/.bashrc",
      ].join(" && "));
      guSession.close();
      onProgress("genie user created");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress(`Warning: Failed to create genie user: ${message}`);
    }

    // From here on, use genie user for all SSH commands
    const genieConnConfig = {
      ...connConfig,
      username: VPS_SSH_USERNAME,
    };

    checkAbort();

    // 5c. Install GitLab deploy key if provided
    if (gitlabDeployKey) {
      onProgress("Installing GitLab deploy key on server...");
      try {
        const s = await connectSsh(genieConnConfig);
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
        onProgress(`Warning: Failed to install GitLab deploy key: ${message}`);
      }
    }

    checkAbort();

    // 6. Ensure vps-agent is installed (idempotent, fast if already present)
    onProgress("Ensuring VPS agent is installed...");
    try {
      const agentSession = await connectSsh(genieConnConfig);
      await agentSession.exec(
        "command -v genie-agent >/dev/null 2>&1 || sudo npm install -g @genie/vps-agent 2>/dev/null || true",
      );
      agentSession.close();
    } catch {
      onProgress("Warning: Could not verify VPS agent installation");
    }

    checkAbort();

    // 7. Deploy via existing vpsDeploy (as genie user)
    onProgress("Starting deployment...");
    const envVars: Record<string, string> = { ...optsEnvVars };
    await vpsDeploy(projectName, genieConnConfig, onProgress, envVars, setupFiles);

    return { serverId, ipAddress, location, serverType };
  } catch (err: unknown) {
    const errObj = err instanceof Error ? err : new Error(String(err));
    if (errObj.message === "Deployment cancelled") {
      await cleanupServer();
    } else if (serverIdForCleanup) {
      // Attach server info so the caller can offer keep/destroy
      (errObj as Error & { serverId?: number; serverIp?: string }).serverId = serverIdForCleanup;
      (errObj as Error & { serverId?: number; serverIp?: string }).serverIp = ipAddressForCleanup;
    }
    throw errObj;
  }
}

export async function hetznerDestroyServer(
  token: string,
  serverId: number,
  onProgress: (msg: string) => void,
): Promise<void> {
  const client = createHetznerClient(token);
  onProgress(`Destroying server ${serverId}...`);
  await client.deleteServer(serverId);
  onProgress("Server destroyed");
}
