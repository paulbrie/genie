// --- Tracker types ---

export type TrackerStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";
export type TrackerPriority = "none" | "urgent" | "high" | "medium" | "low";
export type TrackerViewMode = "board" | "list";
export type TrackerGroupBy = "status" | "priority" | "assignee";

export interface TrackerLabel { id: string; name: string; color: string; }
/** A user who can be assigned issues in a given project (scoped to project access). */
export interface TrackerAssignableUser { id: string; name: string; avatarUrl: string | null; }
export interface TrackerIssue {
  id: string;
  projectId: string;
  identifier: number;
  title: string;
  description: string;
  status: TrackerStatus;
  priority: TrackerPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeAvatar: string | null;
  labels: TrackerLabel[];
  commentCount: number;
  commenters: { name: string; avatar: string | null }[];
  /** null for agent/MCP-created issues (no human author). */
  createdBy: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerComment {
  id: string;
  issueId: string;
  userId: string | null;
  authorName: string;
  authorAvatar: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerFilters {
  status: TrackerStatus[];
  priority: TrackerPriority[];
  assigneeId: string[];
  labelId: string[];
}

export interface TrackerState {
  issues: TrackerIssue[];
  labels: TrackerLabel[];
  /** Assignable users per project id, scoped to who can access that project. */
  assignableUsers: Record<string, TrackerAssignableUser[]>;
  loading: boolean;
  viewMode: TrackerViewMode;
  groupBy: TrackerGroupBy;
  filters: TrackerFilters;
  selectedIssueId: string | null;
  selectedProjectId: string | null;
  showCreateForm: boolean;
}
