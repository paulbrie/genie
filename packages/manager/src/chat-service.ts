import { eq, and, desc, lt, inArray } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { users, conversations, conversationMembers, messages } from "./db/schema.js";
import type { ChatMessage } from "./chat.js";

export async function getOrCreateClaudeDm(userId: string, claudeId: string) {
  const db = getDb();

  // Find DMs where the user is a member, and batch-fetch all members for those DMs
  const userDms = await db
    .select({
      id: conversations.id,
      type: conversations.type,
      name: conversations.name,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .innerJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.type, "dm"),
        eq(conversationMembers.userId, userId),
      )
    );

  if (userDms.length > 0) {
    const dmIds = userDms.map((d) => d.id);

    // Single batch query for all members of all candidate DMs
    const allMembers = await db
      .select({
        conversationId: conversationMembers.conversationId,
        userId: conversationMembers.userId,
      })
      .from(conversationMembers)
      .where(inArray(conversationMembers.conversationId, dmIds));

    // Group members by conversation
    const membersByConv = new Map<string, string[]>();
    for (const m of allMembers) {
      const arr = membersByConv.get(m.conversationId) || [];
      arr.push(m.userId);
      membersByConv.set(m.conversationId, arr);
    }

    // Find DMs with exactly [userId, claudeId]
    const matches = userDms.filter((conv) => {
      const members = membersByConv.get(conv.id) || [];
      return members.length === 2 && members.includes(claudeId) && members.includes(userId);
    });

    if (matches.length > 0) {
      // Clean up duplicates — keep the first (oldest), delete the rest
      if (matches.length > 1) {
        const dupeIds = matches.slice(1).map((m) => m.id);
        await db.delete(messages).where(inArray(messages.conversationId, dupeIds));
        await db.delete(conversationMembers).where(inArray(conversationMembers.conversationId, dupeIds));
        await db.delete(conversations).where(inArray(conversations.id, dupeIds));
      }
      return matches[0];
    }
  }

  // Create new DM
  const [conv] = await db
    .insert(conversations)
    .values({
      type: "dm",
      name: null,
      createdBy: userId,
    })
    .returning();

  await db.insert(conversationMembers).values([
    { conversationId: conv.id, userId },
    { conversationId: conv.id, userId: claudeId },
  ]);

  return conv;
}

export async function createRoom(creatorId: string, name: string, memberIds: string[]) {
  const db = getDb();

  const [conv] = await db
    .insert(conversations)
    .values({
      type: "room",
      name,
      createdBy: creatorId,
    })
    .returning();

  // Always include the creator
  const allMemberIds = [...new Set([creatorId, ...memberIds])];

  await db.insert(conversationMembers).values(
    allMemberIds.map((userId) => ({
      conversationId: conv.id,
      userId,
    })),
  );

  return conv;
}

export async function addMember(conversationId: string, userId: string) {
  const db = getDb();
  await db.insert(conversationMembers).values({ conversationId, userId });
}

export async function removeMember(conversationId: string, userId: string) {
  const db = getDb();
  await db
    .delete(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
      ),
    );
}

export async function saveMessage(
  conversationId: string,
  senderId: string,
  content: string,
  metadata?: string,
  replyToId?: string,
) {
  const db = getDb();

  const [msg] = await db
    .insert(messages)
    .values({ conversationId, senderId, content, metadata: metadata || null, replyToId: replyToId || null })
    .returning();

  // Get sender info
  const [sender] = await db.select().from(users).where(eq(users.id, senderId)).limit(1);

  // Update conversation updatedAt
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  // Fetch reply preview if replyToId provided
  let replyTo: { id: string; senderName: string; contentPreview: string } | null = null;
  if (replyToId) {
    const [parent] = await db
      .select({ id: messages.id, content: messages.content, senderName: users.name })
      .from(messages)
      .innerJoin(users, eq(messages.senderId, users.id))
      .where(eq(messages.id, replyToId))
      .limit(1);
    if (parent) {
      replyTo = { id: parent.id, senderName: parent.senderName, contentPreview: parent.content.slice(0, 80) };
    }
  }

  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    senderName: sender?.name || "Unknown",
    senderAvatar: sender?.avatarUrl || null,
    isAgent: sender?.isAgent || false,
    content: msg.content,
    metadata: msg.metadata,
    replyToId: msg.replyToId || null,
    replyTo,
    editedAt: null,
    reactions: {},
    createdAt: msg.createdAt.toISOString(),
  };
}

export async function getMessages(conversationId: string, limit = 50, before?: string) {
  const db = getDb();

  let query = db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      senderName: users.name,
      senderAvatar: users.avatarUrl,
      isAgent: users.isAgent,
      content: messages.content,
      metadata: messages.metadata,
      replyToId: messages.replyToId,
      editedAt: messages.editedAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(users, eq(messages.senderId, users.id))
    .where(
      before
        ? and(
            eq(messages.conversationId, conversationId),
            lt(messages.createdAt, new Date(before)),
          )
        : eq(messages.conversationId, conversationId),
    )
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  const rows = await query;

  // Batch-fetch reply previews
  const replyIds = rows.filter((r) => r.replyToId).map((r) => r.replyToId!);
  const replyMap = new Map<string, { id: string; senderName: string; contentPreview: string }>();
  if (replyIds.length > 0) {
    const uniqueIds = [...new Set(replyIds)];
    const replyRows = await db
      .select({ id: messages.id, content: messages.content, senderName: users.name })
      .from(messages)
      .innerJoin(users, eq(messages.senderId, users.id))
      .where(inArray(messages.id, uniqueIds));
    for (const r of replyRows) {
      replyMap.set(r.id, { id: r.id, senderName: r.senderName, contentPreview: r.content.slice(0, 80) });
    }
  }

  return rows.reverse().map((r) => {
    // Parse reactions from metadata
    let reactions: Record<string, string[]> = {};
    if (r.metadata) {
      try {
        const parsed = JSON.parse(r.metadata);
        if (parsed.reactions) reactions = parsed.reactions;
      } catch {}
    }

    return {
      ...r,
      replyToId: r.replyToId || null,
      replyTo: r.replyToId ? replyMap.get(r.replyToId) || null : null,
      editedAt: r.editedAt ? r.editedAt.toISOString() : null,
      reactions,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function getMessagesForClaude(conversationId: string): Promise<ChatMessage[]> {
  const db = getDb();

  const rows = await db
    .select({
      senderId: messages.senderId,
      isAgent: users.isAgent,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(users, eq(messages.senderId, users.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
    .limit(50);

  return rows.map((r) => ({
    role: r.isAgent ? "assistant" as const : "user" as const,
    content: r.content,
  }));
}

export async function getUserConversations(userId: string) {
  const db = getDb();

  // Get all conversation IDs where user is a member
  const memberships = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, userId));

  if (memberships.length === 0) return [];

  const convIds = memberships.map((m) => m.conversationId);

  // Batch: conversations, all members, and last messages in 3 queries (not 2N+1)
  const [convs, allMembers, lastMessages] = await Promise.all([
    db
      .select({
        id: conversations.id,
        type: conversations.type,
        name: conversations.name,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(inArray(conversations.id, convIds))
      .orderBy(desc(conversations.updatedAt)),

    db
      .select({
        conversationId: conversationMembers.conversationId,
        userId: conversationMembers.userId,
        name: users.name,
        avatarUrl: users.avatarUrl,
        isAgent: users.isAgent,
      })
      .from(conversationMembers)
      .innerJoin(users, eq(conversationMembers.userId, users.id))
      .where(inArray(conversationMembers.conversationId, convIds)),

    // Batch-fetch recent messages for all conversations (get a few per conv, pick latest in JS)
    db
      .select({
        conversationId: messages.conversationId,
        content: messages.content,
        senderName: users.name,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(users, eq(messages.senderId, users.id))
      .where(inArray(messages.conversationId, convIds))
      .orderBy(desc(messages.createdAt)),
  ]);

  // Index members by conversation
  const membersByConv = new Map<string, typeof allMembers>();
  for (const m of allMembers) {
    const arr = membersByConv.get(m.conversationId) || [];
    arr.push(m);
    membersByConv.set(m.conversationId, arr);
  }

  // Index last messages by conversation (take the first per convId since ordered desc)
  const lastMsgByConv = new Map<string, { content: string; senderName: string; createdAt: string }>();
  for (const row of lastMessages) {
    if (!lastMsgByConv.has(row.conversationId)) {
      lastMsgByConv.set(row.conversationId, {
        content: row.content.slice(0, 100),
        senderName: row.senderName,
        createdAt: row.createdAt.toISOString(),
      });
    }
  }

  return convs.map((conv) => ({
    id: conv.id,
    type: conv.type,
    name: conv.name,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    lastMessage: lastMsgByConv.get(conv.id) || null,
    members: membersByConv.get(conv.id) || [],
  }));
}

export async function getConversationMembers(conversationId: string) {
  const db = getDb();
  return db
    .select({
      userId: conversationMembers.userId,
      name: users.name,
      avatarUrl: users.avatarUrl,
      isAgent: users.isAgent,
    })
    .from(conversationMembers)
    .innerJoin(users, eq(conversationMembers.userId, users.id))
    .where(eq(conversationMembers.conversationId, conversationId));
}

export async function getAllUsers() {
  const db = getDb();
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      isAgent: users.isAgent,
    })
    .from(users)
    .orderBy(users.name);
}

export async function getConversation(conversationId: string) {
  const db = getDb();
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return conv || null;
}

export async function getMessage(messageId: string) {
  const db = getDb();
  const [msg] = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      senderName: users.name,
      content: messages.content,
      metadata: messages.metadata,
    })
    .from(messages)
    .innerJoin(users, eq(messages.senderId, users.id))
    .where(eq(messages.id, messageId))
    .limit(1);
  return msg || null;
}

export async function toggleReaction(messageId: string, userId: string, emoji: string) {
  const db = getDb();
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!msg) return null;

  let parsed: { reactions?: Record<string, string[]>; [key: string]: unknown } = {};
  if (msg.metadata) {
    try { parsed = JSON.parse(msg.metadata); } catch {}
  }
  if (!parsed.reactions) parsed.reactions = {};

  const reactions = parsed.reactions;
  const arr: string[] = reactions[emoji] || [];
  const idx = arr.indexOf(userId);
  if (idx >= 0) {
    arr.splice(idx, 1);
    if (arr.length === 0) delete reactions[emoji];
    else reactions[emoji] = arr;
  } else {
    reactions[emoji] = [...arr, userId];
  }

  await db.update(messages).set({ metadata: JSON.stringify(parsed) }).where(eq(messages.id, messageId));

  return { messageId, reactions: parsed.reactions as Record<string, string[]> };
}

export async function editMessage(messageId: string, senderId: string, newContent: string) {
  const db = getDb();
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!msg || msg.senderId !== senderId) return null;

  const now = new Date();
  await db.update(messages).set({ content: newContent, editedAt: now }).where(eq(messages.id, messageId));

  return { messageId, content: newContent, editedAt: now.toISOString() };
}
