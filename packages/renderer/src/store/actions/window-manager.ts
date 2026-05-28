import { wsSend } from "@/lib/ws";
import { $windowManager } from "../subjects/common";
import type { FloatingWindowState, WindowManagerState } from "../types/common";

// --- Window manager actions ---

function wmSetWindow(wm: WindowManagerState, win: FloatingWindowState): WindowManagerState {
  return { ...wm, windows: { ...wm.windows, [win.id]: win } };
}

/** Project $windowManager into the wire shape the Connected Users panel
 *  actually shows. Focus, drag, busy and zIndex changes don't affect this
 *  projection, so a deep-equal guard on it is enough to keep the socket
 *  quiet during interactions without each mutator opting in/out by name. */
function projectWindows(): { title: string; icon: string; minimized: boolean }[] {
  return Object.values($windowManager.getValue().windows)
    .filter((w) => w.status !== "closed")
    .map((w) => ({ title: w.title, icon: w.icon, minimized: w.status === "minimized" }));
}

let lastProjection = JSON.stringify(projectWindows());

/** Unconditionally resend the full window list — used on (re)connect
 *  (auth:success) so the manager rehydrates this session after a socket
 *  drop reset its openWindows. Incremental changes are handled by the
 *  $windowManager subscription below. */
export function broadcastWindows(): void {
  const windows = projectWindows();
  lastProjection = JSON.stringify(windows);
  wsSend("presence:windows", { windows });
}

// Auto-broadcast on any $windowManager change whose projection differs from
// the last one sent. The diff naturally skips focus/move/busy/zIndex churn
// (none of those fields are in the projection), so individual mutators no
// longer need to remember to call broadcastWindows themselves.
$windowManager.subscribe(() => {
  const windows = projectWindows();
  const proj = JSON.stringify(windows);
  if (proj === lastProjection) return;
  lastProjection = proj;
  wsSend("presence:windows", { windows });
});

export function registerWindow(id: string, title: string, icon: string): void {
  const wm = $windowManager.getValue();
  if (wm.windows[id]) return;
  $windowManager.next(wmSetWindow(
    { ...wm, nextZIndex: wm.nextZIndex + 1 },
    { id, status: "closed", title, icon, position: { x: -1, y: -1 }, zIndex: wm.nextZIndex },
  ));
}

export function openWindow(id: string): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) $windowManager.next(wmSetWindow(wm, { ...win, status: "open" }));
}

export function minimizeWindow(id: string): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) $windowManager.next(wmSetWindow(wm, { ...win, status: "minimized" }));
}

export function restoreWindow(id: string): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) {
    $windowManager.next(wmSetWindow(
      { ...wm, nextZIndex: wm.nextZIndex + 1 },
      { ...win, status: "open", zIndex: wm.nextZIndex },
    ));
  }
}

export function closeWindow(id: string): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) $windowManager.next(wmSetWindow(wm, { ...win, status: "closed" }));
}

export function focusWindow(id: string): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) {
    $windowManager.next(wmSetWindow(
      { ...wm, nextZIndex: wm.nextZIndex + 1 },
      { ...win, zIndex: wm.nextZIndex },
    ));
  }
}

export function updateWindowPosition(id: string, pos: { x: number; y: number }): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) $windowManager.next(wmSetWindow(wm, { ...win, position: pos }));
}

export function updateWindowSize(id: string, size: { w: number; h: number }): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) $windowManager.next(wmSetWindow(wm, { ...win, size }));
}

export function setWindowBusy(id: string, busy: boolean): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) $windowManager.next(wmSetWindow(wm, { ...win, busy }));
}
