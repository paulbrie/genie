import { describe, it, expect } from "vitest";
import { distribution, formatResource, headroomOf, levelOf, statusGroup, summarize, topGroups, type ResourceVm, type TazCapacity } from "./taz-resources";

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
    expect(s.totals.vcpu).toEqual({ capacity: 250, allocated: 13, free: 237, pct: 5.2, level: "ok" });
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
  it("flags running VMs that use little of what they're given, from their live stats", () => {
    const s = summarize([
      vm("idle", "xlarge", { live: { cpuPercent: 3, memUsedGb: 2, diskUsedGb: 30 } }),
      vm("busy", "large", { live: { cpuPercent: 70, memUsedGb: 6, diskUsedGb: 40 } }),
      vm("stopped", "large", { status: "SHUTOFF", live: { cpuPercent: 0, memUsedGb: 0, diskUsedGb: 10 } }),
      vm("unknown", "large"),
    ], CAPACITY);
    const by = Object.fromEntries(s.rows.map(r => [r.id, r]));
    expect(by.idle.overProvisioned).toBe(true);
    expect(by.idle.use).toEqual({ cpu: 0.03, ram: 0.125, disk: 0.1875 });
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
