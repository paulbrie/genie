import { useEffect, useState } from "react";
import { Crown, Plus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeepSubject } from "subjecto/react";
import { $admin } from "@/store/subjects";
import {
  addProjectMember,
  addProjectTeam,
  loadAdminTeams,
  loadAdminUsers,
  loadProjectMembers,
  loadProjectTeams,
  removeProjectMember,
  removeProjectTeam,
  setProjectMemberRole,
} from "@/store/actions";
import { useCanManageProject } from "@/lib/use-project-permissions";
import type { ProjectDef } from "@/store/types";

export function ProjectMembersTab({ project }: { project: ProjectDef }) {
  // Subscribe to the relevant $admin slices. useDeepSubject only accepts
  // top-level keys.
  const [projectMembersMap] = useDeepSubject($admin, "projectMembers");
  const [projectTeamsMap] = useDeepSubject($admin, "projectTeams");
  const [usersSlice] = useDeepSubject($admin, "users");
  const [teamsSlice] = useDeepSubject($admin, "teams");
  const allUsers = usersSlice.list;
  const allTeams = teamsSlice.list;
  const members = projectMembersMap[project.id] || [];
  const projectTeams = projectTeamsMap[project.id] || [];
  const [adding, setAdding] = useState(false);
  const [addingTeam, setAddingTeam] = useState(false);

  useEffect(() => {
    loadProjectMembers(project.id);
    loadProjectTeams(project.id);
    // The add-member / add-team pickers need the user and team lists. Loading is
    // idempotent — if they're already populated the server just responds again.
    if (allUsers.length === 0) loadAdminUsers();
    if (allTeams.length === 0) loadAdminTeams();
  }, [project.id]);

  // Project-scoped, impersonation-safe manage gate (server still enforces).
  // A plain project member sees no management affordances. See the hook for why
  // we don't key off the broad $admin.orgs slice.
  const canManage = useCanManageProject(project);

  // Users available to add: any non-agent user not yet in the project.
  const memberUserIds = new Set(members.map((m) => m.userId));
  const candidates = allUsers.filter((u) => !u.isAgent && !memberUserIds.has(u.id));

  // Teams available to add: any team that isn't the primary owner and isn't
  // already a secondary team on this project.
  const usedTeamIds = new Set([project.teamId, ...projectTeams.map((t) => t.teamId)].filter(Boolean));
  const candidateTeams = allTeams.filter((t) => !usedTeamIds.has(t.id));

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Project Members</h3>
        {canManage && !adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} className="mr-1" /> Add Member
          </Button>
        )}
      </div>

      {canManage && adding && (
        <div className="flex items-center gap-2">
          <select
            className="bg-surface0 border border-surface1 rounded px-3 py-1.5 text-md text-text flex-1 max-w-md"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                addProjectMember(project.id, e.target.value, "member");
                setAdding(false);
              }
            }}
            autoFocus
          >
            <option value="" disabled>
              Select user...
            </option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            <X size={14} />
          </Button>
        </div>
      )}

      {members.length === 0 ? (
        <p className="text-subtext0">No members yet — only org owners/admins and superadmins can see this project.</p>
      ) : (
        <div className="border border-surface0 rounded-lg overflow-hidden">
          {members.map((m) => {
            const user = allUsers.find((u) => u.id === m.userId);
            const isOwner = m.role === "owner";
            return (
              <div
                key={m.id}
                className="flex items-center justify-between px-4 py-2.5 border-b border-surface0/50 last:border-0"
              >
                <div className="flex items-center gap-2">
                  {(user?.avatarUrl || m.userAvatarUrl) && (
                    <img
                      src={user?.avatarUrl || m.userAvatarUrl || ""}
                      alt=""
                      className="w-6 h-6 rounded-full"
                    />
                  )}
                  <span className="font-medium">{user?.name || m.userName || m.userId}</span>
                  <span className="text-subtext0 text-md">{user?.email || m.userEmail}</span>
                  <span className={`text-xs uppercase ${isOwner ? "text-yellow" : "text-overlay0"}`}>
                    {m.role}
                  </span>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant={isOwner ? "default" : "ghost"}
                      onClick={() =>
                        setProjectMemberRole(project.id, m.userId, isOwner ? "member" : "owner")
                      }
                      title={isOwner ? "Demote to member" : "Promote to owner"}
                    >
                      <Crown size={14} className={isOwner ? "text-yellow" : ""} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red hover:text-red"
                      onClick={() => removeProjectMember(project.id, m.userId)}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-overlay0">
        Owners can manage other members. Members can access the project but can't add/remove others.
        Org owners and admins automatically see every project in their org, even without a direct
        membership row.
      </p>

      {/* --- Project Teams (secondary, multi-team access) --- */}
      <div className="flex items-center justify-between pt-2">
        <h3 className="text-lg font-medium">Project Teams</h3>
        {canManage && !addingTeam && candidateTeams.length > 0 && (
          <Button size="sm" onClick={() => setAddingTeam(true)}>
            <Plus size={14} className="mr-1" /> Add Team
          </Button>
        )}
      </div>

      {canManage && addingTeam && (
        <div className="flex items-center gap-2">
          <select
            className="bg-surface0 border border-surface1 rounded px-3 py-1.5 text-md text-text flex-1 max-w-md"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                addProjectTeam(project.id, e.target.value);
                setAddingTeam(false);
              }
            }}
            autoFocus
          >
            <option value="" disabled>
              Select team...
            </option>
            {candidateTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={() => setAddingTeam(false)}>
            <X size={14} />
          </Button>
        </div>
      )}

      <div className="border border-surface0 rounded-lg overflow-hidden">
        {/* Primary owning team — always present, not removable here. */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface0/50 last:border-0">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-overlay0" />
            <span className="font-medium">{project.teamName || "— no primary team —"}</span>
            <span className="text-xs uppercase text-yellow">owner</span>
          </div>
        </div>
        {projectTeams.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between px-4 py-2.5 border-b border-surface0/50 last:border-0"
          >
            <div className="flex items-center gap-2">
              <Users size={14} className="text-overlay0" />
              <span className="font-medium">{t.teamName || t.teamId}</span>
              <span className="text-xs uppercase text-overlay0">shared</span>
            </div>
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red hover:text-red"
                onClick={() => removeProjectTeam(project.id, t.teamId)}
              >
                <X size={14} />
              </Button>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-overlay0">
        The primary team owns the project. Adding a team grants all of its members access too — useful
        when more than one team needs to collaborate on the same project.
      </p>
    </div>
  );
}
