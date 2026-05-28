"use client";

import { Crown, Shield, User } from "lucide-react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { $orgSettings } from "@/store/subjects/org-settings";

/** Phase-1: read-only member list with role badges. CRUD (add/remove/change-
 *  role) will reuse admin:orgs:members:* once it's relaxed to accept org-admin
 *  callers (handler-level check already exists; ACL gate is the only thing
 *  blocking it). */
export function OrgMembersTab({ orgId: _orgId }: { orgId: string }) {
  const state = useDeepSubjectAll($orgSettings);
  const members = state.current.members;

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
          return (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2">
              <Icon size={14} className={`shrink-0 ${iconColor}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-text text-md truncate">{m.userName || m.userEmail || m.userId}</span>
                </div>
                {m.userEmail && m.userName && (
                  <div className="text-xs text-overlay0 truncate">{m.userEmail}</div>
                )}
              </div>
              <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-medium bg-surface0 text-subtext0 capitalize">
                {m.role}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-overlay0 mt-3">
        Editing org membership from this panel is coming soon. For now, ask a superadmin to add/remove members from the Admin → Orgs page.
      </p>
    </div>
  );
}
