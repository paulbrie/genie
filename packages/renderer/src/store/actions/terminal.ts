import { wsSend } from "@/lib/ws";
import { disposeTerminal } from "@/lib/terminal-bridge";
import { WINDOW_PREFIX } from "@/components/terminal/terminal-window";
import { $persistedTerminals, $terminal } from "../subjects/vps";
import { $windowManager } from "../subjects/common";
import { openWindow } from "./window-manager";
import {
  claudeCommandLabel,
  defaultClaudeTabTitle,
  GENIE_PROJECT_DIR,
} from "@/lib/terminal-spawn";
import type {
  ClaudeLaunchOptions,
  PersistedTerminalSession,
  SshConfig,
  TerminalShareInvite,
  TerminalTab,
} from "../types/vps";

// --- Terminal actions ---

export function toggleTerminalBottomPanel(): void {
  const t = $terminal.getValue();
  $terminal.nextAssign({ bottomPanelOpen: !t.bottomPanelOpen });
}

export function setTerminalBottomPanelHeight(height: number): void {
  $terminal.nextAssign({ bottomPanelHeight: Math.max(100, Math.min(500, height)) });
}

// Module-shared tab counter used by all tab-creating actions and by the
// terminal:sessions:list handler when accepting share invites.
export const tabCounter = { value: 0 };

export function addTerminalTab(cwd?: string, title?: string, command?: string): string {
  tabCounter.value++;
  const id = `tab-${Date.now()}-${tabCounter.value}`;
  const tab: TerminalTab = { id, title: title ?? `Terminal ${tabCounter.value}`, cwd, command };
  const t = $terminal.getValue();
  $terminal.next({ ...t, tabs: [...t.tabs, tab], activeTabId: id, bottomPanelOpen: true });
  return id;
}

export function addSshTerminalTab(ssh: SshConfig, title?: string, command?: string): string {
  tabCounter.value++;
  const id = `tab-${Date.now()}-${tabCounter.value}`;
  const tab: TerminalTab = { id, title: title ?? `SSH ${ssh.host}`, ssh, kind: "shell", command };
  const t = $terminal.getValue();
  $terminal.next({ ...t, tabs: [...t.tabs, tab], activeTabId: id, bottomPanelOpen: true });
  return id;
}

/** Open an SSH terminal that starts Claude Code in `/opt/project` via server tmux. */
export function launchClaudeSshTab(
  ssh: SshConfig,
  title?: string,
  opts?: ClaudeLaunchOptions,
): string {
  tabCounter.value++;
  const id = `tab-${Date.now()}-${tabCounter.value}`;
  const tab: TerminalTab = {
    id,
    title: title ?? defaultClaudeTabTitle(ssh),
    ssh,
    kind: "claude",
    claudeLaunch: {
      cwd: opts?.cwd ?? GENIE_PROJECT_DIR,
      resume: opts?.resume,
    },
  };
  const t = $terminal.getValue();
  $terminal.next({ ...t, tabs: [...t.tabs, tab], activeTabId: id, bottomPanelOpen: true });
  return id;
}

/** Label stored on the server for History / reattach (no `cd` compound command). */
export { claudeCommandLabel };

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

// --- Terminal sharing actions ---

export function shareTerminal(sessionId: string, targetUserId: string, conversationId?: string): void {
  wsSend("terminal:share", { sessionId, targetUserId, conversationId });
}

export function acceptTerminalShare(invite: TerminalShareInvite): void {
  tabCounter.value++;
  const tab: TerminalTab = {
    id: invite.sessionId, title: `${invite.ownerName}'s Terminal`,
    shared: true, ownerId: invite.ownerId, ownerName: invite.ownerName,
  };
  const t = $terminal.getValue();
  $terminal.next({
    ...t, tabs: [...t.tabs, tab], activeTabId: invite.sessionId,
    bottomPanelOpen: true, shareInvites: t.shareInvites.filter((i) => i.sessionId !== invite.sessionId),
  });
  wsSend("terminal:share:accept", { sessionId: invite.sessionId });
}

export function declineTerminalShare(sessionId: string): void {
  const t = $terminal.getValue();
  $terminal.nextAssign({ shareInvites: t.shareInvites.filter((i) => i.sessionId !== sessionId) });
}

export function leaveSharedTerminal(sessionId: string): void {
  wsSend("terminal:share:leave", { sessionId });
  removeTerminalTab(sessionId);
}

// --- Persisted terminal sessions (the Terminals tab in History) ---

export function loadPersistedTerminals(filters?: Partial<{ projectId: string | null; instanceId: string | null; vpsHost: string | null; ownerId: string | null | undefined }>): void {
  const state = $persistedTerminals.getValue();
  const merged = { ...state.filters, ...(filters || {}) };
  $persistedTerminals.nextAssign({ loading: true, filters: merged });
  // Only send filters with concrete values; undefined ownerId means "use server default".
  const payload: Record<string, unknown> = {};
  if (merged.projectId) payload.projectId = merged.projectId;
  if (merged.instanceId) payload.instanceId = merged.instanceId;
  if (merged.vpsHost) payload.vpsHost = merged.vpsHost;
  if (merged.ownerId !== undefined) payload.ownerId = merged.ownerId;
  wsSend("terminal:list", payload);
}

/** Click "Reattach" on a persisted row. Reuses the same id so tmux on the VPS
 *  attaches to the existing session instead of starting a new one. The various
 *  terminal render components (terminal-window, terminal-panel,
 *  terminal-bottom-panel) branch on `tab.reattach` and send
 *  `terminal:reattach { id, cols, rows }` instead of a fresh spawn. */
export function reattachPersistedTerminal(record: PersistedTerminalSession): void {
  const title = record.commandLabel || (record.kind === "claude" ? "Claude" : "SSH") + ` · ${record.vpsHost}`;
  const newTab: TerminalTab = {
    id: record.id,
    title,
    reattach: true,
  };
  const t = $terminal.getValue();
  const existing = t.tabs.find((x) => x.id === record.id);
  if (!existing) {
    $terminal.next({ ...t, tabs: [...t.tabs, newTab], activeTabId: record.id, bottomPanelOpen: true });
    return;
  }

  // A tab for this id is already present (e.g. opened before tmux wrapping,
  // or user clicked Reattach twice). React re-uses the SingleTerminalWindow
  // component because `key={tab.id}` doesn't change, so its `mountedRef`
  // stays true and the spawn logic never re-runs. Force a real unmount→remount:
  //
  //   1. Close the server-side PTY + dispose the local xterm instance.
  //   2. Remove the tab AND close the floating window so the component truly
  //      unmounts (the render returns null when window status !== "open").
  //   3. On the next animation frame, re-add the tab with reattach:true and
  //      re-open the window. Fresh component mount → spawn logic runs → it
  //      sees `tab.reattach` and sends `terminal:reattach`.
  wsSend("terminal:close", { id: record.id });
  disposeTerminal(record.id);
  const windowId = WINDOW_PREFIX + record.id;
  const filtered = t.tabs.filter((x) => x.id !== record.id);
  // Step 2: tab gone → TerminalWindows' cleanup useEffect calls closeWindow,
  // status flips to "closed", SingleTerminalWindow returns null and unmounts.
  $terminal.next({ ...t, tabs: filtered, activeTabId: filtered.length > 0 ? filtered[filtered.length - 1].id : null });

  // Step 3: wait one rAF for React to commit the unmount, then re-add. Using
  // rAF (not setTimeout 0) so we sit after the DOM update for sure.
  requestAnimationFrame(() => {
    const t2 = $terminal.getValue();
    $terminal.next({ ...t2, tabs: [...t2.tabs, newTab], activeTabId: record.id, bottomPanelOpen: true });
    // Re-open the floating window (closeWindow above only sets status="closed";
    // openWindow flips it back so the render-time `ws.status === "open"` check
    // mounts SingleTerminalWindow again with a fresh mountedRef).
    if ($windowManager.getValue().windows[windowId]) openWindow(windowId);
  });
}

export function forgetPersistedTerminal(id: string): void {
  wsSend("terminal:forget", { id });
}

/** Hard-kill a persisted session: closes the in-memory PTY (if any), kills the
 *  tmux session on the VPS, and drops the registry row. Use this from the
 *  Sessions tab — `forget` only drops the row and can leak tmux on the VPS. */
export function killPersistedTerminal(id: string): void {
  wsSend("terminal:kill", { id });
}
