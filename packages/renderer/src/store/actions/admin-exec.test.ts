// Tests for the exec round-trip: action creates pending Promise + sends WS
// message; matching :progress / :result handlers stream chunks + resolve.
// Exercises both halves of the contract in one place.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("@/lib/ws", () => ({ wsSend: vi.fn() }));

import { adminTazcloudExec, adminDropletExec } from "./admin";
import { wsSend } from "@/lib/ws";
import { handlers } from "../handlers/admin";

// Stable execIds so we can route :progress / :result back to the right
// pending Promise.
let execIdCounter = 0;
beforeEach(() => {
  execIdCounter = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `exec-${++execIdCounter}` as `${string}-${string}-${string}-${string}-${string}`);
  vi.mocked(wsSend).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("adminTazcloudExec — happy path", () => {
  it("sends the WS message, streams progress, resolves on :result", async () => {
    const chunks: string[] = [];
    const promise = adminTazcloudExec("vm-1", "ubuntu", "uname -a", "::1", (c) => chunks.push(c));

    // Action should have emitted the WS message immediately.
    expect(wsSend).toHaveBeenCalledExactlyOnceWith("admin:tazcloud:exec", {
      vmId: "vm-1",
      sshUser: "ubuntu",
      host: "::1",
      command: "uname -a",
      execId: "exec-1",
    });

    // Simulate the manager pushing partial output…
    handlers["admin:tazcloud:exec:progress"]({ execId: "exec-1", chunk: "Linux " });
    handlers["admin:tazcloud:exec:progress"]({ execId: "exec-1", chunk: "host 6.8.0\n" });
    expect(chunks).toEqual(["Linux ", "host 6.8.0\n"]);

    // …and the final result.
    handlers["admin:tazcloud:exec:result"]({
      execId: "exec-1",
      output: "Linux host 6.8.0\n",
      error: false,
    });

    await expect(promise).resolves.toEqual({
      output: "Linux host 6.8.0\n",
      error: false,
    });
  });
});

describe("adminTazcloudExec — error path", () => {
  it("propagates error=true when the manager reports an SSH failure", async () => {
    const promise = adminTazcloudExec("vm-1", "ubuntu", "boom");

    handlers["admin:tazcloud:exec:result"]({
      execId: "exec-1",
      output: "SSH connection failed: ENETUNREACH",
      error: true,
    });

    await expect(promise).resolves.toEqual({
      output: "SSH connection failed: ENETUNREACH",
      error: true,
    });
  });
});

describe("adminTazcloudExec — timeout", () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }); });
  afterEach(() => { vi.useRealTimers(); });

  it("resolves with error after 15 minutes of silence", async () => {
    const promise = adminTazcloudExec("vm-1", "ubuntu", "sleep 1h");

    // Fast-forward past the 900_000 ms timeout.
    await vi.advanceTimersByTimeAsync(900_001);

    await expect(promise).resolves.toEqual({
      output: "Command timed out",
      error: true,
    });
  });

  it("returns partial output collected before the timeout", async () => {
    const chunks: string[] = [];
    const promise = adminTazcloudExec("vm-1", "ubuntu", "noisy", undefined, (c) => chunks.push(c));

    handlers["admin:tazcloud:exec:progress"]({ execId: "exec-1", chunk: "step 1\n" });
    await vi.advanceTimersByTimeAsync(900_001);

    await expect(promise).resolves.toEqual({
      output: "step 1\n",   // pending.output was accumulated before timeout
      error: true,
    });
    expect(chunks).toEqual(["step 1\n"]);
  });
});

describe("adminTazcloudExec — concurrent execs", () => {
  it("two simultaneous calls route to their own resolves", async () => {
    const p1 = adminTazcloudExec("vm-a", "ubuntu", "cmd-a");
    const p2 = adminTazcloudExec("vm-b", "ubuntu", "cmd-b");

    // The second call should have its own execId.
    expect(wsSend).toHaveBeenCalledTimes(2);
    const sentExecIds = (wsSend as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[1] as { execId: string }).execId,
    );
    expect(sentExecIds).toEqual(["exec-1", "exec-2"]);

    // Resolve in reverse order — must still resolve the right Promise.
    handlers["admin:tazcloud:exec:result"]({ execId: "exec-2", output: "B", error: false });
    handlers["admin:tazcloud:exec:result"]({ execId: "exec-1", output: "A", error: false });

    await expect(p1).resolves.toMatchObject({ output: "A" });
    await expect(p2).resolves.toMatchObject({ output: "B" });
  });

  it(":progress for an unknown execId is silently dropped", () => {
    // Don't open any execs — handlers for an unknown id must be a no-op.
    expect(() => {
      handlers["admin:tazcloud:exec:progress"]({ execId: "ghost", chunk: "x" });
    }).not.toThrow();
  });
});

describe("adminTazcloudExec — cancellation via AbortSignal", () => {
  it("sends admin:exec:cancel when the signal aborts while in flight", async () => {
    const controller = new AbortController();
    const promise = adminTazcloudExec("vm-1", "ubuntu", "long-install", undefined, undefined, controller.signal);

    // The initial exec call.
    expect(wsSend).toHaveBeenNthCalledWith(1, "admin:tazcloud:exec", expect.objectContaining({ execId: "exec-1" }));

    controller.abort();
    expect(wsSend).toHaveBeenNthCalledWith(2, "admin:exec:cancel", { execId: "exec-1" });

    // Manager replies with a cancellation result, which still resolves the promise.
    handlers["admin:tazcloud:exec:result"]({ execId: "exec-1", output: "Cancelled", error: true });
    await expect(promise).resolves.toEqual({ output: "Cancelled", error: true });
  });

  it("does not send a cancel after the result has already arrived", async () => {
    const controller = new AbortController();
    const promise = adminTazcloudExec("vm-1", "ubuntu", "fast", undefined, undefined, controller.signal);

    handlers["admin:tazcloud:exec:result"]({ execId: "exec-1", output: "done", error: false });
    await promise;

    // Aborting after :result has arrived should be a no-op — the pending entry
    // is already gone, so we mustn't send a stray cancel.
    const beforeAbort = (wsSend as ReturnType<typeof vi.fn>).mock.calls.length;
    controller.abort();
    expect((wsSend as ReturnType<typeof vi.fn>).mock.calls.length).toBe(beforeAbort);
  });

  it("sends cancel immediately if the signal is already aborted at call time", () => {
    const controller = new AbortController();
    controller.abort();
    adminTazcloudExec("vm-1", "ubuntu", "noop", undefined, undefined, controller.signal);

    expect(wsSend).toHaveBeenCalledTimes(2);
    expect(wsSend).toHaveBeenNthCalledWith(2, "admin:exec:cancel", { execId: "exec-1" });
  });
});

describe("adminDropletExec — same flow, different message type", () => {
  it("sends admin:droplets:exec and resolves on the matching :result", async () => {
    const promise = adminDropletExec(42, "ls /");

    expect(wsSend).toHaveBeenCalledExactlyOnceWith("admin:droplets:exec", {
      dropletId: 42, command: "ls /", execId: "exec-1",
    });

    handlers["admin:droplets:exec:result"]({
      execId: "exec-1", output: "bin etc usr\n", error: false,
    });

    await expect(promise).resolves.toEqual({ output: "bin etc usr\n", error: false });
  });
});
