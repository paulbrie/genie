import { describe, it, expect, beforeEach, vi } from "vitest";

// Block out the actions that handlers call back into — these would
// otherwise try to wsSend and reset state on us.
vi.mock("../actions/admin", async () => {
  const actual = await vi.importActual<typeof import("../actions/admin")>("../actions/admin");
  return {
    ...actual,
    loadAdminTazVms: vi.fn(),
    loadAdminTazcloudStats: vi.fn(),
    loadAdminDroplets: vi.fn(),
  };
});

import { handlers } from "./admin";
import { $admin } from "../subjects/admin";
import { loadAdminTazVms } from "../actions/admin";

// Reset the tazcloud slice between tests. Don't mutate $admin to a fresh
// object — other slices have invariants the rest of the app depends on.
beforeEach(() => {
  const t = $admin.getValue().tazcloud;
  t.vms = [];
  t.loading = false;
  t.error = null;
  t.creating = false;
  t.createError = null;
  t.vmStats = {};
  t.vmStatsLoading = false;
  vi.clearAllMocks();
});

describe("admin:tazcloud:stats", () => {
  it("merges new VM stats over existing ones (per-vmId)", () => {
    $admin.getValue().tazcloud.vmStats = {
      "vm-1": { cpuPct: 12 },
      "vm-2": { cpuPct: 30 },
    };
    $admin.getValue().tazcloud.vmStatsLoading = true;

    handlers["admin:tazcloud:stats"]({
      stats: {
        "vm-2": { cpuPct: 88 },        // overwrite
        "vm-3": { cpuPct: 5 },         // new
      },
    });

    const t = $admin.getValue().tazcloud;
    expect(t.vmStats).toEqual({
      "vm-1": { cpuPct: 12 },          // preserved
      "vm-2": { cpuPct: 88 },          // updated
      "vm-3": { cpuPct: 5 },           // added
    });
    expect(t.vmStatsLoading).toBe(false);
  });

  it("clears vmStatsLoading even when no stats are returned", () => {
    $admin.getValue().tazcloud.vmStatsLoading = true;
    handlers["admin:tazcloud:stats"]({});
    expect($admin.getValue().tazcloud.vmStatsLoading).toBe(false);
  });
});

describe("admin:tazcloud:created", () => {
  it("clears creating flag and re-loads VMs", () => {
    $admin.getValue().tazcloud.creating = true;
    $admin.getValue().tazcloud.createError = "prior fail";

    handlers["admin:tazcloud:created"]({});

    const t = $admin.getValue().tazcloud;
    expect(t.creating).toBe(false);
    expect(t.createError).toBeNull();
    expect(loadAdminTazVms).toHaveBeenCalledTimes(1);
  });
});

describe("admin:tazcloud:create:error", () => {
  it("clears creating flag and surfaces the error message", () => {
    $admin.getValue().tazcloud.creating = true;

    handlers["admin:tazcloud:create:error"]({ message: "quota exceeded" });

    const t = $admin.getValue().tazcloud;
    expect(t.creating).toBe(false);
    expect(t.createError).toBe("quota exceeded");
  });

  it("falls back to a default message when none is provided", () => {
    handlers["admin:tazcloud:create:error"]({});
    expect($admin.getValue().tazcloud.createError).toBe("Unknown error");
  });
});

describe("admin:tazcloud:renamed", () => {
  it("updates the in-place name of a known VM", () => {
    $admin.getValue().tazcloud.vms = [
      { id: "vm-1", name: "old-name", ipv6: "::1", status: "ACTIVE" },
      { id: "vm-2", name: "other", ipv6: "::2", status: "ACTIVE" },
    ] as never;

    handlers["admin:tazcloud:renamed"]({ vmId: "vm-1", name: "shiny-new" });

    const vms = $admin.getValue().tazcloud.vms;
    expect(vms[0].name).toBe("shiny-new");
    expect(vms[1].name).toBe("other");
  });

  it("is a no-op when the vmId is unknown", () => {
    $admin.getValue().tazcloud.vms = [
      { id: "vm-1", name: "old-name", ipv6: "::1", status: "ACTIVE" },
    ] as never;

    handlers["admin:tazcloud:renamed"]({ vmId: "does-not-exist", name: "x" });

    expect($admin.getValue().tazcloud.vms[0].name).toBe("old-name");
  });
});

describe("admin:tazcloud:list:stale", () => {
  it("triggers a VM reload", () => {
    handlers["admin:tazcloud:list:stale"]({});
    expect(loadAdminTazVms).toHaveBeenCalledTimes(1);
  });
});

describe("admin:tazcloud:locked", () => {
  it("toggles the locked flag in place when the VM is known", () => {
    $admin.getValue().tazcloud.vms = [
      { id: "vm-1", name: "a", locked: false } as never,
      { id: "vm-2", name: "b", locked: true } as never,
    ];

    handlers["admin:tazcloud:locked"]({ vmId: "vm-1", locked: true });
    expect($admin.getValue().tazcloud.vms[0].locked).toBe(true);

    handlers["admin:tazcloud:locked"]({ vmId: "vm-2", locked: false });
    expect($admin.getValue().tazcloud.vms[1].locked).toBe(false);
  });

  it("is a no-op when the vmId is not present", () => {
    $admin.getValue().tazcloud.vms = [{ id: "vm-1", name: "a", locked: false } as never];
    handlers["admin:tazcloud:locked"]({ vmId: "does-not-exist", locked: true });
    expect($admin.getValue().tazcloud.vms[0].locked).toBe(false);
  });
});
