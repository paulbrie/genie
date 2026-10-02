import {
  attachDoDomain,
  detachDoDomain,
  loadNamecheapConfig,
  assertNamecheapConfig,
  getDropletDomain,
  setDropletDomain,
  removeDropletDomain,
} from "../vps/do-domain.js";
import { getGlobalDoToken } from "../settings-service.js";

export async function executeDoAttachDomain(opts: {
  dropletId: number;
  fqdn: string;
  appPort?: number;
}): Promise<string> {
  try {
    const doToken = await getGlobalDoToken();
    if (!doToken) return "Error: DigitalOcean API token is not configured on the manager.";
    const namecheap = await loadNamecheapConfig();
    try {
      assertNamecheapConfig(namecheap);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
    const result = await attachDoDomain(
      { doToken, dropletId: opts.dropletId, fqdn: opts.fqdn, appPort: opts.appPort, namecheap },
      () => {},
    );
    await setDropletDomain(opts.dropletId, {
      fqdn: result.fqdn,
      host: result.host,
      appPort: result.appPort,
      ip: result.ip,
      createdAt: new Date().toISOString(),
    });
    return [
      `Attached ${result.fqdn} to droplet ${opts.dropletId}.`,
      `URL: ${result.url}`,
      `DNS: created A record ${result.host === "@" ? namecheap.domain : `${result.host}.${namecheap.domain}`} → ${result.ip} at Namecheap.`,
      `TLS: Caddy will auto-issue a Let's Encrypt certificate once DNS propagates (usually within a few minutes).`,
      `App port: ${result.appPort} (the app must listen on this port inside the VM).`,
    ].join("\n");
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeDoRemoveDomain(opts: { dropletId: number }): Promise<string> {
  try {
    const existing = await getDropletDomain(opts.dropletId);
    if (!existing) return `No domain is attached to droplet ${opts.dropletId}.`;
    const doToken = await getGlobalDoToken();
    if (!doToken) return "Error: DigitalOcean API token is not configured on the manager.";
    const namecheap = await loadNamecheapConfig();
    try {
      assertNamecheapConfig(namecheap);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
    await detachDoDomain({ doToken, dropletId: opts.dropletId, fqdn: existing.fqdn, namecheap }, () => {});
    await removeDropletDomain(opts.dropletId);
    return `Removed domain ${existing.fqdn} from droplet ${opts.dropletId} (Namecheap A record deleted; Caddy site config removed).`;
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
