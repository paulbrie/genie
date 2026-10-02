const HETZNER_API = "https://api.hetzner.cloud/v1";

interface HetznerRequestInit {
  method?: string;
  body?: unknown;
}

async function hetznerFetch(token: string, path: string, init?: HetznerRequestInit): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${HETZNER_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });

  if (res.status === 204) return null;

  const json = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } })?.error;
    const msg = err?.message || err?.code || `HTTP ${res.status}`;
    throw new Error(`Hetzner API error: ${msg}`);
  }

  return json;
}

export interface HetznerSshKey {
  id: number;
  name: string;
  fingerprint: string;
  public_key: string;
}

export interface HetznerServer {
  id: number;
  name: string;
  status: string;  // initializing | starting | running | off | deleting | ...
  created?: string;
  public_net: {
    ipv4: { ip: string } | null;
    ipv6: { ip: string } | null;
  };
  server_type: {
    name: string;
    cores?: number;
    memory?: number;  // GB
    disk?: number;    // GB
  };
  datacenter: { location: { name: string } };
}

export interface HetznerAction {
  id: number;
  status: string;  // running | success | error
  command: string;
}

export interface HetznerApiClient {
  /** Lightweight auth probe — lists locations, throws on a bad token. */
  verifyToken(): Promise<boolean>;
  listSshKeys(): Promise<HetznerSshKey[]>;
  createSshKey(name: string, publicKey: string): Promise<HetznerSshKey>;
  createServer(opts: {
    name: string;
    serverType: string;
    image: string;
    location: string;
    sshKeyIds: number[];
    labels?: Record<string, string>;
    userData?: string;
  }): Promise<HetznerServer>;
  getServer(id: number): Promise<HetznerServer>;
  deleteServer(id: number): Promise<void>;
  /** All Genie-provisioned servers (filtered by the `genie` label). */
  listServers(labelSelector?: string): Promise<HetznerServer[]>;
  serverAction(serverId: number, action: string): Promise<HetznerAction>;
  /** Rename a server. Hetzner requires a valid hostname (lowercase, no spaces);
   *  the caller treats failures as best-effort since the DB alias is the source
   *  of truth for the display name. */
  renameServer(serverId: number, name: string): Promise<HetznerServer>;
  getAction(actionId: number): Promise<HetznerAction>;
}

export function createHetznerClient(token: string): HetznerApiClient {
  return {
    async verifyToken() {
      await hetznerFetch(token, "/locations");
      return true;
    },

    async listSshKeys() {
      const data = await hetznerFetch(token, "/ssh_keys?per_page=50");
      return (data!.ssh_keys || []) as HetznerSshKey[];
    },

    async createSshKey(name: string, publicKey: string) {
      const data = await hetznerFetch(token, "/ssh_keys", {
        method: "POST",
        body: { name, public_key: publicKey },
      });
      return data!.ssh_key as HetznerSshKey;
    },

    async createServer(opts) {
      const body: Record<string, unknown> = {
        name: opts.name,
        server_type: opts.serverType,
        image: opts.image,
        location: opts.location,
        ssh_keys: opts.sshKeyIds,
        labels: opts.labels || {},
        // IPv4 is billed separately on Hetzner and must be requested explicitly;
        // the manager talks to droplets over IPv4 (matching the DO path).
        public_net: { enable_ipv4: true, enable_ipv6: true },
        start_after_create: true,
      };
      if (opts.userData) body.user_data = opts.userData;
      const data = await hetznerFetch(token, "/servers", {
        method: "POST",
        body,
      });
      return data!.server as HetznerServer;
    },

    async getServer(id: number) {
      const data = await hetznerFetch(token, `/servers/${id}`);
      return data!.server as HetznerServer;
    },

    async deleteServer(id: number) {
      await hetznerFetch(token, `/servers/${id}`, { method: "DELETE" });
    },

    async listServers(labelSelector?: string) {
      const query = labelSelector
        ? `?label_selector=${encodeURIComponent(labelSelector)}&per_page=50`
        : "?per_page=50";
      const data = await hetznerFetch(token, `/servers${query}`);
      return (data!.servers || []) as HetznerServer[];
    },

    async serverAction(serverId: number, action: string) {
      const data = await hetznerFetch(token, `/servers/${serverId}/actions/${action}`, {
        method: "POST",
      });
      return data!.action as HetznerAction;
    },

    async renameServer(serverId: number, name: string) {
      const data = await hetznerFetch(token, `/servers/${serverId}`, {
        method: "PUT",
        body: { name },
      });
      return data!.server as HetznerServer;
    },

    async getAction(actionId: number) {
      const data = await hetznerFetch(token, `/actions/${actionId}`);
      return data!.action as HetznerAction;
    },
  };
}

/** Public IPv4 address of a Hetzner server, or null if not yet assigned. */
export function getServerPublicIp(server: HetznerServer): string | null {
  return server.public_net?.ipv4?.ip || null;
}
