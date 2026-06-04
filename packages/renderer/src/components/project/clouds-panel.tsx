"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSubject } from "subjecto/react";
import { RefreshCw } from "lucide-react";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewTabs } from "@/components/ui/view-tabs";
import { DigitalOceanPanel } from "@/components/admin/digitalocean-panel";
import { TazCloudPanel } from "@/components/admin/tazcloud-panel";
import { HetznerPanel } from "@/components/admin/hetzner-panel";
import { $auth } from "@/store/subjects";
import type { CloudSubTab, VpsMonitorState } from "@/store/types";
import { buildCloudPath } from "@/lib/routes";
import { useCloudsMonitor } from "@/hooks/use-clouds-monitor";
import { cn } from "@/lib/utils";

/** Top-level wrapper for `/clouds/*` — renders a two-tab header (DO / Taz) and
 *  switches the body. Reads the active tab from the URL so deep-linking works.
 *  The `tazcloud` role only has access to the Taz tab — DO is hidden and the
 *  default landing tab is Taz. */
export function CloudsPanel() {
  const router = useRouter();
  const params = useParams();
  const [auth] = useSubject($auth);
  const role = auth.user?.role;
  const tazOnly = role === "tazcloud";
  // TazCloud isn't part of the org/user visibility model yet, so its tab stays
  // limited to privileged roles. Org owners / plain users see DO + Hetzner.
  const canSeeTaz = role === "superadmin" || role === "admin" || role === "tazcloud";
  const segments = (params?.slug as string[] | undefined) ?? [];
  const subFromUrl = segments[1]?.toLowerCase();
  const [active, setActive] = useState<CloudSubTab>(
    tazOnly || (subFromUrl === "taz" && canSeeTaz) ? "taz" : "do",
  );
  const { monitor, refreshHistory, setHistoryHours } = useCloudsMonitor(true);

  // Keep state in sync if the user navigates via browser back/forward.
  // Redirect tazcloud-role users away from /clouds/do, and non-privileged users
  // away from /clouds/taz — neither can access the other tab.
  useEffect(() => {
    if (tazOnly && (subFromUrl === "do" || subFromUrl === "hetzner")) {
      router.replace(buildCloudPath("taz"));
      return;
    }
    if (subFromUrl === "taz" && !canSeeTaz) {
      router.replace(buildCloudPath("do"));
      return;
    }
    if (subFromUrl === "do" || subFromUrl === "taz" || subFromUrl === "hetzner") {
      const target = tazOnly ? "taz" : subFromUrl;
      if (active !== target) setActive(target);
    }
  }, [subFromUrl, active, tazOnly, canSeeTaz, router]);

  function switchTab(tab: CloudSubTab) {
    setActive(tab);
    router.push(buildCloudPath(tab));
  }

  const tabs = tazOnly
    ? [{ key: "taz" as CloudSubTab, label: "TazCloud" }]
    : [
        { key: "do" as CloudSubTab, label: "DigitalOcean" },
        { key: "hetzner" as CloudSubTab, label: "Hetzner" },
        ...(canSeeTaz ? [{ key: "taz" as CloudSubTab, label: "TazCloud" }] : []),
      ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4">
        <ViewHeader title="Clouds" />
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <ViewTabs<CloudSubTab>
            tabs={tabs}
            activeTab={active}
            onTabChange={switchTab}
          />
          <CloudsHistoryControls
            monitor={monitor}
            onHoursChange={setHistoryHours}
            onRefresh={refreshHistory}
          />
        </div>
        {monitor.error && (
          <div className="mt-2 text-md text-red bg-red/10 border border-red/20 rounded px-3 py-2">
            {monitor.error}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {active === "do" ? (
          <DigitalOceanPanel monitor={monitor} />
        ) : active === "hetzner" ? (
          <HetznerPanel monitor={monitor} />
        ) : (
          <TazCloudPanel monitor={monitor} />
        )}
      </div>
    </div>
  );
}

function CloudsHistoryControls({
  monitor,
  onHoursChange,
  onRefresh,
}: {
  monitor: VpsMonitorState;
  onHoursChange: (hours: number) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pb-1">
      <label className="text-[11px] text-overlay0 uppercase tracking-wide">History</label>
      <select
        value={monitor.hours}
        onChange={(e) => onHoursChange(Number(e.target.value))}
        className="text-md bg-surface0 border border-overlay0/30 rounded px-2 py-1 text-text"
      >
        <option value={1}>1 hour</option>
        <option value={6}>6 hours</option>
        <option value={24}>24 hours</option>
      </select>
      <button
        type="button"
        onClick={onRefresh}
        disabled={monitor.loading}
        className="p-1.5 rounded text-overlay0 hover:text-blue transition-colors disabled:opacity-50"
        title="Refresh history"
      >
        <RefreshCw size={14} className={cn(monitor.loading && "animate-spin")} />
      </button>
    </div>
  );
}
