import { describe, it, expect, beforeEach, vi } from "vitest";

// Same mock pattern as admin-tazcloud — stub the action callbacks that
// list:stale / created handlers fire.
vi.mock("../actions/admin", async () => {
  const actual = await vi.importActual<typeof import("../actions/admin")>("../actions/admin");
  return {
    ...actual,
    loadAdminDroplets: vi.fn(),
  };
});

import { handlers } from "./admin";
import { $admin } from "../subjects/admin";
import { loadAdminDroplets } from "../actions/admin";

beforeEach(() => {
  const v = $admin.getValue();
  v.droplets = [];
  v.dropletsLoading = false;
  v.dropletsError = null;
  v.dropletsCreating = false;
  v.dropletsCreateError = null;
  v.dropletStats = {};
  vi.clearAllMocks();
});

describe("admin:droplets:list", () => {
  it("maps DO API rows into the renderer's AdminDroplet shape", () => {
    handlers["admin:droplets:list"]({
      droplets: [
        {
          id: 101,
          name: "web-1",
          status: "active",
          networks: {
            v4: [
              { ip_address: "10.0.0.1", type: "private" },
              { ip_address: "203.0.113.10", type: "public" },
            ],
          },
          region: { slug: "nyc1" },
          size_slug: "s-2vcpu-4gb",
          vcpus: 2,
          memory: 4096,
          disk: 80,
          created_at: "2026-05-01T00:00:00Z",
        },
      ],
      projectMap: {
        101: { projectId: "p-1", projectName: "Terenuri", createdBy: "alice" },
      },
    });

    const d = $admin.getValue().droplets[0];
    expect(d).toMatchObject({
      id: 101,
      name: "web-1",
      status: "active",
      ip: "203.0.113.10",        // picks the public v4
      region: "nyc1",
      size: "s-2vcpu-4gb",
      vcpus: 2,
      memoryMb: 4096,
      diskGb: 80,
      projectId: "p-1",
      projectName: "Terenuri",
      createdBy: "alice",
    });
  });

  it("leaves ip null when no public v4 address is present", () => {
    handlers["admin:droplets:list"]({
      droplets: [{ id: 1, name: "internal", status: "active", networks: { v4: [] } }],
      projectMap: {},
    });
    expect($admin.getValue().droplets[0].ip).toBeNull();
  });

  it("propagates a server error and clears the list", () => {
    $admin.getValue().droplets = [{ id: 1, name: "stale" } as never];
    handlers["admin:droplets:list"]({ error: "DO token invalid" });
    expect($admin.getValue().dropletsError).toBe("DO token invalid");
    expect($admin.getValue().droplets).toEqual([]);
  });
});

describe("admin:droplets:deleted", () => {
  it("removes the matching droplet and its stats entry", () => {
    $admin.getValue().droplets = [
      { id: 1, name: "a" } as never,
      { id: 2, name: "b" } as never,
    ];
    $admin.getValue().dropletStats = { 1: { cpu: 50 } as never, 2: { cpu: 10 } as never };

    handlers["admin:droplets:deleted"]({ dropletId: 1 });

    expect($admin.getValue().droplets.map((d) => d.id)).toEqual([2]);
    expect($admin.getValue().dropletStats).toEqual({ 2: { cpu: 10 } });
  });
});

describe("admin:droplets:stats", () => {
  it("merges new stats into the existing map", () => {
    $admin.getValue().dropletStats = { 1: { cpu: 10 } as never };
    handlers["admin:droplets:stats"]({ stats: { 1: { cpu: 80 }, 2: { cpu: 5 } } });
    expect($admin.getValue().dropletStats).toEqual({ 1: { cpu: 80 }, 2: { cpu: 5 } });
  });

  it("is a no-op when payload.stats is absent", () => {
    $admin.getValue().dropletStats = { 1: { cpu: 10 } as never };
    handlers["admin:droplets:stats"]({});
    expect($admin.getValue().dropletStats).toEqual({ 1: { cpu: 10 } });
  });
});

describe("admin:droplets:created", () => {
  it("clears creating + error flags and re-loads droplets", () => {
    $admin.getValue().dropletsCreating = true;
    $admin.getValue().dropletsCreateError = "prior failure";

    handlers["admin:droplets:created"]({});

    expect($admin.getValue().dropletsCreating).toBe(false);
    expect($admin.getValue().dropletsCreateError).toBeNull();
    expect(loadAdminDroplets).toHaveBeenCalledTimes(1);
  });
});

describe("admin:droplets:create:error", () => {
  it("clears creating and surfaces the message", () => {
    $admin.getValue().dropletsCreating = true;
    handlers["admin:droplets:create:error"]({ message: "no capacity in nyc1" });
    expect($admin.getValue().dropletsCreating).toBe(false);
    expect($admin.getValue().dropletsCreateError).toBe("no capacity in nyc1");
  });

  it("uses a default when no message provided", () => {
    handlers["admin:droplets:create:error"]({});
    expect($admin.getValue().dropletsCreateError).toBe("Unknown error");
  });
});

describe("admin:droplets:renamed", () => {
  it("updates the name in place when the droplet is known", () => {
    $admin.getValue().droplets = [
      { id: 1, name: "old" } as never,
      { id: 2, name: "untouched" } as never,
    ];

    handlers["admin:droplets:renamed"]({ dropletId: 1, name: "renamed" });

    expect($admin.getValue().droplets[0].name).toBe("renamed");
    expect($admin.getValue().droplets[1].name).toBe("untouched");
  });

  it("is a no-op when dropletId is not in the list", () => {
    $admin.getValue().droplets = [{ id: 1, name: "old" } as never];
    handlers["admin:droplets:renamed"]({ dropletId: 999, name: "x" });
    expect($admin.getValue().droplets[0].name).toBe("old");
  });
});

describe("admin:droplets:list:stale", () => {
  it("triggers loadAdminDroplets()", () => {
    handlers["admin:droplets:list:stale"]({});
    expect(loadAdminDroplets).toHaveBeenCalledTimes(1);
  });
});

describe("admin:droplets:locked", () => {
  it("toggles the locked flag in place when the droplet is known", () => {
    $admin.getValue().droplets = [
      { id: 1, name: "a", locked: false } as never,
      { id: 2, name: "b", locked: true } as never,
    ];

    handlers["admin:droplets:locked"]({ dropletId: 1, locked: true });
    expect($admin.getValue().droplets[0].locked).toBe(true);

    handlers["admin:droplets:locked"]({ dropletId: 2, locked: false });
    expect($admin.getValue().droplets[1].locked).toBe(false);
  });

  it("is a no-op when the dropletId is not present", () => {
    $admin.getValue().droplets = [{ id: 1, name: "a", locked: false } as never];
    handlers["admin:droplets:locked"]({ dropletId: 999, locked: true });
    expect($admin.getValue().droplets[0].locked).toBe(false);
  });

  it("list response carries the locked flag through", () => {
    handlers["admin:droplets:list"]({
      droplets: [{ id: 7, name: "L", status: "active", networks: { v4: [] }, locked: true }],
      projectMap: {},
    });
    expect($admin.getValue().droplets[0].locked).toBe(true);
  });
});
