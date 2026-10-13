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
  /** live, as measured on the VM (its stats): CPU busy % (of all its cores), RAM and disk used and in total (GB),
   *  and their use in % of its own totals */
  live?: LiveUse | null;
}

export interface LiveUse {
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  memUsedGb: number;
  diskUsedGb: number;
  /** the VM's own RAM and disk as it reports them (GiB); null when the sample doesn't carry them */
  memTotalGb: number | null;
  diskTotalGb: number | null;
}

export interface ResourceRow extends ResourceVm {
  /** its resources; null when they can't be known (then it counts nowhere) */
  spec: TazSizeSpec | null;
  /** the size as shown: a known size's name, or Taz's own value */
  sizeLabel: string | null;
  /** where its resources came from: Taz (its size or numbers), or measured on the VM (RAM and disk; vCPU inferred
   *  from the RAM, since nothing measures cores) */
  sizeFrom: "taz" | "measured" | null;
  /** its vCPU is a guess from its RAM, not a fact */
  vcpuInferred: boolean;
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
  /** how much of `allocated` is inferred rather than known (vCPU from RAM) */
  inferred: number;
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

const GIB = 1024 ** 3;

/** a stats sample as the server cards get it (vps_metric_samples), or the SSH probe's: the totals may be missing */
export interface StatsSample {
  sampledAt?: string;
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  memUsedBytes: number;
  diskUsedBytes: number;
  memTotalBytes?: number | null;
  diskTotalBytes?: number | null;
}

/** total = used / percent, for a sample from before the totals were sent */
const totalOf = (total: number | null | undefined, used: number, pct: number) => (total && total > 0 ? total : pct > 0 ? (used * 100) / pct : null);

/** what the page reads from a stats sample: the VM's own use, in % of its own totals, and those totals (T240c) */
export function liveOf(sample: StatsSample | null | undefined): LiveUse | null {
  if (!sample) return null;
  const mem = totalOf(sample.memTotalBytes, sample.memUsedBytes, sample.memPercent), disk = totalOf(sample.diskTotalBytes, sample.diskUsedBytes, sample.diskPercent);
  return {
    cpuPercent: sample.cpuPercent,
    memPercent: sample.memPercent,
    diskPercent: sample.diskPercent,
    memUsedGb: sample.memUsedBytes / GIB,
    diskUsedGb: sample.diskUsedBytes / GIB,
    memTotalGb: mem ? mem / GIB : null,
    diskTotalGb: disk ? disk / GIB : null,
  };
}

/**
 * The size whose RAM a VM's measured RAM is (a VM reports a little less than its size, about 93–98 %: the kernel
 * keeps some), within 85–110 % of the size's; each size has its own RAM, so this tells its vCPU, a guess (a custom
 * size wouldn't match, and stays unknown).
 */
export function sizeFromRam(memTotalGb: number | null | undefined, sizes: Record<string, TazSizeSpec>): string | null {
  if (!memTotalGb || memTotalGb <= 0) return null;
  let best: string | null = null, bestGap = Infinity;
  for (const [name, spec] of Object.entries(sizes)) {
    const ratio = memTotalGb / spec.ramGb;
    if (ratio >= 0.85 && ratio <= 1.1 && Math.abs(1 - ratio) < bestGap) { best = name; bestGap = Math.abs(1 - ratio); }
  }
  return best;
}
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function summarize(vms: ResourceVm[], capacity: TazCapacity): ResourceSummary {
  const rows: ResourceRow[] = vms.map(vm => {
    // (its resources: Taz's own numbers or size if Taz gives them; else what the VM itself measures, its vCPU
    // inferred from its RAM; genie's record of the size is never counted: it is written once, as a default)
    const tazName = normalizeSize(vm.size, capacity.sizes);
    const ramName = sizeFromRam(vm.live?.memTotalGb, capacity.sizes);
    let spec: TazSizeSpec | null = null, sizeFrom: ResourceRow["sizeFrom"] = null, vcpuInferred = false;
    if (vm.specs) { spec = vm.specs; sizeFrom = "taz"; }
    else if (tazName) { spec = capacity.sizes[tazName]; sizeFrom = "taz"; }
    else if (ramName && vm.live?.memTotalGb) {
      const s = capacity.sizes[ramName];
      spec = { vcpu: s.vcpu, ramGb: s.ramGb, diskGb: vm.live.diskTotalGb ? Math.round(vm.live.diskTotalGb) : s.diskGb };
      sizeFrom = "measured";
      vcpuInferred = true;
    }
    const raw = vm.sizeRaw ?? vm.size ?? null;
    const genieNote = vm.genieSize ? `; genie's record says ${vm.genieSize}, a value written once, not counted` : "";
    const unknownWhy = spec ? null
      : vm.live?.memTotalGb ? `it reports ${round(vm.live.memTotalGb)} GB RAM, no size's${raw ? `; Taz: ${raw}` : ""}${genieNote}`
      : raw ? `Taz: ${raw}; no stats from the VM${genieNote}`
      : `no size from Taz and no stats from the VM${genieNote}`;
    // (its live use, in % of what it has, as it measures it)
    const use = vm.live ? { cpu: vm.live.cpuPercent / 100, ram: vm.live.memPercent / 100, disk: vm.live.diskPercent / 100 } : null;
    return {
      ...vm,
      spec,
      sizeLabel: tazName ?? (vm.specs ? raw : null) ?? ramName ?? raw,
      sizeFrom,
      vcpuInferred,
      unknownWhy,
      group: statusGroup(vm.status),
      use,
      overProvisioned: !!use && statusGroup(vm.status) === "running" && use.cpu < OVER_CPU && use.ram < OVER_RAM,
    };
  });
  const allocated: Record<ResourceKey, number> = { vcpu: 0, ramGb: 0, diskGb: 0 };
  const inferred: Record<ResourceKey, number> = { vcpu: 0, ramGb: 0, diskGb: 0 };
  for (const r of rows) if (r.spec) for (const k of RESOURCES) allocated[k] += r.spec[k];
  for (const r of rows) if (r.spec && r.vcpuInferred) inferred.vcpu += r.spec.vcpu;
  const totals = Object.fromEntries(
    RESOURCES.map(k => {
      const cap = capacity[k], pct = cap > 0 ? (allocated[k] / cap) * 100 : 0;
      return [k, { capacity: cap, allocated: round(allocated[k], 2), inferred: round(inferred[k], 2), free: round(Math.max(0, cap - allocated[k]), 2), pct: round(pct), level: levelOf(pct) }];
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
  history?: Record<string, StatsSample[]>;
  /** the SSH probe's stats by VM id (often empty: the probe is off where the VMs post their own stats) */
  vmStats?: Record<string, StatsSample>;
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
