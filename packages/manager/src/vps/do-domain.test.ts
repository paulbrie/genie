import { describe, it, expect } from "vitest";
import { deriveHost } from "./do-domain.js";

describe("deriveHost", () => {
  it("derives a single-label subdomain", () => {
    expect(deriveHost("app.example.com", "example.com")).toBe("app");
  });

  it("derives a multi-label subdomain", () => {
    expect(deriveHost("a.b.example.com", "example.com")).toBe("a.b");
  });

  it("maps the apex to '@'", () => {
    expect(deriveHost("example.com", "example.com")).toBe("@");
  });

  it("is case-insensitive and tolerates a trailing dot", () => {
    expect(deriveHost("APP.Example.com.", "example.com")).toBe("app");
    expect(deriveHost("EXAMPLE.COM", "example.com")).toBe("@");
  });

  it("rejects an FQDN that isn't under the managed domain", () => {
    expect(() => deriveHost("app.other.com", "example.com")).toThrow(/not a subdomain/i);
  });

  it("rejects a suffix-only near-match (no dot boundary)", () => {
    // "notexample.com" ends with "example.com" but isn't a subdomain of it.
    expect(() => deriveHost("notexample.com", "example.com")).toThrow(/not a subdomain/i);
  });
});
