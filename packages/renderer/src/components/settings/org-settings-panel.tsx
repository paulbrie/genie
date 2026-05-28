"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown } from "lucide-react";
import { $orgSettings } from "@/store/subjects/org-settings";
import { loadOrgDetail, setActiveOrgSubTab } from "@/store/actions/org-settings";
import { useDeepSubjectAll } from "@/lib/hooks";
import { buildSettingsPath } from "@/lib/routes";
import { ViewTabs } from "@/components/ui/view-tabs";
import { OrgCloudServersTab } from "./org-cloud-servers-tab";
import { OrgMembersTab } from "./org-members-tab";
import { OrgTeamsTab } from "./org-teams-tab";

/** Top-level settings page for an org-admin. URL: /settings/org/{orgId}.
 *  Visible in the parent Settings panel only when listMine returns non-empty. */
export function OrgSettingsPanel({ orgId }: { orgId: string }) {
  const router = useRouter();
  const state = useDeepSubjectAll($orgSettings);

  useEffect(() => {
    if (!orgId) return;
    loadOrgDetail(orgId);
  }, [orgId]);

  // Surface a useful header even before /org:get returns — use the cached
  // entry from listMine if we have it. Avoids the "name flashes in" effect
  // when the user changes orgs from the dropdown.
  const headerName = useMemo(() => {
    if (state.current.org?.name) return state.current.org.name;
    const cached = state.mine.find((o) => o.id === orgId);
    return cached?.name ?? "Organization";
  }, [state.current.org?.name, state.mine, orgId]);

  const sub = state.activeSubTab;
  const subTabs = [
    { key: "cloud" as const, label: "Cloud servers" },
    { key: "members" as const, label: "Members" },
    { key: "teams" as const, label: "Teams" },
  ];

  const manageableOrgs = state.mine;

  return (
    <div className="pt-4 flex flex-col gap-4">
      {/* Header: org name + org switcher (visible only when admin of 2+ orgs). */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={18} className="text-mauve shrink-0" />
          <h2 className="text-lg font-semibold text-text truncate" title={headerName}>{headerName}</h2>
        </div>
        {manageableOrgs.length > 1 && (
          <div className="relative">
            <select
              value={orgId}
              onChange={(e) => router.push(buildSettingsPath("org", e.target.value))}
              className="bg-surface0 text-text border border-surface1 rounded-md pl-2.5 pr-7 py-1 text-md outline-none focus:border-blue appearance-none cursor-pointer"
              aria-label="Switch organization"
            >
              {manageableOrgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-overlay1 pointer-events-none" />
          </div>
        )}
      </div>

      {state.current.loading && !state.current.org ? (
        <div className="text-md text-overlay0 py-6">Loading org details…</div>
      ) : state.current.error && !state.current.org ? (
        <div className="text-md text-red bg-red/10 border border-red/30 rounded-md px-3 py-2">
          {state.current.error}
        </div>
      ) : (
        <>
          <ViewTabs
            tabs={subTabs}
            activeTab={sub}
            onTabChange={(t) => setActiveOrgSubTab(t)}
          />

          {sub === "cloud" && <OrgCloudServersTab orgId={orgId} />}
          {sub === "members" && <OrgMembersTab orgId={orgId} />}
          {sub === "teams" && <OrgTeamsTab orgId={orgId} />}
        </>
      )}
    </div>
  );
}
