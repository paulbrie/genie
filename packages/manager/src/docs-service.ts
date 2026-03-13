import { eq, and, desc, inArray, isNull, ne, or } from "drizzle-orm";
import crypto from "node:crypto";
import { getDb } from "./db/index.js";
import { docs, docFolders, docShares, users } from "./db/schema.js";
import archiver from "archiver";

// --- Folders ---

export async function listFolders(userId: string) {
  const db = getDb();

  // Own folders
  const own = await db
    .select({
      id: docFolders.id,
      parentId: docFolders.parentId,
      name: docFolders.name,
      isPublic: docFolders.isPublic,
      projectId: docFolders.projectId,
      updatedAt: docFolders.updatedAt,
    })
    .from(docFolders)
    .where(eq(docFolders.userId, userId))
    .orderBy(docFolders.name);

  // Public folders from other users (project or personal)
  const publicFolders = await db
    .select({
      id: docFolders.id,
      parentId: docFolders.parentId,
      name: docFolders.name,
      isPublic: docFolders.isPublic,
      projectId: docFolders.projectId,
      updatedAt: docFolders.updatedAt,
      ownerId: docFolders.userId,
      ownerName: users.name,
    })
    .from(docFolders)
    .innerJoin(users, eq(docFolders.userId, users.id))
    .where(and(eq(docFolders.isPublic, true), ne(docFolders.userId, userId)))
    .orderBy(docFolders.name);

  return { own, publicFolders };
}

export async function createFolder(userId: string, name: string, parentId?: string | null, projectId?: string | null) {
  const db = getDb();
  if (parentId) {
    const [parent] = await db
      .select({ id: docFolders.id })
      .from(docFolders)
      .where(and(eq(docFolders.id, parentId), eq(docFolders.userId, userId)))
      .limit(1);
    if (!parent) throw new Error("Parent folder not found");
  }
  const [folder] = await db
    .insert(docFolders)
    .values({ userId, name, parentId: parentId || null, projectId: projectId || null })
    .returning();
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    isPublic: folder.isPublic,
    projectId: folder.projectId,
    updatedAt: folder.updatedAt.toISOString(),
  };
}

export async function renameFolder(userId: string, folderId: string, name: string) {
  const db = getDb();
  const [folder] = await db
    .update(docFolders)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(docFolders.id, folderId), eq(docFolders.userId, userId)))
    .returning();
  if (!folder) throw new Error("Folder not found");
  return { id: folder.id, parentId: folder.parentId, name: folder.name, isPublic: folder.isPublic, projectId: folder.projectId, updatedAt: folder.updatedAt.toISOString() };
}

export async function deleteFolder(userId: string, folderId: string) {
  const db = getDb();
  // Collect all descendant folder IDs recursively
  const allFolders = await db
    .select({ id: docFolders.id, parentId: docFolders.parentId })
    .from(docFolders)
    .where(eq(docFolders.userId, userId));

  const toDelete = new Set<string>();
  function collect(id: string) {
    toDelete.add(id);
    for (const f of allFolders) {
      if (f.parentId === id && !toDelete.has(f.id)) {
        collect(f.id);
      }
    }
  }
  collect(folderId);

  const ids = [...toDelete];
  if (ids.length > 0) {
    await db.delete(docFolders).where(and(eq(docFolders.userId, userId), inArray(docFolders.id, ids)));
  }
  return true;
}

export async function moveDoc(userId: string, docId: string, folderId: string | null) {
  const db = getDb();
  if (folderId) {
    const [folder] = await db
      .select({ id: docFolders.id })
      .from(docFolders)
      .where(and(eq(docFolders.id, folderId), eq(docFolders.userId, userId)))
      .limit(1);
    if (!folder) throw new Error("Target folder not found");
  }
  const [doc] = await db
    .update(docs)
    .set({ folderId, updatedAt: new Date() })
    .where(and(eq(docs.id, docId), eq(docs.userId, userId)))
    .returning();
  if (!doc) throw new Error("Doc not found");
  return true;
}

export async function setDocProject(userId: string, docId: string, projectId: string | null) {
  const db = getDb();
  const [doc] = await db
    .update(docs)
    .set({ projectId, updatedAt: new Date() })
    .where(and(eq(docs.id, docId), eq(docs.userId, userId)))
    .returning();
  if (!doc) throw new Error("Doc not found");
  return { id: doc.id, projectId: doc.projectId };
}

export async function setFolderProject(userId: string, folderId: string, projectId: string | null) {
  const db = getDb();
  const [folder] = await db
    .update(docFolders)
    .set({ projectId, updatedAt: new Date() })
    .where(and(eq(docFolders.id, folderId), eq(docFolders.userId, userId)))
    .returning();
  if (!folder) throw new Error("Folder not found");
  return { id: folder.id, projectId: folder.projectId };
}

// --- Docs (share-aware) ---

export async function listDocs(userId: string) {
  const db = getDb();

  // Own docs
  const own = await db
    .select({
      id: docs.id,
      title: docs.title,
      folderId: docs.folderId,
      isPublic: docs.isPublic,
      publicKey: docs.publicKey,
      projectId: docs.projectId,
      updatedAt: docs.updatedAt,
    })
    .from(docs)
    .where(eq(docs.userId, userId))
    .orderBy(desc(docs.updatedAt));

  // Shared with me
  const shared = await db
    .select({
      id: docs.id,
      title: docs.title,
      updatedAt: docs.updatedAt,
      permission: docShares.permission,
      ownerId: docs.userId,
      ownerName: users.name,
      projectId: docs.projectId,
      isPublic: docs.isPublic,
    })
    .from(docShares)
    .innerJoin(docs, eq(docShares.docId, docs.id))
    .innerJoin(users, eq(docs.userId, users.id))
    .where(eq(docShares.sharedWithUserId, userId))
    .orderBy(desc(docs.updatedAt));

  // Public docs from other users
  const publicDocs = await db
    .select({
      id: docs.id,
      title: docs.title,
      updatedAt: docs.updatedAt,
      ownerId: docs.userId,
      ownerName: users.name,
      projectId: docs.projectId,
      isPublic: docs.isPublic,
    })
    .from(docs)
    .innerJoin(users, eq(docs.userId, users.id))
    .where(and(eq(docs.isPublic, true), ne(docs.userId, userId)))
    .orderBy(desc(docs.updatedAt));

  return { own, shared, publicDocs };
}

export async function getDoc(userId: string, docId: string) {
  const db = getDb();

  // Try as owner first
  const [ownDoc] = await db
    .select()
    .from(docs)
    .where(and(eq(docs.id, docId), eq(docs.userId, userId)))
    .limit(1);

  if (ownDoc) {
    return {
      id: ownDoc.id,
      title: ownDoc.title,
      content: ownDoc.content,
      folderId: ownDoc.folderId,
      isPublic: ownDoc.isPublic,
      publicKey: ownDoc.publicKey,
      projectId: ownDoc.projectId,
      createdAt: ownDoc.createdAt.toISOString(),
      updatedAt: ownDoc.updatedAt.toISOString(),
      isOwner: true,
      permission: "write" as const,
    };
  }

  // Try as shared user
  const [shareRow] = await db
    .select({
      id: docs.id,
      title: docs.title,
      content: docs.content,
      folderId: docs.folderId,
      isPublic: docs.isPublic,
      projectId: docs.projectId,
      createdAt: docs.createdAt,
      updatedAt: docs.updatedAt,
      permission: docShares.permission,
      ownerId: docs.userId,
    })
    .from(docShares)
    .innerJoin(docs, eq(docShares.docId, docs.id))
    .where(and(eq(docShares.docId, docId), eq(docShares.sharedWithUserId, userId)))
    .limit(1);

  if (shareRow) {
    return {
      id: shareRow.id,
      title: shareRow.title,
      content: shareRow.content,
      folderId: shareRow.folderId,
      isPublic: shareRow.isPublic,
      projectId: shareRow.projectId,
      createdAt: shareRow.createdAt.toISOString(),
      updatedAt: shareRow.updatedAt.toISOString(),
      isOwner: false,
      permission: shareRow.permission as "read" | "write",
    };
  }

  // Try as public doc (read-only)
  const [publicDoc] = await db
    .select()
    .from(docs)
    .where(and(eq(docs.id, docId), eq(docs.isPublic, true)))
    .limit(1);

  if (publicDoc) {
    return {
      id: publicDoc.id,
      title: publicDoc.title,
      content: publicDoc.content,
      folderId: publicDoc.folderId,
      isPublic: publicDoc.isPublic,
      projectId: publicDoc.projectId,
      createdAt: publicDoc.createdAt.toISOString(),
      updatedAt: publicDoc.updatedAt.toISOString(),
      isOwner: false,
      permission: "read" as const,
    };
  }

  return null;
}

export async function createDoc(userId: string, title: string, content?: string, folderId?: string | null, projectId?: string | null) {
  const db = getDb();
  const [doc] = await db
    .insert(docs)
    .values({ userId, title, content: content || "", folderId: folderId || null, projectId: projectId || null })
    .returning();
  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    folderId: doc.folderId,
    isPublic: doc.isPublic,
    publicKey: doc.publicKey,
    projectId: doc.projectId,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function updateDoc(
  userId: string,
  docId: string,
  fields: { title?: string; content?: string },
) {
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (fields.title !== undefined) updates.title = fields.title;
  if (fields.content !== undefined) updates.content = fields.content;

  // Try as owner
  const [ownDoc] = await db
    .update(docs)
    .set(updates)
    .where(and(eq(docs.id, docId), eq(docs.userId, userId)))
    .returning();

  if (ownDoc) {
    // Get all users who have shares on this doc for fan-out
    const shares = await db
      .select({ sharedWithUserId: docShares.sharedWithUserId })
      .from(docShares)
      .where(eq(docShares.docId, docId));
    const allUserIds = [userId, ...shares.map((s) => s.sharedWithUserId)];
    return {
      doc: {
        id: ownDoc.id,
        title: ownDoc.title,
        content: ownDoc.content,
        folderId: ownDoc.folderId,
        createdAt: ownDoc.createdAt.toISOString(),
        updatedAt: ownDoc.updatedAt.toISOString(),
      },
      allUserIds,
    };
  }

  // Try as write-permission share holder
  const [share] = await db
    .select({ docId: docShares.docId, ownerId: docShares.ownerId })
    .from(docShares)
    .where(
      and(
        eq(docShares.docId, docId),
        eq(docShares.sharedWithUserId, userId),
        eq(docShares.permission, "write"),
      ),
    )
    .limit(1);

  if (!share) return null;

  const [updatedDoc] = await db
    .update(docs)
    .set(updates)
    .where(eq(docs.id, docId))
    .returning();

  if (!updatedDoc) return null;

  // Fan-out to owner + all share holders
  const shares = await db
    .select({ sharedWithUserId: docShares.sharedWithUserId })
    .from(docShares)
    .where(eq(docShares.docId, docId));
  const allUserIds = [share.ownerId, ...shares.map((s) => s.sharedWithUserId)];

  return {
    doc: {
      id: updatedDoc.id,
      title: updatedDoc.title,
      content: updatedDoc.content,
      folderId: updatedDoc.folderId,
      createdAt: updatedDoc.createdAt.toISOString(),
      updatedAt: updatedDoc.updatedAt.toISOString(),
    },
    allUserIds,
  };
}

export async function deleteDoc(userId: string, docId: string) {
  const db = getDb();
  const result = await db
    .delete(docs)
    .where(and(eq(docs.id, docId), eq(docs.userId, userId)))
    .returning({ id: docs.id });
  return result.length > 0;
}

// --- Public toggle ---

export async function toggleDocPublic(userId: string, docId: string) {
  const db = getDb();
  const [doc] = await db
    .select({ id: docs.id, isPublic: docs.isPublic, publicKey: docs.publicKey })
    .from(docs)
    .where(and(eq(docs.id, docId), eq(docs.userId, userId)))
    .limit(1);
  if (!doc) throw new Error("Doc not found or not owner");

  const newIsPublic = !doc.isPublic;
  const updates: Record<string, unknown> = { isPublic: newIsPublic, updatedAt: new Date() };
  if (newIsPublic && !doc.publicKey) {
    updates.publicKey = crypto.randomBytes(6).toString("base64url");
  }

  const [updated] = await db
    .update(docs)
    .set(updates)
    .where(eq(docs.id, docId))
    .returning();

  return { id: updated.id, isPublic: updated.isPublic, publicKey: updated.publicKey };
}

export async function toggleFolderPublic(userId: string, folderId: string) {
  const db = getDb();
  const [folder] = await db
    .select({ id: docFolders.id, isPublic: docFolders.isPublic })
    .from(docFolders)
    .where(and(eq(docFolders.id, folderId), eq(docFolders.userId, userId)))
    .limit(1);
  if (!folder) throw new Error("Folder not found or not owner");

  const newIsPublic = !folder.isPublic;
  const [updated] = await db
    .update(docFolders)
    .set({ isPublic: newIsPublic, updatedAt: new Date() })
    .where(eq(docFolders.id, folderId))
    .returning();

  return { id: updated.id, isPublic: updated.isPublic };
}

export async function getDocByPublicKey(publicKey: string) {
  const db = getDb();
  const [doc] = await db
    .select({
      id: docs.id,
      title: docs.title,
      content: docs.content,
      updatedAt: docs.updatedAt,
      ownerName: users.name,
    })
    .from(docs)
    .innerJoin(users, eq(docs.userId, users.id))
    .where(and(eq(docs.publicKey, publicKey), eq(docs.isPublic, true)))
    .limit(1);

  if (!doc) return null;
  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    updatedAt: doc.updatedAt.toISOString(),
    ownerName: doc.ownerName,
  };
}

// --- Agent/tool access (project docs) ---

export async function listDocsByProject(projectId: string) {
  const db = getDb();
  return db
    .select({
      id: docs.id,
      title: docs.title,
      updatedAt: docs.updatedAt,
      ownerName: users.name,
    })
    .from(docs)
    .innerJoin(users, eq(docs.userId, users.id))
    .where(eq(docs.projectId, projectId))
    .orderBy(desc(docs.updatedAt));
}

export async function getDocById(docId: string) {
  const db = getDb();
  const [doc] = await db
    .select({
      id: docs.id,
      title: docs.title,
      content: docs.content,
      updatedAt: docs.updatedAt,
    })
    .from(docs)
    .where(eq(docs.id, docId))
    .limit(1);
  return doc || null;
}

// --- Sharing ---

export async function shareDoc(
  ownerId: string,
  docId: string,
  targetUserId: string,
  permission: "read" | "write",
) {
  const db = getDb();
  // Verify ownership
  const [doc] = await db
    .select({ id: docs.id })
    .from(docs)
    .where(and(eq(docs.id, docId), eq(docs.userId, ownerId)))
    .limit(1);
  if (!doc) throw new Error("Doc not found or not owner");

  // Upsert: delete existing share then insert
  await db
    .delete(docShares)
    .where(
      and(
        eq(docShares.docId, docId),
        eq(docShares.sharedWithUserId, targetUserId),
      ),
    );

  const [share] = await db
    .insert(docShares)
    .values({ docId, ownerId, sharedWithUserId: targetUserId, permission })
    .returning();

  return share;
}

export async function unshareDoc(ownerId: string, docId: string, targetUserId: string) {
  const db = getDb();
  const result = await db
    .delete(docShares)
    .where(
      and(
        eq(docShares.docId, docId),
        eq(docShares.ownerId, ownerId),
        eq(docShares.sharedWithUserId, targetUserId),
      ),
    )
    .returning({ id: docShares.id });
  return result.length > 0;
}

export async function getDocShares(ownerId: string, docId: string) {
  const db = getDb();
  // Verify ownership
  const [doc] = await db
    .select({ id: docs.id })
    .from(docs)
    .where(and(eq(docs.id, docId), eq(docs.userId, ownerId)))
    .limit(1);
  if (!doc) throw new Error("Doc not found or not owner");

  return db
    .select({
      id: docShares.id,
      sharedWithUserId: docShares.sharedWithUserId,
      sharedWithName: users.name,
      sharedWithAvatar: users.avatarUrl,
      permission: docShares.permission,
      createdAt: docShares.createdAt,
    })
    .from(docShares)
    .innerJoin(users, eq(docShares.sharedWithUserId, users.id))
    .where(eq(docShares.docId, docId));
}

// --- ZIP export ---

export async function exportDocsAsZip(userId: string): Promise<Buffer> {
  const db = getDb();

  const { own } = await listFolders(userId);
  const allDocs = await db
    .select({
      id: docs.id,
      title: docs.title,
      content: docs.content,
      folderId: docs.folderId,
    })
    .from(docs)
    .where(eq(docs.userId, userId));

  // Build folder path map
  const folderMap = new Map<string, { name: string; parentId: string | null }>();
  for (const f of own) {
    folderMap.set(f.id, { name: f.name, parentId: f.parentId });
  }

  function getFolderPath(folderId: string | null): string {
    if (!folderId) return "";
    const parts: string[] = [];
    let current = folderId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const folder = folderMap.get(current);
      if (!folder) break;
      parts.unshift(folder.name);
      current = folder.parentId!;
    }
    return parts.length > 0 ? parts.join("/") + "/" : "";
  }

  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    for (const doc of allDocs) {
      const folderPath = getFolderPath(doc.folderId);
      const safeName = doc.title.replace(/[/\\?%*:|"<>]/g, "_");
      archive.append(doc.content, { name: `${folderPath}${safeName}.md` });
    }

    archive.finalize();
  });
}
