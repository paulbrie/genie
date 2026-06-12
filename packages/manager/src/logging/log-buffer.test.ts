import { describe, it, expect, beforeEach } from "vitest";
import { LogBuffer } from "./log-buffer.js";

describe("LogBuffer", () => {
  let buf: LogBuffer;

  beforeEach(() => {
    buf = new LogBuffer();
  });

  it("returns empty string for unknown keys", () => {
    expect(buf.get("nope")).toBe("");
  });

  it("appends and reads back per-key data", () => {
    buf.append("a", "hello");
    buf.append("a", " world");
    buf.append("b", "other");
    expect(buf.get("a")).toBe("hello world");
    expect(buf.get("b")).toBe("other");
  });

  it("trims to the last 50,000 bytes when the buffer would overflow", () => {
    const big = "x".repeat(60_000);
    buf.append("k", big);
    expect(buf.get("k").length).toBe(50_000);
    expect(buf.get("k").endsWith("x")).toBe(true);
  });

  it("preserves the tail across multiple appends that push past the cap", () => {
    buf.append("k", "x".repeat(40_000));
    buf.append("k", "y".repeat(20_000));
    const stored = buf.get("k");
    expect(stored.length).toBe(50_000);
    // The 20k of 'y' must all survive — it's newer than the 'x' tail.
    expect(stored.endsWith("y".repeat(20_000))).toBe(true);
    // 30k of 'x' should remain at the head (50k - 20k = 30k of x).
    expect(stored.startsWith("x".repeat(30_000))).toBe(true);
  });

  it("getAll() returns only non-empty buffers, keyed by name", () => {
    buf.append("a", "one");
    buf.append("b", "");
    buf.append("c", "two");
    const all = buf.getAll();
    expect(all).toEqual({ a: "one", c: "two" });
  });
});
