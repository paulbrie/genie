// Project list + per-command output buffers + log streaming.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../actions/terminal", () => ({
  addTerminalTab: vi.fn(() => "term-1"),
}));

import { handlers } from "./projects";
import {
  $commandRunOutputs,
  $projectLogBuffers,
  $projects,
  $selectedProjectId,
  $terminal,
} from "../subjects/vps";
import { addTerminalTab } from "../actions/terminal";

beforeEach(() => {
  $projects.next([]);
  $selectedProjectId.next(null);
  $commandRunOutputs.next({});
  $projectLogBuffers.next({});
  $terminal.next({ tabs: [], activeTabId: null, bottomPanelOpen: false, bottomPanelHeight: 200 });
  vi.clearAllMocks();
});

describe("project:list", () => {
  it("replaces the project list", () => {
    handlers["project:list"]({ projects: [{ id: "p-1", name: "App", slug: "app" }] });
    expect($projects.getValue()).toEqual([{ id: "p-1", name: "App", slug: "app" }]);
  });

  it("clears the selected project if it's not in the new list", () => {
    $projects.next([{ id: "p-deleted", name: "Old", slug: "old" } as never]);
    $selectedProjectId.next("p-deleted");

    handlers["project:list"]({ projects: [{ id: "p-other", name: "New", slug: "new" }] });

    expect($selectedProjectId.getValue()).toBeNull();
  });

  it("keeps the selection if the selected project is still present", () => {
    $selectedProjectId.next("p-1");
    handlers["project:list"]({ projects: [{ id: "p-1", name: "Same", slug: "same" }] });
    expect($selectedProjectId.getValue()).toBe("p-1");
  });
});

describe("project:log", () => {
  it("appends to the per-(project,command) log buffer with ANSI stripped", () => {
    handlers["project:log"]({ projectId: "p-1", commandId: "c-1", data: "\x1b[32mok\x1b[0m\n" });
    handlers["project:log"]({ projectId: "p-1", commandId: "c-1", data: "next\n" });

    expect($projectLogBuffers.getValue()["p-1:c-1"]).toBe("ok\nnext\n");
  });

  it("truncates buffers that exceed MAX_LOG_BUFFER (50 000 chars)", () => {
    const giant = "x".repeat(60_000);
    handlers["project:log"]({ projectId: "p-1", commandId: "c-1", data: giant });
    const buf = $projectLogBuffers.getValue()["p-1:c-1"];
    expect(buf.length).toBe(50_000);
  });
});

describe("project:command lifecycle", () => {
  it("started/output/done flow accumulates output and stamps exitCode", () => {
    handlers["project:command:started"]({ projectId: "p-1", commandId: "c-1" });
    let r = $commandRunOutputs.getValue()["p-1:c-1"];
    expect(r).toEqual({ output: "", running: true, exitCode: null });

    handlers["project:command:output"]({ projectId: "p-1", commandId: "c-1", data: "step 1\n" });
    handlers["project:command:output"]({ projectId: "p-1", commandId: "c-1", data: "step 2\n" });

    r = $commandRunOutputs.getValue()["p-1:c-1"];
    expect(r.output).toBe("step 1\nstep 2\n");
    expect(r.running).toBe(true);

    handlers["project:command:done"]({ projectId: "p-1", commandId: "c-1", exitCode: 0 });
    r = $commandRunOutputs.getValue()["p-1:c-1"];
    expect(r.running).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  it("output truncates to MAX_LOG_BUFFER", () => {
    handlers["project:command:started"]({ projectId: "p-1", commandId: "c-1" });
    handlers["project:command:output"]({ projectId: "p-1", commandId: "c-1", data: "x".repeat(60_000) });
    expect($commandRunOutputs.getValue()["p-1:c-1"].output.length).toBe(50_000);
  });

  it("done with non-zero exitCode + error message appends the error", () => {
    handlers["project:command:started"]({ projectId: "p-1", commandId: "c-1" });
    handlers["project:command:output"]({ projectId: "p-1", commandId: "c-1", data: "partial output\n" });
    handlers["project:command:done"]({ projectId: "p-1", commandId: "c-1", exitCode: 1, error: "Process killed" });

    const r = $commandRunOutputs.getValue()["p-1:c-1"];
    expect(r.exitCode).toBe(1);
    expect(r.output).toBe("partial output\n\nProcess killed");
  });
});

describe("project:command:terminal", () => {
  it("spawns a terminal tab and dispatches a genie:command:terminal event", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    // Seed an existing tab with the id addTerminalTab() mock returns ("term-1")
    $terminal.next({
      tabs: [{
        id: "term-1", title: "Command",
      }],
      activeTabId: "term-1", bottomPanelOpen: false, bottomPanelHeight: 200,
    });

    handlers["project:command:terminal"]({
      projectId: "p-1", commandId: "c-1", instanceId: "i-1", commandName: "Run dev", command: "npm run dev",
    });

    expect(addTerminalTab).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: "genie:command:terminal",
    }));
    // The matching tab should have been patched with projectId/commandId/command.
    const tab = $terminal.getValue().tabs[0];
    expect(tab).toMatchObject({ id: "term-1", projectId: "p-1", commandId: "c-1", command: "npm run dev" });

    dispatchSpy.mockRestore();
  });
});
