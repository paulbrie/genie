import { useState, useEffect } from "react";
import type { DeepSubject } from "subjecto";

/** Subscribe to all changes in a DeepSubject and return the full proxied state. */
export function useDeepSubjectAll<T extends object>(subject: DeepSubject<T>): T {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const handle = subject.subscribe("**", () => forceUpdate((c) => c + 1));
    return () => handle.unsubscribe();
  }, [subject]);
  return subject.getValue();
}
