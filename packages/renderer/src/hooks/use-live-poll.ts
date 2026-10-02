import { useEffect, useRef } from "react";

const DEFAULT_IDLE_MS = 120_000;

/**
 * A polling interval that only does work while the tab is **visible** AND the
 * user has interacted within `idleAfterMs`. The local timer keeps ticking, but
 * `fn` (which typically fires an expensive `vps:exec` / `vps:stats:refresh` WS
 * call to a VM) is skipped when the browser is backgrounded or the user is idle
 * — so an unattended tab stops hammering the VM + bastion. `fn` also runs
 * immediately on mount and again the instant the tab/user becomes active after a
 * pause, so live data is fresh the moment someone's actually looking.
 *
 * Drop-in replacement for `useEffect(() => setInterval(fn, ms), …)` poll loops.
 */
export function useLivePoll(
  fn: () => void,
  intervalMs: number,
  opts?: { idleAfterMs?: number; enabled?: boolean },
): void {
  const idleAfter = opts?.idleAfterMs ?? DEFAULT_IDLE_MS;
  const enabled = opts?.enabled ?? true;
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (!enabled) return;
    const active = () =>
      document.visibilityState === "visible" && Date.now() - lastActivityRef.current < idleAfter;

    if (active()) fnRef.current();
    const id = window.setInterval(() => { if (active()) fnRef.current(); }, intervalMs);

    // Any interaction marks the user active; if we were idle, refresh right away
    // so the resume is instant (not delayed up to intervalMs).
    const wake = () => {
      const wasIdle = !active();
      lastActivityRef.current = Date.now();
      if (wasIdle && document.visibilityState === "visible") fnRef.current();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") wake(); };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "wheel", "touchstart"];
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(id);
      for (const e of events) window.removeEventListener(e, wake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, idleAfter, enabled]);
}
