// genie-local activity dashboard: the load action (filters, instance reset on
// project change), the summary handler, and admin:error clearing the spinner.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/ws", () => ({
  wsSend: vi.fn(),
  wsRequest: vi.fn(),
  onWsClose: vi.fn(),
}));

import { loadVpsActivitySummary, setAnalyticsView } from "./admin";
import { handlers } from "../handlers/admin";
import { $admin } from "../subjects/admin";
import { wsSend } from "@/lib/ws";

beforeEach(() => {
  const v = $admin.getValue();
  v.vpsActivity = { summary: null, days: 7, loading: false, error: null, filterProjectId: null, filterInstanceId: null };
  v.analytics.view = "product";
  vi.mocked(wsSend).mockClear();
});

describe("loadVpsActivitySummary", () => {
  it("sends the current range and filters and marks loading", () => {
    loadVpsActivitySummary({ days: 30 });
    expect($admin.getValue().vpsActivity.loading).toBe(true);
    expect(wsSend).toHaveBeenCalledExactlyOnceWith("admin:vps-activity:summary", { days: 30, projectId: null, instanceId: null });
  });

  it("a project change drops the instance filter; same project keeps it", () => {
    loadVpsActivitySummary({ projectId: "p1", instanceId: "i1" });
    expect(wsSend).toHaveBeenLastCalledWith("admin:vps-activity:summary", { days: 7, projectId: "p1", instanceId: "i1" });
    loadVpsActivitySummary({ projectId: "p1" });
    expect(wsSend).toHaveBeenLastCalledWith("admin:vps-activity:summary", { days: 7, projectId: "p1", instanceId: "i1" });
    loadVpsActivitySummary({ projectId: "p2" });
    expect(wsSend).toHaveBeenLastCalledWith("admin:vps-activity:summary", { days: 7, projectId: "p2", instanceId: null });
  });
});

describe("admin:vps-activity:summary handler", () => {
  it("stores the summary and echoes the filters", () => {
    $admin.getValue().vpsActivity.loading = true;
    const summary = { since: "x", totals: { events: 1 } };
    handlers["admin:vps-activity:summary"]({ summary, days: 30, projectId: "p", instanceId: "i" });
    const a = $admin.getValue().vpsActivity;
    expect(a).toMatchObject({ summary, days: 30, filterProjectId: "p", filterInstanceId: "i", loading: false, error: null });
  });

  it("keeps the error when the query failed", () => {
    handlers["admin:vps-activity:summary"]({ summary: null, days: 7, projectId: null, instanceId: null, error: "db down" });
    expect($admin.getValue().vpsActivity).toMatchObject({ summary: null, error: "db down", loading: false });
  });

  it("admin:error stops the spinner (e.g. not a superadmin)", () => {
    $admin.getValue().vpsActivity.loading = true;
    handlers["admin:error"]({ message: "Superadmin access required" });
    expect($admin.getValue().vpsActivity.loading).toBe(false);
  });
});

describe("setAnalyticsView", () => {
  it("switches the Analytics tab section", () => {
    setAnalyticsView("genie-local");
    expect($admin.getValue().analytics.view).toBe("genie-local");
  });
});
