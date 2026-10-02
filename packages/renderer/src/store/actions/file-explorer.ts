import { genie } from "@/lib/genie-api";
import { $fileExplorer } from "../subjects/common";

// --- File Explorer actions ---

export async function toggleFileExplorer(): Promise<void> {
  const fe = $fileExplorer.getValue();
  $fileExplorer.nextAssign({ open: !fe.open });
  if (!fe.open && !fe.currentPath) {
    const home = await genie.getHomePath();
    await navigateTo(home);
  }
}

export async function navigateTo(dirPath: string): Promise<void> {
  $fileExplorer.nextAssign({ loading: true, error: null, selectedEntry: null, renamingEntry: null });
  const result = await genie.readDirectory(dirPath);
  const fe = $fileExplorer.getValue();
  if (result.ok && result.entries) {
    const newHistory = fe.history.slice(0, fe.historyIndex + 1);
    newHistory.push(dirPath);
    $fileExplorer.nextAssign({ entries: result.entries, currentPath: dirPath, history: newHistory, historyIndex: newHistory.length - 1, loading: false });
  } else {
    $fileExplorer.nextAssign({ error: result.error || "Failed to read directory", loading: false });
  }
}

export async function navigateBack(): Promise<void> {
  const fe = $fileExplorer.getValue();
  if (fe.historyIndex <= 0) return;
  const prevPath = fe.history[fe.historyIndex - 1];
  $fileExplorer.nextAssign({ loading: true, error: null, selectedEntry: null, renamingEntry: null });
  const result = await genie.readDirectory(prevPath);
  if (result.ok && result.entries) {
    $fileExplorer.nextAssign({ entries: result.entries, currentPath: prevPath, historyIndex: fe.historyIndex - 1, loading: false });
  } else {
    $fileExplorer.nextAssign({ error: result.error || "Failed to read directory", loading: false });
  }
}

export async function navigateForward(): Promise<void> {
  const fe = $fileExplorer.getValue();
  if (fe.historyIndex >= fe.history.length - 1) return;
  const nextPath = fe.history[fe.historyIndex + 1];
  $fileExplorer.nextAssign({ loading: true, error: null, selectedEntry: null, renamingEntry: null });
  const result = await genie.readDirectory(nextPath);
  if (result.ok && result.entries) {
    $fileExplorer.nextAssign({ entries: result.entries, currentPath: nextPath, historyIndex: fe.historyIndex + 1, loading: false });
  } else {
    $fileExplorer.nextAssign({ error: result.error || "Failed to read directory", loading: false });
  }
}

export async function navigateUp(): Promise<void> {
  const fe = $fileExplorer.getValue();
  if (!fe.currentPath || fe.currentPath === "/") return;
  const parent = fe.currentPath.replace(/\/[^/]+\/?$/, "") || "/";
  await navigateTo(parent);
}

export async function refreshDirectory(): Promise<void> {
  const fe = $fileExplorer.getValue();
  if (!fe.currentPath) return;
  $fileExplorer.nextAssign({ loading: true, error: null });
  const result = await genie.readDirectory(fe.currentPath);
  if (result.ok && result.entries) {
    $fileExplorer.nextAssign({ entries: result.entries, loading: false });
  } else {
    $fileExplorer.nextAssign({ error: result.error || "Failed to read directory", loading: false });
  }
}

export function selectFileEntry(entryPath: string | null): void {
  $fileExplorer.nextAssign({ selectedEntry: entryPath });
}

export function setRenamingEntry(entryPath: string | null): void {
  $fileExplorer.nextAssign({ renamingEntry: entryPath });
}

export function setFileExplorerPanelWidth(width: number): void {
  $fileExplorer.nextAssign({ panelWidth: Math.max(280, Math.min(800, width)) });
}
