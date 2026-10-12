/**
 * Who may manage a project (its servers' menu, Settings, owner-only actions) — the one rule, shared by the
 * per-request check (`userCanManageProject`) and the per-user project list (`getAllForUser` → `canManage`), so the
 * UI shows exactly what the server allows:
 *  - a superadmin;
 *  - the project's explicit owner (project_members.role = "owner");
 *  - an owner or admin of the org whose team owns the project (its primary `teamId`).
 * A plain project member, or a member of a team the project is shared with, may not.
 */
export function canManageProject(input: {
  superadmin: boolean;
  /** the user's role in project_members, if any */
  memberRole: string | null | undefined;
  /** the project's primary team */
  teamId: string | null | undefined;
  /** the teams of the orgs the user owns or admins */
  adminTeamIds: ReadonlySet<string>;
}): boolean {
  if (input.superadmin) return true;
  if (input.memberRole === "owner") return true;
  return !!input.teamId && input.adminTeamIds.has(input.teamId);
}

/**
 * Who may restart a project's servers (T219b, the user's rule: "project members should only be able to restart"):
 * whoever may manage it, and anyone on the project's own member roster (project_members, any role). Not someone who
 * only sees the project through a team it is shared with, nor through a team membership alone. The Manage console,
 * Detach and Remove stay manage-only.
 */
export function canRestartProject(input: Parameters<typeof canManageProject>[0]): boolean {
  return canManageProject(input) || !!input.memberRole;
}
