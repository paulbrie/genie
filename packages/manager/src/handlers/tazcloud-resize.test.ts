import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WebSocket } from "ws";
import type { WsMessage } from "../types.js";

// A fake Taz client: the handler must never reach the real API from tests.
const fakeClient = {
  getCapabilities: vi.fn(),
  resizeVm: vi.fn(),
};
vi.mock("../vps/tazcloud-api-client.js", async () => {
  const actual = await vi.importActual<typeof import("../vps/tazcloud-api-client.js")>("../vps/tazcloud-api-client.js");
  return { ...actual, createTazClient: vi.fn(() => fakeClient) };
});

import { handleTazcloudMessage } from "./tazcloud-handler.js";

const ws = {} as WebSocket;
let sent: WsMessage[];
let broadcasts: WsMessage[];
const send = (_ws: WebSocket, m: WsMessage) => { sent.push(m); };
const broadcast = (m: WsMessage) => { broadcasts.push(m); };
const resize = (payload: unknown) =>
  handleTazcloudMessage(ws, { type: "admin:tazcloud:resize", payload } as WsMessage, send, "user-1", "tazcloud", broadcast);
const types = () => sent.map((m) => m.type);

let savedToken: string | undefined;
beforeEach(() => {
  sent = [];
  broadcasts = [];
  vi.clearAllMocks();
  savedToken = process.env.TAZCLOUD_API_TOKEN;
  process.env.TAZCLOUD_API_TOKEN = "dummy-token";
  fakeClient.getCapabilities.mockResolvedValue({ images: [], sizes: ["small", "medium", "large", "xlarge", "2xlarge"], created: "" });
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.TAZCLOUD_API_TOKEN;
  else process.env.TAZCLOUD_API_TOKEN = savedToken;
  vi.useRealTimers();
});

describe("admin:tazcloud:resize", () => {
  it("resizes, streams progress, then :done with the new size and marks the list stale", async () => {
    fakeClient.resizeVm.mockResolvedValue({ status: "resized", id: "vm-1", size: "2xlarge" });
    expect(await resize({ vmId: "vm-1", size: "2xlarge" })).toBe(true);

    await vi.waitFor(() => expect(types()).toContain("admin:tazcloud:resize:done"));
    expect(fakeClient.resizeVm).toHaveBeenCalledWith("vm-1", "2xlarge");
    expect(types()[0]).toBe("admin:tazcloud:resize:progress");
    expect(sent.at(-1)).toEqual({ type: "admin:tazcloud:resize:done", payload: { vmId: "vm-1", size: "2xlarge", status: "resized" } });
    expect(broadcasts).toEqual([{ type: "admin:tazcloud:list:stale", payload: {} }]);
  });

  it("ticks progress every 10 s while the blocking call runs", async () => {
    vi.useFakeTimers();
    let finish!: (v: unknown) => void;
    fakeClient.resizeVm.mockReturnValue(new Promise((r) => { finish = r; }));
    await resize({ vmId: "vm-1", size: "xlarge" });
    await vi.advanceTimersByTimeAsync(25_000);
    const ticks = sent.filter((m) => m.type === "admin:tazcloud:resize:progress" && String(m.payload.message).startsWith("Still resizing"));
    expect(ticks.length).toBe(2);
    finish({ status: "resized", id: "vm-1", size: "xlarge" });
    await vi.advanceTimersByTimeAsync(0);
    expect(types()).toContain("admin:tazcloud:resize:done");
    // No ticks after it's done.
    const before = sent.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent.length).toBe(before);
  });

  it("rejects a size the deployment doesn't offer, without resizing", async () => {
    await resize({ vmId: "vm-1", size: "huge" });
    await vi.waitFor(() => expect(types()).toContain("admin:tazcloud:resize:error"));
    expect(fakeClient.resizeVm).not.toHaveBeenCalled();
    expect(String(sent.at(-1)?.payload.message)).toContain('Unknown size "huge"');
  });

  it("reports API failures as :error and leaves the list alone", async () => {
    fakeClient.resizeVm.mockRejectedValue(new Error("TazCloud API error (409): VM is busy"));
    await resize({ vmId: "vm-1", size: "xlarge" });
    await vi.waitFor(() => expect(types()).toContain("admin:tazcloud:resize:error"));
    expect(sent.at(-1)?.payload).toMatchObject({ vmId: "vm-1", size: "xlarge", message: "TazCloud API error (409): VM is busy" });
    expect(broadcasts).toEqual([]);
  });

  it.each([
    [{ size: "xlarge" }, "vmId is required"],
    [{ vmId: "vm-1" }, "A valid size is required"],
    [{ vmId: "vm-1", size: "x large; rm" }, "A valid size is required"],
  ])("validates the payload %j", async (payload, message) => {
    await resize(payload);
    expect(sent).toEqual([{ type: "admin:tazcloud:resize:error", payload: { ...payload, message } }]);
    expect(fakeClient.resizeVm).not.toHaveBeenCalled();
  });

  it("errors when the manager has no TazCloud token", async () => {
    delete process.env.TAZCLOUD_API_TOKEN;
    await resize({ vmId: "vm-1", size: "xlarge" });
    expect(sent.at(-1)?.payload.message).toBe("TAZCLOUD_API_TOKEN not configured");
    expect(fakeClient.resizeVm).not.toHaveBeenCalled();
  });
});
