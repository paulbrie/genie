import { describe, it, expect } from "vitest";
import { distribution, formatResource, headroomOf, levelOf, liveOf, normalizeSize, resourceVmsOf, sizeFromRam, statusGroup, summarize, topGroups, type ResourceSources, type ResourceVm, type TazCapacity } from "./taz-resources";

const CAPACITY: TazCapacity = {
  vcpu: 250, ramGb: 500, diskGb: 2000,
  sizes: {
    small: { vcpu: 1, ramGb: 1, diskGb: 20 },
    medium: { vcpu: 2, ramGb: 2, diskGb: 40 },
    large: { vcpu: 4, ramGb: 8, diskGb: 80 },
    xlarge: { vcpu: 8, ramGb: 16, diskGb: 160 },
    "2xlarge": { vcpu: 16, ramGb: 32, diskGb: 160, assumed: true },
  },
};
const vm = (id: string, size: string | null, extra: Partial<ResourceVm> = {}): ResourceVm => ({ id, name: id, status: "ACTIVE", size, ...extra });

describe("Taz Cloud resources (T240)", () => {
  it("sums what the VMs' sizes allocate, against capacity, with the free part and the level", () => {
    const s = summarize([vm("a", "large"), vm("b", "xlarge"), vm("c", "small", { status: "SHUTOFF" })], CAPACITY);
    expect(s.totals.vcpu).toEqual({ capacity: 250, allocated: 13, inferred: 0, free: 237, pct: 5.2, level: "ok" });
    expect(s.totals.ramGb.allocated).toBe(25);
    expect(s.totals.diskGb.allocated).toBe(260);
    expect(s.byStatus).toEqual({ running: 2, stopped: 1, provisioning: 0, error: 0, other: 0 });
  });
  it("warns from 80 % and is critical from 90 %, and never shows negative free", () => {
    expect([levelOf(79.9), levelOf(80), levelOf(89.9), levelOf(90), levelOf(130)]).toEqual(["ok", "warn", "warn", "critical", "critical"]);
    const full = summarize(Array.from({ length: 17 }, (_, i) => vm(`x${i}`, "2xlarge")), CAPACITY);
    expect(full.totals.vcpu.pct).toBe(108.8);
    expect(full.totals.vcpu.free).toBe(0);
    expect(full.totals.vcpu.level).toBe("critical");
  });
  it("leaves out (and lists) VMs whose size is missing or unknown", () => {
    const s = summarize([vm("a", "large"), vm("b", null), vm("c", "huge")], CAPACITY);
    expect(s.totals.vcpu.allocated).toBe(4);
    expect(s.unsized.map(r => r.id)).toEqual(["b", "c"]);
  });
  it("says how many more of each size fit, and what runs out first", () => {
    // 20 large VMs take 80 vCPU, 160 GB RAM and 1600 GB disk: 170 vCPU, 340 GB and 400 GB are free, so disk runs out first
    const s = summarize(Array.from({ length: 20 }, (_, i) => vm(`l${i}`, "large")), CAPACITY);
    const h = Object.fromEntries(s.headroom.map(x => [x.size, x]));
    expect(h.small).toMatchObject({ fits: 20, limitedBy: "diskGb" });
    expect(h.large).toMatchObject({ fits: 5, limitedBy: "diskGb" });
    expect(h["2xlarge"]).toMatchObject({ fits: 2, limitedBy: "diskGb" });
    expect(s.headroom.map(x => x.size)).toEqual(["small", "medium", "large", "xlarge", "2xlarge"]);
    expect(headroomOf(s.totals, { odd: { vcpu: 1000, ramGb: 1, diskGb: 1 } })[0]).toMatchObject({ fits: 0, limitedBy: "vcpu" });
  });
  it("groups the allocation by project, team, Taz project or status, biggest first", () => {
    const rows = summarize([
      vm("a", "xlarge", { projectName: "Fluentech", teamName: "TeleportHQ", tazProjectName: "ft" }),
      vm("b", "small", { projectName: "Fluentech", teamName: "TeleportHQ", tazProjectName: "ft" }),
      vm("c", "large", { projectName: null, teamName: null, tazProjectName: "lab", status: "SHUTOFF" }),
      vm("d", null, { projectName: "Ghost" }),
    ], CAPACITY).rows;
    expect(distribution(rows, "project")).toEqual([
      { key: "Fluentech", label: "Fluentech", vms: 2, vcpu: 9, ramGb: 17, diskGb: 180 },
      { key: "", label: "Not in a project", vms: 1, vcpu: 4, ramGb: 8, diskGb: 80 },
    ]);
    expect(distribution(rows, "status").map(g => [g.label, g.vcpu])).toEqual([["Running", 9], ["Stopped", 4]]);
    expect(distribution(rows, "tazProject").map(g => g.label)).toEqual(["ft", "lab"]);
    const many = Array.from({ length: 8 }, (_, i) => ({ key: `${i}`, label: `p${i}`, vms: 1, vcpu: 8 - i, ramGb: 1, diskGb: 1 }));
    const top = topGroups(many, 5);
    expect(top).toHaveLength(5);
    expect(top[4]).toMatchObject({ label: "4 others", vcpu: 4 + 3 + 2 + 1, vms: 4 });
  });
  it("flags running VMs that use little of what they have, from what they measure", () => {
    const live = (cpuPercent: number, memPercent: number, diskPercent: number) => ({ cpuPercent, memPercent, diskPercent, memUsedGb: 0, diskUsedGb: 0, memTotalGb: null, diskTotalGb: null });
    const s = summarize([
      vm("idle", "xlarge", { live: live(3, 12, 20) }),
      vm("busy", "large", { live: live(70, 75, 50) }),
      vm("stopped", "large", { status: "SHUTOFF", live: live(0, 0, 12) }),
      vm("unknown", "large"),
    ], CAPACITY);
    const by = Object.fromEntries(s.rows.map(r => [r.id, r]));
    expect(by.idle.overProvisioned).toBe(true);
    expect(by.idle.use).toEqual({ cpu: 0.03, ram: 0.12, disk: 0.2 });
    expect(by.busy.overProvisioned).toBe(false);
    expect(by.stopped.overProvisioned).toBe(false);
    expect(by.unknown.use).toBeNull();
    expect(s.withLive).toBe(3);
  });
  it("reads Taz statuses and formats amounts", () => {
    expect(["ACTIVE", "SHUTOFF", "BUILD", "VERIFY_RESIZE", "ERROR", "weird"].map(statusGroup)).toEqual(["running", "stopped", "provisioning", "provisioning", "error", "other"]);
    expect([formatResource("vcpu", 250), formatResource("ramGb", 500), formatResource("diskGb", 2000), formatResource("diskGb", 1640)]).toEqual(["250 vCPU", "500 GB", "2 TB", "1.64 TB"]);
  });
});

// Shaped like genie's state on live data (T240c), made-up names: the Taz list and the VM give no size (the manager
// says why); genie's project instances all record "small" (a default written once); the server cards' samples carry
// the VMs' own totals. A 16-core VM reports ~31 GiB of RAM; a small one ~0.95 GiB.
const GIB = 1024 ** 3;
const sample = (cpuPercent: number, memUsedGiB: number, memTotalGiB: number, diskUsedGiB: number, diskTotalGiB: number) => ({
  sampledAt: "2026-10-13T10:00:00Z", cpuPercent,
  memUsedBytes: memUsedGiB * GIB, memTotalBytes: memTotalGiB * GIB, memPercent: Math.round((memUsedGiB / memTotalGiB) * 100),
  diskUsedBytes: diskUsedGiB * GIB, diskTotalBytes: diskTotalGiB * GIB, diskPercent: Math.round((diskUsedGiB / diskTotalGiB) * 100),
});
const NO_SIZE = "no size in GET /v1/vm/{id} (fields: id, name, status, ip, project_id, ssh_user, ssh_command)";
const SOURCES: ResourceSources = {
  vms: [
    { id: "vm-big", name: "acme-ml", status: "ACTIVE", size: undefined, sizeSpecs: null, sizeRaw: NO_SIZE, tazProjectId: "tp1", projectId: "p1", projectName: "Acme" },
    { id: "vm-small", name: "acme-web", status: "ACTIVE", size: undefined, sizeSpecs: null, sizeRaw: NO_SIZE, tazProjectId: "tp1", projectId: "p1", projectName: "Acme" },
    { id: "vm-old", name: "acme-db", status: "ACTIVE", size: undefined, sizeSpecs: null, sizeRaw: NO_SIZE, tazProjectId: "tp1", projectId: "p1", projectName: "Acme" },
    { id: "vm-custom", name: "lab-odd", status: "ACTIVE", size: undefined, sizeSpecs: null, sizeRaw: NO_SIZE, tazProjectId: "tp2", projectId: "p2", projectName: "Lab" },
    { id: "vm-nostats", name: "lab-quiet", status: "SHUTOFF", size: undefined, sizeSpecs: null, sizeRaw: "lookup failed: timeout", tazProjectId: "tp2", projectId: "p2", projectName: "Lab" },
    { id: "vm-taz", name: "sized", status: "ACTIVE", size: "Large", sizeSpecs: null, sizeRaw: "Large", tazProjectId: null, projectId: null, projectName: null },
  ],
  projects: [
    { id: "p1", teamName: "Platform", vpsInstances: [
      { id: "i1", tazcloud: { vmId: "vm-big", size: "small" } }, { id: "i2", tazcloud: { vmId: "vm-small", size: "small" } }, { id: "i3", tazcloud: { vmId: "vm-old", size: "small" } },
    ] },
    { id: "p2", teamName: null, vpsInstances: [{ id: "i4", tazcloud: { vmId: "vm-custom", size: "small" } }, { id: "i5", tazcloud: { vmId: "vm-nostats", size: "small" } }] },
  ],
  tazProjects: [{ id: "tp1", name: "prod" }, { id: "tp2", name: "lab" }],
  history: {
    "p1:i1": [sample(80, 10, 31.2, 60, 155), sample(62, 11, 31.2, 61, 155)],
    "p1:i2": [sample(4, 0.2, 0.95, 6, 19.5)],
    // (an old sample: no totals, only used + percent)
    "p1:i3": [{ sampledAt: "2026-10-13T10:00:00Z", cpuPercent: 30, memUsedBytes: 4 * GIB, memPercent: 50, diskUsedBytes: 40 * GIB, diskPercent: 50 }],
    "p2:i4": [sample(20, 5, 12, 30, 100)],
  },
  vmStats: {},
};

describe("live data (T240c): resources as the VMs measure them, never genie's default", () => {
  it("reads a sample's live use in % of the VM's own totals, and the totals (or works them out from an old sample)", () => {
    expect(liveOf(sample(62, 11, 31.2, 61, 155))).toMatchObject({ cpuPercent: 62, memPercent: 35, diskPercent: 39, memTotalGb: 31.2, diskTotalGb: 155 });
    const old = liveOf({ cpuPercent: 30, memUsedBytes: 4 * GIB, memPercent: 50, diskUsedBytes: 40 * GIB, diskPercent: 50 });
    expect([old?.memTotalGb, old?.diskTotalGb]).toEqual([8, 80]);
    expect(liveOf(null)).toBeNull();
  });
  it("tells a size from the RAM a VM reports (a little under the size's), and nothing for a RAM no size has", () => {
    expect([31.2, 15.6, 7.7, 1.9, 0.95].map(g => sizeFromRam(g, CAPACITY.sizes))).toEqual(["2xlarge", "xlarge", "large", "medium", "small"]);
    expect([12, 64, 0.5, null].map(g => sizeFromRam(g, CAPACITY.sizes))).toEqual([null, null, null, null]);
  });
  it("sizes each VM by Taz if it can, else by what it measures (vCPU inferred, marked), and never by genie's record", () => {
    const s = summarize(resourceVmsOf(SOURCES), CAPACITY);
    const by = Object.fromEntries(s.rows.map(r => [r.id, r]));
    expect([by["vm-big"].sizeFrom, by["vm-big"].sizeLabel, by["vm-big"].vcpuInferred, by["vm-big"].spec]).toEqual(["measured", "2xlarge", true, { vcpu: 16, ramGb: 32, diskGb: 155 }]);
    expect([by["vm-small"].sizeLabel, by["vm-small"].spec]).toEqual(["small", { vcpu: 1, ramGb: 1, diskGb: 20 }]);
    expect([by["vm-old"].sizeLabel, by["vm-old"].spec?.vcpu]).toEqual(["large", 4]);
    expect([by["vm-taz"].sizeFrom, by["vm-taz"].sizeLabel, by["vm-taz"].vcpuInferred, by["vm-taz"].spec?.vcpu]).toEqual(["taz", "large", false, 4]);
    expect(by["vm-custom"].spec).toBeNull();
    expect(by["vm-custom"].unknownWhy).toContain("it reports 12 GB RAM, no size's");
    expect(by["vm-custom"].unknownWhy).toContain("genie's record says small, a value written once, not counted");
    expect(by["vm-nostats"].unknownWhy).toBe("Taz: lookup failed: timeout; no stats from the VM; genie's record says small, a value written once, not counted");
    // 16 + 1 + 4 measured (inferred) + 4 from Taz = 25 vCPU, 21 of them inferred
    expect([s.totals.vcpu.allocated, s.totals.vcpu.inferred]).toEqual([25, 21]);
    expect(s.totals.ramGb.allocated).toBe(32 + 1 + 8 + 8);
  });
  it("shows live use as the VM measures it: never over 100 % of what it has", () => {
    const s = summarize(resourceVmsOf(SOURCES), CAPACITY);
    const big = s.rows.find(r => r.id === "vm-big")!;
    expect(big.use).toEqual({ cpu: 0.62, ram: 0.35, disk: 0.39 });
    expect(s.rows.every(r => !r.use || (r.use.ram <= 1 && r.use.disk <= 1))).toBe(true);
  });
});
