"use client";

// Tracker tab in the extension panel — just sets the active project on the
// shared $tracker subject and delegates rendering to the full TrackerPanel
// component (same one the main app uses).

import { useEffect } from "react";
import { setTrackerProject } from "@/store/actions";
import { TrackerPanel } from "@/components/tracker-panel";

export function ExtTrackerTab({ projectId }: { projectId: string }) {
  useEffect(() => {
    setTrackerProject(projectId);
  }, [projectId]);

  return <TrackerPanel />;
}
