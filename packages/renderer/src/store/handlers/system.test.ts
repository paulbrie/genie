// System stats fan-out + log streaming.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handlers } from "./system";
import {
  $system, $appStats, $processes, $docker, $logs,
} from "../subjects/common";

beforeEach(() => {
  $system.next({ cpu: 0, mem: 0, memory: null });
  $appStats.next({});
  $processes.next([]);
  $docker.next({ daemonRunning: false, containers: [] });
  $logs.next({ activeSource: "manager", sources: ["manager"], buffers: {} });
});

describe("stats", () => {
  it("fans out to $system, $appStats, $processes, $docker", () => {
    handlers["stats"]({
      system: { cpu: 42, mem: 70, memory: { used: 1, total: 2 } },
      apps: { "app-1": { cpu: 5, mem: 10 } },
      processes: [{ pid: 100, name: "node" }],
      docker: { daemonRunning: true, containers: [{ id: "c-1", name: "redis" }] },
    });

    expect($system.getValue()).toEqual({ cpu: 42, mem: 70, memory: { used: 1, total: 2 } });
    expect($appStats.getValue()).toEqual({ "app-1": { cpu: 5, mem: 10 } });
    expect($processes.getValue()).toHaveLength(1);
    expect($docker.getValue().daemonRunning).toBe(true);
  });

  it("preserves previous memory when payload.memory is absent", () => {
    $system.next({ cpu: 0, mem: 0, memory: { used: 100, total: 200 } as never });
    handlers["stats"]({ system: { cpu: 1, mem: 1 }, apps: {} });
    expect($system.getValue().memory).toEqual({ used: 100, total: 200 });
  });

  it("does not touch $processes / $docker when those keys are absent", () => {
    $processes.next([{ pid: 1, name: "keep" } as never]);
    $docker.next({ daemonRunning: true, containers: [] });

    handlers["stats"]({ system: { cpu: 5, mem: 5 }, apps: {} });

    expect($processes.getValue()).toEqual([{ pid: 1, name: "keep" }]);
    expect($docker.getValue().daemonRunning).toBe(true);
  });
});

describe("logs:data", () => {
  it("appends to the per-source buffer with ANSI codes stripped", () => {
    handlers["logs:data"]({ source: "manager", data: "\x1b[31merror!\x1b[0m\n" });
    handlers["logs:data"]({ source: "manager", data: "next line\n" });

    expect($logs.getValue().buffers["manager"]).toBe("error!\nnext line\n");
  });

  it("keeps separate buffers per source", () => {
    handlers["logs:data"]({ source: "manager", data: "mgr\n" });
    handlers["logs:data"]({ source: "deploy", data: "dep\n" });

    expect($logs.getValue().buffers).toEqual({ manager: "mgr\n", deploy: "dep\n" });
  });

  it("truncates per-source buffer to 50 000 chars", () => {
    handlers["logs:data"]({ source: "manager", data: "x".repeat(60_000) });
    expect($logs.getValue().buffers["manager"].length).toBe(50_000);
  });
});

describe("logs:backlog", () => {
  it("replaces (not appends) the source buffer with the backlog", () => {
    $logs.getValue().buffers = { manager: "old" } as never;
    handlers["logs:backlog"]({ source: "manager", data: "fresh start\n" });
    expect($logs.getValue().buffers["manager"]).toBe("fresh start\n");
  });
});

describe("logs:sources", () => {
  it("replaces the list of known sources", () => {
    handlers["logs:sources"]({ sources: ["manager", "deploy", "app-1"] });
    expect($logs.getValue().sources).toEqual(["manager", "deploy", "app-1"]);
  });
});

describe("error (manager-level sink)", () => {
  it("logs to console.error", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    handlers["error"]({ message: "unexpected websocket close" });
    expect(errSpy).toHaveBeenCalledWith("Manager error:", "unexpected websocket close");
    errSpy.mockRestore();
  });
});
