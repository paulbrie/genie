import { describe, it, expect } from "vitest";
import { allowedSsoReturnHosts, checkSsoReturnUrl, instancePublicOrigin, normalizeSsoOrigin } from "./vps-sso-origin.js";

describe("normalizeSsoOrigin", () => {
  it("accepts https origins and bare hosts, lowercased, default port dropped", () => {
    expect(normalizeSsoOrigin("https://Paul.Cloud.TeleportHQ.ai")).toBe("https://paul.cloud.teleporthq.ai");
    expect(normalizeSsoOrigin(" paul.cloud.teleporthq.ai/ ")).toBe("https://paul.cloud.teleporthq.ai");
    expect(normalizeSsoOrigin("https://box.example.com:443")).toBe("https://box.example.com");
    expect(normalizeSsoOrigin("https://box.example.com:8443")).toBe("https://box.example.com:8443");
  });

  it("refuses anything that isn't just an https origin", () => {
    for (const bad of [
      "", "http://box.example.com", "https://user:pw@box.example.com", "https://box.example.com/admin",
      "https://box.example.com/?x=1", "https://box.example.com#a", "javascript:alert(1)", "https://",
    ]) {
      expect(() => normalizeSsoOrigin(bad), bad).toThrow();
    }
  });
});

describe("allowed hosts and the public origin", () => {
  it("come from the domain, domainUrl and ssoOrigin genie stores", () => {
    expect([...allowedSsoReturnHosts({})]).toEqual([]);
    expect([...allowedSsoReturnHosts({ domain: "a.example.com", domainUrl: "https://a.example.com" })]).toEqual(["a.example.com"]);
    expect([...allowedSsoReturnHosts({ ssoOrigin: "https://b.example.com:8443", domain: "a.example.com" })].sort())
      .toEqual(["a.example.com", "b.example.com:8443"]);
    expect(instancePublicOrigin({})).toBeNull();
    expect(instancePublicOrigin({ domain: "a.example.com" })).toBe("https://a.example.com");
    expect(instancePublicOrigin({ domain: "a.example.com", ssoOrigin: "https://b.example.com" })).toBe("https://b.example.com");
  });
});

describe("checkSsoReturnUrl", () => {
  const inst = { domain: "paul.cloud.teleporthq.ai" };
  const good = "https://paul.cloud.teleporthq.ai/admin/api/auth/genie/callback";

  it("accepts the callback on a known host, under any basePath", () => {
    expect(checkSsoReturnUrl(good, inst)).toEqual({ ok: true, url: good, origin: "https://paul.cloud.teleporthq.ai" });
    expect(checkSsoReturnUrl("https://PAUL.cloud.teleporthq.ai/api/auth/genie/callback", inst).ok).toBe(true);
  });

  it("refuses other hosts, schemes, paths, queries and credentials", () => {
    const cases: [string | null, Record<string, string>, string][] = [
      [null, inst, "missing return"],
      ["not a url", inst, "bad return"],
      [good, {}, "no origin"],
      ["https://evil.example/admin/api/auth/genie/callback", inst, "return host"],
      ["https://paul.cloud.teleporthq.ai.evil.example/admin/api/auth/genie/callback", inst, "return host"],
      ["https://paul.cloud.teleporthq.ai:8443/admin/api/auth/genie/callback", inst, "return host"],
      ["http://paul.cloud.teleporthq.ai/admin/api/auth/genie/callback", inst, "return not https"],
      ["https://x@paul.cloud.teleporthq.ai/admin/api/auth/genie/callback", inst, "return has credentials"],
      [`${good}?next=https://evil.example`, inst, "return has query"],
      [`${good}#x`, inst, "return has query"],
      ["https://paul.cloud.teleporthq.ai/admin/login", inst, "return path"],
      ["https://paul.cloud.teleporthq.ai/admin/api/auth/genie/callback/../../../steal", inst, "return path"],
    ];
    for (const [raw, i, reason] of cases) {
      expect(checkSsoReturnUrl(raw, i), String(raw)).toEqual({ ok: false, reason });
    }
  });
});
