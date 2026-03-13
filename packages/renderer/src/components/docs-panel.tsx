"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSubject } from "subjecto/react";
import { FileText, Plus, Save, Trash2, X, FolderPlus, ChevronRight, ChevronDown, Folder, Download, Share2, Users, Globe, Lock, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  $docs,
  $conversationChat,
  $projects,
  loadDocsList,
  openDoc,
  saveDoc,
  deleteDoc,
  createNewDoc,
  createFolder,
  renameFolder,
  deleteFolder,
  moveDoc,
  shareDoc,
  unshareDoc,
  openShareModal,
  closeShareModal,
  downloadAllDocs,
  toggleDocPublic,
  toggleFolderPublic,
  setDocProject,
  setFolderProject,
  type DocsState,
  type DocItem,
  type FolderItem,
  type DocShare,
  type ChatUser,
  type ProjectDef,
} from "@/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/view-header";
import { Select } from "@/components/ui/select";

// --- Share Modal ---

function ShareModal({
  docId,
  shares,
  users,
  onClose,
}: {
  docId: string;
  shares: DocShare[];
  users: ChatUser[];
  onClose: () => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [permission, setPermission] = useState<"read" | "write">("read");

  const sharedUserIds = new Set(shares.map((s) => s.sharedWithUserId));
  const availableUsers = users.filter((u) => !u.isAgent && !sharedUserIds.has(u.id));

  const handleShare = useCallback(() => {
    if (!selectedUserId) return;
    shareDoc(docId, selectedUserId, permission);
    setSelectedUserId("");
  }, [docId, selectedUserId, permission]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-crust rounded-lg shadow-xl w-96 max-h-[80vh] flex flex-col border border-surface0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface0">
          <h3 className="text-md font-semibold text-text">Share Document</h3>
          <button onClick={onClose} className="text-overlay0 hover:text-text bg-transparent border-none cursor-pointer p-1">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-surface0">
          <div className="flex gap-2">
            <Select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="flex-1 px-2 rounded bg-mantle"
            >
              <option value="">Select user...</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
            <Select
              value={permission}
              onChange={(e) => setPermission(e.target.value as "read" | "write")}
              className="px-2 rounded bg-mantle"
            >
              <option value="read">Read</option>
              <option value="write">Write</option>
            </Select>
            <button
              onClick={handleShare}
              disabled={!selectedUserId}
              className={cn(
                "px-3 py-1.5 rounded text-md font-medium border-none transition-colors",
                selectedUserId
                  ? "bg-blue text-base cursor-pointer hover:bg-sapphire"
                  : "bg-surface0 text-overlay0 cursor-not-allowed"
              )}
            >
              Share
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 scrollbar-thin">
          {shares.length === 0 ? (
            <p className="text-md text-overlay0 py-2">Not shared with anyone yet.</p>
          ) : (
            shares.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  {s.sharedWithAvatar ? (
                    <img src={s.sharedWithAvatar} alt="" className="w-5 h-5 rounded-full" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-surface1 flex items-center justify-center text-md text-overlay0">
                      {s.sharedWithName[0]}
                    </div>
                  )}
                  <span className="text-md text-text">{s.sharedWithName}</span>
                  <span className="text-md text-overlay0 bg-surface0 px-1.5 py-0.5 rounded">
                    {s.permission}
                  </span>
                </div>
                <button
                  onClick={() => unshareDoc(docId, s.sharedWithUserId)}
                  className="text-md text-red hover:text-maroon bg-transparent border-none cursor-pointer px-1"
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// --- Section Header ---

function SectionHeader({
  label,
  isExpanded,
  onToggle,
  onNewDoc,
  onNewFolder,
  icon,
}: {
  label: string;
  isExpanded: boolean;
  onToggle: () => void;
  onNewDoc?: () => void;
  onNewFolder?: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1.5 mt-1 first:mt-0 group">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 flex-1 text-left border-none bg-transparent cursor-pointer text-md font-semibold uppercase tracking-wide text-overlay0 hover:text-subtext0 p-0"
      >
        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        <span className="truncate">{label}</span>
      </button>
      {onNewFolder && (
        <button
          onClick={onNewFolder}
          className="opacity-0 group-hover:opacity-100 text-overlay0 hover:text-text border-none bg-transparent cursor-pointer p-0.5"
          title="New folder"
        >
          <FolderPlus size={12} />
        </button>
      )}
      {onNewDoc && (
        <button
          onClick={onNewDoc}
          className="opacity-0 group-hover:opacity-100 text-overlay0 hover:text-text border-none bg-transparent cursor-pointer p-0.5"
          title="New doc"
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}

// --- Main Panel ---

export function DocsPanel() {
  const [docsState] = useSubject($docs);
  const { files, sharedFiles, publicFiles, folders, publicFolders, selectedDocId, title, content, loading, isOwner, permission, isPublic: docIsPublic, publicKey: docPublicKey, downloadingZip, activeShareDocId, currentDocShares } = docsState;
  const [conversationChat] = useSubject($conversationChat);
  const chatUsers = conversationChat.users;
  const [projects] = useSubject($projects);

  const [editContent, setEditContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [prevSelectedDocId, setPrevSelectedDocId] = useState<string | null>(null);
  const [prevContent, setPrevContent] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);
  const [newInputFolderId, setNewInputFolderId] = useState<string | null>(null);
  const [newInputProjectId, setNewInputProjectId] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [newFolderProjectId, setNewFolderProjectId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["my-docs"]));
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState("");
  const renamingFolderRef = useRef<HTMLInputElement>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const canEdit = isOwner || permission === "write";

  // Build a map of projectId -> project name
  const projectMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  // Group own files and folders by projectId
  const projectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of files) if (f.projectId) ids.add(f.projectId);
    for (const f of folders) if (f.projectId) ids.add(f.projectId);
    return [...ids].sort((a, b) => (projectMap.get(a) || "").localeCompare(projectMap.get(b) || ""));
  }, [files, folders, projectMap]);

  // Sync store content -> local edit state
  if (selectedDocId !== prevSelectedDocId || content !== prevContent) {
    setPrevSelectedDocId(selectedDocId);
    setPrevContent(content);
    setEditContent(content);
    setDirty(false);
  }

  useEffect(() => {
    loadDocsList();
  }, []);

  const handleSelectFile = useCallback((file: DocItem) => {
    openDoc(file.id);
  }, []);

  const handleSave = useCallback(() => {
    if (selectedDocId && canEdit) {
      saveDoc(selectedDocId, editContent);
      setDirty(false);
    }
  }, [selectedDocId, editContent, canEdit]);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDelete = useCallback(() => {
    if (!selectedDocId || !isOwner) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteDoc(selectedDocId);
    setConfirmingDelete(false);
  }, [selectedDocId, confirmingDelete, isOwner]);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [selectedDocId]);

  const handleNew = useCallback((folderId?: string | null, projectId?: string | null) => {
    setShowNewInput(true);
    setNewInputFolderId(folderId ?? null);
    setNewInputProjectId(projectId ?? null);
    setNewFileName("");
    setTimeout(() => newInputRef.current?.focus(), 0);
  }, []);

  const handleNewSubmit = useCallback(() => {
    const name = newFileName.trim();
    if (name) {
      createNewDoc(name, newInputFolderId, newInputProjectId);
    }
    setShowNewInput(false);
    setNewFileName("");
    setNewInputFolderId(null);
    setNewInputProjectId(null);
  }, [newFileName, newInputFolderId, newInputProjectId]);

  const handleNewKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleNewSubmit();
      } else if (e.key === "Escape") {
        setShowNewInput(false);
        setNewFileName("");
      }
    },
    [handleNewSubmit]
  );

  // Folder creation
  const handleNewFolder = useCallback((parentId?: string | null, projectId?: string | null) => {
    setShowNewFolderInput(true);
    setNewFolderParentId(parentId ?? null);
    setNewFolderProjectId(projectId ?? null);
    setNewFolderName("");
    setTimeout(() => newFolderInputRef.current?.focus(), 0);
  }, []);

  const handleNewFolderSubmit = useCallback(() => {
    const name = newFolderName.trim();
    if (name) {
      createFolder(name, newFolderParentId, newFolderProjectId);
    }
    setShowNewFolderInput(false);
    setNewFolderName("");
    setNewFolderParentId(null);
    setNewFolderProjectId(null);
  }, [newFolderName, newFolderParentId, newFolderProjectId]);

  const handleNewFolderKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleNewFolderSubmit();
      } else if (e.key === "Escape") {
        setShowNewFolderInput(false);
        setNewFolderName("");
      }
    },
    [handleNewFolderSubmit]
  );

  // Folder renaming
  const startRenameFolder = useCallback((folderId: string, currentName: string) => {
    setRenamingFolderId(folderId);
    setRenamingFolderName(currentName);
    setTimeout(() => renamingFolderRef.current?.focus(), 0);
  }, []);

  const handleRenameFolderSubmit = useCallback(() => {
    if (renamingFolderId && renamingFolderName.trim()) {
      renameFolder(renamingFolderId, renamingFolderName.trim());
    }
    setRenamingFolderId(null);
    setRenamingFolderName("");
  }, [renamingFolderId, renamingFolderName]);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);

  const handleTogglePublic = useCallback(() => {
    if (selectedDocId && isOwner) {
      toggleDocPublic(selectedDocId);
    }
  }, [selectedDocId, isOwner]);

  const handleCopyPublicLink = useCallback(() => {
    if (docPublicKey && typeof window !== "undefined") {
      const link = `${window.location.origin}/doc/${docPublicKey}`;
      navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  }, [docPublicKey]);

  const mdComponents = useMemo(() => ({
    input: ({ checked, ...props }: React.InputHTMLAttributes<HTMLInputElement>) =>
      props.type === "checkbox" ? (
        <span
          className={cn(
            "inline-block w-3.5 h-3.5 mr-1.5 rounded-sm border align-text-bottom",
            checked
              ? "bg-blue border-blue text-base"
              : "bg-transparent border-overlay0"
          )}
        >
          {checked && (
            <svg viewBox="0 0 14 14" fill="none" className="w-full h-full">
              <path d="M3 7l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      ) : (
        <input {...props} />
      ),
  }), []);

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setEditContent(e.target.value);
      setDirty(true);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (selectedDocId && dirty && canEdit) {
          saveDoc(selectedDocId, editContent);
          setDirty(false);
        }
      }
    },
    [selectedDocId, editContent, dirty, canEdit]
  );

  // Recursive folder tree renderer for a specific project scope
  const renderTree = useCallback(
    (parentId: string | null, depth: number, scopeFolders: FolderItem[], scopeFiles: DocItem[]) => {
      const childFolders = scopeFolders.filter((f) => f.parentId === parentId);
      const childDocs = scopeFiles.filter((f) => (f.folderId ?? null) === parentId);
      const indent = depth * 16;

      return (
        <>
          {childFolders.map((folder) => {
            const isExpanded = expandedFolders.has(folder.id);
            return (
              <div key={folder.id}>
                {renamingFolderId === folder.id ? (
                  <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: indent + 4 }}>
                    <input
                      ref={renamingFolderRef}
                      value={renamingFolderName}
                      onChange={(e) => setRenamingFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); handleRenameFolderSubmit(); }
                        else if (e.key === "Escape") { setRenamingFolderId(null); }
                      }}
                      onBlur={handleRenameFolderSubmit}
                      className="flex-1 min-w-0 px-1.5 py-0.5 rounded text-md bg-mantle text-text border border-surface1 outline-none focus:border-blue"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => toggleFolder(folder.id)}
                    onDoubleClick={() => !folder.ownerId && startRenameFolder(folder.id, folder.name)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (folder.ownerId) return; // read-only public folder
                      const action = window.prompt(`Folder: ${folder.name}\nType "rename", "delete", "new-doc", "new-folder", or "toggle-public":`);
                      if (action === "rename") startRenameFolder(folder.id, folder.name);
                      else if (action === "delete") deleteFolder(folder.id);
                      else if (action === "new-doc") handleNew(folder.id, folder.projectId);
                      else if (action === "new-folder") handleNewFolder(folder.id, folder.projectId);
                      else if (action === "toggle-public") toggleFolderPublic(folder.id);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 py-1 rounded-md text-left w-full",
                      "border-none cursor-pointer text-md transition-colors duration-150",
                      "bg-transparent text-overlay0 hover:bg-mantle hover:text-subtext0"
                    )}
                    style={{ paddingLeft: indent + 4 }}
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Folder size={14} className="shrink-0 text-yellow" />
                    <span className="truncate">{folder.name}</span>
                    {folder.isPublic && <Globe size={10} className="shrink-0 text-green" />}
                  </button>
                )}
                {isExpanded && renderTree(folder.id, depth + 1, scopeFolders, scopeFiles)}
              </div>
            );
          })}
          {childDocs.map((file) => (
            <button
              key={file.id}
              onClick={() => handleSelectFile(file)}
              className={cn(
                "flex items-center gap-2 py-1.5 rounded-md text-left w-full",
                "border-none cursor-pointer text-md transition-colors duration-150",
                file.id === selectedDocId
                  ? "bg-surface0 text-text"
                  : "bg-transparent text-overlay0 hover:bg-mantle hover:text-subtext0"
              )}
              style={{ paddingLeft: indent + 20 }}
            >
              <FileText size={14} className="shrink-0" />
              <span className="truncate flex-1">{file.title}</span>
              {file.isPublic && <Globe size={10} className="shrink-0 text-green" />}
              {file.permission === "read" && file.ownerId && (
                <span className="text-[10px] text-overlay0 bg-surface0 px-1 py-0.5 rounded shrink-0">r</span>
              )}
            </button>
          ))}
        </>
      );
    },
    [expandedFolders, selectedDocId, renamingFolderId, renamingFolderName, handleSelectFile, toggleFolder, startRenameFolder, handleRenameFolderSubmit, handleNew, handleNewFolder]
  );

  // Filter own files/folders for "My Docs" (projectId is null)
  const myDocFiles = useMemo(() => files.filter((f) => !f.projectId), [files]);
  const myDocFolders = useMemo(() => folders.filter((f) => !f.projectId), [folders]);

  // Filter public files/folders for personal scope (projectId is null)
  const myPublicFiles = useMemo(() => publicFiles.filter((f) => !f.projectId), [publicFiles]);
  const myPublicFolders = useMemo(() => publicFolders.filter((f) => !f.projectId), [publicFolders]);

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      <ViewHeader
        title="Docs"
        actions={
          <>
            <Button size="sm" onClick={() => downloadAllDocs()} disabled={downloadingZip}>
              <Download size={14} />
              {downloadingZip ? "..." : "Export"}
            </Button>
            <Button size="sm" onClick={() => handleNewFolder()}>
              <FolderPlus size={14} />
            </Button>
            <Button size="sm" onClick={() => handleNew()}>
              <Plus size={14} />
              New
            </Button>
          </>
        }
      />

      {/* Body: file list + editor */}
      <div className="flex-1 flex gap-3 overflow-hidden">
        {/* Left: file tree */}
        <div className="w-48 shrink-0 flex flex-col overflow-y-auto scrollbar-thin">
          {/* New folder input */}
          {showNewFolderInput && (
            <div className="flex items-center gap-1 px-1.5 py-1">
              <input
                ref={newFolderInputRef}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={handleNewFolderKeyDown}
                onBlur={handleNewFolderSubmit}
                placeholder="Folder name"
                className="flex-1 min-w-0 px-2 py-1 rounded text-md bg-mantle text-text border border-surface1 outline-none focus:border-blue"
              />
              <button
                onClick={() => { setShowNewFolderInput(false); setNewFolderName(""); }}
                className="text-overlay0 hover:text-text border-none bg-transparent cursor-pointer p-0.5"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* New doc input */}
          {showNewInput && (
            <div className="flex items-center gap-1 px-1.5 py-1">
              <input
                ref={newInputRef}
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={handleNewKeyDown}
                onBlur={handleNewSubmit}
                placeholder="Doc title"
                className="flex-1 min-w-0 px-2 py-1 rounded text-md bg-mantle text-text border border-surface1 outline-none focus:border-blue"
              />
              <button
                onClick={() => { setShowNewInput(false); setNewFileName(""); }}
                className="text-overlay0 hover:text-text border-none bg-transparent cursor-pointer p-0.5"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* My Docs section */}
          <SectionHeader
            label="My Docs"
            isExpanded={expandedSections.has("my-docs")}
            onToggle={() => toggleSection("my-docs")}
            onNewDoc={() => handleNew(null, null)}
            onNewFolder={() => handleNewFolder(null, null)}
            icon={<FileText size={12} className="text-blue" />}
          />
          {expandedSections.has("my-docs") && (
            <>
              {myDocFiles.length === 0 && myDocFolders.length === 0 && !loading && (
                <p className="text-md text-overlay0 px-4 py-2">No personal docs yet.</p>
              )}
              {renderTree(null, 0, myDocFolders, myDocFiles)}
              {/* Public docs from others in personal scope */}
              {myPublicFiles.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 px-3 py-1 mt-1">
                    <Globe size={10} className="text-green" />
                    <span className="text-md text-overlay0">Public</span>
                  </div>
                  {renderTree(null, 0, myPublicFolders, myPublicFiles)}
                </>
              )}
            </>
          )}

          {/* Per-project sections */}
          {projectIds.map((projId) => {
            const projName = projectMap.get(projId) || "Unknown Project";
            const sectionKey = `project-${projId}`;
            const projFiles = files.filter((f) => f.projectId === projId);
            const projFolders = folders.filter((f) => f.projectId === projId);
            const projPublicFiles = publicFiles.filter((f) => f.projectId === projId);
            const projPublicFolders = publicFolders.filter((f) => f.projectId === projId);

            return (
              <div key={projId}>
                <SectionHeader
                  label={projName}
                  isExpanded={expandedSections.has(sectionKey)}
                  onToggle={() => toggleSection(sectionKey)}
                  onNewDoc={() => handleNew(null, projId)}
                  onNewFolder={() => handleNewFolder(null, projId)}
                  icon={<Folder size={12} className="text-peach" />}
                />
                {expandedSections.has(sectionKey) && (
                  <>
                    {renderTree(null, 0, projFolders, projFiles)}
                    {projPublicFiles.length > 0 && (
                      <>
                        <div className="flex items-center gap-1.5 px-3 py-1 mt-1">
                          <Globe size={10} className="text-green" />
                          <span className="text-md text-overlay0">Public</span>
                        </div>
                        {renderTree(null, 0, projPublicFolders, projPublicFiles)}
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* Project sections for public docs from others (projects we don't have own docs in) */}
          {(() => {
            const ownProjectIds = new Set(projectIds);
            const publicOnlyProjectIds = new Set<string>();
            for (const f of publicFiles) if (f.projectId && !ownProjectIds.has(f.projectId)) publicOnlyProjectIds.add(f.projectId);
            for (const f of publicFolders) if (f.projectId && !ownProjectIds.has(f.projectId)) publicOnlyProjectIds.add(f.projectId);
            const sorted = [...publicOnlyProjectIds].sort((a, b) => (projectMap.get(a) || "").localeCompare(projectMap.get(b) || ""));
            return sorted.map((projId) => {
              const projName = projectMap.get(projId) || "Unknown Project";
              const sectionKey = `project-${projId}`;
              const projPublicFiles = publicFiles.filter((f) => f.projectId === projId);
              const projPublicFolders = publicFolders.filter((f) => f.projectId === projId);
              return (
                <div key={projId}>
                  <SectionHeader
                    label={projName}
                    isExpanded={expandedSections.has(sectionKey)}
                    onToggle={() => toggleSection(sectionKey)}
                    icon={<Globe size={12} className="text-green" />}
                  />
                  {expandedSections.has(sectionKey) && renderTree(null, 0, projPublicFolders, projPublicFiles)}
                </div>
              );
            });
          })()}

          {/* Shared with me section */}
          {sharedFiles.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 px-2 py-2 mt-3 border-t border-surface0">
                <Users size={12} className="text-overlay0" />
                <span className="text-md font-semibold uppercase tracking-wide text-overlay0">
                  Shared with me
                </span>
              </div>
              {sharedFiles.map((file) => (
                <button
                  key={file.id}
                  onClick={() => handleSelectFile(file)}
                  className={cn(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left w-full",
                    "border-none cursor-pointer text-md transition-colors duration-150",
                    file.id === selectedDocId
                      ? "bg-surface0 text-text"
                      : "bg-transparent text-overlay0 hover:bg-mantle hover:text-subtext0"
                  )}
                >
                  <FileText size={14} className="shrink-0" />
                  <span className="truncate flex-1">{file.title}</span>
                  <span className="text-[10px] text-overlay0 bg-surface0 px-1 py-0.5 rounded shrink-0">
                    {file.permission === "write" ? "rw" : "r"}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Right: editor */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {selectedDocId ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2 px-3 pb-2 mb-2 border-b border-surface0">
                <span className="text-md font-medium text-text truncate flex-1">
                  {title}
                  {dirty && canEdit && (
                    <span className="text-yellow ml-1 text-md">(unsaved)</span>
                  )}
                  {!canEdit && (
                    <span className="text-overlay0 ml-1 text-md">(read only)</span>
                  )}
                </span>
                {/* Public toggle */}
                {isOwner && (
                  <button
                    onClick={handleTogglePublic}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-md font-medium",
                      "border-none cursor-pointer transition-colors duration-150",
                      docIsPublic
                        ? "bg-green/20 text-green hover:bg-green/30"
                        : "bg-surface0 text-overlay0 hover:bg-surface1 hover:text-text"
                    )}
                    title={docIsPublic ? "Make private" : "Make public"}
                  >
                    {docIsPublic ? <Globe size={13} /> : <Lock size={13} />}
                    {docIsPublic ? "Public" : "Private"}
                  </button>
                )}
                {/* Copy public link */}
                {docIsPublic && docPublicKey && (
                  <button
                    onClick={handleCopyPublicLink}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-md font-medium",
                      "bg-surface0 text-text border-none cursor-pointer",
                      "hover:bg-surface1 transition-colors duration-150"
                    )}
                    title="Copy public link"
                  >
                    <Copy size={13} />
                    {copiedLink ? "Copied!" : "Link"}
                  </button>
                )}
                {isOwner && (
                  <button
                    onClick={() => openShareModal(selectedDocId)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-md font-medium",
                      "bg-surface0 text-text border-none cursor-pointer",
                      "hover:bg-surface1 transition-colors duration-150"
                    )}
                  >
                    <Share2 size={13} />
                    Share
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={handleSave}
                    disabled={!dirty || loading}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-md font-medium",
                      "bg-surface0 border-none transition-colors duration-150",
                      dirty
                        ? "text-text cursor-pointer hover:bg-surface1"
                        : "text-overlay0 cursor-not-allowed opacity-50"
                    )}
                  >
                    <Save size={13} />
                    Save
                  </button>
                )}
                {isOwner && (
                  <button
                    onClick={handleDelete}
                    onBlur={() => setConfirmingDelete(false)}
                    disabled={loading}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-md font-medium",
                      "border-none cursor-pointer transition-colors duration-150",
                      confirmingDelete
                        ? "bg-red text-base"
                        : "bg-surface0 text-red hover:bg-red hover:text-base"
                    )}
                  >
                    <Trash2 size={13} />
                    {confirmingDelete ? "Confirm?" : "Delete"}
                  </button>
                )}
              </div>

              {/* Editor + Preview split */}
              <div className="flex-1 flex gap-0 overflow-hidden">
                {/* Left: Textarea editor */}
                <textarea
                  value={editContent}
                  onChange={handleContentChange}
                  onKeyDown={handleKeyDown}
                  readOnly={!canEdit}
                  spellCheck={false}
                  className={cn(
                    "flex-1 resize-none p-3 rounded-l-md",
                    "bg-mantle text-text border border-surface0",
                    "font-mono text-md leading-relaxed",
                    "outline-none focus:border-blue",
                    "scrollbar-thin",
                    !canEdit && "opacity-75 cursor-default"
                  )}
                />
                {/* Right: Markdown preview */}
                <div
                  className={cn(
                    "flex-1 p-3 rounded-r-md overflow-y-auto select-text",
                    "bg-mantle text-text border border-l-0 border-surface0",
                    "scrollbar-thin"
                  )}
                >
                  <div className="chat-markdown">
                    <ReactMarkdown
                      key={selectedDocId}
                      remarkPlugins={[remarkGfm]}
                      components={mdComponents}
                    >
                      {editContent.replace(/\u00a0/g, " ")}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-overlay0">
              <FileText size={40} className="mb-3 opacity-40" />
              <p className="text-md">Select a doc or create a new one</p>
            </div>
          )}
        </div>
      </div>

      {/* Share modal */}
      {activeShareDocId && (
        <ShareModal
          docId={activeShareDocId}
          shares={currentDocShares}
          users={chatUsers}
          onClose={closeShareModal}
        />
      )}
    </div>
  );
}
