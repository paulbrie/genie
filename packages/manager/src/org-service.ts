import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { organizations, orgCredentials, orgMembers, teams, users } from "./db/schema.js";
import { decryptPrivateKey, encryptPrivateKey, isPasteKeyEnabled, type EncryptedSecret } from "./vps/credential-crypto.js";
import { createTazClient, type TazApiClient } from "./vps/tazcloud-api-client.js";

export type OrgRole = "owner" | "admin" | "member";

export interface OrgDef {
  id: string;
  name: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface OrgMemberDef {
  id: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  joinedAt: Date;
  // Joined display info
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string | null;
}

async function isSuperadmin(userId: string): Promise<boolean> {
  const db = getDb();
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.role === "superadmin";
}

/** Create a new org and add `ownerUserId` as its owner. */
export async function createOrg({ name, ownerUserId }: { name: string; ownerUserId: string | null }): Promise<OrgDef> {
  const db = getDb();
  const [org] = await db.insert(organizations).values({ name, createdBy: ownerUserId ?? null }).returning();
  if (ownerUserId) {
    await db.insert(orgMembers).values({ orgId: org.id, userId: ownerUserId, role: "owner" });
  }
  return org;
}

/** All orgs the given user belongs to (joined with their role in each). */
export async function listForUser(userId: string): Promise<(OrgDef & { role: OrgRole })[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      createdBy: organizations.createdBy,
      createdAt: organizations.createdAt,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(eq(orgMembers.userId, userId))
    .orderBy(organizations.createdAt);
  return rows as (OrgDef & { role: OrgRole })[];
}

/** Every org in the system. Superadmin-only callers. */
export async function listAll(): Promise<OrgDef[]> {
  const db = getDb();
  return db.select().from(organizations).orderBy(organizations.createdAt);
}

/** Orgs visible to this user in admin context: all if superadmin, else only the user's orgs. */
export async function listManageable(userId: string): Promise<(OrgDef & { role: OrgRole | null })[]> {
  if (await isSuperadmin(userId)) {
    const all = await listAll();
    return all.map((o) => ({ ...o, role: "owner" as const }));
  }
  return listForUser(userId);
}

export async function getOrg(orgId: string): Promise<OrgDef | null> {
  const db = getDb();
  const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return row || null;
}

export async function updateOrg(orgId: string, fields: { name?: string }): Promise<OrgDef | null> {
  const db = getDb();
  const updates: Record<string, unknown> = {};
  if (fields.name !== undefined) updates.name = fields.name;
  if (Object.keys(updates).length === 0) return getOrg(orgId);
  const [row] = await db.update(organizations).set(updates).where(eq(organizations.id, orgId)).returning();
  return row || null;
}

export async function deleteOrg(orgId: string): Promise<boolean> {
  const db = getDb();
  const res = await db.delete(organizations).where(eq(organizations.id, orgId)).returning({ id: organizations.id });
  return res.length > 0;
}

/** Members of one org, joined with user display info. */
export async function getMembers(orgId: string): Promise<OrgMemberDef[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: orgMembers.id,
      orgId: orgMembers.orgId,
      userId: orgMembers.userId,
      role: orgMembers.role,
      joinedAt: orgMembers.joinedAt,
      userName: users.name,
      userEmail: users.email,
      userAvatarUrl: users.avatarUrl,
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(orgMembers.joinedAt);
  return rows as OrgMemberDef[];
}

export async function addMember(orgId: string, userId: string, role: OrgRole = "member"): Promise<OrgMemberDef | null> {
  const db = getDb();
  // Upsert: if already a member, update role; otherwise insert.
  const existing = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  if (existing.length > 0) {
    const [updated] = await db
      .update(orgMembers)
      .set({ role })
      .where(eq(orgMembers.id, existing[0].id))
      .returning();
    return decorateMember(updated);
  }
  const [row] = await db.insert(orgMembers).values({ orgId, userId, role }).returning();
  return decorateMember(row);
}

export async function removeMember(orgId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const res = await db
    .delete(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .returning({ id: orgMembers.id });
  return res.length > 0;
}

export async function setMemberRole(orgId: string, userId: string, role: OrgRole): Promise<OrgMemberDef | null> {
  const db = getDb();
  const [updated] = await db
    .update(orgMembers)
    .set({ role })
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .returning();
  if (!updated) return null;
  return decorateMember(updated);
}

async function decorateMember(row: typeof orgMembers.$inferSelect): Promise<OrgMemberDef> {
  const db = getDb();
  const [u] = await db
    .select({ name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    role: row.role as OrgRole,
    joinedAt: row.joinedAt,
    userName: u?.name,
    userEmail: u?.email,
    userAvatarUrl: u?.avatarUrl ?? null,
  };
}

/** True iff `userId` is superadmin OR an owner/admin of `orgId`. */
export async function userCanManageOrg(userId: string, orgId: string): Promise<boolean> {
  if (await isSuperadmin(userId)) return true;
  const db = getDb();
  const [m] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return m?.role === "owner" || m?.role === "admin";
}

/** True iff `userId` is a member (any role) of the org that owns `teamId`. */
export async function userIsInTeamsOrg(userId: string, teamId: string): Promise<boolean> {
  const db = getDb();
  const [t] = await db.select({ orgId: teams.orgId }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!t?.orgId) return false;
  const [m] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, t.orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return !!m;
}

/** OrgIds where the user is owner/admin (i.e. can manage). */
export async function manageableOrgIds(userId: string): Promise<string[]> {
  if (await isSuperadmin(userId)) {
    const db = getDb();
    const rows = await db.select({ id: organizations.id }).from(organizations);
    return rows.map((r) => r.id);
  }
  const db = getDb();
  const rows = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), inArray(orgMembers.role, ["owner", "admin"] as OrgRole[])));
  return rows.map((r) => r.orgId);
}

/**
 * Admin-invite path. Either:
 *   - upserts a stub users row (googleId=null) so the user can sign in later,
 *     or
 *   - reuses an existing user with the same email.
 * Then ensures org_members rows for each orgId. Caller is responsible for
 * checking that they may manage each orgId.
 */
export async function inviteUser(opts: {
  email: string;
  name?: string;
  role?: "user" | "tazcloud" | "admin" | "superadmin";
  orgIds: string[];
  addedByUserId: string;
}): Promise<{ user: typeof users.$inferSelect; created: boolean }> {
  const db = getDb();
  const email = opts.email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let user: typeof users.$inferSelect;
  let created = false;
  if (existing) {
    user = existing;
  } else {
    const [inserted] = await db
      .insert(users)
      .values({
        email,
        name: opts.name?.trim() || email,
        googleId: null,
        isAgent: false,
        validated: false,
        role: opts.role || "user",
      })
      .returning();
    user = inserted;
    created = true;
  }

  for (const orgId of opts.orgIds) {
    await db
      .insert(orgMembers)
      .values({ orgId, userId: user.id, role: "member" })
      .onConflictDoNothing();
  }

  return { user, created };
}

/** Convenience for auth.ts boot path. */
export async function ensureDefaultOrgFor(userId: string, userName: string | null, userEmail: string): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId))
    .limit(1);
  if (existing) return;
  const baseName = (userName || userEmail.split("@")[0]).trim();
  const name = `${baseName}'s Organization`;
  await createOrg({ name, ownerUserId: userId });
  // Touch sql import to satisfy type-checker if unused above in older Drizzle.
  void sql`SELECT 1`;
}

// ─── Org-scoped cloud credentials ─────────────────────────────────────────────
// Each (orgId, kind) row stores an AES-GCM-encrypted blob (see credential-
// crypto). The plaintext never leaves the manager — handlers only return
// boolean "has-credentials" to the renderer.

export type OrgCredentialKind = "tazcloud-token" | "tazcloud-ssh-key";

/** Has-credential boolean per kind, for status display in the org settings UI.
 *  We trial-decrypt every row so a rotated GENIE_SECRET (or otherwise corrupt
 *  blob) shows up as "not set" — the UI then asks the user to reset, instead
 *  of saying "set" while every actual use throws a raw GCM auth-tag error. */
export async function getCredentialStatus(orgId: string): Promise<Record<OrgCredentialKind, boolean>> {
  const db = getDb();
  const rows = await db
    .select({
      kind: orgCredentials.kind,
      ciphertext: orgCredentials.ciphertext,
      iv: orgCredentials.iv,
      authTag: orgCredentials.authTag,
      salt: orgCredentials.salt,
    })
    .from(orgCredentials)
    .where(eq(orgCredentials.orgId, orgId));
  const status: Record<OrgCredentialKind, boolean> = {
    "tazcloud-token": false,
    "tazcloud-ssh-key": false,
  };
  for (const r of rows) {
    if (r.kind !== "tazcloud-token" && r.kind !== "tazcloud-ssh-key") continue;
    try {
      decryptPrivateKey(r as EncryptedSecret);
      status[r.kind] = true;
    } catch {
      status[r.kind] = false;
    }
  }
  return status;
}

/** Upsert one credential. Caller must already have org-admin auth (callers
 *  enforce via {@link userCanManageOrg}). Throws when the manager-secret isn't
 *  configured — encryption would fall back to a default that's effectively
 *  plaintext. */
export async function setCredential(
  orgId: string,
  kind: OrgCredentialKind,
  plaintext: string,
  createdBy: string,
): Promise<void> {
  if (!isPasteKeyEnabled()) {
    throw new Error("Cannot store org credentials: set GENIE_SECRET on the manager to enable encrypted storage.");
  }
  const enc = encryptPrivateKey(plaintext);
  const db = getDb();
  // idx_org_credentials_lookup is UNIQUE on (org_id, kind), so this is one
  // atomic upsert — no SELECT-then-INSERT race, no duplicate rows possible.
  // updatedAt is auto-bumped via $onUpdate on the schema column.
  await db.insert(orgCredentials).values({
    orgId, kind, createdBy,
    ciphertext: enc.ciphertext, iv: enc.iv, authTag: enc.authTag, salt: enc.salt,
  }).onConflictDoUpdate({
    target: [orgCredentials.orgId, orgCredentials.kind],
    set: { ciphertext: enc.ciphertext, iv: enc.iv, authTag: enc.authTag, salt: enc.salt },
  });
}

/** Atomically write multiple credentials in a single transaction — used by the
 *  "save token + SSH key" path so a mid-write failure can't leave the org in a
 *  half-credentialled state (the half that did land would otherwise outlive
 *  the failed second write and confuse subsequent reads). */
export async function setCredentials(
  orgId: string,
  items: Array<{ kind: OrgCredentialKind; plaintext: string }>,
  createdBy: string,
): Promise<void> {
  if (items.length === 0) return;
  if (!isPasteKeyEnabled()) {
    throw new Error("Cannot store org credentials: set GENIE_SECRET on the manager to enable encrypted storage.");
  }
  // Encrypt up front so we don't hold the transaction open during scrypt work.
  const encrypted = items.map((i) => ({ kind: i.kind, ...encryptPrivateKey(i.plaintext) }));
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const e of encrypted) {
      await tx.insert(orgCredentials).values({
        orgId, kind: e.kind, createdBy,
        ciphertext: e.ciphertext, iv: e.iv, authTag: e.authTag, salt: e.salt,
      }).onConflictDoUpdate({
        target: [orgCredentials.orgId, orgCredentials.kind],
        set: { ciphertext: e.ciphertext, iv: e.iv, authTag: e.authTag, salt: e.salt },
      });
    }
  });
}

export async function clearCredential(orgId: string, kind: OrgCredentialKind): Promise<void> {
  const db = getDb();
  await db.delete(orgCredentials).where(and(eq(orgCredentials.orgId, orgId), eq(orgCredentials.kind, kind)));
}

/** Decrypt + return plaintext for a single secret. Server-side only — never
 *  expose the result over WS. Returns null when the secret isn't stored. */
async function readCredential(orgId: string, kind: OrgCredentialKind): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({
      ciphertext: orgCredentials.ciphertext,
      iv: orgCredentials.iv,
      authTag: orgCredentials.authTag,
      salt: orgCredentials.salt,
    })
    .from(orgCredentials)
    .where(and(eq(orgCredentials.orgId, orgId), eq(orgCredentials.kind, kind)))
    .orderBy(desc(orgCredentials.updatedAt))
    .limit(1);
  if (!row) return null;
  return decryptPrivateKey(row as EncryptedSecret);
}

/** Resolve a TazCloud API client bound to an org's stored token. Returns null
 *  when no token is stored — caller surfaces a "Set credentials first" UX. */
export async function getTazClientForOrg(orgId: string): Promise<TazApiClient | null> {
  const token = await readCredential(orgId, "tazcloud-token");
  if (!token) return null;
  return createTazClient(token);
}

/** Return the SSH private key for this org's TazCloud VMs (PEM/OpenSSH text).
 *  Used by ssh-client / pty-manager when connecting to org-pool VMs. */
export async function getTazSshKeyForOrg(orgId: string): Promise<string | null> {
  return readCredential(orgId, "tazcloud-ssh-key");
}
