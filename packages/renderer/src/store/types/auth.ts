// --- Auth types ---

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin?: boolean;
  role: "user" | "tazcloud" | "admin" | "superadmin";
  /** Most recent changelog version this user has acknowledged. Used by the
   *  "What's new" modal to decide whether to pop on next login. Null for
   *  users who have never seen it. */
  lastSeenUpdateVersion?: string | null;
}

/** When a superadmin starts an impersonation session, the server keeps a record
 *  of the original (real) caller. The UI shows a banner with the impersonator
 *  so it's never ambiguous who's really driving. */
export interface ImpersonatedBy {
  id: string;
  name: string;
  email: string;
}

export interface AuthState {
  status: "loading" | "unauthenticated" | "authenticated";
  user: AuthUser | null;
  token: string | null;
  /** Non-null while a superadmin is impersonating another user. */
  impersonatedBy: ImpersonatedBy | null;
}
