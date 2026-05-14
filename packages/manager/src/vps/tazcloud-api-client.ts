const TAZ_API = "https://api.taz.ro";

interface TazRequestInit {
  method?: string;
  body?: unknown;
}

async function tazFetch(token: string, path: string, init?: TazRequestInit): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${TAZ_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });

  if (res.status === 204) return null;

  let json: Record<string, unknown> | null = null;
  try { json = await res.json() as Record<string, unknown>; } catch { /* non-JSON response */ }

  if (!res.ok) {
    const msg = json?.detail || `HTTP ${res.status}`;
    throw new Error(`TazCloud API error: ${msg}`);
  }

  return json;
}

export interface TazCapabilities {
  images: string[];
  sizes: string[];
  vm_access: {
    ssh: string;
    public_ipv6_prefix: string;
    tenant_ipv6_gateway: string;
  };
}

export interface TazVm {
  id: string;
  name: string;
  status: string;            // e.g. "ACTIVE"
  ip?: string;               // private IPv4 (10.x)
  ipv6: string;              // public IPv6
  ssh_host: string;          // same as ipv6
  ssh_port: number;
  image?: string;            // present on create, absent on get/list (per API docs)
  size?: string;
  networks: {
    v4: { ip_address: string; type: string }[];
    v6: { ip_address: string; type: string }[];
  };
}

export interface TazDeleteResult {
  status: string;             // "deleted"
  id: string;
  deleted_ports: string[];
}

/** SSH user TazCloud injects per image (root login is disabled). */
export function sshUserForImage(image: string): string {
  switch (image) {
    case "ubuntu-22":
    case "ubuntu-24": return "ubuntu";
    case "debian-12": return "debian";
    case "almalinux-9": return "almalinux";
    default: return "ubuntu";
  }
}

export interface TazApiClient {
  getCapabilities(): Promise<TazCapabilities>;
  createVm(opts: { name: string; image?: string; size?: string }): Promise<TazVm>;
  getVm(id: string): Promise<TazVm>;
  listVms(): Promise<TazVm[]>;
  deleteVm(id: string): Promise<TazDeleteResult>;
}

export function createTazClient(token: string): TazApiClient {
  return {
    async getCapabilities() {
      const data = await tazFetch(token, "/v1/capabilities");
      return data as unknown as TazCapabilities;
    },

    async createVm(opts) {
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.image) body.image = opts.image;
      if (opts.size) body.size = opts.size;
      const data = await tazFetch(token, "/v1/vm", { method: "POST", body });
      return data as unknown as TazVm;
    },

    async getVm(id: string) {
      const data = await tazFetch(token, `/v1/vm/${id}`);
      return data as unknown as TazVm;
    },

    async listVms() {
      const data = await tazFetch(token, "/v1/vm");
      return ((data?.vms as TazVm[] | undefined) ?? []);
    },

    async deleteVm(id: string) {
      const data = await tazFetch(token, `/v1/vm/${id}`, { method: "DELETE" });
      return data as unknown as TazDeleteResult;
    },
  };
}
