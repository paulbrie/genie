const PENDING_INVITE_KEY = "genie-pending-invite-token";

export function getPendingInviteToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PENDING_INVITE_KEY);
}

export function setPendingInviteToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PENDING_INVITE_KEY, token);
}

export function clearPendingInviteToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PENDING_INVITE_KEY);
}
