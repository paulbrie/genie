// Remaining admin handlers: baseimage build streaming, sshkey, ai costs +
// settings, prodlogs, tazcloud list/deleted (which weren't covered by the
// tazcloud test).

import { describe, it, expect, beforeEach } from "vitest";
import { handlers } from "./admin";
import { $admin } from "../subjects/admin";

beforeEach(() => {
  const v = $admin.getValue();
  v.baseImage = { configs: {}, templates: {}, deletedTemplates: {}, buildingName: null, progress: [], error: null, failedDropletId: null, failedDropletIp: null, history: [] };
  v.sshKey = { exists: false, publicKey: null, fingerprint: null, createdAt: null, history: [], loading: true, regenerating: true };
  v.ai = { subTab: "costs", costs: [], loading: false, error: null, settings: { defaultModel: "claude-sonnet", maxToolRounds: 10 }, settingsLoading: false };
  v.prodlogs = { deployments: [], logs: [], selectedDeploymentId: null, logType: "deploy", loading: false, logsLoading: false };
  v.tazcloud = { vms: [], loading: false, error: null, creating: false, createError: null, projects: [], projectsLoading: false, projectsError: null, projectCreating: false, projectError: null, capabilityImages: [], capabilitiesLoading: false, capabilitiesError: null, vmStats: {}, vmStatsErrors: {}, vmStatsLoading: false, snapshots: [], snapshotsLoading: false, snapshotsError: null, snapshotCreating: {}, snapshotCreateError: null, ingressBusy: {}, ingressError: null, netdiag: { env: null, capabilities: null, vms: [], loading: false, probing: {}, error: null, lastRunAt: null } };
});

describe("admin:baseimage", () => {
  it("configs:list populates configs/templates/deletedTemplates + buildingName", () => {
    handlers["admin:baseimage:configs:list"]({
      configs: { "node18": { snapshotName: "node18-v1" } },
      templates: { "node18": { snapshotId: "snap-1", snapshotName: "node18-v1", verified: true } },
      deletedTemplates: { "old": { name: "deprecated" } },
      buildingName: "redis",
    });

    const bi = $admin.getValue().baseImage;
    expect(bi.configs).toEqual({ "node18": { snapshotName: "node18-v1" } });
    expect(bi.templates).toHaveProperty("node18");
    expect(bi.deletedTemplates).toHaveProperty("old");
    expect(bi.buildingName).toBe("redis");
  });

  it("progress only appends when configName === buildingName (ignores stale builds)", () => {
    $admin.getValue().baseImage.buildingName = "redis";

    handlers["admin:baseimage:progress"]({ configName: "redis", message: "apt install redis" });
    handlers["admin:baseimage:progress"]({ configName: "redis", message: "starting service" });
    // Different config — should be dropped.
    handlers["admin:baseimage:progress"]({ configName: "node18", message: "leaked from old build" });

    expect($admin.getValue().baseImage.progress).toEqual([
      "apt install redis", "starting service",
    ]);
  });

  it("progress caps the buffer at 50 messages (sliding window)", () => {
    $admin.getValue().baseImage.buildingName = "redis";
    for (let i = 0; i < 60; i++) {
      handlers["admin:baseimage:progress"]({ configName: "redis", message: `line ${i}` });
    }
    expect($admin.getValue().baseImage.progress).toHaveLength(50);
    expect($admin.getValue().baseImage.progress[0]).toBe("line 10");   // first 10 evicted
    expect($admin.getValue().baseImage.progress[49]).toBe("line 59");
  });

  it("done stamps the template's snapshotId + clears buildingName/error/failedDroplet", () => {
    $admin.getValue().baseImage.buildingName = "redis";
    $admin.getValue().baseImage.error = "previous attempt failed";
    $admin.getValue().baseImage.failedDropletId = 999;
    $admin.getValue().baseImage.failedDropletIp = "1.2.3.4";
    $admin.getValue().baseImage.templates = {
      "redis": { snapshotId: null, snapshotName: null, verified: false } as never,
    };

    handlers["admin:baseimage:done"]({
      configName: "redis",
      snapshotId: "snap-new",
      snapshotName: "redis-v2",
    });

    const bi = $admin.getValue().baseImage;
    expect(bi.templates["redis"]).toMatchObject({ snapshotId: "snap-new", snapshotName: "redis-v2", verified: true });
    expect(bi.buildingName).toBeNull();
    expect(bi.error).toBeNull();
    expect(bi.failedDropletId).toBeNull();
    expect(bi.failedDropletIp).toBeNull();
  });

  it("error prefixes the message with [configName] and captures failed droplet info", () => {
    $admin.getValue().baseImage.buildingName = "redis";
    handlers["admin:baseimage:error"]({
      configName: "redis", message: "apt timeout",
      failedDropletId: 555, failedDropletIp: "5.6.7.8",
    });

    const bi = $admin.getValue().baseImage;
    expect(bi.error).toBe("[redis] apt timeout");
    expect(bi.failedDropletId).toBe(555);
    expect(bi.failedDropletIp).toBe("5.6.7.8");
    expect(bi.buildingName).toBeNull();
  });

  it("template:history replaces the history list", () => {
    handlers["admin:baseimage:template:history"]({
      history: [{ id: "h-1", snapshotName: "redis-v1", createdAt: "2026-05-18" }],
    });
    expect($admin.getValue().baseImage.history).toHaveLength(1);
  });

  it("template:history with empty payload yields empty array", () => {
    handlers["admin:baseimage:template:history"]({});
    expect($admin.getValue().baseImage.history).toEqual([]);
  });
});

describe("admin:sshkey", () => {
  it(":result populates all fields and clears both loading flags", () => {
    handlers["admin:sshkey:result"]({
      exists: true,
      publicKey: "ssh-ed25519 AAAA…",
      fingerprint: "SHA256:abcdef",
      createdAt: "2026-05-18T00:00:00Z",
      history: [{ id: "h-1" }],
    });

    const sk = $admin.getValue().sshKey;
    expect(sk).toMatchObject({
      exists: true,
      publicKey: "ssh-ed25519 AAAA…",
      fingerprint: "SHA256:abcdef",
      createdAt: "2026-05-18T00:00:00Z",
      loading: false,
      regenerating: false,
    });
    expect(sk.history).toHaveLength(1);
  });

  it(":result with missing history defaults to empty array", () => {
    handlers["admin:sshkey:result"]({ exists: false, publicKey: null, fingerprint: null });
    expect($admin.getValue().sshKey.history).toEqual([]);
  });

  it(":error just clears the loading flags", () => {
    handlers["admin:sshkey:error"]({ message: "permission denied" });
    expect($admin.getValue().sshKey.loading).toBe(false);
    expect($admin.getValue().sshKey.regenerating).toBe(false);
  });
});

describe("admin:ai", () => {
  it("costs replaces rows and clears loading/error", () => {
    $admin.getValue().ai.loading = true;
    handlers["admin:ai:costs"]({
      rows: [{ model: "sonnet-4.6", spend: 1.23 }],
    });
    expect($admin.getValue().ai.costs).toEqual([{ model: "sonnet-4.6", spend: 1.23 }]);
    expect($admin.getValue().ai.loading).toBe(false);
    expect($admin.getValue().ai.error).toBeNull();
  });

  it("costs surfaces an error and uses empty rows fallback", () => {
    handlers["admin:ai:costs"]({ error: "billing API down" });
    expect($admin.getValue().ai.costs).toEqual([]);
    expect($admin.getValue().ai.error).toBe("billing API down");
  });

  it("settings patches only provided fields and clears settingsLoading", () => {
    $admin.getValue().ai.settings = { defaultModel: "old", maxToolRounds: 5 };
    $admin.getValue().ai.settingsLoading = true;

    handlers["admin:ai:settings"]({ defaultModel: "claude-sonnet" });

    expect($admin.getValue().ai.settings).toEqual({ defaultModel: "claude-sonnet", maxToolRounds: 5 });
    expect($admin.getValue().ai.settingsLoading).toBe(false);
  });

  it("settings can patch multiple fields at once", () => {
    handlers["admin:ai:settings"]({ defaultModel: "opus", maxToolRounds: 20 });
    expect($admin.getValue().ai.settings).toEqual({ defaultModel: "opus", maxToolRounds: 20 });
  });
});

describe("admin:prodlogs", () => {
  it("deployments replaces list + clears loading", () => {
    $admin.getValue().prodlogs.loading = true;
    handlers["admin:prodlogs:deployments"]({
      deployments: [{ id: "d-1", commit: "abc123", deployedAt: "2026-05-18" }],
    });
    expect($admin.getValue().prodlogs.deployments).toHaveLength(1);
    expect($admin.getValue().prodlogs.loading).toBe(false);
  });

  it("logs replaces list + clears logsLoading (distinct flag from loading)", () => {
    $admin.getValue().prodlogs.logsLoading = true;
    handlers["admin:prodlogs:logs"]({
      logs: [{ ts: "2026-05-18T10:00:00Z", line: "starting" }],
    });
    expect($admin.getValue().prodlogs.logs).toHaveLength(1);
    expect($admin.getValue().prodlogs.logsLoading).toBe(false);
  });
});

describe("admin:tazcloud list + deleted (round out coverage)", () => {
  it("tazcloud:list maps API shape into AdminTazVm", () => {
    handlers["admin:tazcloud:list"]({
      vms: [
        {
          id: "vm-1",
          name: "taz-prod-1",
          status: "ACTIVE",
          ipv6: "2001:470::1",
          image: "ubuntu-22",
          size: "small",
        },
      ],
      projectMap: {
        "vm-1": { projectId: "p-1", projectName: "Production" },
      },
    });

    const vms = $admin.getValue().tazcloud.vms;
    expect(vms).toHaveLength(1);
    expect(vms[0]).toMatchObject({
      id: "vm-1",
      name: "taz-prod-1",
      status: "ACTIVE",
      ipv6: "2001:470::1",
      projectId: "p-1",
      projectName: "Production",
    });
  });

  it("tazcloud:list falls back to ssh_host when ipv6 is absent", () => {
    handlers["admin:tazcloud:list"]({
      vms: [{ id: "vm-1", name: "x", status: "ACTIVE", ssh_host: "::2" }],
      projectMap: {},
    });
    expect($admin.getValue().tazcloud.vms[0].ipv6).toBe("::2");
  });

  it("tazcloud:list propagates server error and clears list/loading", () => {
    $admin.getValue().tazcloud.vms = [{ id: "stale" } as never];
    $admin.getValue().tazcloud.loading = true;
    handlers["admin:tazcloud:list"]({ error: "token expired" });
    expect($admin.getValue().tazcloud.error).toBe("token expired");
    expect($admin.getValue().tazcloud.vms).toEqual([]);
    expect($admin.getValue().tazcloud.loading).toBe(false);
  });

  it("tazcloud:deleted removes the matching VM", () => {
    $admin.getValue().tazcloud.vms = [
      { id: "vm-1" } as never, { id: "vm-2" } as never,
    ];
    handlers["admin:tazcloud:deleted"]({ vmId: "vm-1" });
    expect($admin.getValue().tazcloud.vms.map((v: { id: string }) => v.id)).toEqual(["vm-2"]);
  });
});
