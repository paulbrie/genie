import { wsSend } from "@/lib/ws";
import {
  $activeNav,
  $filterPortsOnly,
  $logBuffers,
  $processSortBy,
  $selectedAppId,
  $showAddForm,
  $viewingLogsFor,
} from "../subjects/common";
import { $selectedProjectId, $showAddProjectForm } from "../subjects/vps";
import type { NavKey, UiState } from "../types/common";

export const UI_STATE_KEY = "genie-ui-state";

export function switchNav(nav: NavKey): void {
  $activeNav.next(nav);
  if (nav !== "apps") $showAddForm.next(false);
  if (nav !== "projects") $showAddProjectForm.next(false);
  sendPresenceNav(nav);
  saveUiState();
}

export function toggleSort(): void {
  $processSortBy.next($processSortBy.getValue() === "cpu" ? "mem" : "cpu");
  saveUiState();
}

export function togglePortFilter(): void {
  $filterPortsOnly.next(!$filterPortsOnly.getValue());
  saveUiState();
}

export function showAddForm(): void {
  $selectedAppId.next(null);
  $viewingLogsFor.next(null);
  $activeNav.next("apps");
  $showAddForm.next(true);
}

export function hideAddForm(): void {
  $showAddForm.next(false);
}

export function clearLogs(appId: string): void {
  const bufs = $logBuffers.getValue();
  $logBuffers.next({ ...bufs, [appId]: "" });
}

export function sendPresenceNav(nav: string): void {
  wsSend("presence:nav", { nav });
}

export function requestPresenceDetail(): void {
  wsSend("presence:detail", {});
}

export function submitFeedback(title: string, description: string): void {
  wsSend("feedback:submit", { title, description });
}

// --- UI state persistence ---

export function saveUiState(): void {
  if (typeof window === "undefined") return;
  const state: UiState = {
    activeNav: $activeNav.getValue(),
    selectedAppId: $selectedAppId.getValue(),
    selectedProjectId: $selectedProjectId.getValue(),
    processSortBy: $processSortBy.getValue(),
    filterPortsOnly: $filterPortsOnly.getValue(),
  };
  localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
}

export function loadUiState(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as UiState;
    $processSortBy.next(saved.processSortBy);
    $filterPortsOnly.next(saved.filterPortsOnly ?? false);
    // Nav state (activeNav, selectedAppId, selectedProjectId) is now
    // driven by the URL via useRouteSync. We only restore activeNav
    // here so the root "/" redirect knows the last-used nav.
    if (saved.activeNav) {
      $activeNav.next(saved.activeNav);
    }
  } catch {
    // ignore
  }
}
