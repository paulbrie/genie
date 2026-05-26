import { useEffect, useState } from "react";
import { Crown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeepSubject, useSubject } from "subjecto/react";
import { $admin, $auth } from "@/store/subjects";
import {
  addProjectMember,
  loadAdminOrgs,
  loadAdminUsers,
  loadProjectMembers,
  removeProjectMember,
  setProjectMemberRole,
} from "@/store/actions";
import type { ProjectDef } from "@/store/types";

export function ProjectMembersTab({ project }: { project: ProjectDef }) {
  const [auth] = useSubject($auth);
  // Subscribe to the relevant $admin slices. useDeepSubject only accepts
  // top-level keys.
  const [projectMembersMap] = useDeepSubject($admin, "projectMembers");
  const [orgsSlice] = useDeepSubject($admin, "orgs");
  const [usersSlice] = useDeepSubject($admin, "users");
  const orgs = orgsSlice.list;
  const allUsers = usersSlice.list;
  const members = projectMembersMap[project.id] || [];
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadProjectMembers(project.id);
    // We also need orgs/users so the picker has data. Loading is idempotent —
    // if they're already populated the server will just respond again.
    if (orgs.length === 0) loadAdminOrgs();
    if (allUsers.length === 0) loadAdminUsers();
  }, [project.id]);

  const isSuperadmin = auth.user?.role === "superadmin";
  // Local "may I manage?" heuristic — server still enforces. We grant the UI
  // affordance to superadmins, current project owners, and any org owner/admin
  // whose org owns this project's team. The org → team mapping isn't on the
  // client, so for the UI we approximate "user has any org owner/admin role"
  // OR "is a project owner here".
  const meIsProjectOwner = members.some(
    (m) => m.userId === auth.user?.id && m.role === "owner",
  );
  const anyManageableOrg = orgs.some((o) => o.role === "owner" || o.role === "admin");
  const canManage = isSuperadmin || meIsProjectOwner || anyManageableOrg;

  // Users available to add: any non-agent user not yet in the project.
  const memberUserIds = new Set(members.map((m) => m.userId));
  const candidates = allUsers.filter((u) => !u.isAgent && !memberUserIds.has(u.id));

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
    </div>
  );
}
