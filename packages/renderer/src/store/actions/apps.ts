import {
  $activeNav,
  $apps,
  $selectedAppId,
  $showAddForm,
  $viewingLogsFor,
} from "../subjects/common";
import { saveUiState } from "./ui";

export function selectApp(id: string): void {
  const app = $apps.getValue().find((a) => a.id === id);
  if (!app) return;
  $selectedAppId.next(id);
  $viewingLogsFor.next(id);
  $activeNav.next("apps");
  $showAddForm.next(false);
  saveUiState();
}

export function deselectApp(): void {
  $selectedAppId.next(null);
  $viewingLogsFor.next(null);
  saveUiState();
}
