// VPS deploy/teardown/hibernate/wake lifecycle handlers — and the test
// connection probe + stats / process:kill side channels. These all key on
// instanceId and mutate $vpsDeploy.instances[id] state.

import { describe, it, expect, beforeEach } from "vitest";
import { handlers } from "./vps";
import { $vpsDeploy } from "../subjects/vps";

const INST = "inst-1";

function resetState() {
  $vpsDeploy.next({
    instances: {}, activeDeploys: {}, testResult: null,
  });
}

/** Seed $vpsDeploy with an instance + matching activeDeploy entry. The
 *  handlers update both in parallel; tests assert on both. */
function makeActiveDeploy(instOverrides = {}, deployOverrides = {}) {
  $vpsDeploy.next({
    instances: {
      [INST]: {
        deploying: true, tearingDown: false, hibernating: false, wakingUp: false, rebooting: false,
        progress: [], error: null, logs: null,
        startedAt: Date.now() - 1000, endedAt: null,
        stats: null, statsError: null,
        recipes: {},
        ...instOverrides,
      },
    },
    activeDeploys: {
      [INST]: {
        instanceId: INST, projectId: "p-1", deploying: true,
        progress: [], error: null, startedAt: Date.now() - 1000, endedAt: null,
        failedDroplet: null, destroyingDroplet: false,
        ...deployOverrides,
      },
    },
    testResult: null,
  });
}

beforeEach(() => {
  resetState();
});

describe("vps:test-connection", () => {
  it("vps:test-connection:ok writes hostname", () => {
    handlers["vps:test-connection:ok"]({ hostname: "ip-10-0-0-1" });
    expect($vpsDeploy.getValue().testResult).toEqual({ ok: true, hostname: "ip-10-0-0-1" });
  });

  it("vps:test-connection:error writes the failure message", () => {
    handlers["vps:test-connection:error"]({ message: "permission denied" });
    expect($vpsDeploy.getValue().testResult).toEqual({ ok: false, error: "permission denied" });
  });
});

describe("vps:deploy lifecycle", () => {
  it("vps:deploy:progress appends to both the instance and activeDeploy", () => {
    makeActiveDeploy();

    handlers["vps:deploy:progress"]({ instanceId: INST, message: "uploading payload" });
    handlers["vps:deploy:progress"]({ instanceId: INST, message: "running setup.sh" });

    const v = $vpsDeploy.getValue();
    expect(v.instances[INST].progress).toEqual(["uploading payload", "running setup.sh"]);
    expect(v.activeDeploys[INST].progress).toEqual(["uploading payload", "running setup.sh"]);
  });

  it("vps:deploy:progress creates the instance if absent (server can send before client is ready)", () => {
    handlers["vps:deploy:progress"]({ instanceId: "lazy-1", message: "step 1" });
    expect($vpsDeploy.getValue().instances["lazy-1"].progress).toEqual(["step 1"]);
  });

  it("vps:deploy:done flips deploying→false and stamps endedAt on both halves", () => {
    makeActiveDeploy();

    handlers["vps:deploy:done"]({ instanceId: INST });

    const v = $vpsDeploy.getValue();
    expect(v.instances[INST].deploying).toBe(false);
    expect(typeof v.instances[INST].endedAt).toBe("number");
    expect(v.activeDeploys[INST].deploying).toBe(false);
    expect(typeof v.activeDeploys[INST].endedAt).toBe("number");
  });

  it("vps:deploy:error stamps endedAt + error and captures failedDroplet", () => {
    makeActiveDeploy();

    handlers["vps:deploy:error"]({
      instanceId: INST,
      message: "apt failed at provisioning",
      failedDroplet: { dropletId: 999, ipAddress: "1.2.3.4" },
    });

    const v = $vpsDeploy.getValue();
    expect(v.instances[INST].deploying).toBe(false);
    expect(v.instances[INST].error).toBe("apt failed at provisioning");
    expect(v.activeDeploys[INST].error).toBe("apt failed at provisioning");
    expect(v.activeDeploys[INST].failedDroplet).toEqual({ dropletId: 999, ipAddress: "1.2.3.4" });
  });
});

describe("do:destroy-failed-droplet", () => {
  it(":done clears the failedDroplet reference and the destroying flag", () => {
    makeActiveDeploy(
      {},
      {
        deploying: false,
        error: "apt failed",
        failedDroplet: { dropletId: 999, ipAddress: "1.2.3.4" },
        destroyingDroplet: true,
      },
    );

    handlers["do:destroy-failed-droplet:done"]({ dropletId: 999 });

    const d = $vpsDeploy.getValue().activeDeploys[INST];
    expect(d.failedDroplet).toBeNull();
    expect(d.destroyingDroplet).toBe(false);
  });

  it(":error keeps the failedDroplet but stops the spinner and surfaces the reason", () => {
    makeActiveDeploy(
      {},
      {
        deploying: false,
        error: null,
        failedDroplet: { dropletId: 999, ipAddress: "1.2.3.4" },
        destroyingDroplet: true,
      },
    );

    handlers["do:destroy-failed-droplet:error"]({ dropletId: 999, message: "not found" });

    const d = $vpsDeploy.getValue().activeDeploys[INST];
    expect(d.destroyingDroplet).toBe(false);
    expect(d.error).toBe("Failed to destroy droplet: not found");
    // failedDroplet stays so the UI keeps offering retry.
    expect(d.failedDroplet).not.toBeNull();
  });

  it("only touches deploys whose failedDroplet matches the id", () => {
    // Two failed deploys with different droplet IDs.
    $vpsDeploy.next({
      instances: {},
      activeDeploys: {
        "i-a": {
          instanceId: "i-a", projectId: "p", deploying: false,
          progress: [], error: null, startedAt: 0, endedAt: 0,
          failedDroplet: { dropletId: 111, ipAddress: "1.1.1.1" },
          destroyingDroplet: true,
        },
        "i-b": {
          instanceId: "i-b", projectId: "p", deploying: false,
          progress: [], error: null, startedAt: 0, endedAt: 0,
          failedDroplet: { dropletId: 222, ipAddress: "2.2.2.2" },
          destroyingDroplet: true,
        },
      },
      testResult: null,
    });

    handlers["do:destroy-failed-droplet:done"]({ dropletId: 111 });

    expect($vpsDeploy.getValue().activeDeploys["i-a"].failedDroplet).toBeNull();
    expect($vpsDeploy.getValue().activeDeploys["i-b"].failedDroplet).not.toBeNull();
  });
});

describe("vps:stats", () => {
  const sampleStats = {
    cpuPercent: 12.5, memUsedBytes: 500_000_000, memTotalBytes: 2_000_000_000, memPercent: 25,
    diskUsedBytes: 5_000_000_000, diskTotalBytes: 20_000_000_000, diskPercent: 25,
    processes: [{ pid: 100, ppid: 1, name: "nginx", cpu: 0.1, mem: 5, user: "root", port: "80" }],
    openPorts: [22, 80], externalPorts: [80],
  };

  it(":result writes stats and clears any previous statsError", () => {
    makeActiveDeploy({ statsError: "earlier failure" });

    handlers["vps:stats:result"]({ instanceId: INST, stats: sampleStats });

    const inst = $vpsDeploy.getValue().instances[INST];
    expect(inst.stats).toEqual(sampleStats);
    expect(inst.statsError).toBeNull();
  });

  it(":update writes stats like :result (daemon stream push)", () => {
    makeActiveDeploy({ statsError: "earlier failure" });

    handlers["vps:stats:update"]({ instanceId: INST, stats: sampleStats });

    const inst = $vpsDeploy.getValue().instances[INST];
    expect(inst.stats).toEqual(sampleStats);
    expect(inst.statsError).toBeNull();
  });

  it(":error stores the message without clearing existing stats", () => {
    makeActiveDeploy({ stats: sampleStats });

    handlers["vps:stats:error"]({ instanceId: INST, message: "ssh probe timeout" });

    const inst = $vpsDeploy.getValue().instances[INST];
    expect(inst.statsError).toBe("ssh probe timeout");
    // The previous stats are not wiped — UI shows stale data flagged with the error.
    expect(inst.stats).toEqual(sampleStats);
  });
});

describe("vps:process:kill:result", () => {
  it("drops the killed PID from the in-memory process list on ok=true", () => {
    makeActiveDeploy({
      stats: {
        cpuPercent: 0, memUsedBytes: 0, memTotalBytes: 0, memPercent: 0,
        diskUsedBytes: 0, diskTotalBytes: 0, diskPercent: 0,
        processes: [
          { pid: 100, ppid: 1, name: "nginx", cpu: 0, mem: 0, user: "root", port: "80" },
          { pid: 200, ppid: 1, name: "node",  cpu: 0, mem: 0, user: "genie", port: "3000" },
        ],
        openPorts: [], externalPorts: [],
      },
    });

    handlers["vps:process:kill:result"]({ instanceId: INST, ok: true, pid: 100 });

    const procs = $vpsDeploy.getValue().instances[INST].stats!.processes;
    expect(procs.map((p) => p.pid)).toEqual([200]);
  });

  it("is a no-op when ok=false (UI shows the error separately)", () => {
    makeActiveDeploy({
      stats: {
        cpuPercent: 0, memUsedBytes: 0, memTotalBytes: 0, memPercent: 0,
        diskUsedBytes: 0, diskTotalBytes: 0, diskPercent: 0,
        processes: [{ pid: 100, ppid: 1, name: "x", cpu: 0, mem: 0, user: "x", port: "" }],
        openPorts: [], externalPorts: [],
      },
    });

    handlers["vps:process:kill:result"]({ instanceId: INST, ok: false, pid: 100, message: "EPERM" });

    expect($vpsDeploy.getValue().instances[INST].stats!.processes).toHaveLength(1);
  });
});

describe("vps:teardown", () => {
  it("vps:teardown:progress appends progress lines", () => {
    makeActiveDeploy();
    handlers["vps:teardown:progress"]({ instanceId: INST, message: "stopping services" });
    expect($vpsDeploy.getValue().instances[INST].progress).toEqual(["stopping services"]);
  });

  it("vps:teardown:done deletes the instance entry entirely", () => {
    makeActiveDeploy();
    handlers["vps:teardown:done"]({ instanceId: INST });
    expect($vpsDeploy.getValue().instances[INST]).toBeUndefined();
  });

  it("vps:teardown:error stores the message but leaves the instance", () => {
    makeActiveDeploy();
    handlers["vps:teardown:error"]({ instanceId: INST, message: "ssh disconnected" });
    expect($vpsDeploy.getValue().instances[INST].error).toBe("ssh disconnected");
  });
});

describe("vps:hibernate", () => {
  it(":progress appends, :done clears + flips flag, :error preserves flag", () => {
    makeActiveDeploy({ hibernating: true });

    handlers["vps:hibernate:progress"]({ instanceId: INST, message: "snapshotting…" });
    expect($vpsDeploy.getValue().instances[INST].progress).toEqual(["snapshotting…"]);

    handlers["vps:hibernate:done"]({ instanceId: INST });
    const v = $vpsDeploy.getValue().instances[INST];
    expect(v.hibernating).toBe(false);
    expect(v.progress).toEqual([]);
    expect(v.error).toBeNull();
  });

  it(":error flips hibernating→false and stores message", () => {
    makeActiveDeploy({ hibernating: true });
    handlers["vps:hibernate:error"]({ instanceId: INST, message: "snapshot quota exceeded" });
    expect($vpsDeploy.getValue().instances[INST].hibernating).toBe(false);
    expect($vpsDeploy.getValue().instances[INST].error).toBe("snapshot quota exceeded");
  });
});

describe("vps:wake", () => {
  it(":progress / :done lifecycle clears wakingUp and resets progress", () => {
    makeActiveDeploy({ wakingUp: true });

    handlers["vps:wake:progress"]({ instanceId: INST, message: "restoring snapshot" });
    expect($vpsDeploy.getValue().instances[INST].progress).toEqual(["restoring snapshot"]);

    handlers["vps:wake:done"]({ instanceId: INST });
    const v = $vpsDeploy.getValue().instances[INST];
    expect(v.wakingUp).toBe(false);
    expect(v.progress).toEqual([]);
    expect(v.error).toBeNull();
  });

  it(":error flips wakingUp→false and stores message", () => {
    makeActiveDeploy({ wakingUp: true });
    handlers["vps:wake:error"]({ instanceId: INST, message: "snapshot not found" });
    expect($vpsDeploy.getValue().instances[INST].wakingUp).toBe(false);
    expect($vpsDeploy.getValue().instances[INST].error).toBe("snapshot not found");
  });
});
