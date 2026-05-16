import { Subject } from "subjecto/core";
import type { DocsState } from "../types/docs";

export const $docs = new Subject<DocsState>({
  files: [], sharedFiles: [], publicFiles: [], folders: [], publicFolders: [],
  selectedDocId: null, title: "", content: "", folderId: null, isPublic: false,
  publicKey: null, projectId: null, editing: false, loading: false,
  permission: "write", isOwner: true, downloadingZip: false,
  activeShareDocId: null, currentDocShares: [],
});
