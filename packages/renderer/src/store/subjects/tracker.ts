import { Subject } from "subjecto/core";
import type { TrackerState } from "../types/tracker";

export const $tracker = new Subject<TrackerState>({
  issues: [], labels: [], assignableUsers: {}, loading: false, viewMode: "board", groupBy: "status",
  filters: { status: [], priority: [], assigneeId: [], labelId: [] },
  selectedIssueId: null, selectedProjectId: null, showCreateForm: false,
});
