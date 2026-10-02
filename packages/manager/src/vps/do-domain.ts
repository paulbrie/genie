// On-demand "attach a custom subdomain + automatic HTTPS" for a DigitalOcean
// droplet. DO has no shared ingress layer (unlike TazCloud), so we:
//   1. create/update an A record (fqdn → droplet public IP) at Namecheap, and
//   2. install Caddy on the VM to terminate TLS (auto Let's Encrypt) and
//      reverse-proxy to the app port.
//
// Mirrors the spirit of tools/tazcloud.ts → registerIngress, but self-hosted on
// the droplet. Triggered on demand (admin panel / AI tool), never as part of
// the core provision flow.

import { createDoClient, type DoDroplet } from "./do-api-client.js";
import { createNamecheapClient } from "./namecheap-dns-client.js";
import { connectSsh, pickWorkingSshUser } from "./ssh-client.js";
import { ensureGenieKeyOnDisk } from "./do-provision.js";
import { VPS_SSH_USERNAME } from "../types.js";
import {
  getGlobalSetting,
  setGlobalSetting,
  getGlobalNamecheapApiUser,
  getGlobalNamecheapApiKey,
  getGlobalNamecheapUserName,
  getGlobalNamecheapDomain,
} from "../settings-service.js";

export interface NamecheapConfig {
  apiUser: string;
  apiKey: string;
  userName: string;
  domain: string;   // the registered domain Genie manages, e.g. "example.com"
  clientIp: string; // manager public IP (must be whitelisted at Namecheap)
}

export interface AttachDoDomainOpts {
  doToken: string;
  dropletId: number;
  fqdn: string;
  appPort?: number;
  namecheap: NamecheapConfig;
}

export interface AttachDoDomainResult {
  url: string;
  fqdn: string;
  host: string;
  ip: string;
  appPort: number;
  status: string;
}

type Progress = (message: string) => void;

const DEFAULT_APP_PORT = 3000;
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

function getPublicIp(droplet: DoDroplet): string | null {
  return (droplet.networks?.v4 || []).find((n) => n.type === "public")?.ip_address || null;
}

function normalizeFqdn(fqdn: string): string {
  return fqdn.trim().toLowerCase().replace(/\.$/, "");
}

/** Derive the host label Namecheap wants (e.g. "app") from the full FQDN and the
 *  configured managed domain. Apex maps to "@". Throws if the FQDN isn't under
 *  the managed domain. */
export function deriveHost(fqdn: string, managedDomain: string): string {
  const f = normalizeFqdn(fqdn);
  const d = normalizeFqdn(managedDomain);
  if (!f) throw new Error("fqdn is required");
  if (!d) throw new Error("Namecheap managed domain is not configured");
  if (f === d) return "@";
  if (f.endsWith("." + d)) return f.slice(0, f.length - d.length - 1);
  throw new Error(
    `"${fqdn}" is not a subdomain of the managed domain "${managedDomain}". ` +
    `Configure the Namecheap domain in Settings to match, or attach a subdomain of it.`,
  );
}

/** Idempotent Caddy install + per-site config. Uses a drop-in dir so multiple
 *  domains can coexist on one droplet and detach is a single file removal.
 *  All file writes use printf|tee (no heredocs) so the whole script can be sent
 *  as one SSH exec without quoting surprises. */
function buildCaddyAttachScript(fqdn: string, appPort: number): string {
  const site = `${fqdn} {\n    reverse_proxy localhost:${appPort}\n}\n`;
  return [
    "set -e",
    // Open the web ports incrementally — never reset existing UFW rules (SSH
    // stays manager-only). Harmless if UFW is inactive.
    "sudo ufw allow 80/tcp >/dev/null 2>&1 || true",
    "sudo ufw allow 443/tcp >/dev/null 2>&1 || true",
    "sudo ufw reload >/dev/null 2>&1 || true",
    // Install Caddy from its official apt repo if not already present.
    "if ! command -v caddy >/dev/null 2>&1; then",
    "  sudo apt-get update -y",
    "  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg",
    "  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg",
    "  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null",
    "  sudo apt-get update -y",
    "  sudo apt-get install -y caddy",
    "fi",
    // Genie-managed top-level Caddyfile just imports per-site drop-ins.
    "sudo mkdir -p /etc/caddy/sites",
    "printf 'import /etc/caddy/sites/*.caddy\\n' | sudo tee /etc/caddy/Caddyfile >/dev/null",
    `printf '%s' ${shSingleQuote(site)} | sudo tee /etc/caddy/sites/${fqdn}.caddy >/dev/null`,
    "sudo systemctl enable caddy >/dev/null 2>&1 || true",
    "sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile",
    "sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy",
  ].join("\n");
}

function buildCaddyDetachScript(fqdn: string): string {
  return [
    `sudo rm -f /etc/caddy/sites/${fqdn}.caddy`,
    "sudo systemctl reload caddy 2>/dev/null || true",
  ].join("\n");
}

/** POSIX single-quote a string for safe embedding in a shell command. */
function shSingleQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

async function resolveDropletSsh(ip: string): Promise<{ username: string; privateKeyPath: string }> {
  const privateKeyPath = await ensureGenieKeyOnDisk();
  const username = await pickWorkingSshUser({ host: ip, port: 22, privateKeyPath }, [VPS_SSH_USERNAME, "root"]);
  if (!username) {
    throw new Error(`Cannot SSH into ${ip} as '${VPS_SSH_USERNAME}' or 'root' with the Genie key.`);
  }
  return { username, privateKeyPath };
}

export async function attachDoDomain(opts: AttachDoDomainOpts, onProgress: Progress): Promise<AttachDoDomainResult> {
  const fqdn = normalizeFqdn(opts.fqdn);
  const appPort = opts.appPort ?? DEFAULT_APP_PORT;
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) {
    throw new Error("app port must be an integer in 1–65535");
  }
  if (!HOSTNAME_RE.test(fqdn)) throw new Error(`Invalid FQDN "${opts.fqdn}"`);
  const host = deriveHost(fqdn, opts.namecheap.domain);

  // 1. Resolve the droplet's public IPv4.
  onProgress(`Resolving droplet ${opts.dropletId}…`);
  const droplet = await createDoClient(opts.doToken).getDroplet(opts.dropletId);
  const ip = getPublicIp(droplet);
  if (!ip) throw new Error(`Droplet ${opts.dropletId} has no public IPv4 address.`);
  onProgress(`Droplet public IP: ${ip}`);

  // 2. Create/update the A record at Namecheap (read-modify-write).
  onProgress(`Creating DNS A record ${fqdn} → ${ip} at Namecheap…`);
  const nc = createNamecheapClient({
    apiUser: opts.namecheap.apiUser,
    apiKey: opts.namecheap.apiKey,
    userName: opts.namecheap.userName,
    clientIp: opts.namecheap.clientIp,
  });
  await nc.upsertARecord(opts.namecheap.domain, host, ip, 300);
  onProgress(`DNS A record set: ${host === "@" ? opts.namecheap.domain : `${host}.${opts.namecheap.domain}`} → ${ip}`);

  // 3. Open ports 80/443 + install/configure Caddy over SSH.
  onProgress("Connecting to droplet over SSH…");
  const { username, privateKeyPath } = await resolveDropletSsh(ip);
  const session = await connectSsh({ host: ip, port: 22, username, privateKeyPath });
  try {
    onProgress("Opening ports 80/443 and installing Caddy (this can take a minute)…");
    await session.exec(buildCaddyAttachScript(fqdn, appPort), undefined, { timeoutMs: 600_000, idleTimeoutMs: 180_000 });
    onProgress("Caddy configured.");
  } finally {
    session.close();
  }

  onProgress(`Done. https://${fqdn} will serve once DNS propagates and Caddy issues the certificate (usually within a few minutes).`);
  return { url: `https://${fqdn}`, fqdn, host, ip, appPort, status: "dns_created_cert_pending" };
}

export interface DetachDoDomainOpts {
  doToken: string;
  dropletId: number;
  fqdn: string;
  namecheap: NamecheapConfig;
}

export async function detachDoDomain(opts: DetachDoDomainOpts, onProgress: Progress): Promise<{ fqdn: string }> {
  const fqdn = normalizeFqdn(opts.fqdn);
  const host = deriveHost(fqdn, opts.namecheap.domain);

  // 1. Remove the A record at Namecheap.
  onProgress(`Removing DNS A record ${fqdn} at Namecheap…`);
  const nc = createNamecheapClient({
    apiUser: opts.namecheap.apiUser,
    apiKey: opts.namecheap.apiKey,
    userName: opts.namecheap.userName,
    clientIp: opts.namecheap.clientIp,
  });
  await nc.removeRecord(opts.namecheap.domain, host, "A");
  onProgress("DNS record removed.");

  // 2. Remove the Caddy site config (best-effort — the droplet may be gone).
  try {
    const droplet = await createDoClient(opts.doToken).getDroplet(opts.dropletId);
    const ip = getPublicIp(droplet);
    if (ip) {
      const { username, privateKeyPath } = await resolveDropletSsh(ip);
      const session = await connectSsh({ host: ip, port: 22, username, privateKeyPath });
      try {
        await session.exec(buildCaddyDetachScript(fqdn), undefined, { timeoutMs: 120_000, idleTimeoutMs: 60_000 });
        onProgress("Removed Caddy site config on the droplet.");
      } finally {
        session.close();
      }
    }
  } catch (err) {
    onProgress(`Note: could not clean up Caddy on the droplet (${err instanceof Error ? err.message : String(err)}). The DNS record was removed.`);
  }

  return { fqdn };
}

// --- Namecheap config loader (settings + env fallback) ---

export async function loadNamecheapConfig(): Promise<NamecheapConfig> {
  return {
    apiUser: await getGlobalNamecheapApiUser(),
    apiKey: await getGlobalNamecheapApiKey(),
    userName: await getGlobalNamecheapUserName(),
    domain: await getGlobalNamecheapDomain(),
    clientIp: process.env.MANAGER_PUBLIC_IP || "",
  };
}

export function assertNamecheapConfig(c: NamecheapConfig): void {
  if (!c.apiUser || !c.apiKey || !c.userName) {
    throw new Error("Namecheap API credentials are not configured. Set them in Settings (or NAMECHEAP_API_USER / NAMECHEAP_API_KEY / NAMECHEAP_USERNAME env).");
  }
  if (!c.domain) {
    throw new Error("Namecheap managed domain is not configured. Set it in Settings (or NAMECHEAP_DOMAIN env).");
  }
  if (!c.clientIp) {
    throw new Error("MANAGER_PUBLIC_IP is not set on the manager — Namecheap requires the caller IP, which must also be whitelisted in your Namecheap API access settings.");
  }
}

// --- Attached-domain persistence (global-settings map keyed by dropletId) ---

export interface DropletDomainRecord {
  fqdn: string;
  host: string;
  appPort: number;
  ip: string;
  createdAt: string;
}

const DROPLET_DOMAINS_KEY = "dropletDomains";

export async function getDropletDomainMap(): Promise<Record<string, DropletDomainRecord>> {
  return (await getGlobalSetting<Record<string, DropletDomainRecord>>(DROPLET_DOMAINS_KEY)) || {};
}

export async function getDropletDomain(dropletId: number): Promise<DropletDomainRecord | null> {
  const map = await getDropletDomainMap();
  return map[String(dropletId)] || null;
}

export async function setDropletDomain(dropletId: number, rec: DropletDomainRecord): Promise<void> {
  const map = await getDropletDomainMap();
  map[String(dropletId)] = rec;
  await setGlobalSetting(DROPLET_DOMAINS_KEY, map);
}

export async function removeDropletDomain(dropletId: number): Promise<void> {
  const map = await getDropletDomainMap();
  delete map[String(dropletId)];
  await setGlobalSetting(DROPLET_DOMAINS_KEY, map);
}
