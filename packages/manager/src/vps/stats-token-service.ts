// Per-instance bearer tokens for the on-VM genie-stats daemon's HTTPS postback.
//
// `ensureStatsToken` is called at provisioning time (syncGenieStatsOnVm) and is
// idempotent so re-provisioning a VM keeps the same token. `resolveStatsToken`
// is the hot path on every POST /api/vps/stats — backed by an in-memory cache
// since tokens are long-lived and ingest fires every few seconds per VM.

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { vpsStatsTokens } from "../db/schema.js";

interface TokenOwner {
  projectId: string;
  instanceId: string;
}

/** token → owner. Populated lazily on resolve and on mint. */
const tokenCache = new Map<string, TokenOwner>();

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Return the existing token for this instance, or mint + persist a new one. */
export async function ensureStatsToken(projectId: string, instanceId: string): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select({ token: vpsStatsTokens.token })
    .from(vpsStatsTokens)
    .where(and(eq(vpsStatsTokens.projectId, projectId), eq(vpsStatsTokens.instanceId, instanceId)))
    .limit(1);
  if (existing) {
    tokenCache.set(existing.token, { projectId, instanceId });
    return existing.token;
  }

  const token = newToken();
  // ON CONFLICT on the (project_id, instance_id) unique index guards against a
  // concurrent provision racing us; re-read the winner if we lost.
  await db
    .insert(vpsStatsTokens)
    .values({ projectId, instanceId, token })
    .onConflictDoNothing();

  const [row] = await db
    .select({ token: vpsStatsTokens.token })
    .from(vpsStatsTokens)
    .where(and(eq(vpsStatsTokens.projectId, projectId), eq(vpsStatsTokens.instanceId, instanceId)))
    .limit(1);
  const finalToken = row?.token ?? token;
  tokenCache.set(finalToken, { projectId, instanceId });
  return finalToken;
}

/** Resolve a bearer token to its owning instance, or null if unknown. */
export async function resolveStatsToken(token: string): Promise<TokenOwner | null> {
  if (!token) return null;
  const cached = tokenCache.get(token);
  if (cached) return cached;

  const db = getDb();
  const [row] = await db
    .select({ projectId: vpsStatsTokens.projectId, instanceId: vpsStatsTokens.instanceId })
    .from(vpsStatsTokens)
    .where(eq(vpsStatsTokens.token, token))
    .limit(1);
  if (!row) return null;
  const owner: TokenOwner = { projectId: row.projectId, instanceId: row.instanceId };
  tokenCache.set(token, owner);
  return owner;
}
