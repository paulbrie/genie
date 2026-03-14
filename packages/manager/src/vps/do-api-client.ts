const DO_API = "https://api.digitalocean.com/v2";

interface DoRequestInit {
  method?: string;
  body?: unknown;
}

async function doFetch(token: string, path: string, init?: DoRequestInit): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${DO_API}${path}`, {
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
    const msg = (json as Record<string, unknown>)?.message || (json as Record<string, unknown>)?.id || `HTTP ${res.status}`;
    throw new Error(`DigitalOcean API error: ${msg}`);
  }

  return json;
}

export interface DoAccount {
  email: string;
  uuid: string;
  status: string;
}

export interface DoSshKey {
  id: number;
  fingerprint: string;
  name: string;
  public_key: string;
}

export interface DoDroplet {
  id: number;
  name: string;
  status: string;
  networks: {
    v4: { ip_address: string; type: string }[];
  };
  region: { slug: string };
  size_slug: string;
}

export interface DoAction {
  id: number;
  status: string;
  type: string;
}

export interface DoSnapshot {
  id: number;
  name: string;
  regions: string[];
}

export interface DoApiClient {
  getAccount(): Promise<DoAccount>;
  listSshKeys(): Promise<DoSshKey[]>;
  createSshKey(name: string, publicKey: string): Promise<DoSshKey>;
  createDroplet(opts: {
    name: string;
    region: string;
    size: string;
    image: string | number;
    sshKeyIds: number[];
    tags?: string[];
    userData?: string;
  }): Promise<DoDroplet>;
  getDroplet(id: number): Promise<DoDroplet>;
  deleteDroplet(id: number): Promise<void>;
  listDroplets(tag?: string): Promise<DoDroplet[]>;
  snapshotDroplet(id: number, name: string): Promise<DoAction>;
  getAction(actionId: number): Promise<DoAction>;
  listDropletSnapshots(dropletId: number): Promise<DoSnapshot[]>;
  deleteSnapshot(snapshotId: number): Promise<void>;
  listAccountSnapshots(): Promise<DoSnapshot[]>;
  dropletAction(dropletId: number, type: string): Promise<DoAction>;
}

export function createDoClient(token: string): DoApiClient {
  return {
    async getAccount() {
      const data = await doFetch(token, "/account")!;
      return data!.account as DoAccount;
    },

    async listSshKeys() {
      const data = await doFetch(token, "/account/keys?per_page=200");
      return (data!.ssh_keys || []) as DoSshKey[];
    },

    async createSshKey(name: string, publicKey: string) {
      const data = await doFetch(token, "/account/keys", {
        method: "POST",
        body: { name, public_key: publicKey },
      });
      return data!.ssh_key as DoSshKey;
    },

    async createDroplet(opts) {
      const body: Record<string, unknown> = {
        name: opts.name,
        region: opts.region,
        size: opts.size,
        image: opts.image,
        ssh_keys: opts.sshKeyIds,
        tags: opts.tags || [],
      };
      if (opts.userData) body.user_data = opts.userData;
      const data = await doFetch(token, "/droplets", {
        method: "POST",
        body,
      });
      return data!.droplet as DoDroplet;
    },

    async getDroplet(id: number) {
      const data = await doFetch(token, `/droplets/${id}`);
      return data!.droplet as DoDroplet;
    },

    async deleteDroplet(id: number) {
      await doFetch(token, `/droplets/${id}`, { method: "DELETE" });
    },

    async listDroplets(tag?: string) {
      const query = tag ? `?tag_name=${tag}&per_page=200` : "?per_page=200";
      const data = await doFetch(token, `/droplets${query}`);
      return (data!.droplets || []) as DoDroplet[];
    },

    async snapshotDroplet(id: number, name: string) {
      const data = await doFetch(token, `/droplets/${id}/actions`, {
        method: "POST",
        body: { type: "snapshot", name },
      });
      return data!.action as DoAction;
    },

    async getAction(actionId: number) {
      const data = await doFetch(token, `/actions/${actionId}`);
      return data!.action as DoAction;
    },

    async listDropletSnapshots(dropletId: number) {
      const data = await doFetch(token, `/droplets/${dropletId}/snapshots?per_page=200`);
      return (data!.snapshots || []) as DoSnapshot[];
    },

    async deleteSnapshot(snapshotId: number) {
      await doFetch(token, `/snapshots/${snapshotId}`, { method: "DELETE" });
    },

    async listAccountSnapshots() {
      const data = await doFetch(token, "/snapshots?resource_type=droplet&per_page=200");
      return (data!.snapshots || []) as DoSnapshot[];
    },

    async dropletAction(dropletId: number, type: string) {
      const data = await doFetch(token, `/droplets/${dropletId}/actions`, {
        method: "POST",
        body: { type },
      });
      return data!.action as DoAction;
    },
  };
}
