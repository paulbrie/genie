import { useState, useEffect } from "react";
import { useSubject } from "subjecto/react";
import type { DeepSubject } from "subjecto";
import { $windowManager } from "@/store/subjects";
import type { FloatingWindowState } from "@/store/types/common";

/** Subscribe to all changes in a DeepSubject and return the full proxied state. */
export function useDeepSubjectAll<T extends object>(subject: DeepSubject<T>): T {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const handle = subject.subscribe("**", () => forceUpdate((c) => c + 1));
    return () => handle.unsubscribe();
  }, [subject]);
  return subject.getValue();
}

/** True if this floating window currently has focus — i.e. it is the open
 *  window with the highest zIndex across the shared window-manager space.
 *  Used to drive the focused-popup border/glow treatment. */
export function useIsWindowFocused(windowState: FloatingWindowState): boolean {
  const [windowManager] = useSubject($windowManager);
  if (windowState.status !== "open") return false;
  let maxZ = 0;
  for (const w of Object.values(windowManager.windows)) {
    if (w.status === "open" && w.zIndex > maxZ) maxZ = w.zIndex;
  }
  return windowState.zIndex === maxZ;
}
