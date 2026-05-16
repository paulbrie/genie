// Auth-related action functions.

import { wsSend } from "@/lib/ws";

/** Superadmin starts impersonating another user. The manager swaps the WS
 *  session's userId and replies with a fresh `auth:success` whose payload
 *  carries an `impersonatedBy` block — the UI shows that as a banner. */
export function impersonateUser(userId: string): void {
  wsSend("admin:impersonate:start", { userId });
}

/** End an in-progress impersonation session. The manager restores the original
 *  superadmin identity and replies with `auth:success` whose `impersonatedBy`
 *  is cleared. */
export function stopImpersonating(): void {
  wsSend("admin:impersonate:stop", {});
}
