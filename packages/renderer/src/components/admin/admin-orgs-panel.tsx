import { useState } from "react";
import { ChevronDown, ChevronUp, Crown, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addOrgMember,
  createOrg,
  deleteOrg,
  removeOrgMember,
  setOrgMemberRole,
  updateOrg,
} from "@/store/actions";
import type { AdminOrg, AdminOrgMember, AdminState, AdminUser, OrgRole } from "@/store/types";

export function OrgsPanel({
  orgs,
  users,
}: {
  orgs: AdminState["orgs"];
  users: AdminUser[];
}) {
  const [newOrgName, setNewOrgName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [addMemberOrgId, setAddMemberOrgId] = useState<string | null>(null);

  const nonAgentUsers = users.filter((u) => !u.isAgent);

  const handleCreate = () => {
    if (!newOrgName.trim()) return;
    createOrg(newOrgName.trim());
    setNewOrgName("");
  };

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <input
          className="bg-surface0 border border-surface1 rounded px-3 py-1.5 text-md text-text flex-1 max-w-xs"
          placeholder="New organization name..."
          value={newOrgName}
          onChange={(e) => setNewOrgName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <Button size="sm" onClick={handleCreate} disabled={!newOrgName.trim()}>
          <Plus size={14} className="mr-1" /> Create Org
        </Button>
      </div>

      {orgs.loading ? (
        <p className="text-subtext0">Loading organizations...</p>
      ) : orgs.list.length === 0 ? (
        <p className="text-subtext0">No organizations yet.</p>
      ) : (
        <div className="space-y-3">
          {orgs.list.map((org: AdminOrg) => {
            const members = orgs.members[org.id] || [];
            const isExpanded = expandedOrgId === org.id;
            const isEditing = editingId === org.id;
            const callerRole = org.role || null;
            const canDelete = callerRole === "owner" || callerRole == null; // superadmin gets owner

            return (
              <div key={org.id} className="border border-surface0 rounded-lg overflow-hidden">
                <div
                  className="flex items-center justify-between px-4 py-3 bg-surface0/30 cursor-pointer"
                  onClick={() => setExpandedOrgId(isExpanded ? null : org.id)}
                >
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <input
                        className="bg-surface0 border border-surface1 rounded px-2 py-1 text-md text-text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            updateOrg(org.id, editingName);
                            setEditingId(null);
                          }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span className="font-medium">{org.name}</span>
                    )}
                    <span className="text-subtext0 text-md">({members.length} members)</span>
                    {callerRole && (
                      <span className="text-overlay0 text-xs uppercase">{callerRole}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(org.id);
                        setEditingName(org.name);
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red hover:text-red"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete organization "${org.name}"? All its teams and projects stay but lose their org link.`)) {
                            deleteOrg(org.id);
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 py-3 space-y-2">
                    {members.length === 0 ? (
                      <p className="text-subtext0 text-md">No members yet.</p>
                    ) : (
                      members.map((m: AdminOrgMember) => {
                        const user = nonAgentUsers.find((u) => u.id === m.userId);
                        return (
                          <div
                            key={m.id}
                            className="flex items-center justify-between py-1.5 border-b border-surface0/50 last:border-0"
                          >
                            <div className="flex items-center gap-2">
                              {user?.avatarUrl && (
                                <img src={user.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
                              )}
                              <span>{user?.name || m.userName || m.userId}</span>
                              <span className="text-subtext0 text-md">{user?.email || m.userEmail}</span>
                              <span className="text-overlay0 text-xs uppercase">{m.role}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant={m.role === "owner" ? "default" : "ghost"}
                                onClick={() =>
                                  setOrgMemberRole(
                                    org.id,
                                    m.userId,
                                    cycleRole(m.role),
                                  )
                                }
                                title="Cycle role"
                              >
                                <Crown size={14} className={m.role === "owner" ? "text-yellow" : ""} />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red hover:text-red"
                                onClick={() => removeOrgMember(org.id, m.userId)}
                              >
                                <X size={14} />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {addMemberOrgId === org.id ? (
                      <div className="flex items-center gap-2 pt-2">
                        <select
                          className="bg-surface0 border border-surface1 rounded px-2 py-1.5 text-md text-text flex-1"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              addOrgMember(org.id, e.target.value, "member");
                              setAddMemberOrgId(null);
                            }
                          }}
                        >
                          <option value="" disabled>
                            Select user...
                          </option>
                          {nonAgentUsers
                            .filter((u) => !members.some((m) => m.userId === u.id))
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name} ({u.email})
                              </option>
                            ))}
                        </select>
                        <Button size="sm" variant="ghost" onClick={() => setAddMemberOrgId(null)}>
                          <X size={14} />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAddMemberOrgId(org.id)}
                        className="mt-1"
                      >
                        <Plus size={14} className="mr-1" /> Add Member
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** member → admin → owner → member */
function cycleRole(current: OrgRole): OrgRole {
  if (current === "member") return "admin";
  if (current === "admin") return "owner";
  return "member";
}
