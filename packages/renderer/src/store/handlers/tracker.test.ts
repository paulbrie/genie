// Tracker handlers — issues + comments. Comments are pushed as
// CustomEvents to a listener component; tests assert detail payload.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handlers } from "./tracker";
import { $tracker } from "../subjects/tracker";

beforeEach(() => {
  $tracker.next({
    issues: [], labels: [],
    loading: false, showCreateForm: false, selectedIssueId: null,
  });
});

describe("tracker:list", () => {
  it("populates issues + labels and clears loading", () => {
    $tracker.getValue().loading = true as never;
    handlers["tracker:list"]({
      issues: [{ id: "i-1", title: "Fix bug" }],
      labels: [{ id: "l-1", name: "bug", color: "#f00" }],
    });

    const v = $tracker.getValue();
    expect(v.issues).toEqual([{ id: "i-1", title: "Fix bug" }]);
    expect(v.labels).toEqual([{ id: "l-1", name: "bug", color: "#f00" }]);
    expect(v.loading).toBe(false);
  });
});

describe("tracker:issue lifecycle", () => {
  it("issue:created closes the create form", () => {
    $tracker.getValue().showCreateForm = true as never;
    handlers["tracker:issue:created"]({});
    expect($tracker.getValue().showCreateForm).toBe(false);
  });

  it("issue:updated patches the matching issue in place", () => {
    $tracker.getValue().issues = [
      { id: "i-1", title: "Old" } as never,
      { id: "i-2", title: "Untouched" } as never,
    ];

    handlers["tracker:issue:updated"]({ id: "i-1", title: "New", status: "done" });

    expect($tracker.getValue().issues[0]).toEqual({ id: "i-1", title: "New", status: "done" });
    expect($tracker.getValue().issues[1]).toEqual({ id: "i-2", title: "Untouched" });
  });

  it("issue:deleted removes the issue", () => {
    $tracker.getValue().issues = [
      { id: "i-1" } as never,
      { id: "i-2" } as never,
    ];
    handlers["tracker:issue:deleted"]({ issueId: "i-1" });
    expect($tracker.getValue().issues.map((i: { id: string }) => i.id)).toEqual(["i-2"]);
  });

  it("issue:deleted clears selectedIssueId when the deleted issue was selected", () => {
    $tracker.getValue().issues = [{ id: "i-1" } as never];
    $tracker.getValue().selectedIssueId = "i-1" as never;

    handlers["tracker:issue:deleted"]({ issueId: "i-1" });

    expect($tracker.getValue().selectedIssueId).toBeNull();
  });

  it("issue:deleted preserves selection when the deleted issue is different", () => {
    $tracker.getValue().issues = [
      { id: "i-1" } as never,
      { id: "i-2" } as never,
    ];
    $tracker.getValue().selectedIssueId = "i-2" as never;

    handlers["tracker:issue:deleted"]({ issueId: "i-1" });

    expect($tracker.getValue().selectedIssueId).toBe("i-2");
  });
});

describe("tracker comments (event dispatch)", () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { dispatchSpy = vi.spyOn(window, "dispatchEvent"); });

  function lastEvent(name: string): CustomEvent | null {
    for (let i = dispatchSpy.mock.calls.length - 1; i >= 0; i--) {
      const ev = dispatchSpy.mock.calls[i][0] as Event;
      if (ev.type === name) return ev as CustomEvent;
    }
    return null;
  }

  it("comments:list dispatches a tracker:comments event with issueId + comments", () => {
    handlers["tracker:comments:list"]({
      issueId: "i-1",
      comments: [{ id: "c-1", body: "hi" }],
    });
    const ev = lastEvent("tracker:comments");
    expect(ev!.detail).toEqual({
      issueId: "i-1",
      comments: [{ id: "c-1", body: "hi" }],
    });
  });

  it("comment:created dispatches tracker:comment:created with the new comment", () => {
    handlers["tracker:comment:created"]({
      issueId: "i-1",
      comment: { id: "c-2", body: "fresh" },
    });
    const ev = lastEvent("tracker:comment:created");
    expect(ev!.detail).toEqual({ issueId: "i-1", comment: { id: "c-2", body: "fresh" } });
  });

  it("comment:deleted dispatches tracker:comment:deleted with both ids", () => {
    handlers["tracker:comment:deleted"]({ commentId: "c-1", issueId: "i-1" });
    const ev = lastEvent("tracker:comment:deleted");
    expect(ev!.detail).toEqual({ commentId: "c-1", issueId: "i-1" });
  });
});

describe("tracker:error", () => {
  it("logs + clears loading flag", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    $tracker.getValue().loading = true as never;
    handlers["tracker:error"]({ message: "permission denied" });

    expect(warnSpy).toHaveBeenCalledWith("Tracker error:", "permission denied");
    expect($tracker.getValue().loading).toBe(false);
    warnSpy.mockRestore();
  });
});
