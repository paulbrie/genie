// Docs: per-user documents + folders with sharing, public links, project
// association, and zip export. Mutations refresh the owner's list (and any
// share target's / collaborator's list) by re-sending docs:list. `sendToUser`
// is injected from ws-server (it owns the clients map) for the cross-user
// fan-out on save/share. Extracted from ws-server's switch — behavior unchanged.

import { type WebSocket } from "ws";
import type { WsMessage as WsMessageBase } from "../types.js";
import * as docsService from "../docs-service.js";

export interface WsMessage extends Omit<WsMessageBase, "payload"> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
}

/** The full docs:list payload for a user: their own docs/folders plus docs and
 *  folders shared with them and public ones. */
async function buildDocsPayload(userId: string) {
  const [{ own, shared, publicDocs }, { own: folders, publicFolders }] = await Promise.all([
    docsService.listDocs(userId),
    docsService.listFolders(userId),
  ]);
  return {
    own: own.map((f) => ({ id: f.id, title: f.title, folderId: f.folderId, isPublic: f.isPublic, publicKey: f.publicKey, projectId: f.projectId, updatedAt: f.updatedAt.toISOString() })),
    shared: shared.map((f) => ({ id: f.id, title: f.title, updatedAt: f.updatedAt.toISOString(), permission: f.permission, ownerId: f.ownerId, ownerName: f.ownerName, projectId: f.projectId, isPublic: f.isPublic })),
    publicDocs: publicDocs.map((f) => ({ id: f.id, title: f.title, updatedAt: f.updatedAt.toISOString(), ownerId: f.ownerId, ownerName: f.ownerName, projectId: f.projectId, isPublic: f.isPublic, permission: "read" as const })),
    folders: folders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name, isPublic: f.isPublic, projectId: f.projectId, updatedAt: f.updatedAt.toISOString() })),
    publicFolders: publicFolders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name, isPublic: f.isPublic, projectId: f.projectId, updatedAt: f.updatedAt.toISOString(), ownerId: f.ownerId, ownerName: f.ownerName })),
  };
}

export async function handleDocsMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
  sendToUser: (targetUserId: string, message: WsMessage) => void,
): Promise<boolean> {
  // Refresh the requester's own list, or another user's (share/collab fan-out).
  const sendDocsList = async () => send(ws, { type: "docs:list", payload: await buildDocsPayload(userId) });
  const sendDocsListToUser = async (targetUserId: string) =>
    sendToUser(targetUserId, { type: "docs:list", payload: await buildDocsPayload(targetUserId) });

  switch (msg.type) {
    case "docs:list": {
      try {
        await sendDocsList();
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:get": {
      try {
        const doc = await docsService.getDoc(userId, msg.payload.docId);
        if (!doc) {
          send(ws, { type: "docs:error", payload: { message: "Doc not found" } });
        } else {
          send(ws, { type: "docs:content", payload: doc });
        }
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:create": {
      try {
        const { title, content, folderId, projectId } = msg.payload;
        const doc = await docsService.createDoc(userId, title, content, folderId, projectId);
        send(ws, { type: "docs:created", payload: doc });
        await sendDocsList();
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:save": {
      try {
        const { docId, title, content } = msg.payload;
        const result = await docsService.updateDoc(userId, docId, { title, content });
        if (!result) {
          send(ws, { type: "docs:error", payload: { message: "Doc not found" } });
        } else {
          // Fan-out saved event and refresh lists for all collaborators
          for (const uid of result.allUserIds) {
            sendToUser(uid, { type: "docs:saved", payload: result.doc });
            await sendDocsListToUser(uid);
          }
        }
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:delete": {
      try {
        const { docId } = msg.payload;
        const deleted = await docsService.deleteDoc(userId, docId);
        if (!deleted) {
          send(ws, { type: "docs:error", payload: { message: "Doc not found" } });
        } else {
          send(ws, { type: "docs:deleted", payload: { docId } });
          await sendDocsList();
        }
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:folder:create": {
      try {
        const { name, parentId, projectId } = msg.payload;
        await docsService.createFolder(userId, name, parentId, projectId);
        await sendDocsList();
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:folder:rename": {
      try {
        const { folderId, name } = msg.payload;
        await docsService.renameFolder(userId, folderId, name);
        await sendDocsList();
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:folder:delete": {
      try {
        const { folderId } = msg.payload;
        await docsService.deleteFolder(userId, folderId);
        await sendDocsList();
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:move": {
      try {
        const { docId, folderId } = msg.payload;
        await docsService.moveDoc(userId, docId, folderId ?? null);
        await sendDocsList();
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:share": {
      try {
        const { docId, targetUserId, permission } = msg.payload;
        await docsService.shareDoc(userId, docId, targetUserId, permission);
        const shares = await docsService.getDocShares(userId, docId);
        send(ws, { type: "docs:shares", payload: { docId, shares: shares.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })) } });
        await sendDocsListToUser(targetUserId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:unshare": {
      try {
        const { docId, targetUserId } = msg.payload;
        await docsService.unshareDoc(userId, docId, targetUserId);
        const shares = await docsService.getDocShares(userId, docId);
        send(ws, { type: "docs:shares", payload: { docId, shares: shares.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })) } });
        await sendDocsListToUser(targetUserId);
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:shares:get": {
      try {
        const { docId } = msg.payload;
        const shares = await docsService.getDocShares(userId, docId);
        send(ws, { type: "docs:shares", payload: { docId, shares: shares.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })) } });
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:download:zip": {
      try {
        const zipBuffer = await docsService.exportDocsAsZip(userId);
        send(ws, { type: "docs:download:zip", payload: { data: zipBuffer.toString("base64") } });
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:download:doc": {
      try {
        const { docId } = msg.payload;
        const { buffer, fileName } = await docsService.exportDocAsZip(userId, docId);
        send(ws, { type: "docs:download:item", payload: { data: buffer.toString("base64"), fileName } });
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:download:folder": {
      try {
        const { folderId } = msg.payload;
        const { buffer, fileName } = await docsService.exportFolderAsZip(userId, folderId);
        send(ws, { type: "docs:download:item", payload: { data: buffer.toString("base64"), fileName } });
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:toggle-public": {
      try {
        const { docId } = msg.payload;
        const result = await docsService.toggleDocPublic(userId, docId);
        send(ws, { type: "docs:public-toggled", payload: result });
        await sendDocsList();
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:folder:toggle-public": {
      try {
        const { folderId } = msg.payload;
        const result = await docsService.toggleFolderPublic(userId, folderId);
        send(ws, { type: "docs:folder:public-toggled", payload: result });
        await sendDocsList();
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:set-project": {
      try {
        const { docId, projectId } = msg.payload;
        await docsService.setDocProject(userId, docId, projectId ?? null);
        await sendDocsList();
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:folder:set-project": {
      try {
        const { folderId, projectId } = msg.payload;
        await docsService.setFolderProject(userId, folderId, projectId ?? null);
        await sendDocsList();
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "docs:get-public": {
      try {
        const { publicKey } = msg.payload;
        const doc = await docsService.getDocByPublicKey(publicKey);
        if (!doc) {
          send(ws, { type: "docs:error", payload: { message: "Public doc not found" } });
        } else {
          send(ws, { type: "docs:public-content", payload: doc });
        }
      } catch (err: unknown) {
        send(ws, { type: "docs:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
