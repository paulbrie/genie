// Remaining smaller handlers: apps, presence, do/railway probes,
// chat:session:deleted, terminal:share:sent, vps exec/logs/status,
// deploy:logs:list.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../actions/apps", () => ({ selectApp: vi.fn() }));
// Bring app handlers in once their action stub is mocked.
import { handlers as appsHandlers } from "./apps";
import {
  $apps,
  $appStats,
  $selectedAppId,
  $viewingLogsFor,
  $pendingRestoreAppId,
  $presenceSessions,
  $logBuffers,
} from "../subjects/common";
import { selectApp } from "../actions/apps";

// presence
import { handlers as presenceHandlers } from "./presence";

// vps exec / logs / status / deploy logs / railway / do
import { handlers as vpsHandlers } from "./vps";
import {
  $doSnapshots,
  $doSnapshotsLoading,
  $doTokenValid,
  $railwayTestResult,
  $vpsDeploy,
} from "../subjects/vps";
import { execCallbacks } from "../actions/vps";

// terminal:share:sent
import { handlers as terminalHandlers } from "./terminal";

// chat:session:deleted
import { handlers as chatHandlers } from "./chat";
import { $chat } from "../subjects/chat";
import type { ChatState } from "../types/chat";

const FRESH_CHAT: ChatState = {
  messages: [], loading: false, streamingContent: "", streamingSteps: [],
  toolUses: [], statusText: "", modelId: "claude-code", maxToolRounds: 0,
  toolRoundsUsed: 0, claudeInfo: null,
  sessions: [], sessionsLoading: false, activeSessionId: null,
  resumedFrom: null,
};

beforeEach(() => {
  $apps.next([]); $appStats.next({}); $selectedAppId.next(null);
  $viewingLogsFor.next(null); $pendingRestoreAppId.next(null);
  $logBuffers.next({}); $presenceSessions.next([]);
  $doSnapshots.next([]); $doSnapshotsLoading.next(true);
  $doTokenValid.next(null); $railwayTestResult.next(null);
  $vpsDeploy.next({ instances: {}, activeDeploys: {}, testResult: null, deployLogs: [] });
  $chat.next({ ...FRESH_CHAT });
  vi.clearAllMocks();
  execCallbacks.clear();
});

describe("app:list", () => {
  it("replaces the app list", () => {
    appsHandlers["app:list"]({ apps: [{ id: "a-1", name: "API" }] });
    expect($apps.getValue()).toEqual([{ id: "a-1", name: "API" }]);
  });

  it("auto-restores pending app id when it's present in the new list", () => {
    $pendingRestoreAppId.next("a-restore");
    appsHandlers["app:list"]({
      apps: [{ id: "a-1" }, { id: "a-restore" }],
    });
    expect($pendingRestoreAppId.getValue()).toBeNull();
    expect(selectApp).toHaveBeenCalledExactlyOnceWith("a-restore");
  });

  it("clears pending app id (and skips selection) when it's not in the list", () => {
    $pendingRestoreAppId.next("a-missing");
    appsHandlers["app:list"]({ apps: [{ id: "a-1" }] });
    expect($pendingRestoreAppId.getValue()).toBeNull();
    expect(selectApp).not.toHaveBeenCalled();
  });

  it("clears selectedAppId + viewingLogsFor when the selected app is removed", () => {
    $selectedAppId.next("a-deleted");
    $viewingLogsFor.next("a-deleted");
    appsHandlers["app:list"]({ apps: [{ id: "a-1" }] });
    expect($selectedAppId.getValue()).toBeNull();
    expect($viewingLogsFor.getValue()).toBeNull();
  });
});

describe("app:status", () => {
  it("patches the status of the matching app in $apps", () => {
    $apps.next([{ id: "a-1", name: "API", status: "running" } as never]);
    appsHandlers["app:status"]({ id: "a-1", status: "stopped" });
    expect($apps.getValue()[0]).toMatchObject({ id: "a-1", status: "stopped" });
  });

  it("auto-selects the app when it crashed (so logs surface)", () => {
    $apps.next([{ id: "a-1", name: "API", status: "running" } as never]);
    appsHandlers["app:status"]({ id: "a-1", status: "crashed" });
    expect(selectApp).toHaveBeenCalledExactlyOnceWith("a-1");
  });
});

describe("app:log", () => {
  it("appends to per-app log buffer with ANSI stripped", () => {
    appsHandlers["app:log"]({ id: "a-1", data: "\x1b[32mok\x1b[0m\n" });
    appsHandlers["app:log"]({ id: "a-1", data: "next\n" });
    expect($logBuffers.getValue()["a-1"]).toBe("ok\nnext\n");
  });

  it("truncates the buffer past 50 000 chars", () => {
    appsHandlers["app:log"]({ id: "a-1", data: "x".repeat(60_000) });
    expect($logBuffers.getValue()["a-1"].length).toBe(50_000);
  });
});

describe("presence:detail", () => {
  it("replaces $presenceSessions with the payload", () => {
    presenceHandlers["presence:detail"]({
      sessions: [{ id: "u-1", name: "Alice", color: "#f00", path: "/projects/p-1" }],
    });
    expect($presenceSessions.getValue()).toHaveLength(1);
  });

  it("defaults to empty array when sessions is absent", () => {
    $presenceSessions.next([{ id: "stale" } as never]);
    presenceHandlers["presence:detail"]({});
    expect($presenceSessions.getValue()).toEqual([]);
  });
});

describe("do:token-valid / do:snapshots:list", () => {
  it("do:token-valid stores the validation result", () => {
    vpsHandlers["do:token-valid"]({ valid: true, email: "x@y" });
    expect($doTokenValid.getValue()).toEqual({ valid: true, email: "x@y" });
  });

  it("do:snapshots:list writes the list and clears loading", () => {
    vpsHandlers["do:snapshots:list"]({
      snapshots: [{ id: 1, name: "snap-1", createdAt: "2026" }],
    });
    expect($doSnapshots.getValue()).toHaveLength(1);
    expect($doSnapshotsLoading.getValue()).toBe(false);
  });

  it("do:snapshots:list defaults to empty array when snapshots is absent", () => {
    $doSnapshots.next([{ id: 99 } as never]);
    vpsHandlers["do:snapshots:list"]({});
    expect($doSnapshots.getValue()).toEqual([]);
    expect($doSnapshotsLoading.getValue()).toBe(false);
  });
});

describe("admin:railway:test", () => {
  it("stores the raw test result payload", () => {
    vpsHandlers["admin:railway:test"]({ ok: true, message: "connected" });
    expect($railwayTestResult.getValue()).toEqual({ ok: true, message: "connected" });
  });

  it("error payload is passed through verbatim", () => {
    vpsHandlers["admin:railway:test"]({ ok: false, message: "401 unauthorized" });
    expect($railwayTestResult.getValue()).toEqual({ ok: false, message: "401 unauthorized" });
  });
});

describe("vps:exec:result", () => {
  it("invokes the matching execId callback and removes it from the map", () => {
    const cb = vi.fn();
    execCallbacks.set("exec-1", cb);

    vpsHandlers["vps:exec:result"]({ execId: "exec-1", output: "ok\n", error: false });

    expect(cb).toHaveBeenCalledExactlyOnceWith("ok\n", false);
    expect(execCallbacks.has("exec-1")).toBe(false);
  });

  it("is a silent no-op for an unknown execId", () => {
    expect(() => {
      vpsHandlers["vps:exec:result"]({ execId: "ghost", output: "x", error: false });
    }).not.toThrow();
  });
});

describe("vps:logs:data", () => {
  it("writes logs into the matching instance", () => {
    vpsHandlers["vps:logs:data"]({
      instanceId: "i-1",
      serviceName: "nginx",
      logs: ["line 1", "line 2"],
    });

    const inst = $vpsDeploy.getValue().instances["i-1"];
    expect(inst.logs).toEqual({ serviceName: "nginx", logs: ["line 1", "line 2"] });
  });

  it("serviceName defaults to null when absent", () => {
    vpsHandlers["vps:logs:data"]({ instanceId: "i-1", logs: ["root logs"] });
    expect($vpsDeploy.getValue().instances["i-1"].logs).toEqual({
      serviceName: null, logs: ["root logs"],
    });
  });
});

describe("vps:status:update", () => {
  it("is a no-op placeholder (state is refreshed via project:list)", () => {
    // The handler intentionally does nothing — it's a server signal that
    // a project:list broadcast is about to arrive. Just ensure it doesn't throw.
    expect(() => vpsHandlers["vps:status:update"]({})).not.toThrow();
  });
});

describe("deploy:logs:list", () => {
  it("writes the deploy log list into $vpsDeploy", () => {
    vpsHandlers["deploy:logs:list"]({
      logs: [{ id: "l-1", projectId: "p-1", startedAt: "2026-05-18", status: "success" }],
    });
    expect($vpsDeploy.getValue().deployLogs).toHaveLength(1);
  });
});

describe("chat:session:deleted", () => {
  it("filters the session out of the list", () => {
    $chat.next({
      ...FRESH_CHAT,
      sessions: [
        { sessionId: "s-1", name: "Keep" } as never,
        { sessionId: "s-2", name: "Drop" } as never,
      ],
    });

    chatHandlers["chat:session:deleted"]({ sessionId: "s-2" });

    expect($chat.getValue().sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual(["s-1"]);
  });

  it("clears activeSessionId + messages when the deleted session was active", () => {
    $chat.next({
      ...FRESH_CHAT,
      sessions: [{ sessionId: "s-1" } as never],
      activeSessionId: "s-1",
      messages: [{ role: "user", content: "hi" }],
    });

    chatHandlers["chat:session:deleted"]({ sessionId: "s-1" });

    expect($chat.getValue().activeSessionId).toBeNull();
    expect($chat.getValue().messages).toEqual([]);
  });

  it("leaves the active session alone when a different session is deleted", () => {
    $chat.next({
      ...FRESH_CHAT,
      sessions: [{ sessionId: "s-1" } as never, { sessionId: "s-2" } as never],
      activeSessionId: "s-1",
      messages: [{ role: "user", content: "hi" }],
    });

    chatHandlers["chat:session:deleted"]({ sessionId: "s-2" });

    expect($chat.getValue().activeSessionId).toBe("s-1");
    expect($chat.getValue().messages).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("terminal:share:sent", () => {
  it("dispatches a genie:terminal:share:sent CustomEvent with the payload", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    terminalHandlers["terminal:share:sent"]({ sessionId: "s-1", to: "alice" });

    const ev = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent => e.type === "genie:terminal:share:sent");

    expect(ev).toBeDefined();
    expect(ev!.detail).toEqual({ sessionId: "s-1", to: "alice" });
    dispatchSpy.mockRestore();
  });
});
