import { getDb } from "./db/index.js";
import { assistantChatLogs, chatSessionMeta } from "./db/schema.js";
import { eq, desc, sql, and } from "drizzle-orm";

export interface SaveMessageParams {
  sessionId: string;
  projectId?: string | null;
  instanceId?: string | null;
  userId?: string | null;
  clientType: string;
  role: "user" | "assistant";
  content: string;
  modelId?: string | null;
  toolUses?: unknown[] | null;
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number } | null;
}

export async function saveAssistantMessage(params: SaveMessageParams): Promise<void> {
  await getDb().insert(assistantChatLogs).values({
    sessionId: params.sessionId,
    projectId: params.projectId ?? null,
    instanceId: params.instanceId ?? null,
    userId: params.userId ?? null,
    clientType: params.clientType,
    role: params.role,
    content: params.content,
    modelId: params.modelId ?? null,
    toolUses: params.toolUses ?? null,
    usage: params.usage ?? null,
  });
}

export async function getSessionMessages(sessionId: string) {
  return getDb()
    .select()
    .from(assistantChatLogs)
    .where(eq(assistantChatLogs.sessionId, sessionId))
    .orderBy(assistantChatLogs.createdAt);
}

export async function getProjectSessions(projectId: string, limit = 50) {
  return getDb()
    .select()
    .from(assistantChatLogs)
    .where(eq(assistantChatLogs.projectId, projectId))
    .orderBy(desc(assistantChatLogs.createdAt))
    .limit(limit);
}

export interface SessionSummary {
  sessionId: string;
  projectId: string | null;
  modelId: string | null;
  userName: string | null;
  name: string | null;
  firstMessage: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** List distinct chat sessions with user names. Pass null userId to get all sessions (admin). */
export async function listUserSessions(userId: string | null, limit = 50): Promise<SessionSummary[]> {
  const db = getDb();
  const userFilter = userId ? sql`AND acl.user_id = ${userId}` : sql``;
  const rows = await db.execute(sql`
    SELECT
      acl.session_id,
      max(acl.project_id) AS project_id,
      max(acl.model_id) AS model_id,
      max(u.name) AS user_name,
      max(csm.name) AS session_name,
      min(acl.created_at) AS created_at,
      max(acl.created_at) AS updated_at,
      count(*)::int AS message_count,
      (SELECT content FROM assistant_chat_logs sub
       WHERE sub.session_id = acl.session_id AND sub.role = 'user'
       ORDER BY sub.created_at ASC LIMIT 1) AS first_message
    FROM assistant_chat_logs acl
    LEFT JOIN users u ON u.id::text = acl.user_id
    LEFT JOIN chat_session_meta csm ON csm.session_id = acl.session_id
    WHERE (csm.deleted_at IS NULL)
    ${userFilter}
    GROUP BY acl.session_id
    ORDER BY max(acl.created_at) DESC
    LIMIT ${limit}
  `);
  return (rows as Record<string, unknown>[]).map((r: Record<string, unknown>) => ({
    sessionId: r.session_id as string,
    projectId: r.project_id as string | null,
    modelId: r.model_id as string | null,
    userName: (r.user_name as string) || null,
    name: (r.session_name as string) || null,
    firstMessage: (r.first_message as string) || "",
    messageCount: r.message_count as number,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  }));
}

export async function renameSession(sessionId: string, name: string): Promise<void> {
  const db = getDb();
  await db
    .insert(chatSessionMeta)
    .values({ sessionId, name, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: chatSessionMeta.sessionId,
      set: { name, updatedAt: new Date() },
    });
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = getDb();
  await db
    .insert(chatSessionMeta)
    .values({ sessionId, deletedAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: chatSessionMeta.sessionId,
      set: { deletedAt: new Date(), updatedAt: new Date() },
    });
}

export interface SessionResumeMeta {
  claudeCodeSessionId: string;
  projectId: string;
  instanceId: string;
}

/** Upsert the Claude Code resume metadata for a Genie chat session. Called
 *  whenever the agent's stream emits a session_id, so the History panel can
 *  reinstall --resume when the session is re-opened later. */
export async function saveSessionResumeMeta(
  sessionId: string,
  meta: SessionResumeMeta,
): Promise<void> {
  const db = getDb();
  await db
    .insert(chatSessionMeta)
    .values({
      sessionId,
      claudeCodeSessionId: meta.claudeCodeSessionId,
      projectId: meta.projectId,
      instanceId: meta.instanceId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: chatSessionMeta.sessionId,
      set: {
        claudeCodeSessionId: meta.claudeCodeSessionId,
        projectId: meta.projectId,
        instanceId: meta.instanceId,
        updatedAt: new Date(),
      },
    });
}

/** Returns resume metadata for a Genie chat session, or null if the session
 *  was never bound to a Claude Code session (e.g. created before this
 *  feature, or used a different model). */
export async function getSessionResumeMeta(sessionId: string): Promise<SessionResumeMeta | null> {
  const rows = await getDb()
    .select({
      claudeCodeSessionId: chatSessionMeta.claudeCodeSessionId,
      projectId: chatSessionMeta.projectId,
      instanceId: chatSessionMeta.instanceId,
    })
    .from(chatSessionMeta)
    .where(eq(chatSessionMeta.sessionId, sessionId))
    .limit(1);
  const r = rows[0];
  if (!r || !r.claudeCodeSessionId || !r.projectId || !r.instanceId) return null;
  return {
    claudeCodeSessionId: r.claudeCodeSessionId,
    projectId: r.projectId,
    instanceId: r.instanceId,
  };
}
