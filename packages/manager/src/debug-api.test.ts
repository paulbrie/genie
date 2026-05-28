import { describe, it, expect, afterEach } from "vitest";
import type http from "node:http";
import { _debugApiTest } from "./debug-api.js";

describe("debug-api", () => {
  const origSecret = process.env.GENIE_DEBUG_SECRET;

  afterEach(() => {
    if (origSecret === undefined) delete process.env.GENIE_DEBUG_SECRET;
    else process.env.GENIE_DEBUG_SECRET = origSecret;
  });

  it("parseSource accepts errors, manager, all", () => {
    expect(_debugApiTest.parseSource(null)).toBe("errors");
    expect(_debugApiTest.parseSource("all")).toBe("all");
    expect(_debugApiTest.parseSource("nope")).toBeNull();
  });

  it("tailText returns suffix when tail is set", () => {
    expect(_debugApiTest.tailText("abcdef", 3)).toBe("def");
    expect(_debugApiTest.tailText("ab", 10)).toBe("ab");
  });

  it("authorizeDebugAccess accepts GENIE_DEBUG_SECRET header", async () => {
    process.env.GENIE_DEBUG_SECRET = "test-debug-key";
    const req = { headers: { "x-genie-debug-key": "test-debug-key" } } as unknown as http.IncomingMessage;
    const result = await _debugApiTest.authorizeDebugAccess(req);
    expect(result).toEqual({ ok: true });
  });

  it("authorizeDebugAccess rejects missing auth", async () => {
    delete process.env.GENIE_DEBUG_SECRET;
    const req = { headers: {} } as unknown as http.IncomingMessage;
    const result = await _debugApiTest.authorizeDebugAccess(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });
});
