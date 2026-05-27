// AES-256-GCM encryption for stored SSH private keys (generic "bring-your-own"
// servers, paste-a-key auth). Each secret gets its own random salt + iv; the
// 32-byte key is derived per-row via scrypt from a manager secret.
//
// The manager secret is GENIE_SECRET (preferred) or GENIE_JWT_SECRET. If only
// the insecure default is in effect, paste-a-key is disabled (isPasteKeyEnabled
// === false) and we refuse to encrypt — operators must set a real secret to
// store key material. Note: rotating that secret invalidates all stored keys.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const INSECURE_FALLBACK = "genie-secret-fallback";

/** The effective encryption secret, or null when none/insecure-default. */
function managerSecret(): string | null {
  const s = process.env.GENIE_SECRET || process.env.GENIE_JWT_SECRET || "";
  if (!s || s === INSECURE_FALLBACK) return null;
  return s;
}

/** True when a real secret is configured. When false, the paste-a-key auth
 *  method must be rejected server-side and hidden in the UI. */
export function isPasteKeyEnabled(): boolean {
  return managerSecret() !== null;
}

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string;         // base64
  authTag: string;    // base64
  salt: string;       // base64
}

export function encryptPrivateKey(plaintext: string): EncryptedSecret {
  const secret = managerSecret();
  if (!secret) throw new Error("Cannot store a server key: set GENIE_SECRET (or GENIE_JWT_SECRET) to enable encrypted key storage.");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    salt: salt.toString("base64"),
  };
}

export function decryptPrivateKey(e: EncryptedSecret): string {
  const secret = managerSecret();
  if (!secret) throw new Error("Cannot decrypt a server key: GENIE_SECRET / GENIE_JWT_SECRET is not configured.");
  const key = scryptSync(secret, Buffer.from(e.salt, "base64"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"));
  decipher.setAuthTag(Buffer.from(e.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(e.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
