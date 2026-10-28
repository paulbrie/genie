// admin:vps-activity:summary is superadmin-only (ACL override + in-handler
// gate) and clamps its inputs before querying. The service is mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import type { ClientState } from "../ws-server.js";

const { getActivitySummary } = vi.hoisted(() => ({
  getActivitySummary: vi.fn(async (from: Date) => ({ since: from.toISOString() })),
}));
vi.mock("../vps/vps-activity-service.js", () => ({ getActivitySummary }));
vi.mock("../logging/analytics-service.js", () => ({}));

import { handleAnalyticsMessage } from "./analytics-handler.js";
import { canSend, canReceive } from "../auth/ws-acl.js";

const ws = {} as WebSocket;
let sent: WsMessage[];
const send = (_ws: WebSocket, m: WsMessage) => { sent.push(m); };
const ask = (role: ClientState["role"], payload: unknown) =>
  handleAnalyticsMessage(ws, { type: "admin:vps-activity:summary", payload } as WsMessage, send, { role, userId: "u" } as ClientState);

beforeEach(() => {
  sent = [];
  vi.clearAllMocks();
});

describe("admin:vps-activity:summary", () => {
  it("is superadmin-only in the ACL", () => {
    expect(canSend("admin", "admin:vps-activity:summary")).toBe(false);
    expect(canReceive("admin", "admin:vps-activity:summary")).toBe(false);
    expect(canSend("superadmin", "admin:vps-activity:summary")).toBe(true);
    expect(canReceive("superadmin", "admin:vps-activity:summary")).toBe(true);
  });

  it("refuses an admin in the handler too", async () => {
    expect(await ask("admin", {})).toBe(true);
    expect(sent.map((m) => m.type)).toEqual(["admin:error"]);
    expect(getActivitySummary).not.toHaveBeenCalled();
  });

  it("clamps days and passes the filters through", async () => {
    await ask("superadmin", { days: 9999, projectId: "p", instanceId: "i" });
    expect(sent[0].type).toBe("admin:vps-activity:summary");
    expect(sent[0].payload).toMatchObject({ days: 180, projectId: "p", instanceId: "i" });
    const [from, filters] = getActivitySummary.mock.calls[0] as unknown as [Date, unknown];
    expect(Date.now() - from.getTime()).toBeGreaterThanOrEqual(180 * 86_400_000 - 1000);
    expect(filters).toEqual({ projectId: "p", instanceId: "i" });

    sent = [];
    await ask("superadmin", { days: "x", projectId: "" });
    expect(sent[0].payload).toMatchObject({ days: 7, projectId: null, instanceId: null });
  });

  it("reports a query failure on the summary message", async () => {
    getActivitySummary.mockRejectedValueOnce(new Error("db down"));
    await ask("superadmin", {});
    expect(sent[0]).toMatchObject({ type: "admin:vps-activity:summary", payload: { summary: null, error: "db down" } });
  });
});
