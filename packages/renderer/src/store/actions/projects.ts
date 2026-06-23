import { wsSend } from "@/lib/ws";
import { debounce } from "@/lib/debounce";
import { $activeNav } from "../subjects/common";
import {
  $commandRunOutputs,
  $projectsPaged,
  $selectedProjectId,
  $showAddProjectForm,
} from "../subjects/vps";
import { saveUiState, sendPresenceProject } from "./ui";

// --- Project actions ---

export function selectProject(id: string): void {
  $selectedProjectId.next(id);
  $activeNav.next("projects");
  $showAddProjectForm.next(false);
  sendPresenceProject(id);
  saveUiState();
}

export function deselectProject(): void {
  $selectedProjectId.next(null);
  sendPresenceProject(null);
  saveUiState();
}

export function showAddProjectForm(): void {
  $selectedProjectId.next(null);
  sendPresenceProject(null);
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

/** Rename a project. `project:update` merges — only the name changes; the server
 *  re-checks manage permission. */
export function renameProject(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  wsSend("project:update", { id, name: trimmed });
}

/** Delete a project. The server blocks removal while servers are still attached
 *  (and re-checks permission), so this only succeeds for an empty project. */
export function removeProject(id: string): void {
  wsSend("project:remove", { id });
}

// --- Paginated projects (Projects grid) ---

/** Send the current `$projectsPaged` window to the server for a fresh slice.
 *  Callers that change page/search/pageSize mutate the subject first and then
 *  invoke this, so the server gets a consistent snapshot. */
export function loadProjectsPaged(): void {
  const v = $projectsPaged.getValue();
  $projectsPaged.next({ ...v, loading: true });
  wsSend("project:list:paged", { page: v.page, pageSize: v.pageSize, search: v.search });
}

// Debounce the server query so typing in the filter doesn't fire a
// project:list:paged per keystroke; the input itself stays instant (state below
// updates synchronously).
const debouncedLoadProjectsPaged = debounce(() => loadProjectsPaged(), 300);

export function setProjectsSearch(search: string): void {
  const v = $projectsPaged.getValue();
  $projectsPaged.next({ ...v, search, page: 1 });
  debouncedLoadProjectsPaged();
}

export function setProjectsPage(page: number): void {
  const v = $projectsPaged.getValue();
  $projectsPaged.next({ ...v, page: Math.max(1, page) });
  loadProjectsPaged();
}

export function setProjectsPageSize(pageSize: number): void {
  const v = $projectsPaged.getValue();
  $projectsPaged.next({ ...v, pageSize, page: 1 });
  loadProjectsPaged();
}
