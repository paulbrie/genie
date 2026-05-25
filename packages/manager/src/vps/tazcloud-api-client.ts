const TAZ_API = "https://api.taz.ro";

interface TazRequestInit {
  method?: string;
  body?: unknown;
}

function formatTazDetail(json: Record<string, unknown> | null): string {
  const detail = json?.detail;
  if (typeof detail === "string") return detail;
  // FastAPI validation errors: detail is an array of {loc, msg, type}.
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        if (typeof e === "string") return e;
        if (e && typeof e === "object") {
          const o = e as { msg?: unknown; loc?: unknown };
          const loc = Array.isArray(o.loc) ? o.loc.join(".") : undefined;
          const msg = typeof o.msg === "string" ? o.msg : JSON.stringify(o);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return JSON.stringify(e);
      })
      .join("; ");
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  if (json && Object.keys(json).length > 0) return JSON.stringify(json);
  return "no detail returned";
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

  // Read body as text first so non-JSON error responses (FastAPI's plain
  // "no such route" 404, HTML error pages) still surface a useful message.
  const rawBody = await res.text();
  let json: Record<string, unknown> | null = null;
  if (rawBody) {
    try { json = JSON.parse(rawBody) as Record<string, unknown>; } catch { /* non-JSON */ }
  }

  if (!res.ok) {
    throw new Error(`TazCloud API error (${res.status}): ${formatTazDetail(json) || rawBody || "no body"}`);
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
  ingress?: {
    available: boolean;
    public_ip: string;
    tls: boolean;
  };
  /** Tenants with multi-project support require `project_id` on createVm. */
  projects?: {
    available: boolean;
  };
}

export interface TazIngress {
  ip: string;
  domain: string;
  url: string;
  dns_action: string;
  status: string;             // e.g. "pending_dns", "active"
}

export interface TazVm {
  id: string;
  name: string;
  status: string;            // e.g. "ACTIVE"
  ip?: string | null;        // private IPv4 (10.x) for vxlan-bastion VMs; absent on legacy v6-only
  ipv6?: string | null;      // public IPv6 (legacy v6-only mode); null on vxlan-bastion
  ssh_host: string;          // address to ssh to — equals ipv6 (legacy) or ip (bastion)
  ssh_port: number;
  /** Present on tenants with `vm_access.mode === "vxlan-bastion"`. Format:
   *  "<user>@<host>" (e.g. "almalinux@188.213.48.230"). When set, ssh_host
   *  is a private IP only reachable via this bastion. */
  ssh_bastion?: string | null;
  /** Human-readable command, e.g. "ssh -J almalinux@188.213.48.230 …". */
  ssh_command?: string;
  image?: string | null;     // null when booted from snapshot
  snapshot_id?: string;      // present when booted from snapshot
  size?: string;
  project_id?: string;
  networks: {
    v4: { ip_address: string; type: string }[];
    v6: { ip_address: string; type: string }[];
  };
  ingress?: TazIngress;      // present when ingress is registered for this VM
}

export interface TazDeleteResult {
  status: string;             // "deleted"
  id: string;
  deleted_ports: string[];
}

export type TazSnapshotStatus = "pending" | "active" | "error";

export interface TazSnapshot {
  id: string;
  name: string;
  source_vm_id: string;
  status: TazSnapshotStatus;
  size_gb: number;
  created: string;            // ISO-8601 timestamp
}

export interface TazIngressRemoveResult {
  status: string;             // "removed"
  vm_id: string;
}

export interface TazSnapshotDeleteResult {
  status: string;             // "deleted"
  id: string;
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

export interface TazCreateVmOpts {
  name: string;
  /** Base image key. Mutually exclusive with `snapshot_id`. Default: almalinux-9. */
  image?: string;
  size?: string;
  /** Boot from an existing active snapshot instead of a base image. */
  snapshot_id?: string;
  /** Taz tenant project the VM belongs to. Required by the API on tenants
   *  where `/v1/capabilities.projects.available === true`. When omitted and
   *  exactly one project exists, createVm auto-fills it; otherwise throws
   *  asking the caller to specify. */
  project_id?: string;
}

export interface TazProject {
  id: string;
  name: string;
  subnet_cidr: string;
  vm_count: number;
  created: string;
}

export interface TazCreateSnapshotOpts {
  name: string;
  /** Stop the VM before snapshotting for disk consistency. VM restarts automatically. Default: false. */
  stop_first?: boolean;
}

export interface TazRegisterIngressOpts {
  domain: string;
  /** Port the VM's app listens on. Default: 80. Range: 1–65535. */
  app_port?: number;
}

export interface TazApiClient {
  getCapabilities(): Promise<TazCapabilities>;
  listProjects(): Promise<TazProject[]>;
  createVm(opts: TazCreateVmOpts): Promise<TazVm>;
  getVm(id: string): Promise<TazVm>;
  listVms(): Promise<TazVm[]>;
  deleteVm(id: string): Promise<TazDeleteResult>;
  // Snapshots
  createSnapshot(vmId: string, opts: TazCreateSnapshotOpts): Promise<TazSnapshot>;
  getSnapshot(snapshotId: string): Promise<TazSnapshot>;
  listSnapshots(): Promise<TazSnapshot[]>;
  deleteSnapshot(snapshotId: string): Promise<TazSnapshotDeleteResult>;
  // Ingress
  registerIngress(vmId: string, opts: TazRegisterIngressOpts): Promise<TazIngress>;
  removeIngress(vmId: string): Promise<TazIngressRemoveResult>;
}

export function createTazClient(token: string): TazApiClient {
  return {
    async getCapabilities() {
      const data = await tazFetch(token, "/v1/capabilities");
      return data as unknown as TazCapabilities;
    },

    async listProjects() {
      const data = await tazFetch(token, "/v1/project");
      return ((data?.projects as TazProject[] | undefined) ?? []);
    },

    async createVm(opts) {
      if (opts.image && opts.snapshot_id) {
        throw new Error("createVm: `image` and `snapshot_id` are mutually exclusive");
      }
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.image) body.image = opts.image;
      if (opts.size) body.size = opts.size;
      if (opts.snapshot_id) body.snapshot_id = opts.snapshot_id;

      // Resolve project_id. Caller can pass it explicitly (override the env);
      // otherwise prefer TAZCLOUD_PROJECT_ID, then auto-pick if exactly one
      // project exists on the tenant. Multi-project tenants without an env or
      // explicit value throw with the available IDs so the caller knows what
      // to set.
      let projectId = opts.project_id ?? process.env.TAZCLOUD_PROJECT_ID ?? null;
      if (!projectId) {
        const projects = await this.listProjects();
        if (projects.length === 1) {
          projectId = projects[0].id;
        } else if (projects.length > 1) {
          const list = projects.map((p) => `  ${p.id}  ${p.name}`).join("\n");
          throw new Error(
            `createVm: tenant has multiple Taz projects — pass project_id explicitly or set TAZCLOUD_PROJECT_ID. Available:\n${list}`,
          );
        }
        // projects.length === 0 → omit; legacy tenants without projects-mode still accept.
      }
      if (projectId) body.project_id = projectId;

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

    async createSnapshot(vmId, opts) {
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.stop_first !== undefined) body.stop_first = opts.stop_first;
      const data = await tazFetch(token, `/v1/vm/${vmId}/snapshot`, { method: "POST", body });
      return data as unknown as TazSnapshot;
    },

    async getSnapshot(snapshotId) {
      const data = await tazFetch(token, `/v1/snapshot/${snapshotId}`);
      return data as unknown as TazSnapshot;
    },

    async listSnapshots() {
      const data = await tazFetch(token, "/v1/snapshot");
      return ((data?.snapshots as TazSnapshot[] | undefined) ?? []);
    },

    async deleteSnapshot(snapshotId) {
      const data = await tazFetch(token, `/v1/snapshot/${snapshotId}`, { method: "DELETE" });
      return data as unknown as TazSnapshotDeleteResult;
    },

    async registerIngress(vmId, opts) {
      const body: Record<string, unknown> = { domain: opts.domain };
      if (opts.app_port !== undefined) body.app_port = opts.app_port;
      const data = await tazFetch(token, `/v1/vm/${vmId}/ingress`, { method: "POST", body });
      return data as unknown as TazIngress;
    },

    async removeIngress(vmId) {
      const data = await tazFetch(token, `/v1/vm/${vmId}/ingress`, { method: "DELETE" });
      return data as unknown as TazIngressRemoveResult;
    },
  };
}
