// "Sign in with Genie" (server sign-in) over real HTTP against the test DB.
// Google itself is not reachable from tests: google-auth-library's OAuth2Client
// is mocked, so generateAuthUrl records its options and the code exchange
// returns the userinfo registered for a code. Everything after that (state +
// cookie, user mapping, membership, assertion, audit) is the real code.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { isTestDbAvailable, setupTestDb, truncateAllTables, getTestDb } from "../test-helpers/db.js";
import { makeProject, makeUser, addProjectMember } from "../test-helpers/fixtures.js";
import { verifyWithJwks } from "../test-helpers/jws.js";
import { auditLog, users } from "../db/schema.js";
import type { VpsInstance } from "../types.js";

const google = vi.hoisted(() => ({
  userinfo: new Map<string, Record<string, unknown>>(),
  lastAuthOptions: null as null | Record<string, unknown>,
  lastRedirect: "" as string,
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    private code = "";
    constructor(_id: string, _secret: string, private redirect: string) {}
    generateAuthUrl(o: Record<string, unknown>) {
      google.lastAuthOptions = o;
      google.lastRedirect = this.redirect;
      return `https://accounts.google.test/o/oauth2/auth?state=${encodeURIComponent(String(o.state))}`;
    }
    async getToken(code: string) {
      if (!google.userinfo.has(code)) throw new Error("invalid_grant");
      return { tokens: { access_token: code } };
    }
    setCredentials(t: { access_token: string }) { this.code = t.access_token; }
    async request() { return { data: google.userinfo.get(this.code) }; }
  },
}));

const { handleVpsSsoRequest, VPS_SSO_COOKIE } = await import("./vps-sso.js");
const { clearVpsSsoKeyCache } = await import("../vps/vps-sso-keys.js");

const ISSUER = "https://manager.test";
const ORIGIN = "https://paul.cloud.example";
const RETURN = `${ORIGIN}/admin/api/auth/genie/callback`;
const NONCE = "n0nce-0123456789abcdefghijklmnopqrstuvwxyzAB"; // 43 chars, b64url alphabet

function instance(over: Partial<VpsInstance> = {}): VpsInstance {
  return {
    id: "inst-1",
    label: "prod",
    connection: { host: `10.0.0.${Math.floor(Math.random() * 200) + 1}`, port: 22, username: "genie", privateKeyPath: "" },
    services: [],
    domain: "paul.cloud.example",
    domainUrl: ORIGIN,
    ...over,
  };
}

describe.skipIf(!isTestDbAvailable())("Sign in with Genie (/auth/vps/start → /auth/callback)", () => {
  let server: http.Server;
  let base: string;
  let projectId: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GENIE_SECRET", "VPS_MANAGER_URL"]) saved[k] = process.env[k];
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    process.env.GENIE_SECRET = "test-genie-secret-for-vps-sso";
    process.env.VPS_MANAGER_URL = ISSUER;
    await setupTestDb();
    server = http.createServer(async (req, res) => {
      if (await handleVpsSsoRequest(req, res)) return;
      res.writeHead(404);
      res.end("fell through");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  beforeEach(async () => {
    await truncateAllTables();
    clearVpsSsoKeyCache();
    google.userinfo.clear();
    projectId = (await makeProject({ vps: [instance()] })).id;
  });

  const startUrl = (q: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const all = { project: projectId, instance: "inst-1", nonce: NONCE, return: RETURN, ...q };
    for (const [k, v] of Object.entries(all)) if (v !== undefined) params.set(k, v);
    return `${base}/auth/vps/start?${params}`;
  };
  const get = (url: string, cookie?: string) =>
    fetch(url, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });

  /** Start a sign-in; returns the state Google would echo and the browser cookie. */
  async function start(q: Record<string, string | undefined> = {}) {
    const r = await get(startUrl(q));
    expect(r.status).toBe(302);
    const location = r.headers.get("location")!;
    const state = new URL(location).searchParams.get("state")!;
    const setCookie = r.headers.get("set-cookie")!;
    return { r, state, cookie: setCookie.split(";")[0], setCookie, location };
  }

  function googleAccount(over: Record<string, unknown> = {}) {
    const code = `code-${randomUUID()}`;
    google.userinfo.set(code, { sub: `g-${randomUUID()}`, email: "Alice@Example.com", email_verified: true, name: "Alice", ...over });
    return code;
  }

  const callback = (state: string, code: string, cookie?: string) =>
    get(`${base}/auth/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`, cookie);

  async function audit(action: string) {
    return getTestDb().select().from(auditLog).where(eq(auditLog.action, action));
  }

  // ── /auth/vps/start validation ─────────────────────────────────────────────

  it("refuses an unknown instance, an instance of another project, a bad return host and a missing nonce", async () => {
    const other = await makeProject({ vps: [instance({ id: "inst-other" })] });
    const cases: [Record<string, string | undefined>, number][] = [
      [{ instance: "nope" }, 400],
      [{ instance: "inst-other" }, 400], // exists, but in another project
      [{ project: other.id }, 400], // inst-1 isn't in that project
      [{ project: "not-a-uuid" }, 400],
      [{ return: "https://evil.example/admin/api/auth/genie/callback" }, 400],
      [{ return: `${ORIGIN}/admin/somewhere-else` }, 400],
      [{ return: `${ORIGIN}/admin/api/auth/genie/callback?x=1` }, 400],
      [{ return: undefined }, 400],
      [{ nonce: undefined }, 400],
      [{ nonce: "short" }, 400],
      [{ nonce: "has spaces and = signs that are not base64url!!" }, 400],
    ];
    for (const [q, status] of cases) {
      const r = await get(startUrl(q));
      expect(r.status, JSON.stringify(q)).toBe(status);
      expect(r.headers.get("location")).toBeNull();
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("refuses until genie knows an origin for the instance, then accepts the SSO origin", async () => {
    const p = await makeProject({ vps: [instance({ id: "inst-bare", domain: undefined, domainUrl: undefined })] });
    const r = await get(startUrl({ project: p.id, instance: "inst-bare" }));
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("sign-in origin");

    const p2 = await makeProject({ vps: [instance({ id: "inst-sso", domain: undefined, domainUrl: undefined, ssoOrigin: "https://box.example.org" })] });
    const ok = await get(startUrl({ project: p2.id, instance: "inst-sso", return: "https://box.example.org/admin/api/auth/genie/callback" }));
    expect(ok.status).toBe(302);
  });

  it("redirects to Google with the shared redirect URI, a vps.* state and a matching HttpOnly cookie", async () => {
    const { state, setCookie, location, r } = await start();
    expect(location.startsWith("https://accounts.google.test/")).toBe(true);
    expect(state).toMatch(/^vps\.[A-Za-z0-9_-]{43}$/);
    expect(google.lastAuthOptions).toMatchObject({ state, scope: ["openid", "email", "profile"] });
    expect(google.lastRedirect).toMatch(/\/auth\/callback$/);
    expect(setCookie).toContain(`${VPS_SSO_COOKIE}=${state}`);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\/auth/);
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  });

  // ── after Google ──────────────────────────────────────────────────────────

  it("a project member gets an auto-posted assertion that verifies with the published JWKS", async () => {
    const alice = await makeUser({ email: "alice@example.com", googleId: "g-alice", name: "Alice" });
    await addProjectMember(projectId, alice.id, "member");
    const { state, cookie } = await start();
    const code = googleAccount({ sub: "g-alice" });

    const r = await callback(state, code, cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    const csp = r.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`form-action ${ORIGIN}`);
    expect(csp).toMatch(/script-src 'nonce-[^']+'/);
    expect(csp).not.toContain("unsafe-inline");
    expect(r.headers.get("set-cookie")).toMatch(new RegExp(`${VPS_SSO_COOKIE}=;.*Max-Age=0`));

    const html = await r.text();
    expect(html).toContain(`<form method="post" action="${RETURN}">`);
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    const assertion = html.match(/name="assertion" value="([^"]+)"/)![1];
    expect(assertion.split(".")).toHaveLength(3);

    const jwksRes = await get(`${base}/api/vps/sso/jwks`);
    expect(jwksRes.headers.get("cache-control")).toBe("public, max-age=300");
    const jwks = await jwksRes.json();
    expect(JSON.stringify(jwks)).not.toMatch(/"d"/);
    const claims = verifyWithJwks(assertion, jwks)!;
    expect(claims).not.toBeNull();
    expect(JSON.parse(Buffer.from(assertion.split(".")[0], "base64url").toString())).toEqual({ alg: "EdDSA", typ: "JWT", kid: jwks.keys[0].kid });
    expect(claims).toMatchObject({
      iss: ISSUER,
      aud: "genie-vps:inst-1",
      sub: alice.id,
      email: "alice@example.com",
      name: "Alice",
      project: projectId,
      nonce: NONCE,
    });
    expect(claims.exp).toBe((claims.iat as number) + 120);
    expect(Math.abs((claims.iat as number) - Date.now() / 1000)).toBeLessThan(5);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);

    const issued = await audit("auth:vps:assertion");
    expect(issued).toHaveLength(1);
    expect(issued[0].userId).toBe(alice.id);
    expect(issued[0].payload).toMatchObject({ projectId, instanceId: "inst-1", jti: claims.jti, returnHost: "paul.cloud.example" });
    expect(JSON.stringify(issued[0].payload)).not.toContain(assertion.split(".")[2]);
  });

  it("each sign-in gets its own jti; the state works once", async () => {
    const bob = await makeUser({ googleId: "g-bob" });
    await addProjectMember(projectId, bob.id);
    const a = await start();
    const b = await start();
    const r1 = await callback(a.state, googleAccount({ sub: "g-bob", email: bob.email }), a.cookie);
    const r2 = await callback(b.state, googleAccount({ sub: "g-bob", email: bob.email }), b.cookie);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const jtis = (await audit("auth:vps:assertion")).map((x) => (x.payload as { jti: string }).jti);
    expect(new Set(jtis).size).toBe(2);

    const replay = await callback(a.state, googleAccount({ sub: "g-bob", email: bob.email }), a.cookie);
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("expired");
  });

  it("a non-member gets a plain error page and an audit entry, no assertion", async () => {
    const carol = await makeUser({ googleId: "g-carol", name: "Carol" });
    const { state, cookie } = await start();
    const r = await callback(state, googleAccount({ sub: "g-carol", email: carol.email }), cookie);
    expect(r.status).toBe(403);
    const html = await r.text();
    expect(html).toContain("You&#39;re not a member of this server&#39;s project");
    expect(html).not.toContain("assertion");
    expect(r.headers.get("content-security-policy")).toContain("form-action 'none'");
    const denied = await audit("auth:vps:denied");
    expect(denied).toHaveLength(1);
    expect(denied[0].userId).toBe(carol.id);
    expect(denied[0].payload).toMatchObject({ projectId, instanceId: "inst-1", reason: "not_member" });
    expect(await audit("auth:vps:assertion")).toHaveLength(0);
  });

  it("an unknown Google account is refused without creating a genie user", async () => {
    const before = (await getTestDb().select().from(users)).length;
    const { state, cookie } = await start();
    const r = await callback(state, googleAccount({ sub: "g-stranger", email: "stranger@example.com" }), cookie);
    expect(r.status).toBe(403);
    expect((await getTestDb().select().from(users)).length).toBe(before);
    expect((await audit("auth:vps:denied"))[0].payload).toMatchObject({ reason: "no_genie_user", email: "stranger@example.com" });
  });

  it("an invited stub is hydrated (existing rules) and, as a member, signed in", async () => {
    const stub = await makeUser({ email: "dave@example.com", googleId: null, validated: false });
    await addProjectMember(projectId, stub.id);
    const { state, cookie } = await start();
    const r = await callback(state, googleAccount({ sub: "g-dave", email: "dave@example.com", name: "Dave" }), cookie);
    expect(r.status).toBe(200);
    const [row] = await getTestDb().select().from(users).where(eq(users.id, stub.id));
    expect(row).toMatchObject({ googleId: "g-dave", validated: true, name: "Dave" });
  });

  it("refuses an unvalidated user, an unverified Google email, a superadmin passes", async () => {
    const pending = await makeUser({ googleId: "g-pending", validated: false });
    await addProjectMember(projectId, pending.id);
    let s = await start();
    expect((await callback(s.state, googleAccount({ sub: "g-pending", email: pending.email }), s.cookie)).status).toBe(403);

    const eve = await makeUser({ googleId: "g-eve" });
    await addProjectMember(projectId, eve.id);
    s = await start();
    expect((await callback(s.state, googleAccount({ sub: "g-eve", email: eve.email, email_verified: false }), s.cookie)).status).toBe(403);

    const root = await makeUser({ googleId: "g-root", role: "superadmin" });
    s = await start();
    expect((await callback(s.state, googleAccount({ sub: "g-root", email: root.email }), s.cookie)).status).toBe(200);
  });

  it("CSRF: the callback needs the cookie of the browser that started it", async () => {
    const alice = await makeUser({ googleId: "g-alice2" });
    await addProjectMember(projectId, alice.id);
    const { state } = await start();
    const other = await start();
    expect((await callback(state, googleAccount({ sub: "g-alice2", email: alice.email }))).status).toBe(400);
    const s2 = await start();
    expect((await callback(s2.state, googleAccount({ sub: "g-alice2", email: alice.email }), other.cookie)).status).toBe(400);
    expect(await audit("auth:vps:assertion")).toHaveLength(0);
  });

  it("re-checks the return host after Google (origin removed meanwhile → refused)", async () => {
    const alice = await makeUser({ googleId: "g-alice3" });
    await addProjectMember(projectId, alice.id);
    const { state, cookie } = await start();
    const { updateVpsInstance } = await import("../projects/project-service.js");
    await updateVpsInstance(projectId, "inst-1", { domain: "moved.example", domainUrl: "https://moved.example" });
    expect((await callback(state, googleAccount({ sub: "g-alice3", email: alice.email }), cookie)).status).toBe(400);
  });

  it("a Google error or a failed exchange ends with an error page", async () => {
    let s = await start();
    expect((await get(`${base}/auth/callback?state=${encodeURIComponent(s.state)}&error=access_denied`, s.cookie)).status).toBe(400);
    s = await start();
    expect((await callback(s.state, "unknown-code", s.cookie)).status).toBe(502);
  });

  it("leaves the genie sign-in's /auth/callback alone (no vps.* state)", async () => {
    expect((await get(`${base}/auth/callback?code=abc`)).status).toBe(404);
    expect((await get(`${base}/auth/callback?code=abc&state=other`)).status).toBe(404);
  });
});
