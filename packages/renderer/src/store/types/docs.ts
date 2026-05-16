// --- Docs types ---

export interface FolderItem { id: string; parentId: string | null; name: string; updatedAt: string; projectId?: string | null; isPublic?: boolean; ownerId?: string; ownerName?: string; }
export interface DocShare { id: string; sharedWithUserId: string; sharedWithName: string; sharedWithAvatar: string | null; permission: "read" | "write"; createdAt: string; }
export interface DocItem { id: string; title: string; updatedAt: string; folderId?: string | null; permission?: "read" | "write"; ownerName?: string; ownerId?: string; projectId?: string | null; isPublic?: boolean; publicKey?: string | null; }

export interface DocsState {
  files: DocItem[];
  sharedFiles: DocItem[];
  publicFiles: DocItem[];
  folders: FolderItem[];
  publicFolders: FolderItem[];
  selectedDocId: string | null;
  title: string;
  content: string;
  folderId: string | null;
  isPublic: boolean;
  publicKey: string | null;
  projectId: string | null;
  editing: boolean;
  loading: boolean;
  permission: "read" | "write";
  isOwner: boolean;
  downloadingZip: boolean;
  activeShareDocId: string | null;
  currentDocShares: DocShare[];
}
