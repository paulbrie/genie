import { createDoClient, type DoDroplet } from "./do-api-client.js";
import { connectSsh } from "./ssh-client.js";
import { vpsDeploy } from "./deploy-service.js";
import { getGenieKeyPair, saveGenieKeyPair } from "../settings-service.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Compute MD5 fingerprint of an SSH public key (matches DO format). */
export function sshKeyFingerprint(pubKeyContent: string): string {
  // Public key format: "ssh-rsa AAAA... comment"
  const parts = pubKeyContent.trim().split(/\s+/);
  if (parts.length < 2) throw new Error("Invalid SSH public key format");
  const keyData = Buffer.from(parts[1], "base64");
  const hash = crypto.createHash("md5").update(keyData).digest("hex");
  return hash.match(/.{2}/g)!.join(":");
}

function getPublicIp(droplet: DoDroplet): string | null {
  const v4 = droplet.networks?.v4 || [];
  const pub = v4.find((n) => n.type === "public");
  return pub?.ip_address || null;
}

/** Dedicated Genie SSH key pair (no passphrase) used for DO provisioning. */
const GENIE_KEY_DIR = ".genie/ssh";
const GENIE_KEY_NAME = "genie_ed25519";

export function getGenieKeyPath(): string {
  return path.join(os.homedir(), GENIE_KEY_DIR, GENIE_KEY_NAME);
}

export function getGenieKeyPubPath(): string {
  return `${getGenieKeyPath()}.pub`;
}

/**
 * Ensure the Genie SSH key pair exists in DB (source of truth).
 * Generates a new key pair if none is stored, saves to DB, and writes to disk cache.
 */
export async function ensureGenieKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  // 1. Check DB first
  const stored = await getGenieKeyPair();
  if (stored) {
    // Also ensure on disk as cache
    await writeKeyToDisk(stored.privateKey, stored.publicKey);
    return stored;
  }

  // 2. Generate a new key pair using ssh-keygen with temp files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "genie-ssh-"));
  const tmpKeyPath = path.join(tmpDir, "genie_ed25519");
  try {
    await execFileAsync("ssh-keygen", ["-t", "ed25519", "-f", tmpKeyPath, "-N", "", "-C", "genie-deploy"]);
    const privateKey = fs.readFileSync(tmpKeyPath, "utf-8");
    const publicKey = fs.readFileSync(`${tmpKeyPath}.pub`, "utf-8");

    // 3. Store in DB
    await saveGenieKeyPair(privateKey, publicKey);

    // 4. Write to disk cache
    await writeKeyToDisk(privateKey, publicKey);

    return { privateKey, publicKey };
  } finally {
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Ensure the Genie SSH key exists on disk (filesystem cache for CLI tools like ssh).
 * Loads from DB if not present on disk. Returns the file path.
 */
export async function ensureGenieKeyOnDisk(): Promise<string> {
  const keyPath = getGenieKeyPath();
  const pubKeyPath = getGenieKeyPubPath();

  // If files exist, check content matches DB
  if (fs.existsSync(keyPath) && fs.existsSync(pubKeyPath)) {
    return keyPath;
  }

  // Load from DB and write to disk
  const stored = await getGenieKeyPair();
  if (!stored) {
    // No key in DB yet — generate one
    await ensureGenieKeyPair();
    return keyPath;
  }

  await writeKeyToDisk(stored.privateKey, stored.publicKey);
  return keyPath;
}

/** Write key pair to the filesystem cache at ~/.genie/ssh/ */
export function writeKeyToDisk(privateKey: string, publicKey: string): void {
  const keyPath = getGenieKeyPath();
  const pubKeyPath = getGenieKeyPubPath();
  const dir = path.dirname(keyPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(pubKeyPath, publicKey, { mode: 0o644 });
}

export interface DoProvisionOpts {
  token: string;
  projectName: string;
  region?: string;
  size?: string;
  signal?: AbortSignal;
  gitlabDeployKey?: string;
  gitToken?: string;
  envVars?: Record<string, string>;
  baseImageId?: number;
  setupFiles?: Record<string, string>;
}

export interface DoProvisionResult {
  dropletId: number;
  ipAddress: string;
  region: string;
  size: string;
}

export async function doProvisionAndDeploy(
  opts: DoProvisionOpts,
  onProgress: (msg: string) => void,
): Promise<DoProvisionResult> {
  const {
    token,
    projectName,
    region = "nyc1",
    size = "s-2vcpu-4gb",
    signal,
    gitlabDeployKey,
    gitToken,
    envVars: optsEnvVars,
    baseImageId,
    setupFiles,
  } = opts;

  const client = createDoClient(token);
  let dropletIdForCleanup: number | null = null;
  let ipAddressForCleanup: string | undefined;

  function checkAbort() {
    if (signal?.aborted) {
      throw new Error("Deployment cancelled");
    }
  }

  async function cleanupDroplet() {
    if (dropletIdForCleanup) {
      try {
        onProgress(`Cleaning up droplet ${dropletIdForCleanup}...`);
        await client.deleteDroplet(dropletIdForCleanup);
        onProgress("Droplet destroyed");
      } catch {}
    }
  }

  try {
    // 1. Ensure dedicated Genie SSH key exists (DB-persisted)
    onProgress("Ensuring Genie SSH key...");
    const keyPair = await ensureGenieKeyPair();
    const resolvedPrivateKey = await ensureGenieKeyOnDisk();
    const pubKeyContent = keyPair.publicKey;
    const fingerprint = sshKeyFingerprint(pubKeyContent);

    onProgress("Checking SSH keys on DigitalOcean...");
    const existingKeys = await client.listSshKeys();
    let keyId: number;
    const existing = existingKeys.find((k) => k.fingerprint === fingerprint);
    if (existing) {
      keyId = existing.id;
      onProgress(`SSH key already registered (${existing.name})`);
    } else {
      onProgress("Uploading SSH key to DigitalOcean...");
      const created = await client.createSshKey(`genie-${Date.now()}`, pubKeyContent.trim());
      keyId = created.id;
      onProgress("SSH key uploaded");
    }

    checkAbort();

    // 2. Create droplet
    const dropletName = `genie-${projectName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}-${Date.now()}`;
    const useBaseImage = !!baseImageId;
    const image: string | number = useBaseImage ? baseImageId : "docker-20-04";
    onProgress(`Creating droplet "${dropletName}" (${size} in ${region}, image: ${useBaseImage ? `snapshot ${baseImageId}` : "docker-20-04"})...`);
    // cloud-init: configure UFW — restrict SSH to manager IP if available, otherwise just allow
    const managerIpForInit = process.env.MANAGER_PUBLIC_IP;
    const userData = useBaseImage ? undefined : managerIpForInit
      ? `#!/bin/bash
ufw delete limit 22/tcp 2>/dev/null || true
ufw delete allow 22/tcp 2>/dev/null || true
ufw allow from ${managerIpForInit} to any port 22 proto tcp
ufw --force enable
ufw reload
`
      : `#!/bin/bash
ufw delete limit 22/tcp
ufw allow 22/tcp
ufw delete limit 22/tcp
ufw reload
`;

    const droplet = await client.createDroplet({
      name: dropletName,
      region,
      size,
      image,
      sshKeyIds: [keyId],
      tags: ["genie"],
      userData,
    });
    const dropletId = droplet.id;
    dropletIdForCleanup = dropletId;
    onProgress(`Droplet created (id: ${dropletId}), waiting for it to become active...`);

    // 3. Poll until active + public IP
    const DROPLET_TIMEOUT = 120_000;
    const POLL_INTERVAL = 5_000;
    let ipAddress = "";
    const pollStart = Date.now();

    while (Date.now() - pollStart < DROPLET_TIMEOUT) {
      checkAbort();
      const current = await client.getDroplet(dropletId);
      const ip = getPublicIp(current);
      if (current.status === "active" && ip) {
        ipAddress = ip;
        ipAddressForCleanup = ip;
        onProgress(`Droplet active at ${ip}`);
        break;
      }
      onProgress(`Droplet status: ${current.status}...`);
      await sleep(POLL_INTERVAL);
    }

    if (!ipAddress) {
      throw new Error("Timed out waiting for droplet to become active (120s)");
    }

    // 4. Wait for SSH + docker to be ready
    onProgress(`Waiting for SSH on ${ipAddress}:22 as root...`);
    onProgress(`Using key: ${resolvedPrivateKey}`);
    const SSH_TIMEOUT = 180_000;
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
              const dockerVersion = await session.exec("docker --version");
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
        onProgress(`[${attempt}] ${elapsed}s — SSH connected but Docker not found: ${String(sshResult).trim().slice(0, 100)}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        onProgress(`[${attempt}] ${elapsed}s — ${msg.slice(0, 120)}`);
      }
      await sleep(POLL_INTERVAL);
    }

    if (!sshReady) {
      throw new Error("Timed out waiting for SSH/Docker to be ready (180s)");
    }

    checkAbort();

    const connConfig = {
      host: ipAddress,
      port: 22,
      username: "root",
      privateKeyPath: resolvedPrivateKey,
      privateKey: keyPair.privateKey,
    };

    if (useBaseImage) {
      onProgress("Base image detected — skipping cloud-init wait");
    } else {
      // 5. Wait for cloud-init to fully finish (sshd restarts during finalization)
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

      // Extra stabilization pause after cloud-init
      onProgress("Stabilizing (5s)...");
      await sleep(5_000);
    }

    checkAbort();

    // 5b. Lock down SSH to manager IP only
    const managerIp = process.env.MANAGER_PUBLIC_IP;
    if (managerIp) {
      onProgress(`Restricting SSH access to manager IP (${managerIp})...`);
      try {
        const fwSession = await connectSsh(connConfig);
        await fwSession.exec([
          // Remove any existing broad SSH rules
          "ufw delete allow 22/tcp 2>/dev/null || true",
          "ufw delete limit 22/tcp 2>/dev/null || true",
          // Allow SSH only from the manager IP
          `ufw allow from ${managerIp} to any port 22 proto tcp`,
          "ufw --force enable",
          "ufw reload",
        ].join(" && "));
        fwSession.close();
        onProgress("SSH restricted to manager IP");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        onProgress(`Warning: Failed to restrict SSH: ${message}`);
      }
    }

    checkAbort();

    // 5c. Install GitLab deploy key if provided
    if (gitlabDeployKey) {
      onProgress("Installing GitLab deploy key on droplet...");
      try {
        const s = await connectSsh(connConfig);
        await s.exec("mkdir -p ~/.ssh && chmod 700 ~/.ssh");
        // Write the deploy key
        const escapedKey = gitlabDeployKey.replace(/'/g, "'\\''");
        await s.exec(`printf '%s\\n' '${escapedKey}' > ~/.ssh/id_gitlab && chmod 600 ~/.ssh/id_gitlab`);
        // Configure SSH to use this key for gitlab.com
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
      const agentSession = await connectSsh(connConfig);
      await agentSession.exec(
        "command -v genie-agent >/dev/null 2>&1 || npm install -g @genie/vps-agent 2>/dev/null || true",
      );
      agentSession.close();
    } catch {
      onProgress("Warning: Could not verify VPS agent installation");
    }

    checkAbort();

    // 7. Deploy via existing vpsDeploy
    onProgress("Starting deployment...");
    const envVars: Record<string, string> = { ...optsEnvVars };
    if (gitToken) envVars.GIT_TOKEN = gitToken;
    await vpsDeploy(projectName, connConfig, onProgress, envVars, setupFiles);

    return { dropletId, ipAddress, region, size };
  } catch (err: unknown) {
    const errObj = err instanceof Error ? err : new Error(String(err));
    if (errObj.message === "Deployment cancelled") {
      await cleanupDroplet();
    } else if (dropletIdForCleanup) {
      // Attach droplet info so the caller can offer keep/destroy
      (errObj as Error & { dropletId?: number; dropletIp?: string }).dropletId = dropletIdForCleanup;
      (errObj as Error & { dropletId?: number; dropletIp?: string }).dropletIp = ipAddressForCleanup;
    }
    throw errObj;
  }
}

export async function doDestroyDroplet(
  token: string,
  dropletId: number,
  onProgress: (msg: string) => void,
): Promise<void> {
  const client = createDoClient(token);
  onProgress(`Destroying droplet ${dropletId}...`);
  await client.deleteDroplet(dropletId);
  onProgress("Droplet destroyed");
}
