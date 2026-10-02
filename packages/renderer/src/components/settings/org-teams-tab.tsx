"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Link2, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { $orgSettings } from "@/store/subjects/org-settings";
import {
  createOrgTeam,
  createOrgTeamInvite,
  deleteOrgTeam,
  removeOrgTeamMember,
  revokeOrgTeamInvite,
  updateOrgTeam,
} from "@/store/actions/org-settings";
import type { OrgTeamInvite, OrgTeamMember } from "@/store/types/org-settings";
import { Button } from "@/components/ui/button";

function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => {});
}

export function OrgTeamsTab({ orgId }: { orgId: string }) {
  const state = useDeepSubjectAll($orgSettings);
  const teams = state.current.teams;
  const teamMembers = state.current.teamMembers;
  const invites = state.current.invites;
  const busy = state.teamsBusy;

  const [newTeamName, setNewTeamName] = useState("");
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const handleCreate = () => {
    const name = newTeamName.trim();
    if (!name) return;
    createOrgTeam(orgId, name);
    setNewTeamName("");
  };

  const activeInvitesForTeam = (teamId: string): OrgTeamInvite[] =>
    invites.filter((i) => i.teamId === teamId && !i.revokedAt);

  const membersForTeam = (teamId: string): OrgTeamMember[] =>
    teamMembers.filter((m) => m.teamId === teamId);

  const handleCopyInvite = (invite: OrgTeamInvite) => {
    copyText(invite.url);
    setCopiedInviteId(invite.id);
    setTimeout(() => setCopiedInviteId(null), 2000);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <input
          className="bg-surface0 border border-surface1 rounded-md px-3 py-1.5 text-md text-text flex-1 max-w-xs"
          placeholder="New team name…"
          value={newTeamName}
          onChange={(e) => setNewTeamName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          disabled={busy}
        />
        <Button size="sm" onClick={handleCreate} disabled={busy || !newTeamName.trim()}>
          <Plus size={14} className="mr-1" /> Create team
        </Button>
      </div>

      {teams.length === 0 ? (
        <div className="text-md text-overlay0 border border-dashed border-surface0 rounded-lg px-4 py-8 text-center">
          No teams in this organization yet. Create one above, then invite members with a link.
        </div>
      ) : (
        <div className="space-y-3">
          {teams.map((team) => {
            const members = membersForTeam(team.id);
            const teamInvites = activeInvitesForTeam(team.id);
            const isExpanded = expandedTeamId === team.id;
            const isEditing = editingId === team.id;

            return (
              <div key={team.id} className="border border-surface0 rounded-lg overflow-hidden bg-mantle">
                <div
                  className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-surface0/20"
                  onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isEditing ? (
                      <input
                        className="bg-surface0 border border-surface1 rounded px-2 py-1 text-md text-text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            updateOrgTeam(orgId, team.id, editingName);
                            setEditingId(null);
                          }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span className="font-medium text-text truncate">{team.name}</span>
                    )}
                    <span className="text-xs text-overlay0 shrink-0">{members.length} member{members.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); setEditingId(team.id); setEditingName(team.name); }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red hover:text-red"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete team "${team.name}"? Members stay in the organization.`)) {
                          deleteOrgTeam(orgId, team.id);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                    {isExpanded ? <ChevronUp size={16} className="text-overlay0" /> : <ChevronDown size={16} className="text-overlay0" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-surface0 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs text-overlay0 uppercase tracking-wide">Members</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => createOrgTeamInvite(orgId, team.id)}
                      >
                        <UserPlus size={14} className="mr-1" /> Invite link
                      </Button>
                    </div>

                    {teamInvites.length > 0 && (
                      <div className="space-y-1.5">
                        {teamInvites.map((invite) => (
                          <div key={invite.id} className="flex items-center gap-2 text-xs bg-surface0/40 rounded-md px-2 py-1.5">
                            <Link2 size={12} className="text-mauve shrink-0" />
                            <span className="font-mono text-overlay1 truncate flex-1">{invite.url}</span>
                            <Button size="sm" variant="ghost" onClick={() => handleCopyInvite(invite)} title="Copy link">
                              <Copy size={12} />
                            </Button>
                            {copiedInviteId === invite.id && (
                              <span className="text-green shrink-0">Copied</span>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red hover:text-red"
                              onClick={() => revokeOrgTeamInvite(orgId, invite.id)}
                              title="Revoke link"
                            >
                              <X size={12} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {members.length === 0 ? (
                      <p className="text-sm text-overlay0">No members yet. Generate an invite link to add people.</p>
                    ) : (
                      <ul className="divide-y divide-surface0/60 rounded-md border border-surface0/60 overflow-hidden">
                        {members.map((m) => (
                          <li key={m.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                            <div className="flex-1 min-w-0">
                              <div className="truncate text-text">{m.userName || m.userEmail || m.userId}</div>
                              {m.userEmail && m.userName && (
                                <div className="text-xs text-overlay0 truncate">{m.userEmail}</div>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red hover:text-red shrink-0"
                              disabled={busy}
                              onClick={() => removeOrgTeamMember(orgId, m.id)}
                              title="Remove from team"
                            >
                              <X size={14} />
                            </Button>
                          </li>
                        ))}
                      </ul>
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
