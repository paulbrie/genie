"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSubject } from "subjecto/react";
import { ViewHeader } from "@/components/view-header";
import { ViewTabs } from "@/components/view-tabs";
import { DigitalOceanPanel } from "@/components/digitalocean-panel";
import { TazCloudPanel } from "@/components/tazcloud-panel";
import { $auth } from "@/store/subjects";
import type { CloudSubTab } from "@/store/types";
import { buildCloudPath } from "@/lib/routes";

/** Top-level wrapper for `/clouds/*` — renders a two-tab header (DO / Taz) and
 *  switches the body. Reads the active tab from the URL so deep-linking works.
 *  The `tazcloud` role only has access to the Taz tab — DO is hidden and the
 *  default landing tab is Taz. */
export function CloudsPanel() {
  const router = useRouter();
  const params = useParams();
  const [auth] = useSubject($auth);
  const tazOnly = auth.user?.role === "tazcloud";
  const segments = (params?.slug as string[] | undefined) ?? [];
  const subFromUrl = segments[1]?.toLowerCase();
  const [active, setActive] = useState<CloudSubTab>(
    tazOnly || subFromUrl === "taz" ? "taz" : "do",
  );

  // Keep state in sync if the user navigates via browser back/forward.
  // Redirect tazcloud-role users away from /clouds/do — they don't have access.
  useEffect(() => {
    if (tazOnly && subFromUrl === "do") {
      router.replace(buildCloudPath("taz"));
      return;
    }
    if (subFromUrl === "do" || subFromUrl === "taz") {
      const target = tazOnly ? "taz" : subFromUrl;
      if (active !== target) setActive(target);
    }
  }, [subFromUrl, active, tazOnly, router]);

  function switchTab(tab: CloudSubTab) {
    setActive(tab);
    router.push(buildCloudPath(tab));
  }

  const tabs = tazOnly
    ? [{ key: "taz" as CloudSubTab, label: "TazCloud" }]
    : [
        { key: "do" as CloudSubTab, label: "DigitalOcean" },
        { key: "taz" as CloudSubTab, label: "TazCloud" },
      ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4">
        <ViewHeader title="Clouds" />
        <ViewTabs<CloudSubTab>
          tabs={tabs}
          activeTab={active}
          onTabChange={switchTab}
        />
      </div>
      <div className="flex-1 overflow-auto">
        {active === "do" ? <DigitalOceanPanel /> : <TazCloudPanel />}
      </div>
    </div>
  );
}
