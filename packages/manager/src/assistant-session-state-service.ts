import { getDb } from "./db/index.js";
import { assistantSessionState } from "./db/schema.js";
import { eq, lt } from "drizzle-orm";

export interface ResumeState {
  sessionId: string;
  lastActivity: Date;
}

// Read-through cache: the chat hot path calls getResumeState on every user
// turn, so we keep last-seen rows in memory. Cache is process-local — multiple
// Managers stay correct because the DB row is the source of truth and writes
// always upsert.
const cache = new Map<string, ResumeState>();

/** Returns the persisted resume state for `sessionKey`, or null if none. */
export async function getResumeState(sessionKey: string): Promise<ResumeState | null> {
  const cached = cache.get(sessionKey);
  if (cached) return cached;

  const rows = await getDb()
    .select({
      claudeCodeSessionId: assistantSessionState.claudeCodeSessionId,
      lastActivity: assistantSessionState.lastActivity,
    })
    .from(assistantSessionState)
    .where(eq(assistantSessionState.sessionKey, sessionKey))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const state: ResumeState = { sessionId: row.claudeCodeSessionId, lastActivity: row.lastActivity };
  cache.set(sessionKey, state);
  return state;
}

/** Upsert the resume mapping and bump lastActivity. Called when the agent
 * emits a session_id in its stream. */
export async function saveResumeSessionId(
  sessionKey: string,
  claudeCodeSessionId: string,
  projectId: string,
  instanceId: string,
): Promise<void> {
  const now = new Date();
  cache.set(sessionKey, { sessionId: claudeCodeSessionId, lastActivity: now });
  await getDb()
    .insert(assistantSessionState)
    .values({ sessionKey, claudeCodeSessionId, projectId, instanceId, lastActivity: now })
    .onConflictDoUpdate({
      target: assistantSessionState.sessionKey,
      set: { claudeCodeSessionId, lastActivity: now },
    });
}

export interface PrunedSession {
  sessionKey: string;
  claudeCodeSessionId: string;
  projectId: string;
  instanceId: string;
}

/** Delete rows whose lastActivity is older than `retentionDays`. Returns the
 * removed rows so the caller can also wipe the corresponding JSONL files on
 * the VPS. */
export async function pruneStaleSessions(retentionDays: number): Promise<PrunedSession[]> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const removed = await getDb()
    .delete(assistantSessionState)
    .where(lt(assistantSessionState.lastActivity, cutoff))
    .returning({
      sessionKey: assistantSessionState.sessionKey,
      claudeCodeSessionId: assistantSessionState.claudeCodeSessionId,
      projectId: assistantSessionState.projectId,
      instanceId: assistantSessionState.instanceId,
    });
  for (const r of removed) cache.delete(r.sessionKey);
  return removed;
}
