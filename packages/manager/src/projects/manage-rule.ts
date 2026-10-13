/**
 * Who may manage a project, and who may restart its servers: the one rule, shared by the per-request checks
 * (`userCanManageProject`, `userCanRestartProject`) and the per-user project list (`getAllForUser` → `canManage`,
 * `canRestart`), so the UI shows exactly what the server allows.
 */
export interface ProjectAccessInput {
  superadmin: boolean;
  /** the user's role in project_members, if any */
  memberRole: string | null | undefined;
  /** the project's primary team */
  teamId: string | null | undefined;
  /** the teams the project is also shared with (project_teams) */
  sharedTeamIds?: readonly string[];
  /** the teams of the orgs the user owns or admins */
  adminTeamIds: ReadonlySet<string>;
  /** the teams the user owns (team_members.role "owner" or "superadmin") */
  ownedTeamIds?: ReadonlySet<string>;
  /** every team the user is a member of, any role */
  memberTeamIds?: ReadonlySet<string>;
}

/**
 * Who may manage a project (its servers' menu, Settings, owner-only actions):
 *  - a superadmin;
 *  - the project's explicit owner (project_members.role = "owner");
 *  - an owner or admin of the org whose team owns the project (its primary `teamId`);
 *  - an owner of the team that owns the project (T219c: "the owner of the project" is often its team's owner).
 * A plain project member, a plain team member, or anyone on a team the project is shared with may not.
 */
export function canManageProject(input: ProjectAccessInput): boolean {
  if (input.superadmin) return true;
  if (input.memberRole === "owner") return true;
  if (!input.teamId) return false;
  return input.adminTeamIds.has(input.teamId) || !!input.ownedTeamIds?.has(input.teamId);
}

/**
 * Who may restart a project's servers (T219b, T219d; the user's rule: project members may restart, and so may anyone
 * the project is given to through a team): whoever may manage it, anyone on its member roster (project_members, any
 * role), and any member of its team or of a team it is shared with. The Manage console, Detach and Remove stay
 * manage-only.
 */
export function canRestartProject(input: ProjectAccessInput): boolean {
  if (canManageProject(input) || !!input.memberRole) return true;
  const mine = input.memberTeamIds;
  if (!mine?.size) return false;
  return [input.teamId, ...(input.sharedTeamIds ?? [])].some(t => !!t && mine.has(t));
}
