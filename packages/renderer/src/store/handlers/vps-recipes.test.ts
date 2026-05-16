import { describe, it, expect, beforeEach } from "vitest";
import { handlers } from "./vps";
import { $vpsDeploy } from "../subjects/vps";

const INST = "inst-1";
const RECIPE = "nodejs-20";

function resetState() {
  $vpsDeploy.next({ instances: {}, activeDeploys: {}, testResult: null, deployLogs: [] });
}

function makeInstanceWithRecipe(overrides = {}) {
  $vpsDeploy.next({
    instances: {
      [INST]: {
        deploying: false, tearingDown: false, hibernating: false, wakingUp: false,
        progress: [], error: null, logs: null,
        startedAt: null, endedAt: null, stats: null, statsError: null, deployLogs: [],
        recipes: {
          [RECIPE]: {
            recipeId: RECIPE, checking: false, installed: null,
            running: true, progress: [], error: null,
            ...overrides,
          },
        },
      },
    },
    activeDeploys: {}, testResult: null, deployLogs: [],
  });
}

beforeEach(() => {
  resetState();
});

describe("vps:recipe:check:result", () => {
  it("marks the recipe checked + installed=true", () => {
    makeInstanceWithRecipe({ checking: true });

    handlers["vps:recipe:check:result"]({
      instanceId: INST, recipeId: RECIPE, installed: true,
    });

    const r = $vpsDeploy.getValue().instances[INST].recipes[RECIPE];
    expect(r.checking).toBe(false);
    expect(r.installed).toBe(true);
  });

  it("marks installed=false when the check failed", () => {
    makeInstanceWithRecipe({ checking: true });

    handlers["vps:recipe:check:result"]({
      instanceId: INST, recipeId: RECIPE, installed: false,
    });

    expect($vpsDeploy.getValue().instances[INST].recipes[RECIPE].installed).toBe(false);
  });

  it("is a no-op when the recipe slot doesn't exist yet", () => {
    // ensureInstanceState() will create the instance, but no recipe entry
    // exists — handler must not throw or implicitly create one.
    handlers["vps:recipe:check:result"]({
      instanceId: INST, recipeId: "never-checked", installed: true,
    });

    const inst = $vpsDeploy.getValue().instances[INST];
    expect(inst).toBeDefined();
    expect(inst.recipes["never-checked"]).toBeUndefined();
  });
});

describe("vps:recipe:progress", () => {
  it("appends streaming output to progress[]", () => {
    makeInstanceWithRecipe({ progress: ["installing curl…"] });

    handlers["vps:recipe:progress"]({
      instanceId: INST, recipeId: RECIPE, message: "downloading nodejs.tar.xz",
    });
    handlers["vps:recipe:progress"]({
      instanceId: INST, recipeId: RECIPE, message: "extracting…",
    });

    expect($vpsDeploy.getValue().instances[INST].recipes[RECIPE].progress).toEqual([
      "installing curl…",
      "downloading nodejs.tar.xz",
      "extracting…",
    ]);
  });
});

describe("vps:recipe:done", () => {
  it("flips running→false and installed→true", () => {
    makeInstanceWithRecipe({ running: true, installed: false });

    handlers["vps:recipe:done"]({ instanceId: INST, recipeId: RECIPE });

    const r = $vpsDeploy.getValue().instances[INST].recipes[RECIPE];
    expect(r.running).toBe(false);
    expect(r.installed).toBe(true);
  });
});

describe("vps:recipe:uninstall:done", () => {
  it("flips running→false and installed→false", () => {
    makeInstanceWithRecipe({ running: true, installed: true });

    handlers["vps:recipe:uninstall:done"]({ instanceId: INST, recipeId: RECIPE });

    const r = $vpsDeploy.getValue().instances[INST].recipes[RECIPE];
    expect(r.running).toBe(false);
    expect(r.installed).toBe(false);
  });
});

describe("vps:recipe:error", () => {
  it("stops the run and stores the error message", () => {
    makeInstanceWithRecipe({ running: true });

    handlers["vps:recipe:error"]({
      instanceId: INST, recipeId: RECIPE, message: "Command exited with code 100",
    });

    const r = $vpsDeploy.getValue().instances[INST].recipes[RECIPE];
    expect(r.running).toBe(false);
    expect(r.error).toBe("Command exited with code 100");
  });
});

describe("install lifecycle (integration: check → progress → done)", () => {
  it("walks a full install through the state machine", () => {
    makeInstanceWithRecipe({ checking: true, running: false });

    // 1. Check confirms not installed
    handlers["vps:recipe:check:result"]({ instanceId: INST, recipeId: RECIPE, installed: false });
    let r = $vpsDeploy.getValue().instances[INST].recipes[RECIPE];
    expect(r).toMatchObject({ checking: false, installed: false });

    // 2. UI flips it to running (would normally be done by runVpsRecipe action)
    $vpsDeploy.getValue().instances[INST].recipes[RECIPE].running = true;

    // 3. Stream progress
    handlers["vps:recipe:progress"]({ instanceId: INST, recipeId: RECIPE, message: "step 1" });
    handlers["vps:recipe:progress"]({ instanceId: INST, recipeId: RECIPE, message: "step 2" });

    // 4. Done
    handlers["vps:recipe:done"]({ instanceId: INST, recipeId: RECIPE });

    r = $vpsDeploy.getValue().instances[INST].recipes[RECIPE];
    expect(r).toMatchObject({
      checking: false, installed: true, running: false, error: null,
      progress: ["step 1", "step 2"],
    });
  });
});
