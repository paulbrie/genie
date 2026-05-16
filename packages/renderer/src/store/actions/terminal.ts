import { wsSend } from "@/lib/ws";
import { $terminal } from "../subjects/vps";
import type { SshConfig, TerminalShareInvite, TerminalTab } from "../types/vps";

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
  const tab: TerminalTab = { id, title: title ?? `SSH ${ssh.host}`, ssh, command };
  const t = $terminal.getValue();
  $terminal.next({ ...t, tabs: [...t.tabs, tab], activeTabId: id, bottomPanelOpen: true });
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
