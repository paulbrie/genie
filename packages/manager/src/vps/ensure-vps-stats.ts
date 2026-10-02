import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { connectSsh, type SshConnectionConfig } from "./ssh-client.js";
import { execCached, evictSession } from "./ssh-session-cache.js";
import { ensureStatsToken } from "./stats-token-service.js";
import { mcpRestBaseUrl } from "./mcp-config-merge.js";

export const VPS_STATS_REMOTE_BASE = "/usr/lib/node_modules/@genie/vps-stats";
export const VPS_STATS_JSONL_PATH = "/run/genie/stats.jsonl";
export const GENIE_STATS_SYSTEMD_UNIT = "genie-stats.service";
export const GENIE_STANDARD_RECIPE_SLUG = "genie-standard";

/** systemd drop-in carrying per-instance postback env for genie-stats. */
const STATS_DROPIN_DIR = `/etc/systemd/system/${GENIE_STATS_SYSTEMD_UNIT}.d`;
const STATS_DROPIN_PATH = `${STATS_DROPIN_DIR}/10-genie-postback.conf`;

const VERSION_FILE = `${VPS_STATS_REMOTE_BASE}/.version`;

/** Resolve path to vps-stats dist directory (relative to manager package). */
export function getVpsStatsDistDir(): string {
  const dir = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(dir, "../../../vps-stats/dist");
}

async function computeLocalStatsHash(): Promise<string> {
  const localDist = getVpsStatsDistDir();
  const localPkg = path.resolve(localDist, "../package.json");
  const hash = crypto.createHash("sha256");
  hash.update(await fsp.readFile(localPkg));

  async function hashDir(dir: string): Promise<void> {
    const entries = (await fsp.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await hashDir(fullPath);
      } else if (entry.name.endsWith(".js")) {
        hash.update(entry.name);
        hash.update(await fsp.readFile(fullPath));
      }
    }
  }
  await hashDir(localDist);
  return hash.digest("hex").slice(0, 16);
}

async function collectStatsFiles(): Promise<{ remotePath: string; content: string }[]> {
  const localDist = getVpsStatsDistDir();
  const localPkg = path.resolve(localDist, "../package.json");
  const files: { remotePath: string; content: string }[] = [];

  files.push({
    remotePath: `${VPS_STATS_REMOTE_BASE}/package.json`,
    content: await fsp.readFile(localPkg, "utf-8"),
  });

  async function collect(dir: string, remoteBase: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const remotePath = `${remoteBase}/${entry.name}`;
      if (entry.isDirectory()) {
        await collect(fullPath, remotePath);
      } else if (entry.name.endsWith(".js")) {
        files.push({ remotePath, content: await fsp.readFile(fullPath, "utf-8") });
      }
    }
  }
  await collect(localDist, `${VPS_STATS_REMOTE_BASE}/dist`);
  return files;
}

/** Ensure the vps-stats bundle on the remote VPS matches the local build. */
export async function ensureVpsStats(connection: SshConnectionConfig): Promise<void> {
  const localHash = await computeLocalStatsHash();

  let remoteHash = "";
  try {
    remoteHash = (await execCached(connection, `cat ${VERSION_FILE} 2>/dev/null || echo ""`)).trim();
  } catch {
    /* missing */
  }

  if (remoteHash === localHash) return;

  console.log(`[vps-stats] Version mismatch (local=${localHash}, remote=${remoteHash || "none"}), uploading...`);
  const filesToUpload = await collectStatsFiles();

  try {
    const dirs = new Set(filesToUpload.map((f) => path.posix.dirname(f.remotePath)));
    await execCached(connection, `sudo mkdir -p ${[...dirs].join(" ")}`);

    for (const file of filesToUpload) {
      const b64 = Buffer.from(file.content).toString("base64");
      await execCached(connection, `echo '${b64}' | base64 -d | sudo tee ${file.remotePath} > /dev/null`);
    }

    await execCached(connection, `echo '${localHash}' | sudo tee ${VERSION_FILE} > /dev/null`);
    console.log(`[vps-stats] Uploaded successfully (version=${localHash})`);
  } catch (err) {
    evictSession(connection);
    throw err;
  }
}


/**
 * Write the systemd drop-in that points the on-VM genie-stats daemon at the
 * manager's public URL with a per-instance bearer token, so it can POST stats
 * over HTTPS. Uses the same resolver as the MCP config (`mcpRestBaseUrl`):
 * VPS_MANAGER_URL override → MANAGER_URL when it's already public → the public
 * API default. This matters because the daemon runs on EVERY cloud (DO, Hetzner,
 * Taz). The old code used raw `process.env.MANAGER_URL`: if that was a dev/private
 * value, only VMs that happened to share its network (Taz) could reach it and
 * non-Taz clouds silently never posted. Always resolves to something publicly
 * reachable now, so it always writes (returns true).
 */
async function writeStatsPostbackDropin(
  connection: SshConnectionConfig,
  projectId: string,
  instanceId: string,
): Promise<boolean> {
  const managerUrl = mcpRestBaseUrl();
  const token = await ensureStatsToken(projectId, instanceId);
  const dropin = [
    "[Service]",
    `Environment=GENIE_MANAGER_URL=${managerUrl}`,
    `Environment=GENIE_STATS_TOKEN=${token}`,
    `Environment=GENIE_PROJECT_ID=${projectId}`,
    `Environment=GENIE_INSTANCE_ID=${instanceId}`,
    "",
  ].join("\n");
  const b64 = Buffer.from(dropin).toString("base64");
  await execCached(connection, `sudo mkdir -p ${STATS_DROPIN_DIR}`);
  await execCached(connection, `echo '${b64}' | base64 -d | sudo tee ${STATS_DROPIN_PATH} > /dev/null`);
  return true;
}

/** Upload bundle if needed, then enable/restart the recipe-installed systemd unit. */
export async function syncGenieStatsOnVm(
  connection: SshConnectionConfig,
  projectId: string,
  instanceId: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  await ensureVpsStats(connection);
  try {
    const wrote = await writeStatsPostbackDropin(connection, projectId, instanceId);
    if (wrote) onProgress?.("genie-stats postback configured");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress?.(`Warning: could not write genie-stats postback config: ${message}`);
  }
  const session = await connectSsh(connection, { timeoutMs: 30_000 });
  try {
    const out = await session.exec(
      `sudo systemctl daemon-reload 2>/dev/null; ` +
        `if systemctl list-unit-files ${GENIE_STATS_SYSTEMD_UNIT} 2>/dev/null | grep -q ${GENIE_STATS_SYSTEMD_UNIT}; then ` +
        `sudo systemctl enable ${GENIE_STATS_SYSTEMD_UNIT} 2>/dev/null; ` +
        `sudo systemctl restart ${GENIE_STATS_SYSTEMD_UNIT} 2>&1; ` +
        `systemctl is-active ${GENIE_STATS_SYSTEMD_UNIT}; ` +
        `else echo "no-unit"; fi`,
    );
    const line = out.trim().split("\n").pop()?.trim() ?? "";
    if (line === "active") {
      onProgress?.("genie-stats service active");
    } else if (line === "no-unit") {
      onProgress?.("genie-stats unit not installed (re-run Genie Standard Setup)");
    } else {
      onProgress?.(`genie-stats service: ${line || "unknown"}`);
    }
  } finally {
    session.close();
  }
}
