"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ViewHeader } from "@/components/view-header";
import { ViewTabs } from "@/components/view-tabs";
import { DigitalOceanPanel } from "@/components/digitalocean-panel";
import { TazCloudPanel } from "@/components/tazcloud-panel";
import type { CloudSubTab } from "@/store/types";
import { buildCloudPath } from "@/lib/routes";

/** Top-level wrapper for `/clouds/*` — renders a two-tab header (DO / Taz) and
 *  switches the body. Reads the active tab from the URL so deep-linking works. */
export function CloudsPanel() {
  const router = useRouter();
  const params = useParams();
  const segments = (params?.slug as string[] | undefined) ?? [];
  const subFromUrl = segments[1]?.toLowerCase();
  const [active, setActive] = useState<CloudSubTab>(
    subFromUrl === "taz" ? "taz" : "do",
  );

  // Keep state in sync if the user navigates via browser back/forward.
  useEffect(() => {
    if (subFromUrl === "do" || subFromUrl === "taz") {
      if (active !== subFromUrl) setActive(subFromUrl);
    }
  }, [subFromUrl, active]);

  function switchTab(tab: CloudSubTab) {
    setActive(tab);
    router.push(buildCloudPath(tab));
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4">
        <ViewHeader title="Clouds" />
        <ViewTabs<CloudSubTab>
          tabs={[
            { key: "do", label: "DigitalOcean" },
            { key: "taz", label: "TazCloud" },
          ]}
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
