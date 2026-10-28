// "Sign in with Genie" signing keys against the test DB: generated on first
// need, private half encrypted at rest, the JWKS carries only public halves,
// signatures verify with the JWKS, and rotation keeps old keys verifying for
// the grace period only.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { isTestDbAvailable, setupTestDb, truncateAllTables, getTestDb } from "../test-helpers/db.js";
import { vpsSsoKeys } from "../db/schema.js";
import { verifyWithJwks } from "../test-helpers/jws.js";
import {
  clearVpsSsoKeyCache,
  getVpsSsoJwks,
  getVpsSsoSigningKey,
  isVpsSsoAvailable,
  pruneExpiredVpsSsoKeys,
  rotateVpsSsoSigningKey,
  signVpsSsoAssertion,
} from "./vps-sso-keys.js";

describe.skipIf(!isTestDbAvailable())("vps-sso-keys", () => {
  const prevSecret = process.env.GENIE_SECRET;
  beforeAll(async () => {
    process.env.GENIE_SECRET = "test-genie-secret-for-vps-sso";
    await setupTestDb();
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.GENIE_SECRET;
    else process.env.GENIE_SECRET = prevSecret;
  });
  beforeEach(async () => {
    await truncateAllTables();
    clearVpsSsoKeyCache();
  });

  it("generates one key on first need and reuses it", async () => {
    expect(isVpsSsoAvailable()).toBe(true);
    expect((await getVpsSsoJwks()).keys).toEqual([]);
    const a = await getVpsSsoSigningKey();
    const b = await getVpsSsoSigningKey();
    expect(b.kid).toBe(a.kid);
    expect(a.kid).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(await getTestDb().select().from(vpsSsoKeys)).toHaveLength(1);
  });

  it("stores the private key encrypted, never as PEM, and decrypts it after a cache flush", async () => {
    const { kid, privateKey } = await getVpsSsoSigningKey();
    const [row] = await getTestDb().select().from(vpsSsoKeys);
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const d = privateKey.export({ format: "jwk" }).d as string;
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("PRIVATE KEY");
    expect(stored).not.toContain(pem.split("\n")[1]);
    expect(stored).not.toContain(d);
    expect(row.privateKeyIv).toBeTruthy();
    expect(row.privateKeySalt).toBeTruthy();

    clearVpsSsoKeyCache();
    const again = await getVpsSsoSigningKey();
    expect(again.kid).toBe(kid);
    expect(again.privateKey.export({ format: "jwk" }).d).toBe(d);
  });

  it("can't decrypt with another manager secret", async () => {
    await getVpsSsoSigningKey();
    clearVpsSsoKeyCache();
    process.env.GENIE_SECRET = "a-different-secret";
    try {
      await expect(getVpsSsoSigningKey()).rejects.toThrow();
    } finally {
      process.env.GENIE_SECRET = "test-genie-secret-for-vps-sso";
    }
  });

  it("publishes only public JWK fields and the signature verifies with them", async () => {
    const token = await signVpsSsoAssertion({ sub: "u1", aud: "genie-vps:i1" });
    const jwks = await getVpsSsoJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(Object.keys(jwks.keys[0]).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x"]);
    expect(jwks.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA", use: "sig" });
    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    expect(header).toEqual({ alg: "EdDSA", typ: "JWT", kid: jwks.keys[0].kid });
    expect(verifyWithJwks(token, jwks)).toEqual({ sub: "u1", aud: "genie-vps:i1" });

    // A tampered payload or another key's signature fails.
    const [h, , s] = token.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url")}.${s}`;
    expect(verifyWithJwks(forged, jwks)).toBeNull();
  });

  it("rotation: the new key signs, the old one verifies during the grace period, then retires", async () => {
    const t0 = new Date();
    const oldToken = await signVpsSsoAssertion({ n: 1 });
    const oldKid = (await getVpsSsoSigningKey()).kid;

    const newKid = await rotateVpsSsoSigningKey(60_000, t0);
    expect(newKid).not.toBe(oldKid);
    expect((await getVpsSsoSigningKey()).kid).toBe(newKid);
    const newToken = await signVpsSsoAssertion({ n: 2 });
    expect(JSON.parse(Buffer.from(newToken.split(".")[0], "base64url").toString()).kid).toBe(newKid);

    const during = await getVpsSsoJwks(new Date(t0.getTime() + 30_000));
    expect(during.keys.map((k) => k.kid).sort()).toEqual([oldKid, newKid].sort());
    expect(verifyWithJwks(oldToken, during)).toEqual({ n: 1 });
    expect(verifyWithJwks(newToken, during)).toEqual({ n: 2 });

    const after = await getVpsSsoJwks(new Date(t0.getTime() + 61_000));
    expect(after.keys.map((k) => k.kid)).toEqual([newKid]);
    expect(verifyWithJwks(oldToken, after)).toBeNull();

    expect(await pruneExpiredVpsSsoKeys(new Date(t0.getTime() + 61_000))).toBe(1);
    expect((await getTestDb().select().from(vpsSsoKeys)).map((r) => r.kid)).toEqual([newKid]);
  });

  it("is unavailable without a real manager secret", async () => {
    const s = process.env.GENIE_SECRET;
    const j = process.env.GENIE_JWT_SECRET;
    delete process.env.GENIE_SECRET;
    delete process.env.GENIE_JWT_SECRET;
    try {
      expect(isVpsSsoAvailable()).toBe(false);
      await expect(getVpsSsoSigningKey()).rejects.toThrow(/GENIE_SECRET/);
    } finally {
      process.env.GENIE_SECRET = s;
      if (j !== undefined) process.env.GENIE_JWT_SECRET = j;
    }
  });
});
