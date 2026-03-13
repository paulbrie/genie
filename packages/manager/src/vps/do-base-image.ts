import { createDoClient } from "./do-api-client.js";
import { connectSsh } from "./ssh-client.js";
import {
  ensureGenieKeyPair,
  ensureGenieKeyOnDisk,
  sshKeyFingerprint,
} from "./do-provision.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CreateBaseImageOpts {
  token: string;
  region?: string;
  size?: string;
  snapshotPrefix?: string;
  provisionScript?: string;
  signal?: AbortSignal;
}

export async function createBaseImage(
  opts: CreateBaseImageOpts,
  onProgress: (msg: string) => void,
): Promise<{ snapshotId: number; snapshotName: string }> {
  const {
    token,
    region = "nyc1",
    size = "s-1vcpu-1gb",
    snapshotPrefix = "genie-base",
    provisionScript,
    signal,
  } = opts;
  const client = createDoClient(token);
  let dropletId: number | null = null;

  function checkAbort() {
    if (signal?.aborted) throw new Error("Base image creation cancelled");
  }

  async function cleanupDroplet() {
    if (dropletId) {
      try {
        onProgress(`Cleaning up temp droplet ${dropletId}...`);
        await client.deleteDroplet(dropletId);
        onProgress("Temp droplet destroyed");
      } catch {}
    }
  }

  try {
    // 1. Ensure Genie SSH key + register with DO
    onProgress("Ensuring Genie SSH key...");
    const keyPair = await ensureGenieKeyPair();
    const privateKeyPath = await ensureGenieKeyOnDisk();
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

    // 2. Create temp droplet
    onProgress(`Creating temp droplet for base image (${size} in ${region})...`);
    const droplet = await client.createDroplet({
      name: `genie-base-build-${Date.now()}`,
      region,
      size,
      image: "docker-20-04",
      sshKeyIds: [keyId],
      tags: ["genie-base"],
      userData: `#!/bin/bash
ufw delete limit 22/tcp
ufw allow 22/tcp
ufw delete limit 22/tcp
ufw reload
`,
    });
    dropletId = droplet.id;
    onProgress(`Temp droplet created (id: ${dropletId}), waiting for active...`);

    // 3. Wait for active + IP (120s timeout)
    const POLL_INTERVAL = 5_000;
    let ipAddress = "";
    const pollStart = Date.now();
    while (Date.now() - pollStart < 120_000) {
      checkAbort();
      const current = await client.getDroplet(dropletId);
      const pub = current.networks?.v4?.find((n) => n.type === "public");
      if (current.status === "active" && pub?.ip_address) {
        ipAddress = pub.ip_address;
        onProgress(`Droplet active at ${ipAddress}`);
        break;
      }
      onProgress(`Droplet status: ${current.status}...`);
      await sleep(POLL_INTERVAL);
    }
    if (!ipAddress) throw new Error("Timed out waiting for droplet to become active (120s)");

    // 4. Wait for SSH + Docker ready (180s timeout)
    onProgress(`Waiting for SSH on ${ipAddress}:22...`);
    const sshStart = Date.now();
    let sshReady = false;
    let attempt = 0;
    while (Date.now() - sshStart < 180_000) {
      checkAbort();
      attempt++;
      try {
        const session = await Promise.race([
          connectSsh({ host: ipAddress, port: 22, username: "root", privateKeyPath, privateKey: keyPair.privateKey }),
          sleep(15_000).then(() => { throw new Error("attempt timeout (15s)"); }),
        ]);
        const result = await (session as any).exec("docker --version");
        (session as any).close();
        if (typeof result === "string" && result.includes("Docker")) {
          sshReady = true;
          onProgress("SSH ready, Docker available");
          break;
        }
      } catch (err: any) {
        onProgress(`[${attempt}] ${Math.round((Date.now() - sshStart) / 1000)}s — ${(err?.message || String(err)).slice(0, 120)}`);
      }
      await sleep(POLL_INTERVAL);
    }
    if (!sshReady) throw new Error("Timed out waiting for SSH/Docker to be ready (180s)");

    // 5. Wait for cloud-init (24 attempts × 5s)
    onProgress("Waiting for cloud-init to finish...");
    const connConfig = { host: ipAddress, port: 22, username: "root", privateKeyPath, privateKey: keyPair.privateKey };
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
      } catch (err: any) {
        onProgress(`Waiting for cloud-init (${ci}/24): ${err.message?.slice(0, 60)}`);
      }
      await sleep(5_000);
    }

    checkAbort();

    // 6. SSH in and run provision script
    const script = provisionScript?.trim() || "#!/bin/bash\nset -e\nufw allow 80/tcp && ufw allow 443/tcp && ufw reload\ncurl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs\nnpm install -g @anthropic-ai/claude-code";
    onProgress("Running provision script...");
    const s = await connectSsh(connConfig);
    try {
      await s.exec(`cat > /tmp/provision.sh << 'GENIEEOF'\n${script}\nGENIEEOF`);
      await s.exec("chmod +x /tmp/provision.sh && bash /tmp/provision.sh 2>&1", (chunk) => {
        const line = chunk.trimEnd();
        if (line) onProgress(line);
      });
      onProgress("Provisioning complete");
    } finally {
      s.close();
    }

    checkAbort();

    // 7. Shutdown droplet cleanly
    onProgress("Shutting down droplet...");
    await client.dropletAction(dropletId, "shutdown");
    const shutdownStart = Date.now();
    while (Date.now() - shutdownStart < 120_000) {
      checkAbort();
      const current = await client.getDroplet(dropletId);
      if (current.status === "off") {
        onProgress("Droplet powered off");
        break;
      }
      onProgress(`Shutdown: ${current.status}...`);
      await sleep(POLL_INTERVAL);
    }

    // 8. Snapshot the droplet
    const snapshotName = `snapshot-${snapshotPrefix}-${Date.now()}`;
    onProgress(`Creating snapshot "${snapshotName}"...`);
    const snapAction = await client.snapshotDroplet(dropletId, snapshotName);
    const snapStart = Date.now();
    while (Date.now() - snapStart < 600_000) {
      checkAbort();
      const action = await client.getAction(snapAction.id);
      if (action.status === "completed") {
        onProgress("Snapshot completed");
        break;
      }
      if (action.status === "errored") throw new Error("Snapshot action failed");
      onProgress(`Snapshotting (${Math.round((Date.now() - snapStart) / 1000)}s)...`);
      await sleep(POLL_INTERVAL);
    }

    // 9. Find the snapshot
    const snapshots = await client.listDropletSnapshots(dropletId);
    const snap = snapshots.find((s) => s.name === snapshotName);
    if (!snap) throw new Error("Snapshot not found after creation");
    const snapshotId = snap.id;
    onProgress(`Snapshot ready: ${snapshotName} (id: ${snapshotId})`);

    // 10. Destroy temp droplet
    onProgress("Destroying temp droplet...");
    await client.deleteDroplet(dropletId);
    dropletId = null;
    onProgress("Temp droplet destroyed");

    onProgress(`Base image ready: ${snapshotName} (id: ${snapshotId})`);
    return { snapshotId, snapshotName };
  } catch (err: any) {
    // Don't destroy the droplet on failure — let the user debug via SSH
    if (dropletId) {
      let failedIp = "";
      try {
        const current = await client.getDroplet(dropletId);
        const pub = current.networks?.v4?.find((n: any) => n.type === "public");
        failedIp = pub?.ip_address || "";
      } catch {}
      onProgress(`Build failed — droplet ${dropletId} (${failedIp || "no IP"}) kept alive for debugging`);
      const enriched: any = new Error(err.message || String(err));
      enriched.failedDropletId = dropletId;
      enriched.failedDropletIp = failedIp;
      throw enriched;
    }
    throw err;
  }
}
