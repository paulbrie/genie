import { describe, it, expect } from "vitest";
import { DEFAULT_TAZ_CAPACITY, parseTazCapacity } from "./taz-capacity.js";

describe("Taz Cloud capacity (T240)", () => {
  it("defaults to today's cloud: 250 vCPU, 500 GB RAM, 2 TB SSD, and the documented sizes", () => {
    expect([DEFAULT_TAZ_CAPACITY.vcpu, DEFAULT_TAZ_CAPACITY.ramGb, DEFAULT_TAZ_CAPACITY.diskGb]).toEqual([250, 500, 2000]);
    expect(DEFAULT_TAZ_CAPACITY.sizes.large).toEqual({ vcpu: 4, ramGb: 8, diskGb: 80 });
    expect(DEFAULT_TAZ_CAPACITY.sizes["2xlarge"].assumed).toBe(true);
  });
  it("takes new totals (numbers or numeric strings) and keeps the default sizes", () => {
    const c = parseTazCapacity({ vcpu: "320", ramGb: 640, diskGb: 4000 });
    expect([c.vcpu, c.ramGb, c.diskGb]).toEqual([320, 640, 4000]);
    expect(c.sizes).toEqual(DEFAULT_TAZ_CAPACITY.sizes);
  });
  it("lets a size be changed or added over the defaults", () => {
    const c = parseTazCapacity({ vcpu: 250, ramGb: 500, diskGb: 2000, sizes: { "2xlarge": { vcpu: 16, ramGb: 32, diskGb: 320 }, "4xlarge": { vcpu: 32, ramGb: 64, diskGb: 640 } } });
    expect(c.sizes["2xlarge"]).toEqual({ vcpu: 16, ramGb: 32, diskGb: 320 });
    expect(c.sizes["4xlarge"].vcpu).toBe(32);
    expect(c.sizes.small.vcpu).toBe(1);
  });
  it("refuses missing, zero, negative, huge or non-numeric totals, and bad size names", () => {
    for (const bad of [null, "x", {}, { vcpu: 0, ramGb: 500, diskGb: 2000 }, { vcpu: -1, ramGb: 500, diskGb: 2000 },
      { vcpu: 1e9, ramGb: 500, diskGb: 2000 }, { vcpu: "lots", ramGb: 500, diskGb: 2000 },
      { vcpu: 250, ramGb: 500, diskGb: 2000, sizes: { "bad name!": { vcpu: 1, ramGb: 1, diskGb: 1 } } },
      { vcpu: 250, ramGb: 500, diskGb: 2000, sizes: { small: { vcpu: 1, ramGb: 0, diskGb: 20 } } }])
      expect(() => parseTazCapacity(bad)).toThrow();
  });
});
