// Verify "Sign in with Genie" assertions in tests the way genie-local does.
import crypto from "node:crypto";

/** Verify a compact JWS against a JWKS the way genie-local does (node:crypto). */
export function verifyWithJwks(token: string, jwks: { keys: ReadonlyArray<{ kid: string; x: string }> }): Record<string, unknown> | null {
  const [h, p, s] = token.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg: string; kid: string; typ: string };
  if (header.alg !== "EdDSA") return null;
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" });
  const ok = crypto.verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
  return ok ? (JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, unknown>) : null;
}
