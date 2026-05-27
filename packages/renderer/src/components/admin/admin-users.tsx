"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Crown, Pencil, Plus, Trash2, X } from "lucide-react";
import type { AdminState, AdminTeam, AdminTeamMember, AdminUser } from "@/store/types";
import { addTeamMember, createTeam, deleteTeam, removeTeamMember, saveUser, setTeamMemberRole, updateTeam } from "@/store/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const TEAM_ROLES: ("member" | "owner" | "superadmin")[] = ["member", "owner", "superadmin"];
const USER_ROLES: ("user" | "tazcloud" | "admin" | "superadmin")[] = ["user", "tazcloud", "admin", "superadmin"];

export function UserDrawer({ user, teams, teamMembers, onClose }: { user: AdminUser; teams: AdminTeam[]; teamMembers: AdminTeamMember[]; onClose: () => void }) {
  const [name, setName] = useState(user.name);
  const [validated, setValidated] = useState(user.validated);
  const [role, setRole] = useState<"user" | "tazcloud" | "admin" | "superadmin">(user.role || "user");
  const [addingTeam, setAddingTeam] = useState(false);
  const [addTeamRole, setAddTeamRole] = useState<"member" | "owner" | "superadmin">("member");

  useEffect(() => { setName(user.name); setValidated(user.validated); setRole(user.role || "user"); }, [user]);

  const userTeams = teamMembers.filter((m: AdminTeamMember) => m.userId === user.id);
  const availableTeams = teams.filter((t: AdminTeam) => !userTeams.some((m: AdminTeamMember) => m.teamId === t.id));

  const handleSave = () => {
    saveUser(user.id, { name, validated, role } as Partial<AdminUser>);
    onClose();
  };

  return (
    <div className="fixed right-0 top-0 h-screen w-[420px] z-50 bg-mantle border-l border-surface0 flex flex-col shadow-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface0">
        <h2 className="text-base font-semibold text-text">Edit User</h2>
        <Button size="sm" variant="ghost" onClick={onClose}><X size={16} /></Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {user.avatarUrl && (
          <div className="flex justify-center">
            <img src={user.avatarUrl} alt="" className="w-16 h-16 rounded-full" />
          </div>
        )}
        <div>
          <label className="text-subtext1 text-md block mb-1">Name</label>
          <input className="w-full bg-surface0 border border-surface1 rounded px-3 py-2 text-md text-text font-mono" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-subtext1 text-md block mb-1">Email</label>
          <p className="text-subtext0 text-md font-mono">{user.email}</p>
        </div>
        <div>
          <label className="text-subtext1 text-md block mb-1">Validated</label>
          <button
            className={cn("px-3 py-1.5 rounded text-md font-mono", validated ? "bg-green/20 text-green" : "bg-yellow/20 text-yellow")}
            onClick={() => setValidated(!validated)}
          >
            {validated ? "Validated" : "Pending"}
          </button>
        </div>
        <div>
          <label className="text-subtext1 text-md block mb-1">Role</label>
          <select
            className="bg-surface0 border border-surface1 rounded px-3 py-2 text-md text-text font-mono"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            {USER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="text-subtext1 text-md block mb-1">Google ID</label>
          <p className="text-subtext0 text-md font-mono">{user.googleId}</p>
        </div>
        <div>
          <label className="text-subtext1 text-md block mb-1">Joined</label>
          <p className="text-subtext0 text-md font-mono">{new Date(user.createdAt).toLocaleString()}</p>
        </div>

        {/* Teams management */}
        <div>
          <label className="text-subtext1 text-md block mb-2">Teams</label>
          <div className="space-y-2">
            {userTeams.map((m: AdminTeamMember) => {
              const team = teams.find((t: AdminTeam) => t.id === m.teamId);
              return (
                <div key={m.id} className="flex items-center justify-between py-2 px-3 bg-surface0/30 rounded">
                  <span className="text-md">{team?.name || m.teamId}</span>
                  <div className="flex items-center gap-2">
                    <select
                      className="bg-surface0 border border-surface1 rounded px-2 py-1 text-md text-text"
                      value={m.role}
                      onChange={(e) => setTeamMemberRole(m.id, e.target.value)}
                    >
                      {TEAM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <Button size="sm" variant="ghost" className="text-red hover:text-red" onClick={() => removeTeamMember(m.id)}>
                      <X size={14} />
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* Add to team */}
            {addingTeam ? (
              <div className="flex items-center gap-2">
                <select
                  className="bg-surface0 border border-surface1 rounded px-2 py-1.5 text-md text-text flex-1"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addTeamMember(e.target.value, user.id, addTeamRole);
                      setAddingTeam(false);
                      setAddTeamRole("member");
                    }
                  }}
                >
                  <option value="" disabled>Select team...</option>
                  {availableTeams.map((t: AdminTeam) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select
                  className="bg-surface0 border border-surface1 rounded px-2 py-1.5 text-md text-text"
                  value={addTeamRole}
                  onChange={(e) => setAddTeamRole(e.target.value as typeof addTeamRole)}
                >
                  {TEAM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <Button size="sm" variant="ghost" onClick={() => setAddingTeam(false)}>
                  <X size={14} />
                </Button>
              </div>
            ) : availableTeams.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setAddingTeam(true)}>
                <Plus size={14} className="mr-1" /> Add to Team
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-surface0 flex items-center gap-2">
        <Button onClick={handleSave} className="flex-1">Save</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

export function TeamsPanel({ teams, users }: { teams: AdminState["teams"]; users: AdminUser[] }) {
  const [newTeamName, setNewTeamName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [addMemberTeamId, setAddMemberTeamId] = useState<string | null>(null);

  const nonAgentUsers = users.filter((u: AdminUser) => !u.isAgent);

  const handleCreateTeam = () => {
    if (!newTeamName.trim()) return;
    createTeam(newTeamName.trim());
    setNewTeamName("");
  };

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Create team form */}
      <div className="flex items-center gap-2">
        <input
          className="bg-surface0 border border-surface1 rounded px-3 py-1.5 text-md text-text flex-1 max-w-xs"
          placeholder="New team name..."
          value={newTeamName}
          onChange={(e) => setNewTeamName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
        />
        <Button size="sm" onClick={handleCreateTeam} disabled={!newTeamName.trim()}>
          <Plus size={14} className="mr-1" /> Create Team
        </Button>
      </div>

      {teams.loading ? (
        <p className="text-subtext0">Loading teams...</p>
      ) : teams.list.length === 0 ? (
        <p className="text-subtext0">No teams yet.</p>
      ) : (
        <div className="space-y-3">
          {teams.list.map((team: AdminTeam) => {
            const teamMembersList = teams.members.filter((m: AdminTeamMember) => m.teamId === team.id);
            const isExpanded = expandedTeamId === team.id;
            const isEditing = editingId === team.id;

            return (
              <div key={team.id} className="border border-surface0 rounded-lg overflow-hidden">
                {/* Team header */}
                <div className="flex items-center justify-between px-4 py-3 bg-surface0/30 cursor-pointer" onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}>
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <input
                        className="bg-surface0 border border-surface1 rounded px-2 py-1 text-md text-text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { updateTeam(team.id, editingName); setEditingId(null); }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span className="font-medium">{team.name}</span>
                    )}
                    <span className="text-subtext0 text-md">({teamMembersList.length} members)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditingId(team.id); setEditingName(team.name); }}>
                      <Pencil size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red hover:text-red" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete team "${team.name}"?`)) deleteTeam(team.id); }}>
                      <Trash2 size={14} />
                    </Button>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* Expanded: members list */}
                {isExpanded && (
                  <div className="px-4 py-3 space-y-2">
                    {teamMembersList.length === 0 ? (
                      <p className="text-subtext0 text-md">No members yet.</p>
                    ) : (
                      teamMembersList.map((m: AdminTeamMember) => {
                        const user = nonAgentUsers.find((u: AdminUser) => u.id === m.userId);
                        return (
                          <div key={m.id} className="flex items-center justify-between py-1.5 border-b border-surface0/50 last:border-0">
                            <div className="flex items-center gap-2">
                              {user?.avatarUrl && <img src={user.avatarUrl} alt="" className="w-5 h-5 rounded-full" />}
                              <span>{user?.name || m.userId}</span>
                              <span className="text-subtext0 text-md">{user?.email}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant={m.role === "owner" ? "default" : "ghost"}
                                onClick={() => setTeamMemberRole(m.id, m.role === "owner" ? "member" : "owner")}
                                title={m.role === "owner" ? "Demote to member" : "Promote to owner"}
                              >
                                <Crown size={14} className={m.role === "owner" ? "text-yellow" : ""} />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-red hover:text-red" onClick={() => removeTeamMember(m.id)}>
                                <X size={14} />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {/* Add member */}
                    {addMemberTeamId === team.id ? (
                      <div className="flex items-center gap-2 pt-2">
                        <select
                          className="bg-surface0 border border-surface1 rounded px-2 py-1.5 text-md text-text flex-1"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              addTeamMember(team.id, e.target.value);
                              setAddMemberTeamId(null);
                            }
                          }}
                        >
                          <option value="" disabled>Select user...</option>
                          {nonAgentUsers
                            .filter((u: AdminUser) => !teamMembersList.some((m: AdminTeamMember) => m.userId === u.id))
                            .map((u: AdminUser) => (
                              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                            ))}
                        </select>
                        <Button size="sm" variant="ghost" onClick={() => setAddMemberTeamId(null)}>
                          <X size={14} />
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setAddMemberTeamId(team.id)} className="mt-1">
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
