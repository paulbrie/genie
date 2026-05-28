"use client";

import { Crown, Shield, Trash2, User } from "lucide-react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { $auth } from "@/store/subjects/auth";
import { $orgSettings } from "@/store/subjects/org-settings";
import { removeOrgMember, setOrgMemberRole } from "@/store/actions/org-settings";
import { Button } from "@/components/ui/button";
import { useSubject } from "subjecto/react";

const ROLE_OPTIONS = [
  { value: "member" as const, label: "Member" },
  { value: "admin" as const, label: "Admin" },
  { value: "owner" as const, label: "Owner" },
];

export function OrgMembersTab({ orgId }: { orgId: string }) {
  const state = useDeepSubjectAll($orgSettings);
  const [auth] = useSubject($auth);
  const members = state.current.members;
  const busy = state.membersBusy;
  const currentUserId = auth.status === "authenticated" ? auth.user?.id : null;

  if (members.length === 0) {
    return (
      <div className="text-md text-overlay0 border border-dashed border-surface0 rounded-lg px-4 py-8 text-center">
        No members in this organization.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="text-xs text-overlay0 mb-2">
        {members.length} member{members.length === 1 ? "" : "s"}
      </div>
      <ul className="divide-y divide-surface0 border border-surface0 rounded-lg overflow-hidden bg-mantle">
        {members.map((m) => {
          const Icon = m.role === "owner" ? Crown : m.role === "admin" ? Shield : User;
          const iconColor = m.role === "owner" ? "text-peach" : m.role === "admin" ? "text-blue" : "text-overlay1";
          const isSelf = m.userId === currentUserId;

          return (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2">
              <Icon size={14} className={`shrink-0 ${iconColor}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-text text-md truncate">
                    {m.userName || m.userEmail || m.userId}
                    {isSelf && <span className="text-overlay0 text-xs ml-1">(you)</span>}
                  </span>
                </div>
                {m.userEmail && m.userName && (
                  <div className="text-xs text-overlay0 truncate">{m.userEmail}</div>
                )}
              </div>
              <select
                className="bg-surface0 text-text border border-surface1 rounded-md px-2 py-1 text-xs outline-none focus:border-blue shrink-0"
                value={m.role}
                disabled={busy || isSelf}
                onChange={(e) => setOrgMemberRole(orgId, m.userId, e.target.value as "owner" | "admin" | "member")}
                aria-label={`Role for ${m.userName || m.userEmail}`}
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <Button
                size="sm"
                variant="ghost"
                className="text-red hover:text-red shrink-0"
                disabled={busy || isSelf}
                onClick={() => {
                  const label = m.userName || m.userEmail || "this member";
                  if (confirm(`Remove ${label} from the organization?`)) {
                    removeOrgMember(orgId, m.userId);
                  }
                }}
                title={isSelf ? "You cannot remove yourself" : "Remove member"}
              >
                <Trash2 size={14} />
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-overlay0 mt-3">
        To add members, go to Teams and generate an invite link for the team they should join.
      </p>
    </div>
  );
}
