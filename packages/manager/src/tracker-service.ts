import { eq, desc, max, inArray, asc } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { trackerIssues, trackerLabels, trackerIssueLabels, trackerIssueComments, users } from "./db/schema.js";

// --- Labels ---

export async function listLabels() {
  const db = getDb();
  const rows = await db
    .select({
      id: trackerLabels.id,
      name: trackerLabels.name,
      color: trackerLabels.color,
    })
    .from(trackerLabels)
    .orderBy(trackerLabels.name);
  return rows;
}

export async function createLabel(userId: string, name: string, color: string) {
  const db = getDb();
  const [label] = await db
    .insert(trackerLabels)
    .values({ name, color, createdBy: userId })
    .returning();
  return { id: label.id, name: label.name, color: label.color };
}

export async function updateLabel(userId: string, labelId: string, fields: { name?: string; color?: string }) {
  const db = getDb();
  const updates: Record<string, unknown> = {};
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.color !== undefined) updates.color = fields.color;
  if (Object.keys(updates).length === 0) return null;

  const [label] = await db
    .update(trackerLabels)
    .set(updates)
    .where(eq(trackerLabels.id, labelId))
    .returning();
  if (!label) return null;
  return { id: label.id, name: label.name, color: label.color };
}

export async function deleteLabel(userId: string, labelId: string) {
  const db = getDb();
  const result = await db
    .delete(trackerLabels)
    .where(eq(trackerLabels.id, labelId))
    .returning({ id: trackerLabels.id });
  return result.length > 0;
}

// --- Issues ---

export async function getIssueProjectId(issueId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ projectId: trackerIssues.projectId })
    .from(trackerIssues)
    .where(eq(trackerIssues.id, issueId))
    .limit(1);
  return row?.projectId ?? null;
}

async function getNextIdentifier(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ maxId: max(trackerIssues.identifier) })
    .from(trackerIssues);
  return (row?.maxId ?? 0) + 1;
}

async function batchFetchLabels(issueIds: string[]) {
  if (issueIds.length === 0) return new Map<string, { id: string; name: string; color: string }[]>();
  const db = getDb();
  const rows = await db
    .select({
      issueId: trackerIssueLabels.issueId,
      labelId: trackerLabels.id,
      labelName: trackerLabels.name,
      labelColor: trackerLabels.color,
    })
    .from(trackerIssueLabels)
    .innerJoin(trackerLabels, eq(trackerIssueLabels.labelId, trackerLabels.id))
    .where(inArray(trackerIssueLabels.issueId, issueIds));

  const map = new Map<string, { id: string; name: string; color: string }[]>();
  for (const r of rows) {
    if (!map.has(r.issueId)) map.set(r.issueId, []);
    map.get(r.issueId)!.push({ id: r.labelId, name: r.labelName, color: r.labelColor });
  }
  return map;
}

interface CommentStats {
  commentCount: number;
  commenters: { name: string; avatar: string | null }[];
}

async function batchFetchCommentStats(issueIds: string[]): Promise<Map<string, CommentStats>> {
  if (issueIds.length === 0) return new Map();
  const db = getDb();
  const rows = await db
    .select({
      issueId: trackerIssueComments.issueId,
      authorName: trackerIssueComments.authorName,
      authorAvatar: trackerIssueComments.authorAvatar,
    })
    .from(trackerIssueComments)
    .where(inArray(trackerIssueComments.issueId, issueIds));

  const map = new Map<string, CommentStats>();
  for (const r of rows) {
    if (!map.has(r.issueId)) map.set(r.issueId, { commentCount: 0, commenters: [] });
    const stats = map.get(r.issueId)!;
    stats.commentCount++;
    if (!stats.commenters.some((c) => c.name === r.authorName)) {
      stats.commenters.push({ name: r.authorName, avatar: r.authorAvatar });
    }
  }
  return map;
}

function formatIssue(
  row: {
    id: string;
    projectId: string;
    identifier: number;
    title: string;
    description: string;
    status: string;
    priority: string;
    assigneeId: string | null;
    assigneeName: string | null;
    assigneeAvatar: string | null;
    createdBy: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  },
  labels: { id: string; name: string; color: string }[],
  commentStats?: CommentStats,
) {
  return {
    id: row.id,
    projectId: row.projectId,
    identifier: row.identifier,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    assigneeAvatar: row.assigneeAvatar,
    labels,
    commentCount: commentStats?.commentCount ?? 0,
    commenters: commentStats?.commenters ?? [],
    createdBy: row.createdBy,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listIssues(allowedProjectIds?: string[]) {
  // Caller passes the set of projects the user is allowed to see.
  // Undefined = no scoping (admin / internal callers); [] = no access → no issues.
  if (allowedProjectIds && allowedProjectIds.length === 0) return [];

  const db = getDb();
  const baseQuery = db
    .select({
      id: trackerIssues.id,
      projectId: trackerIssues.projectId,
      identifier: trackerIssues.identifier,
      title: trackerIssues.title,
      description: trackerIssues.description,
      status: trackerIssues.status,
      priority: trackerIssues.priority,
      assigneeId: trackerIssues.assigneeId,
      assigneeName: users.name,
      assigneeAvatar: users.avatarUrl,
      createdBy: trackerIssues.createdBy,
      sortOrder: trackerIssues.sortOrder,
      createdAt: trackerIssues.createdAt,
      updatedAt: trackerIssues.updatedAt,
    })
    .from(trackerIssues)
    .leftJoin(users, eq(trackerIssues.assigneeId, users.id));

  const rows = await (allowedProjectIds
    ? baseQuery.where(inArray(trackerIssues.projectId, allowedProjectIds))
    : baseQuery
  ).orderBy(desc(trackerIssues.createdAt));

  const issueIds = rows.map((r) => r.id);
  const [labelsMap, commentStatsMap] = await Promise.all([
    batchFetchLabels(issueIds),
    batchFetchCommentStats(issueIds),
  ]);

  return rows.map((r) => formatIssue(r, labelsMap.get(r.id) || [], commentStatsMap.get(r.id)));
}

export async function getIssue(issueId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: trackerIssues.id,
      projectId: trackerIssues.projectId,
      identifier: trackerIssues.identifier,
      title: trackerIssues.title,
      description: trackerIssues.description,
      status: trackerIssues.status,
      priority: trackerIssues.priority,
      assigneeId: trackerIssues.assigneeId,
      assigneeName: users.name,
      assigneeAvatar: users.avatarUrl,
      createdBy: trackerIssues.createdBy,
      sortOrder: trackerIssues.sortOrder,
      createdAt: trackerIssues.createdAt,
      updatedAt: trackerIssues.updatedAt,
    })
    .from(trackerIssues)
    .leftJoin(users, eq(trackerIssues.assigneeId, users.id))
    .where(eq(trackerIssues.id, issueId))
    .limit(1);

  if (!row) return null;

  const [labelsMap, commentStatsMap] = await Promise.all([
    batchFetchLabels([row.id]),
    batchFetchCommentStats([row.id]),
  ]);
  return formatIssue(row, labelsMap.get(row.id) || [], commentStatsMap.get(row.id));
}

export async function createIssue(
  userId: string | null,
  fields: {
    projectId: string;
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    assigneeId?: string | null;
    labelIds?: string[];
  },
) {
  const db = getDb();
  const identifier = await getNextIdentifier();

  // Compute sortOrder: put new issues at the top
  const [maxSort] = await db
    .select({ maxOrder: max(trackerIssues.sortOrder) })
    .from(trackerIssues);
  const sortOrder = (maxSort?.maxOrder ?? 0) + 1;

  const [issue] = await db
    .insert(trackerIssues)
    .values({
      projectId: fields.projectId,
      identifier,
      title: fields.title,
      description: fields.description || "",
      status: (fields.status as typeof trackerIssues.$inferInsert.status) || "todo",
      priority: (fields.priority as typeof trackerIssues.$inferInsert.priority) || "none",
      assigneeId: fields.assigneeId || null,
      createdBy: userId || null,
      sortOrder,
    })
    .returning();

  // Bulk-insert labels
  if (fields.labelIds && fields.labelIds.length > 0) {
    await db.insert(trackerIssueLabels).values(
      fields.labelIds.map((labelId) => ({ issueId: issue.id, labelId })),
    );
  }

  return getIssue(issue.id);
}

export async function updateIssue(
  userId: string,
  issueId: string,
  fields: {
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    assigneeId?: string | null;
    labelIds?: string[];
    sortOrder?: number;
    projectId?: string;
  },
) {
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (fields.title !== undefined) updates.title = fields.title;
  if (fields.description !== undefined) updates.description = fields.description;
  if (fields.status !== undefined) updates.status = fields.status;
  if (fields.priority !== undefined) updates.priority = fields.priority;
  if (fields.assigneeId !== undefined) updates.assigneeId = fields.assigneeId;
  if (fields.sortOrder !== undefined) updates.sortOrder = fields.sortOrder;
  if (fields.projectId !== undefined) updates.projectId = fields.projectId;

  const [updated] = await db
    .update(trackerIssues)
    .set(updates)
    .where(eq(trackerIssues.id, issueId))
    .returning();

  if (!updated) return null;

  // Replace labels if provided
  if (fields.labelIds !== undefined) {
    await db.delete(trackerIssueLabels).where(eq(trackerIssueLabels.issueId, issueId));
    if (fields.labelIds.length > 0) {
      await db.insert(trackerIssueLabels).values(
        fields.labelIds.map((labelId) => ({ issueId, labelId })),
      );
    }
  }

  return getIssue(issueId);
}

export async function deleteIssue(userId: string, issueId: string) {
  const db = getDb();
  const result = await db
    .delete(trackerIssues)
    .where(eq(trackerIssues.id, issueId))
    .returning({ id: trackerIssues.id });
  return result.length > 0;
}

export async function reorderIssue(issueId: string, newSortOrder: number) {
  const db = getDb();
  const [updated] = await db
    .update(trackerIssues)
    .set({ sortOrder: newSortOrder, updatedAt: new Date() })
    .where(eq(trackerIssues.id, issueId))
    .returning();
  return !!updated;
}

// --- Comments ---

export async function listComments(issueId: string) {
  const db = getDb();
  return db
    .select({
      id: trackerIssueComments.id,
      issueId: trackerIssueComments.issueId,
      userId: trackerIssueComments.userId,
      authorName: trackerIssueComments.authorName,
      authorAvatar: trackerIssueComments.authorAvatar,
      content: trackerIssueComments.content,
      createdAt: trackerIssueComments.createdAt,
      updatedAt: trackerIssueComments.updatedAt,
    })
    .from(trackerIssueComments)
    .where(eq(trackerIssueComments.issueId, issueId))
    .orderBy(asc(trackerIssueComments.createdAt));
}

export async function createComment(fields: {
  issueId: string;
  userId?: string | null;
  authorName: string;
  authorAvatar?: string | null;
  content: string;
}) {
  const db = getDb();
  const [comment] = await db
    .insert(trackerIssueComments)
    .values({
      issueId: fields.issueId,
      userId: fields.userId || undefined,
      authorName: fields.authorName,
      authorAvatar: fields.authorAvatar || undefined,
      content: fields.content,
    })
    .returning();

  // Touch the issue's updatedAt
  await db.update(trackerIssues).set({ updatedAt: new Date() }).where(eq(trackerIssues.id, fields.issueId));

  return comment;
}

export async function deleteComment(commentId: string) {
  const db = getDb();
  const result = await db.delete(trackerIssueComments).where(eq(trackerIssueComments.id, commentId)).returning();
  return result.length > 0;
}
