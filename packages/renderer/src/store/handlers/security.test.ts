// Security scan handlers — manages an in-memory scan list with one active
// scan id that the progress handler is allowed to mutate.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handlers } from "./security";
import { $security } from "../subjects/admin";

beforeEach(() => {
  $security.next({ target: "https://example.com", activeScanId: null, scans: [] });
});

describe("security:scan:progress", () => {
  it("creates a new scan entry on first progress message", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234567890);

    handlers["security:scan:progress"]({
      id: "scan-1",
      progress: 10,
      phase: "Discovering",
    });

    const sec = $security.getValue();
    expect(sec.scans).toHaveLength(1);
    expect(sec.scans[0]).toMatchObject({
      id: "scan-1",
      target: "https://example.com",
      status: "running",
      startedAt: 1234567890,
      progress: 10,
      phase: "Discovering",
    });
    expect(sec.activeScanId).toBe("scan-1");

    vi.restoreAllMocks();
  });

  it("updates the existing scan on subsequent progress messages without overwriting id", () => {
    handlers["security:scan:progress"]({ id: "scan-1", progress: 10 });
    handlers["security:scan:progress"]({
      id: "scan-1",
      progress: 50,
      phase: "Probing",
      findings: [{ type: "open-port", port: 22 }],
    });

    const sec = $security.getValue();
    expect(sec.scans).toHaveLength(1);
    expect(sec.scans[0]).toMatchObject({
      id: "scan-1",
      progress: 50,
      phase: "Probing",
    });
    expect(sec.scans[0].findings).toEqual([{ type: "open-port", port: 22 }]);
  });

  it("ignores progress messages without an id (safety guard)", () => {
    handlers["security:scan:progress"]({ progress: 50 });
    expect($security.getValue().scans).toEqual([]);
  });
});

describe("security:scan:complete", () => {
  it("marks the scan completed and clears activeScanId", () => {
    handlers["security:scan:progress"]({ id: "scan-1", progress: 50 });

    handlers["security:scan:complete"]({
      scanId: "scan-1",
      completedAt: 1700000000,
    });

    const sec = $security.getValue();
    const scan = sec.scans[0];
    expect(scan.status).toBe("completed");
    expect(scan.progress).toBe(100);
    expect(scan.phase).toBe("Complete");
    expect(scan.completedAt).toBe(1700000000);
    expect(sec.activeScanId).toBeNull();
  });

  it("falls back to payload.id when scanId is absent (legacy)", () => {
    handlers["security:scan:progress"]({ id: "scan-1", progress: 50 });
    handlers["security:scan:complete"]({ id: "scan-1", completedAt: 1 });
    expect($security.getValue().scans[0].status).toBe("completed");
  });

  it("is a no-op when the scan is not in the list", () => {
    expect(() => {
      handlers["security:scan:complete"]({ scanId: "ghost" });
    }).not.toThrow();
  });

  it("does NOT clear activeScanId if a different scan is active", () => {
    handlers["security:scan:progress"]({ id: "scan-1", progress: 50 });
    handlers["security:scan:progress"]({ id: "scan-2", progress: 50 });
    // Active is scan-2 (last created). Completing scan-1 must leave it alone.
    expect($security.getValue().activeScanId).toBe("scan-2");

    handlers["security:scan:complete"]({ scanId: "scan-1" });

    expect($security.getValue().activeScanId).toBe("scan-2");
  });
});

describe("security:scan:error", () => {
  it("marks the scan errored and surfaces the message", () => {
    handlers["security:scan:progress"]({ id: "scan-1", progress: 30 });

    handlers["security:scan:error"]({ scanId: "scan-1", message: "network unreachable" });

    const scan = $security.getValue().scans[0];
    expect(scan.status).toBe("error");
    expect(scan.error).toBe("network unreachable");
    expect($security.getValue().activeScanId).toBeNull();
  });
});

describe("security:scans:list", () => {
  it("replaces the list with DB history when no active scan", () => {
    handlers["security:scans:list"]({
      scans: [
        { id: "old-1", status: "completed", progress: 100 },
        { id: "old-2", status: "completed", progress: 100 },
      ],
    });

    expect($security.getValue().scans.map((s: { id: string }) => s.id)).toEqual(["old-1", "old-2"]);
  });

  it("preserves an in-progress active scan ahead of the historical list", () => {
    // Active scan running locally
    handlers["security:scan:progress"]({ id: "active-1", progress: 30 });

    // Server replies with historical scans (which may also include the active one)
    handlers["security:scans:list"]({
      scans: [
        { id: "active-1", status: "running", progress: 5 },  // older snapshot — must be dropped
        { id: "old-1", status: "completed", progress: 100 },
        { id: "old-2", status: "completed", progress: 100 },
      ],
    });

    const sec = $security.getValue();
    // Active scan should be first, and the duplicate `active-1` from the history filtered out.
    expect(sec.scans.map((s: { id: string }) => s.id)).toEqual(["active-1", "old-1", "old-2"]);
    // The active scan's progress should still be 30 (our local copy), not 5 (the stale server copy).
    expect(sec.scans[0].progress).toBe(30);
  });
});

describe("security:scan:deleted", () => {
  it("removes the matching scan", () => {
    handlers["security:scans:list"]({
      scans: [{ id: "s-1" }, { id: "s-2" }, { id: "s-3" }],
    });

    handlers["security:scan:deleted"]({ scanId: "s-2" });

    expect($security.getValue().scans.map((s: { id: string }) => s.id)).toEqual(["s-1", "s-3"]);
  });
});
