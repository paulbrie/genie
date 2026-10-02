// Per-(project, instance) git repos registered via the Github tab. Tokens are
// encrypted at rest via credential-crypto. The token plaintext is only ever
// materialized inside this service (for `getTokenForRepo`) or by the
// auto-save reconciler when pushing the manifest to a VM — it never leaves
// here in list/CRUD responses.

import { and, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { vpsGitRepos } from "../db/schema.js";
import { encryptPrivateKey, decryptPrivateKey } from "./credential-crypto.js";

export type GitProvider = "github" | "gitlab" | "other";

/** Split any credentials embedded in an `https://user:token@host/...` (or
 *  `https://token@host/...`) URL out of the URL. Returns the credential-free URL
 *  and the extracted token (password if present, else the userinfo). This keeps
 *  secrets out of the stored/displayed `repoUrl` and lets the token be encrypted
 *  at rest like any other. A URL without credentials is returned unchanged with
 *  a null token. */
export function splitRepoUrlCredentials(rawUrl: string): { cleanUrl: string; embeddedToken: string | null } {
  try {
    const u = new URL(rawUrl);
    if (!u.username && !u.password) return { cleanUrl: rawUrl, embeddedToken: null };
    const embedded = u.password || u.username;
    u.username = "";
    u.password = "";
    // URL() percent-encodes userinfo on read; decode so we store the raw token.
    let token: string | null = null;
    try {
      token = embedded ? decodeURIComponent(embedded) : null;
    } catch {
      token = embedded || null;
    }
    return { cleanUrl: u.toString(), embeddedToken: token };
  } catch {
    return { cleanUrl: rawUrl, embeddedToken: null };
  }
}

export interface VpsGitRepoPublic {
  id: string;
  projectId: string;
  instanceId: string;
  repoUrl: string;
  repoPath: string;
  provider: GitProvider;
  hasToken: boolean;
  autoSave: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Project the row to its public shape — strips the encrypted bundle and the
 *  internal token flags so handlers can hand it to the wire without thinking. */
function toPublic(row: typeof vpsGitRepos.$inferSelect): VpsGitRepoPublic {
  return {
    id: row.id,
    projectId: row.projectId,
    instanceId: row.instanceId,
    repoUrl: row.repoUrl,
    repoPath: row.repoPath,
    provider: row.provider as GitProvider,
    hasToken: !!row.ciphertext,
    autoSave: row.autoSave,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listForInstance(projectId: string, instanceId: string): Promise<VpsGitRepoPublic[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(vpsGitRepos)
    .where(and(eq(vpsGitRepos.projectId, projectId), eq(vpsGitRepos.instanceId, instanceId)))
    .orderBy(vpsGitRepos.createdAt);
  return rows.map(toPublic);
}

/** All auto-save-enabled rows for a (project, instance), with their decrypted
 *  tokens. Used by the reconciler when pushing the manifest + ~/.git-credentials
 *  to the VM. Never expose this output on the wire. */
export interface VpsGitRepoWithToken extends VpsGitRepoPublic {
  token: string | null;
}

export async function listAutoSaveWithTokens(projectId: string, instanceId: string): Promise<VpsGitRepoWithToken[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(vpsGitRepos)
    .where(and(
      eq(vpsGitRepos.projectId, projectId),
      eq(vpsGitRepos.instanceId, instanceId),
      eq(vpsGitRepos.autoSave, true),
    ));
  return rows.map((r) => ({
    ...toPublic(r),
    token: r.ciphertext && r.iv && r.authTag && r.salt
      ? decryptPrivateKey({ ciphertext: r.ciphertext, iv: r.iv, authTag: r.authTag, salt: r.salt })
      : null,
  }));
}

export async function getById(id: string): Promise<VpsGitRepoPublic | null> {
  const db = getDb();
  const [row] = await db.select().from(vpsGitRepos).where(eq(vpsGitRepos.id, id)).limit(1);
  return row ? toPublic(row) : null;
}

/** Decrypt the token for a single repo. Returns null when the repo was
 *  registered without one. */
export async function getTokenForRepo(id: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db.select().from(vpsGitRepos).where(eq(vpsGitRepos.id, id)).limit(1);
  if (!row) return null;
  if (!row.ciphertext || !row.iv || !row.authTag || !row.salt) return null;
  return decryptPrivateKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, salt: row.salt });
}

export async function add(input: {
  projectId: string;
  instanceId: string;
  repoUrl: string;
  repoPath: string;
  provider?: GitProvider;
  token?: string | null;
  autoSave?: boolean;
  createdBy: string;
}): Promise<VpsGitRepoPublic> {
  // An explicit token wins; otherwise adopt one embedded in the URL. Either way
  // the stored repoUrl is stripped of credentials so secrets never land in the
  // DB column or the UI.
  const { cleanUrl, embeddedToken } = splitRepoUrlCredentials(input.repoUrl);
  const effectiveToken = input.token?.trim() ? input.token.trim() : embeddedToken;
  const enc = effectiveToken ? encryptPrivateKey(effectiveToken) : null;
  const db = getDb();
  const [row] = await db
    .insert(vpsGitRepos)
    .values({
      projectId: input.projectId,
      instanceId: input.instanceId,
      repoUrl: cleanUrl,
      repoPath: input.repoPath,
      provider: input.provider ?? "github",
      ciphertext: enc?.ciphertext ?? null,
      iv: enc?.iv ?? null,
      authTag: enc?.authTag ?? null,
      salt: enc?.salt ?? null,
      autoSave: input.autoSave ?? false,
      createdBy: input.createdBy,
    })
    .returning();
  return toPublic(row);
}

/** Update any subset of the mutable fields. Passing `token: null` clears the
 *  stored token; omitting `token` leaves it untouched. */
export async function update(
  id: string,
  patch: {
    repoUrl?: string;
    repoPath?: string;
    provider?: GitProvider;
    token?: string | null;
    autoSave?: boolean;
  },
): Promise<VpsGitRepoPublic | null> {
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  let embeddedToken: string | null = null;
  if (patch.repoUrl !== undefined) {
    const split = splitRepoUrlCredentials(patch.repoUrl);
    updates.repoUrl = split.cleanUrl;
    embeddedToken = split.embeddedToken;
  }
  if (patch.repoPath !== undefined) updates.repoPath = patch.repoPath;
  if (patch.provider !== undefined) updates.provider = patch.provider;
  if (patch.autoSave !== undefined) updates.autoSave = patch.autoSave;
  // Explicit token (incl. null to clear) wins; otherwise adopt one extracted
  // from a newly-provided URL.
  const tokenToStore = patch.token !== undefined ? patch.token : embeddedToken ?? undefined;
  if (tokenToStore !== undefined) {
    if (tokenToStore === null) {
      updates.ciphertext = null;
      updates.iv = null;
      updates.authTag = null;
      updates.salt = null;
    } else {
      const enc = encryptPrivateKey(tokenToStore);
      updates.ciphertext = enc.ciphertext;
      updates.iv = enc.iv;
      updates.authTag = enc.authTag;
      updates.salt = enc.salt;
    }
  }
  const [row] = await db.update(vpsGitRepos).set(updates).where(eq(vpsGitRepos.id, id)).returning();
  return row ? toPublic(row) : null;
}

export async function remove(id: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db.delete(vpsGitRepos).where(eq(vpsGitRepos.id, id)).returning({ id: vpsGitRepos.id });
  return deleted.length > 0;
}

/** One-time boot repair: earlier registrations (and the detected-repo adopt
 *  flow) could persist a token embedded in `repoUrl` in plaintext, leaving the
 *  encrypted token unset (so `hasToken` was false and auto-save was blocked).
 *  Strip credentials from every affected row's URL and, when no encrypted token
 *  exists yet, adopt the embedded one. Idempotent. Returns the rows fixed. */
export async function sanitizeEmbeddedCredentials(): Promise<number> {
  const db = getDb();
  const rows = await db.select().from(vpsGitRepos);
  let fixed = 0;
  for (const row of rows) {
    const { cleanUrl, embeddedToken } = splitRepoUrlCredentials(row.repoUrl);
    if (cleanUrl === row.repoUrl) continue; // no embedded credentials
    const updates: Record<string, unknown> = { repoUrl: cleanUrl, updatedAt: new Date() };
    if (embeddedToken && !row.ciphertext) {
      try {
        const enc = encryptPrivateKey(embeddedToken);
        updates.ciphertext = enc.ciphertext;
        updates.iv = enc.iv;
        updates.authTag = enc.authTag;
        updates.salt = enc.salt;
      } catch (err) {
        // Encryption unavailable (GENIE_SECRET not configured). Skip this row so
        // the embedded token survives for a clean migration once the secret is
        // set, rather than stripping it from the URL and losing it.
        console.warn(`[vps-git] Cannot migrate token for repo ${row.id} — set GENIE_SECRET to enable encrypted storage. Skipping.`, err instanceof Error ? err.message : err);
        continue;
      }
    }
    await db.update(vpsGitRepos).set(updates).where(eq(vpsGitRepos.id, row.id));
    fixed += 1;
  }
  return fixed;
}
