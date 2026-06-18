// Per-host SSH handshake gate — the protection against tripping a target VM's
// sshd MaxStartups with a burst of concurrent dials. The dial fn is faked so we
// can assert concurrency capping, slot transfer, per-host isolation, and the
// reset-class retry without any real SSH.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  withHandshakeGate,
  isHandshakeReset,
  MAX_HANDSHAKES_PER_HOST,
  HANDSHAKE_RETRIES,
  __test,
} from "./ssh-handshake-gate.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  __test.reset();
  __test.setWakeJitter(0, 0);          // deterministic wakes (setTimeout 0)
  __test.setRetryBackoffEnabled(false); // no real backoff waits
});

describe("concurrency cap", () => {
  it("never runs more than MAX_HANDSHAKES_PER_HOST dials at once for a host", async () => {
    let live = 0;
    let maxLive = 0;
    const finishers: (() => void)[] = [];
    const gated = () =>
      withHandshakeGate("vmA:22", () => {
        live++;
        maxLive = Math.max(maxLive, live);
        return new Promise<void>((resolve) => finishers.push(() => { live--; resolve(); }));
      });

    const N = MAX_HANDSHAKES_PER_HOST + 3;
    const ps = Array.from({ length: N }, gated);
    await flush();

    // Only the cap is in flight; the rest are queued.
    expect(live).toBe(MAX_HANDSHAKES_PER_HOST);
    expect(__test.stats("vmA:22")).toEqual({ active: MAX_HANDSHAKES_PER_HOST, queued: N - MAX_HANDSHAKES_PER_HOST });

    // Drain: finishing one promotes exactly one waiter (slot transfer), never
    // exceeding the cap.
    while (finishers.length) {
      finishers.shift()!();
      await flush();
      expect(live).toBeLessThanOrEqual(MAX_HANDSHAKES_PER_HOST);
    }
    await Promise.all(ps);
    expect(maxLive).toBe(MAX_HANDSHAKES_PER_HOST);
    expect(__test.stats("vmA:22")).toEqual({ active: 0, queued: 0 });
  });

  it("caps per target host independently", async () => {
    let live = 0;
    let maxLive = 0;
    const finishers: (() => void)[] = [];
    const gated = (key: string) =>
      withHandshakeGate(key, () => {
        live++;
        maxLive = Math.max(maxLive, live);
        return new Promise<void>((resolve) => finishers.push(() => { live--; resolve(); }));
      });

    // MAX on each of two hosts → all 2×MAX run concurrently (separate daemons).
    const ps = [
      ...Array.from({ length: MAX_HANDSHAKES_PER_HOST }, () => gated("vmA:22")),
      ...Array.from({ length: MAX_HANDSHAKES_PER_HOST }, () => gated("vmB:22")),
    ];
    await flush();
    expect(live).toBe(2 * MAX_HANDSHAKES_PER_HOST);

    while (finishers.length) { finishers.shift()!(); await flush(); }
    await Promise.all(ps);
    expect(maxLive).toBe(2 * MAX_HANDSHAKES_PER_HOST);
  });
});

describe("retry on banner-less reset", () => {
  it("retries a reset-class drop with backoff, then succeeds", async () => {
    let calls = 0;
    const result = await withHandshakeGate("vmA:22", () => {
      calls++;
      if (calls <= 2) return Promise.reject(new Error("read ECONNRESET"));
      return Promise.resolve("connected");
    });
    expect(result).toBe("connected");
    expect(calls).toBe(3); // 1 + 2 retries
    expect(__test.stats("vmA:22")).toEqual({ active: 0, queued: 0 }); // slot released each time
  });

  it("gives up after HANDSHAKE_RETRIES and surfaces the error", async () => {
    let calls = 0;
    await expect(
      withHandshakeGate("vmA:22", () => { calls++; return Promise.reject(new Error("Connection reset by peer")); }),
    ).rejects.toThrow(/reset by peer/);
    expect(calls).toBe(1 + HANDSHAKE_RETRIES);
  });

  it("does NOT retry an auth failure (wrong key/user)", async () => {
    let calls = 0;
    await expect(
      withHandshakeGate("vmA:22", () => { calls++; return Promise.reject(new Error("All authentication methods failed")); }),
    ).rejects.toThrow(/authentication/);
    expect(calls).toBe(1);
  });

  it("does NOT retry connection-refused (VM down — caller's loop owns it)", async () => {
    let calls = 0;
    await expect(
      withHandshakeGate("vmA:22", () => { calls++; return Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1:22")); }),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect(calls).toBe(1);
  });

  it("honours retries:0 for fast-fail callers even on a reset", async () => {
    let calls = 0;
    await expect(
      withHandshakeGate("vmA:22", () => { calls++; return Promise.reject(new Error("read ECONNRESET")); }, { retries: 0 }),
    ).rejects.toThrow(/ECONNRESET/);
    expect(calls).toBe(1);
  });

  it("releases the slot after a terminal failure (no leak)", async () => {
    await expect(
      withHandshakeGate("vmA:22", () => Promise.reject(new Error("All authentication methods failed")), { retries: 0 }),
    ).rejects.toThrow();
    expect(__test.stats("vmA:22")).toEqual({ active: 0, queued: 0 });
  });
});

describe("isHandshakeReset classifier", () => {
  it.each([
    ["read ECONNRESET", true],
    ["Connection reset by peer", true],
    ["Connection closed before handshake completed", true],
    ["socket hang up", true],
    ["write EPIPE", true],
    ["All authentication methods failed", false],
    ["connect ECONNREFUSED 10.0.0.1:22", false],
    ["Timed out while waiting for handshake", false],
  ])("%s → %s", (msg, expected) => {
    expect(isHandshakeReset(new Error(msg))).toBe(expected);
  });

  it("handles non-Error inputs", () => {
    expect(isHandshakeReset("ECONNRESET")).toBe(true);
    expect(isHandshakeReset(null)).toBe(false);
  });
});
