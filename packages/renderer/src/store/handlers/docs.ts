import { $docs } from "../subjects/docs";
import type { DocsState } from "../types/docs";
import type { HandlerMap } from "./types";

// --- Docs messages ---

export const handlers: HandlerMap = {
  "docs:list": (payload) => {
    // New format: { own, shared, publicDocs, folders, publicFolders } or legacy { files }
    if (payload.own) {
      $docs.nextAssign({
        files: payload.own,
        sharedFiles: payload.shared || [],
        publicFiles: payload.publicDocs || [],
        folders: payload.folders || [],
        publicFolders: payload.publicFolders || [],
        loading: false,
      });
    } else {
      $docs.nextAssign({ files: payload.files, loading: false });
    }
  },

  "docs:content": (payload) => {
    $docs.nextAssign({
      selectedDocId: payload.id,
      title: payload.title,
      content: payload.content,
      folderId: payload.folderId ?? null,
      isPublic: payload.isPublic ?? false,
      publicKey: payload.publicKey ?? null,
      projectId: payload.projectId ?? null,
      isOwner: payload.isOwner ?? true,
      permission: payload.permission ?? "write",
      editing: false,
      loading: false,
    });
  },

  "docs:created": (payload) => {
    $docs.nextAssign({
      selectedDocId: payload.id,
      title: payload.title,
      content: payload.content,
      folderId: payload.folderId ?? null,
      isPublic: payload.isPublic ?? false,
      publicKey: payload.publicKey ?? null,
      projectId: payload.projectId ?? null,
      isOwner: true,
      permission: "write",
      editing: false,
      loading: false,
    });
  },

  "docs:saved": (payload) => {
    const d = $docs.getValue();
    if (d.selectedDocId === payload.id) {
      $docs.nextAssign({ title: payload.title, content: payload.content, editing: false, loading: false });
    } else {
      $docs.nextAssign({ loading: false });
    }
  },

  "docs:deleted": (payload) => {
    const d = $docs.getValue();
    if (d.selectedDocId === payload.docId) {
      $docs.nextAssign({
        selectedDocId: null, title: "", content: "", folderId: null,
        isPublic: false, publicKey: null, projectId: null,
        editing: false, isOwner: true, permission: "write", loading: false,
      });
    } else {
      $docs.nextAssign({ loading: false });
    }
  },

  "docs:shares": (payload) => {
    const { docId, shares } = payload;
    const d = $docs.getValue();
    if (d.activeShareDocId === docId) {
      $docs.nextAssign({ currentDocShares: shares });
    }
  },

  "docs:public-toggled": (payload) => {
    const { id, isPublic, publicKey } = payload;
    const d = $docs.getValue();
    const updates: Partial<DocsState> = {};
    if (d.selectedDocId === id) {
      updates.isPublic = isPublic;
      updates.publicKey = publicKey;
    }
    updates.files = d.files.map((f) =>
      f.id === id ? { ...f, isPublic, publicKey } : f
    );
    $docs.nextAssign(updates);
  },

  "docs:folder:public-toggled": (payload) => {
    const { id, isPublic } = payload;
    const d = $docs.getValue();
    $docs.nextAssign({
      folders: d.folders.map((f) =>
        f.id === id ? { ...f, isPublic } : f
      ),
    });
  },

  "docs:download:zip": (payload) => {
    $docs.nextAssign({ downloadingZip: false });
    // Trigger browser download
    if (typeof window !== "undefined" && payload.data) {
      const byteChars = atob(payload.data);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "docs.zip";
      a.click();
      URL.revokeObjectURL(url);
    }
  },

  "docs:download:item": (payload) => {
    if (typeof window !== "undefined" && payload.data) {
      const byteChars = atob(payload.data);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = payload.fileName || "download.zip";
      a.click();
      URL.revokeObjectURL(url);
    }
  },

  "docs:error": (payload) => {
    console.warn("Docs error:", payload.message);
    $docs.nextAssign({ loading: false, downloadingZip: false });
  },
};
