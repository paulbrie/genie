/**
 * The Taz Cloud's resources (T240), pure: what the VMs' sizes allocate against the cloud's capacity, how that is
 * distributed (by project, team, Taz project, status), how many more VMs of each size fit, and, where a VM's live
 * stats are known, how much of its allocation it uses. Rendered by /clouds/taz/resources (taz-resources.tsx).
 * Capacity and sizes come from the manager's "tazCapacity" setting (manager/src/vps/taz-capacity.ts).
 */

export interface TazSizeSpec {
  vcpu: number;
  ramGb: number;
  diskGb: number;
  /** a guess, not seen on a fresh VM yet */
  assumed?: boolean;
}

export interface TazCapacity {
  vcpu: number;
  ramGb: number;
  diskGb: number;
  sizes: Record<string, TazSizeSpec>;
  updatedAt?: string;
}

export type ResourceKey = "vcpu" | "ramGb" | "diskGb";
export const RESOURCES: ResourceKey[] = ["vcpu", "ramGb", "diskGb"];
export const RESOURCE_LABEL: Record<ResourceKey, string> = { vcpu: "vCPU", ramGb: "RAM", diskGb: "Disk" };

/** amber from WARN_PCT % allocated, red from CRITICAL_PCT % */
export const WARN_PCT = 80, CRITICAL_PCT = 90;
export type Level = "ok" | "warn" | "critical";
export const levelOf = (pct: number): Level => (pct >= CRITICAL_PCT ? "critical" : pct >= WARN_PCT ? "warn" : "ok");

export type StatusGroup = "running" | "stopped" | "provisioning" | "error" | "other";
export const STATUS_LABEL: Record<StatusGroup, string> = {
  running: "Running", stopped: "Stopped", provisioning: "Provisioning", error: "Error", other: "Other",
};

/** A Taz (OpenStack) VM status as one of a few groups: ACTIVE runs; SHUTOFF/PAUSED/SUSPENDED stop; BUILD,
 *  REBOOT, RESIZE… are on their way; ERROR fails. */
export function statusGroup(status: string | null | undefined): StatusGroup {
  const s = (status ?? "").toUpperCase();
  if (s === "ACTIVE" || s === "RUNNING") return "running";
  if (["SHUTOFF", "STOPPED", "PAUSED", "SUSPENDED", "SHELVED", "SHELVED_OFFLOADED"].includes(s)) return "stopped";
  if (["BUILD", "BUILDING", "REBOOT", "HARD_REBOOT", "RESIZE", "VERIFY_RESIZE", "MIGRATING", "REBUILD", "PENDING", "PROVISIONING"].includes(s)) return "provisioning";
  if (s === "ERROR") return "error";
  return "other";
}

/** What the page knows of a VM (from the admin VM list, its linked project and its live stats). */
export interface ResourceVm {
  id: string;
  name: string;
  status: string;
  size?: string | null;
  projectName?: string | null;
  teamName?: string | null;
  tazProjectName?: string | null;
  /** its resources when Taz gives them as numbers (they win over the size's name) */
  specs?: TazSizeSpec | null;
  /** what Taz said of its size, when it said anything */
  sizeRaw?: string | null;
  /** the size genie recorded when it provisioned the VM (a fallback: a resize since isn't in it) */
  genieSize?: string | null;
  /** live: CPU busy %, RAM and disk in use (GB), when the VM's stats are known */
  live?: { cpuPercent: number; memUsedGb: number; diskUsedGb: number } | null;
}

export interface ResourceRow extends ResourceVm {
  /** its size's resources; null when the size is missing or unknown (then it counts nowhere) */
  spec: TazSizeSpec | null;
  /** the size as shown: a known size's name, or Taz's own value */
  sizeLabel: string | null;
  /** where the size came from: Taz, or genie's record of it */
  sizeFrom: "taz" | "genie" | null;
  /** why it couldn't be sized, when it couldn't */
  unknownWhy: string | null;
  group: StatusGroup;
  /** live use as a share of what it is allocated (0–1+), when known */
  use?: { cpu: number; ram: number; disk: number } | null;
  /** allocated far more than it uses: CPU under 10 % and RAM under 25 % of its allocation */
  overProvisioned: boolean;
}

export interface ResourceTotal {
  capacity: number;
  allocated: number;
  free: number;
  /** allocated / capacity, in % (may pass 100) */
  pct: number;
  level: Level;
}

export interface Headroom {
  size: string;
  spec: TazSizeSpec;
  /** how many more VMs of that size fit in what is free */
  fits: number;
  /** the resource that runs out first */
  limitedBy: ResourceKey;
}

export interface ResourceSummary {
  totals: Record<ResourceKey, ResourceTotal>;
  rows: ResourceRow[];
  /** VMs whose size isn't known: not counted in the totals */
  unsized: ResourceRow[];
  byStatus: Record<StatusGroup, number>;
  headroom: Headroom[];
  /** how many rows have live stats */
  withLive: number;
}

const OVER_CPU = 0.1, OVER_RAM = 0.25;

/** spellings of the sizes seen or likely ("2XL", "xx-large", "X-Large") */
const SIZE_ALIASES: Record<string, string> = {
  "2xl": "2xlarge", "xxl": "2xlarge", "xxlarge": "2xlarge", "2x-large": "2xlarge", "xx-large": "2xlarge",
  "xl": "xlarge", "x-large": "xlarge", "sm": "small", "md": "medium", "med": "medium", "lg": "large",
};

/**
 * A size's name as one of `sizes`' keys, case-insensitively, with a "taz-" / "taz." / "tazcloud-" prefix and the
 * usual spellings tolerated ("TAZ-LARGE" → large, "2XL" → 2xlarge); null when it isn't one of them.
 */
export function normalizeSize(name: string | null | undefined, sizes: Record<string, TazSizeSpec>): string | null {
  if (!name) return null;
  const keys = new Map(Object.keys(sizes).map(k => [k.toLowerCase(), k]));
  const s = name.trim().toLowerCase().replace(/^(tazcloud|taz)[-_. ]+/, "").replace(/[_ ]/g, "-");
  return keys.get(s) ?? keys.get(SIZE_ALIASES[s] ?? "") ?? keys.get(s.replace(/-/g, "")) ?? null;
}

/** what the page reads from a stats sample (the server cards' gauges): CPU %, RAM and disk in use, in GB */
export function liveOf(sample: { cpuPercent: number; memUsedBytes: number; diskUsedBytes: number } | null | undefined) {
  return sample ? { cpuPercent: sample.cpuPercent, memUsedGb: sample.memUsedBytes / 1e9, diskUsedGb: sample.diskUsedBytes / 1e9 } : null;
}
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function summarize(vms: ResourceVm[], capacity: TazCapacity): ResourceSummary {
  const rows: ResourceRow[] = vms.map(vm => {
    const tazName = normalizeSize(vm.size, capacity.sizes), genieName = normalizeSize(vm.genieSize, capacity.sizes);
    const spec = vm.specs ?? (tazName ? capacity.sizes[tazName] : genieName ? capacity.sizes[genieName] : null);
    const sizeFrom = vm.specs || tazName ? "taz" : genieName ? "genie" : null;
    const raw = vm.sizeRaw ?? vm.size ?? null;
    const unknownWhy = spec ? null : raw ? `Taz gave "${raw}", not a known size` : "Taz gives no size for it, and genie has none recorded";
    const use = spec && vm.live
      ? { cpu: vm.live.cpuPercent / 100, ram: vm.live.memUsedGb / spec.ramGb, disk: vm.live.diskUsedGb / spec.diskGb }
      : null;
    return {
      ...vm,
      spec,
      sizeLabel: tazName ?? (vm.specs ? raw : null) ?? genieName ?? raw,
      sizeFrom,
      unknownWhy,
      group: statusGroup(vm.status),
      use,
      overProvisioned: !!use && statusGroup(vm.status) === "running" && use.cpu < OVER_CPU && use.ram < OVER_RAM,
    };
  });
  const allocated: Record<ResourceKey, number> = { vcpu: 0, ramGb: 0, diskGb: 0 };
  for (const r of rows) if (r.spec) for (const k of RESOURCES) allocated[k] += r.spec[k];
  const totals = Object.fromEntries(
    RESOURCES.map(k => {
      const cap = capacity[k], pct = cap > 0 ? (allocated[k] / cap) * 100 : 0;
      return [k, { capacity: cap, allocated: round(allocated[k], 2), free: round(Math.max(0, cap - allocated[k]), 2), pct: round(pct), level: levelOf(pct) }];
    })
  ) as Record<ResourceKey, ResourceTotal>;
  const byStatus: Record<StatusGroup, number> = { running: 0, stopped: 0, provisioning: 0, error: 0, other: 0 };
  for (const r of rows) byStatus[r.group]++;
  return {
    totals,
    rows,
    unsized: rows.filter(r => !r.spec),
    byStatus,
    headroom: headroomOf(totals, capacity.sizes),
    withLive: rows.filter(r => r.live).length,
  };
}

/** For each size, how many more fit in what is free, and what runs out first; sizes from the smallest. */
export function headroomOf(totals: Record<ResourceKey, ResourceTotal>, sizes: Record<string, TazSizeSpec>): Headroom[] {
  return Object.entries(sizes)
    .map(([size, spec]) => {
      let fits = Infinity, limitedBy: ResourceKey = "vcpu";
      for (const k of RESOURCES) {
        const n = spec[k] > 0 ? Math.floor(totals[k].free / spec[k]) : Infinity;
        if (n < fits) { fits = n; limitedBy = k; }
      }
      return { size, spec, fits: Number.isFinite(fits) ? Math.max(0, fits) : 0, limitedBy };
    })
    .sort((a, b) => a.spec.vcpu - b.spec.vcpu || a.spec.ramGb - b.spec.ramGb);
}

export type GroupBy = "project" | "team" | "tazProject" | "status";
export const GROUP_BY_LABEL: Record<GroupBy, string> = { project: "Project", team: "Team", tazProject: "Taz project", status: "Status" };

export interface DistributionGroup {
  key: string;
  label: string;
  vms: number;
  vcpu: number;
  ramGb: number;
  diskGb: number;
}

/** what each group (a project, a team, a Taz project, a status) is allocated, biggest first (by vCPU, then RAM) */
export function distribution(rows: ResourceRow[], by: GroupBy): DistributionGroup[] {
  const groups = new Map<string, DistributionGroup>();
  for (const r of rows) {
    if (!r.spec) continue;
    const [key, label] =
      by === "status" ? [r.group, STATUS_LABEL[r.group]]
      : by === "project" ? [r.projectName ?? "", r.projectName ?? "Not in a project"]
      : by === "team" ? [r.teamName ?? "", r.teamName ?? "No team"]
      : [r.tazProjectName ?? "", r.tazProjectName ?? "No Taz project"];
    const g = groups.get(key) ?? { key, label, vms: 0, vcpu: 0, ramGb: 0, diskGb: 0 };
    g.vms++;
    for (const k of RESOURCES) g[k] += r.spec[k];
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.vcpu - a.vcpu || b.ramGb - a.ramGb || a.label.localeCompare(b.label));
}

/** at most `max` groups, the rest summed into one "Other" (for a readable chart) */
export function topGroups(groups: DistributionGroup[], max: number): DistributionGroup[] {
  if (groups.length <= max) return groups;
  const rest = groups.slice(max - 1).reduce(
    (o, g) => ({ ...o, vms: o.vms + g.vms, vcpu: o.vcpu + g.vcpu, ramGb: o.ramGb + g.ramGb, diskGb: o.diskGb + g.diskGb }),
    { key: "__other", label: `${groups.length - max + 1} others`, vms: 0, vcpu: 0, ramGb: 0, diskGb: 0 }
  );
  return [...groups.slice(0, max - 1), rest];
}

/** "2 TB", "500 GB", "250 vCPU" */
export function formatResource(k: ResourceKey, n: number): string {
  if (k === "vcpu") return `${round(n, 1)} vCPU`;
  return n >= 1000 ? `${round(n / 1000, 2)} TB` : `${round(n, 1)} GB`;
}

/** the parts of genie's state the page reads (shapes as in the store: AdminTazVm, ProjectDef, monitor history) */
export interface ResourceSources {
  vms: { id: string; name: string; status: string; size?: string; sizeSpecs?: TazSizeSpec | null; sizeRaw?: string | null; tazProjectId: string | null; projectId: string | null; projectName: string | null }[];
  projects: { id: string; teamName?: string | null; vpsInstances: { id: string; tazcloud?: { vmId: string; size?: string } }[] }[];
  tazProjects: { id: string; name: string }[];
  /** the server cards' history: "<projectId>:<instanceId>" → samples, oldest first */
  history?: Record<string, { cpuPercent: number; memUsedBytes: number; diskUsedBytes: number }[]>;
  /** the SSH probe's stats by VM id (often empty: the probe is off where the VMs post their own stats) */
  vmStats?: Record<string, { cpuPercent: number; memUsedBytes: number; diskUsedBytes: number }>;
}

/**
 * The page's VMs from genie's state (T240b): each Taz VM with its project's team, its Taz project's name, the size
 * genie recorded for it (the linked project instance's), and its live use as the server cards show it (the linked
 * instance's latest sample, else the SSH probe's). A VM is linked to an instance by `tazcloud.vmId`.
 */
export function resourceVmsOf(src: ResourceSources): ResourceVm[] {
  const link = new Map<string, { projectId: string; instanceId: string; size: string | null }>();
  for (const p of src.projects) for (const i of p.vpsInstances) if (i.tazcloud?.vmId) link.set(i.tazcloud.vmId, { projectId: p.id, instanceId: i.id, size: i.tazcloud.size ?? null });
  const teamOf = new Map(src.projects.map(p => [p.id, p.teamName ?? null]));
  const tazName = new Map(src.tazProjects.map(p => [p.id, p.name]));
  return src.vms.map(vm => {
    const l = link.get(vm.id);
    const samples = l ? src.history?.[`${l.projectId}:${l.instanceId}`] : undefined;
    return {
      id: vm.id,
      name: vm.name,
      status: vm.status,
      size: vm.size ?? null,
      specs: vm.sizeSpecs ?? null,
      sizeRaw: vm.sizeRaw ?? null,
      genieSize: l?.size ?? null,
      projectName: vm.projectName,
      teamName: vm.projectId ? teamOf.get(vm.projectId) ?? null : null,
      tazProjectName: vm.tazProjectId ? tazName.get(vm.tazProjectId) ?? null : null,
      live: liveOf(samples?.length ? samples[samples.length - 1] : null) ?? liveOf(src.vmStats?.[vm.id]),
    };
  });
}
