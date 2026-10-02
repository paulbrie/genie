import { wsSend } from "@/lib/ws";

/**
 * Record a first-party UI analytics event. Server-authoritative events (logins,
 * terminal opens, …) are tracked on the manager; this is for UI-only signals the
 * browser owns (tab focus, nav, opening the Manage popup).
 *
 * The server allowlists event names and stamps userId/ip — only send metadata,
 * never sensitive values. No-ops silently if the socket isn't open.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  try {
    wsSend("analytics:track", { event, props: props ?? {} });
  } catch {
    /* analytics must never break the UI */
  }
}
