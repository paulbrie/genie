import { wsSend } from "@/lib/ws";
import { $activeNav } from "../subjects/common";
import {
  $commandRunOutputs,
  $selectedProjectId,
  $showAddProjectForm,
} from "../subjects/vps";
import { saveUiState } from "./ui";

// --- Project actions ---

export function selectProject(id: string): void {
  $selectedProjectId.next(id);
  $activeNav.next("projects");
  $showAddProjectForm.next(false);
  saveUiState();
}

export function deselectProject(): void {
  $selectedProjectId.next(null);
  saveUiState();
}

export function showAddProjectForm(): void {
  $selectedProjectId.next(null);
  $activeNav.next("projects");
  $showAddProjectForm.next(true);
}

export function hideAddProjectForm(): void {
  $showAddProjectForm.next(false);
}

export function runProjectCommand(projectId: string, commandId: string, instanceId: string): void {
  const key = `${projectId}:${commandId}`;
  const outputs = $commandRunOutputs.getValue();
  $commandRunOutputs.next({ ...outputs, [key]: { output: "", running: true, exitCode: null } });
  wsSend("project:command:run", { projectId, commandId, instanceId });
}

export function stopProjectCommand(projectId: string, commandId: string): void {
  wsSend("project:command:stop", { projectId, commandId });
}
