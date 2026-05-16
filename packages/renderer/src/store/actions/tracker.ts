import { wsSend } from "@/lib/ws";
import { $tracker } from "../subjects/tracker";
import type { TrackerFilters, TrackerGroupBy, TrackerPriority, TrackerStatus, TrackerViewMode } from "../types/tracker";

// --- Tracker actions ---

export function loadTrackerIssues(): void {
  $tracker.nextAssign({ loading: true });
  wsSend("tracker:list", {});
}

export function createTrackerIssue(fields: {
  projectId: string;
  title: string;
  description?: string;
  status?: TrackerStatus;
  priority?: TrackerPriority;
  assigneeId?: string | null;
  labelIds?: string[];
}): void {
  wsSend("tracker:issue:create", fields);
}

export function updateTrackerIssue(issueId: string, fields: {
  title?: string;
  description?: string;
  status?: TrackerStatus;
  priority?: TrackerPriority;
  assigneeId?: string | null;
  labelIds?: string[];
  sortOrder?: number;
  projectId?: string;
}): void {
  wsSend("tracker:issue:update", { issueId, ...fields });
}

export function deleteTrackerIssue(issueId: string): void {
  wsSend("tracker:issue:delete", { issueId });
}

export function reorderTrackerIssue(issueId: string, sortOrder: number): void {
  wsSend("tracker:issue:reorder", { issueId, sortOrder });
}

export function selectTrackerIssue(issueId: string | null): void {
  $tracker.nextAssign({ selectedIssueId: issueId });
}

export function setTrackerViewMode(mode: TrackerViewMode): void {
  $tracker.nextAssign({ viewMode: mode });
}

export function setTrackerGroupBy(groupBy: TrackerGroupBy): void {
  $tracker.nextAssign({ groupBy });
}

export function setTrackerFilters(filters: Partial<TrackerFilters>): void {
  const t = $tracker.getValue();
  $tracker.nextAssign({ filters: { ...t.filters, ...filters } });
}

export function clearTrackerFilters(): void {
  $tracker.nextAssign({ filters: { status: [], priority: [], assigneeId: [], labelId: [] } });
}

export function setTrackerProject(projectId: string | null): void {
  $tracker.nextAssign({ selectedProjectId: projectId });
}

export function showTrackerCreateForm(): void {
  $tracker.nextAssign({ showCreateForm: true });
}

export function hideTrackerCreateForm(): void {
  $tracker.nextAssign({ showCreateForm: false });
}

export function createTrackerLabel(name: string, color: string): void {
  wsSend("tracker:label:create", { name, color });
}

export function updateTrackerLabel(labelId: string, fields: { name?: string; color?: string }): void {
  wsSend("tracker:label:update", { labelId, ...fields });
}

export function deleteTrackerLabel(labelId: string): void {
  wsSend("tracker:label:delete", { labelId });
}

// --- Tracker comments ---

export function loadTrackerComments(issueId: string): void {
  wsSend("tracker:comments:list", { issueId });
}

export function createTrackerComment(issueId: string, content: string): void {
  wsSend("tracker:comment:create", { issueId, content });
}

export function deleteTrackerComment(commentId: string, issueId: string): void {
  wsSend("tracker:comment:delete", { commentId, issueId });
}
