"use client";

import { Users } from "lucide-react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { $orgSettings } from "@/store/subjects/org-settings";

/** Phase-1: read-only list of teams that belong to this org. Team CRUD +
 *  per-team member assignment will land in a follow-up — server already has
 *  the team tables, we just need the org-admin-scoped handlers. */
export function OrgTeamsTab({ orgId: _orgId }: { orgId: string }) {
  const state = useDeepSubjectAll($orgSettings);
  const teams = state.current.teams;

  if (teams.length === 0) {
    return (
      <div className="text-md text-overlay0 border border-dashed border-surface0 rounded-lg px-4 py-8 text-center">
        No teams in this organization yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="text-xs text-overlay0 mb-2">
        {teams.length} team{teams.length === 1 ? "" : "s"}
      </div>
      <ul className="divide-y divide-surface0 border border-surface0 rounded-lg overflow-hidden bg-mantle">
        {teams.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2">
            <Users size={14} className="text-mauve shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-text text-md truncate">{t.name}</span>
            </div>
            <span className="text-xs text-overlay0 font-mono">{t.id.slice(0, 8)}…</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-overlay0 mt-3">
        Team CRUD from this panel is coming soon. For now, ask a superadmin to add/edit teams from Admin → Teams.
      </p>
    </div>
  );
}
