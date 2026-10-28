// Ed25519 signing keys for "Sign in with Genie" on genie-local servers.
//
// The manager signs a short-lived assertion (a compact JWS, alg EdDSA) after a
// server sign-in; genie-local verifies it against the public keys served at
// GET /api/vps/sso/jwks. Keys live in vps_sso_keys: the private key (PKCS#8
// PEM) is encrypted with the manager secret (credential-crypto), never logged
// and only decrypted into memory to sign. A key is generated on first need.
//
// Rotation: several keys may exist. The newest unexpired key signs; every
// unexpired key is published and verifies. rotateVpsSsoSigningKey() adds a new
// key and gives the old ones `expires_at = now + grace`, long enough for the
// JWKS cache (5 min) and in-flight assertions (2 min) to drain.

import crypto, { type KeyObject } from "node:crypto";
import { desc, gt, isNull, lte, or } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { vpsSsoKeys } from "../db/schema.js";
import { decryptPrivateKey, encryptPrivateKey, isPasteKeyEnabled } from "./credential-crypto.js";

/** How long a rotated-out key keeps verifying. */
export const VPS_SSO_ROTATION_GRACE_MS = 15 * 60_000;

export interface VpsSsoJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  alg: "EdDSA";
  use: "sig";
}

/** kid → decrypted private key, so signing doesn't re-run scrypt each time. */
const privateKeyCache = new Map<string, KeyObject>();

/** True when keys can be stored (a real manager secret is configured). */
export function isVpsSsoAvailable(): boolean {
  return isPasteKeyEnabled();
}

function newKid(): string {
  return crypto.randomBytes(9).toString("base64url"); // 12 chars
}

const unexpired = (now: Date) => or(isNull(vpsSsoKeys.expiresAt), gt(vpsSsoKeys.expiresAt, now));

async function insertNewKey(): Promise<{ kid: string; privateKey: KeyObject }> {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x;
  if (!x) throw new Error("Ed25519 key export produced no x");
  const enc = encryptPrivateKey(privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  const kid = newKid();
  await getDb().insert(vpsSsoKeys).values({
    kid,
    publicX: x,
    privateKeyCiphertext: enc.ciphertext,
    privateKeyIv: enc.iv,
    privateKeyAuthTag: enc.authTag,
    privateKeySalt: enc.salt,
  });
  privateKeyCache.set(kid, privateKey);
  console.log(`[vps-sso] generated signing key kid=${kid}`);
  return { kid, privateKey };
}

/** The key to sign with: the newest unexpired one, generated if there is none. */
export async function getVpsSsoSigningKey(now = new Date()): Promise<{ kid: string; privateKey: KeyObject }> {
  const [row] = await getDb()
    .select()
    .from(vpsSsoKeys)
    .where(unexpired(now))
    .orderBy(desc(vpsSsoKeys.createdAt))
    .limit(1);
  if (!row) return insertNewKey();
  let privateKey = privateKeyCache.get(row.kid);
  if (!privateKey) {
    const pem = decryptPrivateKey({
      ciphertext: row.privateKeyCiphertext,
      iv: row.privateKeyIv,
      authTag: row.privateKeyAuthTag,
      salt: row.privateKeySalt,
    });
    privateKey = crypto.createPrivateKey(pem);
    privateKeyCache.set(row.kid, privateKey);
  }
  return { kid: row.kid, privateKey };
}

/** Add a new signing key; older keys keep verifying for `graceMs`, then retire. */
export async function rotateVpsSsoSigningKey(graceMs = VPS_SSO_ROTATION_GRACE_MS, now = new Date()): Promise<string> {
  const db = getDb();
  const retireAt = new Date(now.getTime() + graceMs);
  // Keys already retiring keep their earlier date.
  await db.update(vpsSsoKeys).set({ expiresAt: retireAt }).where(isNull(vpsSsoKeys.expiresAt));
  const { kid } = await insertNewKey();
  return kid;
}

/** Delete keys whose verify window has passed (their assertions are long dead). */
export async function pruneExpiredVpsSsoKeys(now = new Date()): Promise<number> {
  const rows = await getDb()
    .delete(vpsSsoKeys)
    .where(lte(vpsSsoKeys.expiresAt, now))
    .returning({ kid: vpsSsoKeys.kid });
  for (const r of rows) privateKeyCache.delete(r.kid);
  return rows.length;
}

/** The published key set: public halves of every unexpired key. */
export async function getVpsSsoJwks(now = new Date()): Promise<{ keys: VpsSsoJwk[] }> {
  const rows = await getDb()
    .select({ kid: vpsSsoKeys.kid, x: vpsSsoKeys.publicX })
    .from(vpsSsoKeys)
    .where(unexpired(now))
    .orderBy(desc(vpsSsoKeys.createdAt));
  return { keys: rows.map((r) => ({ kty: "OKP", crv: "Ed25519", x: r.x, kid: r.kid, alg: "EdDSA", use: "sig" })) };
}

/** Sign `claims` as a compact JWS: header {"alg":"EdDSA","typ":"JWT","kid"}. */
export async function signVpsSsoAssertion(claims: Record<string, unknown>): Promise<string> {
  const { kid, privateKey } = await getVpsSsoSigningKey();
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput = `${b64({ alg: "EdDSA", typ: "JWT", kid })}.${b64(claims)}`;
  const sig = crypto.sign(null, Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${sig}`;
}

/** Test hook: forget decrypted keys (e.g. after truncating the table). */
export function clearVpsSsoKeyCache(): void {
  privateKeyCache.clear();
}
