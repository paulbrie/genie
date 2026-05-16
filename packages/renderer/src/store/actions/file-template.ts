import { wsSend } from "@/lib/ws";
import { $fileTemplates } from "../subjects/vps";

// --- File Template actions ---

export function loadFileTemplates(): void {
  $fileTemplates.nextAssign({ loading: true });
  wsSend("file-template:list", {});
}

export function createFileTemplate(name: string, description: string, files: Record<string, string>): void {
  wsSend("file-template:create", { name, description, files });
}

export function saveTemplateFromProject(projectId: string, name: string, description: string): void {
  wsSend("file-template:save-from-project", { projectId, name, description });
}

export function updateFileTemplate(id: string, patch: { name?: string; description?: string; files?: Record<string, string> }): void {
  wsSend("file-template:update", { id, ...patch });
}

export function deleteFileTemplate(id: string): void {
  wsSend("file-template:delete", { id });
}

export function injectFileTemplate(projectId: string, templateId: string, mode: "merge" | "replace"): void {
  wsSend("file-template:inject", { projectId, templateId, mode });
}

export function injectSingleFileFromTemplate(projectId: string, fileName: string, content: string): void {
  wsSend("project-file:save", { projectId, fileName, content });
}
