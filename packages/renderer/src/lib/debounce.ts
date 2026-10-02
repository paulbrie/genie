/** Trailing-edge debounce: returns a wrapper that delays calling `fn` until
 *  `ms` has passed since the last call. Each call resets the timer, so a burst
 *  (e.g. keystrokes in a filter) collapses to a single trailing invocation.
 *  Used to keep server-backed filters from firing a query per keystroke while
 *  the controlled input itself stays instant. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
}
