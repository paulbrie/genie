import { wsSend } from "@/lib/ws";
import { $docs } from "../subjects/docs";

// --- Docs actions ---

export function loadDocsList(): void {
  $docs.nextAssign({ loading: true });
  wsSend("docs:list", {});
}

export function openDoc(docId: string): void {
  $docs.nextAssign({ loading: true });
  wsSend("docs:get", { docId });
}

export function saveDoc(docId: string, content: string, title?: string): void {
  $docs.nextAssign({ loading: true });
  wsSend("docs:save", { docId, content, title });
}

export function deleteDoc(docId: string): void {
  $docs.nextAssign({ loading: true });
  wsSend("docs:delete", { docId });
}

export function createNewDoc(title: string, folderId?: string | null, projectId?: string | null): void {
  $docs.nextAssign({ loading: true });
  wsSend("docs:create", { title, content: "", folderId: folderId || undefined, projectId: projectId || undefined });
}

export function createFolder(name: string, parentId?: string | null, projectId?: string | null): void {
  wsSend("docs:folder:create", { name, parentId: parentId || undefined, projectId: projectId || undefined });
}

export function renameFolder(folderId: string, name: string): void {
  wsSend("docs:folder:rename", { folderId, name });
}

export function deleteFolder(folderId: string): void {
  wsSend("docs:folder:delete", { folderId });
}

export function renameDoc(docId: string, title: string): void {
  wsSend("docs:save", { docId, title });
}

export function moveDoc(docId: string, folderId: string | null): void {
  wsSend("docs:move", { docId, folderId });
}

export function shareDoc(docId: string, targetUserId: string, permission: "read" | "write"): void {
  wsSend("docs:share", { docId, targetUserId, permission });
}

export function unshareDoc(docId: string, targetUserId: string): void {
  wsSend("docs:unshare", { docId, targetUserId });
}

export function openShareModal(docId: string): void {
  $docs.nextAssign({ activeShareDocId: docId, currentDocShares: [] });
  wsSend("docs:shares:get", { docId });
}

export function closeShareModal(): void {
  $docs.nextAssign({ activeShareDocId: null, currentDocShares: [] });
}

export function downloadAllDocs(): void {
  $docs.nextAssign({ downloadingZip: true });
  wsSend("docs:download:zip", {});
}

export function downloadDoc(docId: string): void {
  wsSend("docs:download:doc", { docId });
}

export function downloadFolder(folderId: string): void {
  wsSend("docs:download:folder", { folderId });
}

export function toggleDocPublic(docId: string): void {
  wsSend("docs:toggle-public", { docId });
}

export function toggleFolderPublic(folderId: string): void {
  wsSend("docs:folder:toggle-public", { folderId });
}

export function setDocProject(docId: string, projectId: string | null): void {
  wsSend("docs:set-project", { docId, projectId });
}

export function setFolderProject(folderId: string, projectId: string | null): void {
  wsSend("docs:folder:set-project", { folderId, projectId });
}
