import { describe, it, expect } from "vitest";
import { tazVmSize } from "./taz-vm-size.js";
import { clearTazVmSizeCache, noteTazVmSize, resolveTazVmSizes } from "./taz-vm-sizes.js";

// Shaped like the real objects (docs/API-v2.md), made-up names.
const LIST_ITEM = {
  id: "0b8f-…", name: "demo-web", status: "ACTIVE", ip: "10.128.3.14", project_id: "4a1f-…", ssh_user: "genie",
  ssh_command: "ssh -J almalinux@192.0.2.1 genie@10.128.3.14",
};
const GET_VM = { ...LIST_ITEM, ipv6: null, ssh_host: "10.128.3.14", ssh_port: 22, image: "ubuntu-22", size: "small", networks: { v4: [], v6: [] } };

describe("a Taz VM's size from its API object (T240b)", () => {
  it("the list carries none: no size, no specs, nothing to show", () => {
    expect(tazVmSize(LIST_ITEM)).toEqual({ size: null, specs: null, raw: null });
  });
  it("GET /v1/vm/{id} carries the size's name", () => {
    expect(tazVmSize(GET_VM)).toEqual({ size: "small", specs: null, raw: "small" });
  });
  it("reads an OpenStack flavor, by name or with its numbers (RAM in MB)", () => {
    expect(tazVmSize({ ...LIST_ITEM, flavor: "TAZ-LARGE" })).toMatchObject({ size: "TAZ-LARGE", raw: "TAZ-LARGE" });
    expect(tazVmSize({ ...LIST_ITEM, flavor: { original_name: "xlarge", vcpus: 8, ram: 16384, disk: 160 } }))
      .toEqual({ size: "xlarge", specs: { vcpu: 8, ramGb: 16, diskGb: 160 }, raw: "xlarge" });
  });
  it("takes explicit numbers in their usual spellings, and shows them when there's no name", () => {
    expect(tazVmSize({ ...LIST_ITEM, vcpus: "4", memory_mb: 8192, disk_gb: 80 }))
      .toEqual({ size: null, specs: { vcpu: 4, ramGb: 8, diskGb: 80 }, raw: "4 vCPU / 8 GB / 80 GB" });
    expect(tazVmSize({ ...LIST_ITEM, vcpu: 2, memory_gb: 2, disk: 40 }).specs).toEqual({ vcpu: 2, ramGb: 2, diskGb: 40 });
  });
  it("ignores partial or nonsense numbers", () => {
    expect(tazVmSize({ ...LIST_ITEM, vcpus: 4, disk_gb: 80 }).specs).toBeNull();
    expect(tazVmSize({ ...LIST_ITEM, vcpus: -1, memory_gb: 2, disk_gb: 40 }).specs).toBeNull();
    expect(tazVmSize({ ...LIST_ITEM, size: "  " }).size).toBeNull();
  });
});

describe("the list's sizes, asked of each VM when the list has none (T240b)", () => {
  const vms = [{ ...LIST_ITEM, id: "a" }, { ...LIST_ITEM, id: "b", size: "large" }, { ...LIST_ITEM, id: "c" }];
  it("keeps the list's own size, asks the others once, and keeps the answers", async () => {
    clearTazVmSizeCache();
    const asked: string[] = [];
    const client = { getVm: async (id: string) => { asked.push(id); return id === "a" ? { ...GET_VM, size: "medium" } : { ...LIST_ITEM } } };
    let t = 1_000;
    const first = await resolveTazVmSizes(client, vms, () => t);
    expect(Object.fromEntries([...first].map(([id, s]) => [id, [s.size, s.source]]))).toEqual({ a: ["medium", "vm"], b: ["large", "list"], c: [null, "vm"] });
    // (a VM whose answer has no size says what it has: field names only, T240c)
    expect(first.get("c")?.raw).toBe("no size in GET /v1/vm/{id} (fields: id, name, status, ip, project_id, ssh_user, ssh_command)");
    expect(asked.sort()).toEqual(["a", "c"]);
    t += 60_000;
    await resolveTazVmSizes(client, vms, () => t);
    expect(asked).toHaveLength(2);
    t += 11 * 60_000;
    await resolveTazVmSizes(client, vms, () => t);
    expect(asked).toHaveLength(4);
  });
  it("shrugs off a VM that can't be asked, and takes a resize's size at once", async () => {
    clearTazVmSizeCache();
    const client = { getVm: async () => { throw new Error("timeout"); } };
    expect((await resolveTazVmSizes(client, [{ ...LIST_ITEM, id: "x" }])).get("x")).toEqual({ size: null, specs: null, raw: "lookup failed: timeout", source: "vm" });
    noteTazVmSize("x", "xlarge");
    expect((await resolveTazVmSizes(client, [{ ...LIST_ITEM, id: "x" }])).get("x")).toMatchObject({ size: "xlarge", source: "vm" });
  });
});
