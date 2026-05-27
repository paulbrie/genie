// Stored SSH private keys for generic ("bring-your-own") servers connected with
// the paste-a-key auth method. Keys are encrypted at rest (credential-crypto)
// and materialized to a 0600 file on demand so the existing SSH plumbing
// (connectSsh via connection-resolver, and spawnSshPty which reads a key path)
// works unchanged. Mirrors the ensureTazcloudKeyOnDisk pattern.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { serverCredentials } from "../db/schema.js";
import { encryptPrivateKey, decryptPrivateKey } from "./credential-crypto.js";

const CUSTOM_KEY_DIR = path.join(os.homedir(), ".genie", "ssh", "custom");

/** Absolute path where a credential's key is materialized. */
export function serverKeyPath(credentialId: string): string {
  return path.join(CUSTOM_KEY_DIR, credentialId);
}

export async function storeServerCredential(opts: {
  projectId: string;
  instanceId: string;
  privateKey: string;
  createdBy: string;
}): Promise<string> {
  const enc = encryptPrivateKey(opts.privateKey);
  const [row] = await getDb().insert(serverCredentials).values({
    projectId: opts.projectId,
    instanceId: opts.instanceId,
    ciphertext: enc.ciphertext,
    iv: enc.iv,
    authTag: enc.authTag,
    salt: enc.salt,
    createdBy: opts.createdBy,
  }).returning({ id: serverCredentials.id });
  return row.id;
}

export async function deleteServerCredential(credentialId: string): Promise<void> {
  await getDb().delete(serverCredentials).where(eq(serverCredentials.id, credentialId));
  try { fs.rmSync(serverKeyPath(credentialId)); } catch { /* already gone */ }
}

/** Decrypt the credential and materialize it to a 0600 file, returning the path.
 *  Idempotent (skips rewrite if the file already matches) and atomic (temp +
 *  rename), so it's safe under concurrent exec/terminal callers and survives a
 *  manager restart that cleared the temp dir. */
export async function ensureServerKeyOnDisk(credentialId: string): Promise<string> {
  const [row] = await getDb().select().from(serverCredentials).where(eq(serverCredentials.id, credentialId)).limit(1);
  if (!row) throw new Error(`Server credential ${credentialId} not found`);
  const plaintext = decryptPrivateKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, salt: row.salt });
  const normalized = plaintext.endsWith("\n") ? plaintext : `${plaintext}\n`;
  const dest = serverKeyPath(credentialId);
  fs.mkdirSync(CUSTOM_KEY_DIR, { recursive: true, mode: 0o700 });
  try {
    if (fs.readFileSync(dest, "utf-8") === normalized) return dest;
  } catch { /* not materialized yet */ }
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, normalized, { mode: 0o600 });
  fs.renameSync(tmp, dest);
  return dest;
}
