import { useEffect } from "react";
import { useSubject, useDeepSubject } from "subjecto/react";
import { $admin, $auth } from "@/store/subjects";
import { $orgSettings } from "@/store/subjects/org-settings";
import { loadProjectMembers, loadProjectTeams } from "@/store/actions";
import { loadMyOrgs } from "@/store/actions/org-settings";
import type { ProjectDef } from "@/store/types";

/**
 * May the active user manage *this* project — add/remove members, change
 * settings, add teams?
 *
 * Impersonation-safe by construction: it keys off `$auth.user` (the active
 * identity, which becomes the impersonated user) and `$orgSettings` (orgs the
 * active user owns/admins, scoped server-side to that identity). It deliberately
 * does NOT consult the broad `$admin.orgs` slice — that's loaded via admin
 * endpoints, isn't re-scoped on impersonation, and granted manage rights to
 * anyone who admins *any* org (so an impersonated plain member still saw owner
 * controls).
 *
 * Granted to: superadmins, owners on the project's own member roster, and
 * owners/admins of the org that owns the project's team (primary or any shared
 * team).
 */
export function useCanManageProject(project: ProjectDef): boolean {
  const [auth] = useSubject($auth);
  const [projectMembersMap] = useDeepSubject($admin, "projectMembers");
  const [projectTeamsMap] = useDeepSubject($admin, "projectTeams");
  const [myTeams] = useDeepSubject($orgSettings, "myTeams");
  const [mineFetched] = useDeepSubject($orgSettings, "mineFetched");

  useEffect(() => {
    // The gate must hold regardless of which surface mounted us first — e.g.
    // landing directly on the Settings tab never triggers the Members tab's
    // loads, which would leave an owner wrongly gated until they switched tabs.
    loadProjectMembers(project.id);
    loadProjectTeams(project.id);
    if (!mineFetched) loadMyOrgs();
  }, [project.id]);

  const members = projectMembersMap[project.id] || [];
  const projectTeams = projectTeamsMap[project.id] || [];

  if (auth.user?.role === "superadmin") return true;
  if (members.some((m) => m.userId === auth.user?.id && m.role === "owner")) return true;

  const myTeamIds = new Set(myTeams.map((t) => t.id));
  const projectTeamIds = [project.teamId, ...projectTeams.map((t) => t.teamId)].filter(Boolean) as string[];
  return projectTeamIds.some((id) => myTeamIds.has(id));
}
