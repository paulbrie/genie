// Terminal connection logic intentionally removed — all connection-driving
// actions are no-ops while the new connection layer is being rebuilt.
// Public signatures preserved so callsites continue to compile.

import { $persistedTerminals, $terminal } from "../subjects/vps";
import type {
  ClaudeLaunchOptions,
  PersistedTerminalSession,
  SshConfig,
  TerminalTab,
} from "../types/vps";
import { claudeCommandLabel, defaultClaudeTabTitle, GENIE_PROJECT_DIR } from "@/lib/terminal-spawn";

// --- Local UI state (no connection) ---

export function toggleTerminalBottomPanel(): void {
  const t = $terminal.getValue();
  $terminal.nextAssign({ bottomPanelOpen: !t.bottomPanelOpen });
}

export function setTerminalBottomPanelHeight(height: number): void {
  $terminal.nextAssign({ bottomPanelHeight: Math.max(100, Math.min(500, height)) });
}

export const tabCounter = { value: 0 };

export function addTerminalTab(title?: string, command?: string): string {
  tabCounter.value++;
  const id = `tab-${Date.now()}-${tabCounter.value}`;
  const tab: TerminalTab = {
    id,
    title: title ?? `Terminal ${tabCounter.value}`,
    command,
  };
  const t = $terminal.getValue();
  $terminal.next({ ...t, tabs: [...t.tabs, tab], activeTabId: id });
  return id;
}

export function removeTerminalTab(id: string): void {
  const t = $terminal.getValue();
  const idx = t.tabs.findIndex((tab) => tab.id === id);
  if (idx === -1) return;
  const newTabs = t.tabs.filter((tab) => tab.id !== id);
  let newActiveId = t.activeTabId;
  let newOpen = t.bottomPanelOpen;
  if (t.activeTabId === id) {
    if (newTabs.length > 0) {
      newActiveId = newTabs[Math.min(idx, newTabs.length - 1)].id;
    } else {
      newActiveId = null;
      newOpen = false;
    }
  }
  $terminal.next({ ...t, tabs: newTabs, activeTabId: newActiveId, bottomPanelOpen: newOpen });
}

export function switchTerminalTab(id: string): void {
  $terminal.nextAssign({ activeTabId: id });
}

// --- Connection-triggering actions: stubbed to no-ops ---

export function addSshTerminalTab(_ssh: SshConfig, _title?: string, _command?: string): string {
  return "";
}

export function launchClaudeTmuxSshTab(
  _ssh: SshConfig,
  _title?: string,
  _opts?: ClaudeLaunchOptions,
): string {
  return "";
}

export function launchClaudeDirectSshTab(
  _ssh: SshConfig,
  _title?: string,
  _opts?: ClaudeLaunchOptions,
): string {
  return "";
}

export { claudeCommandLabel, defaultClaudeTabTitle, GENIE_PROJECT_DIR };

// --- Persisted sessions registry — stubbed ---

export function loadPersistedTerminals(
  filters?: Partial<{
    projectId: string | null;
    instanceId: string | null;
    vpsHost: string | null;
    ownerId: string | null | undefined;
  }>,
): void {
  const state = $persistedTerminals.getValue();
  const merged = { ...state.filters, ...(filters || {}) };
  $persistedTerminals.nextAssign({ loading: false, sessions: [], filters: merged });
}

export function reattachPersistedTerminal(_record: PersistedTerminalSession): void {}

export function reconnectTerminalTab(_id: string): void {}

export function forgetPersistedTerminal(_id: string): void {}

export function killPersistedTerminal(_id: string): void {}

// Type-only re-export to keep external callers compiling without importing
// TerminalTab directly here.
export type { TerminalTab };
