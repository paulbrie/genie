import { wsSend } from "@/lib/ws";
import { $fileEditor } from "../subjects/vps";

// --- File editor actions ---

export function loadProjectFiles(projectId: string): void {
  $fileEditor.next({ projectId, files: [], selectedFile: null, content: null, savedContent: null, loading: true, saving: false, error: null });
  wsSend("project-file:list", { projectId });
}

export function selectFile(fileName: string): void {
  const fe = $fileEditor.getValue();
  $fileEditor.nextAssign({ selectedFile: fileName, content: null, savedContent: null, loading: true, error: null });
  wsSend("project-file:read", { projectId: fe.projectId, fileName });
}

export function saveFile(content: string): void {
  const fe = $fileEditor.getValue();
  $fileEditor.nextAssign({ saving: true, error: null });
  wsSend("project-file:save", { projectId: fe.projectId, fileName: fe.selectedFile, content });
}

export function updateFileContent(content: string): void {
  $fileEditor.nextAssign({ content });
}

export function clearFileEditor(): void {
  $fileEditor.next({ projectId: null, files: [], selectedFile: null, content: null, savedContent: null, loading: false, saving: false, error: null });
}

export function deleteProjectFile(fileName: string): void {
  const fe = $fileEditor.getValue();
  if (!fe.projectId) return;
  wsSend("project-file:delete", { projectId: fe.projectId, fileName });
}

export function addProjectFile(fileName: string): void {
  const fe = $fileEditor.getValue();
  if (!fe.projectId) return;
  wsSend("project-file:add", { projectId: fe.projectId, fileName });
}

export function renameProjectFile(oldName: string, newName: string): void {
  const fe = $fileEditor.getValue();
  if (!fe.projectId) return;
  wsSend("project-file:rename", { projectId: fe.projectId, oldName, newName });
  $fileEditor.nextAssign({
    files: fe.files.map((f) => (f === oldName ? newName : f)),
    selectedFile: fe.selectedFile === oldName ? newName : fe.selectedFile,
  });
}

export function importProjectFilesFromDisk(): void {
  const fe = $fileEditor.getValue();
  if (!fe.projectId) return;
  wsSend("project-file:import-from-disk", { projectId: fe.projectId });
}
