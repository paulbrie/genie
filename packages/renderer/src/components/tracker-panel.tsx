"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSubject } from "subjecto/react";
import {
  Circle, CircleDot, CheckCircle2, XCircle,
  AlertTriangle, ChevronUp, Equal, ChevronDown, Minus,
  LayoutGrid, List, Plus, X, Filter, Search, Trash2, Tag,
  GripVertical,
} from "lucide-react";
import {
  $tracker,
  $projects,
  $conversationChat,
  loadTrackerIssues,
  createTrackerIssue,
  updateTrackerIssue,
  deleteTrackerIssue,
  selectTrackerIssue,
  setTrackerViewMode,
  setTrackerGroupBy,
  setTrackerFilters,
  clearTrackerFilters,
  showTrackerCreateForm,
  hideTrackerCreateForm,
  setTrackerProject,
  createTrackerLabel,
  updateTrackerLabel,
  deleteTrackerLabel,
  type TrackerState,
  type TrackerIssue,
  type TrackerLabel,
  type TrackerStatus,
  type TrackerPriority,
  type TrackerViewMode as TViewMode,
  type TrackerGroupBy as TGroupBy,
  type TrackerFilters,
  type ChatUser,
  type ProjectDef,
} from "@/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/view-header";
import { ViewTabs } from "@/components/view-tabs";

// --- Status / Priority config ---

const STATUS_ORDER: TrackerStatus[] = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"];
const PRIORITY_ORDER: TrackerPriority[] = ["urgent", "high", "medium", "low", "none"];

const STATUS_CONFIG: Record<TrackerStatus, { label: string; icon: typeof Circle; color: string; dashed?: boolean }> = {
  backlog: { label: "Backlog", icon: Circle, color: "text-overlay0", dashed: true },
  todo: { label: "Todo", icon: Circle, color: "text-overlay1" },
  in_progress: { label: "In Progress", icon: CircleDot, color: "text-yellow" },
  in_review: { label: "In Review", icon: CircleDot, color: "text-blue" },
  done: { label: "Done", icon: CheckCircle2, color: "text-green" },
  cancelled: { label: "Cancelled", icon: XCircle, color: "text-red" },
};

const PRIORITY_CONFIG: Record<TrackerPriority, { label: string; icon: typeof Minus; color: string }> = {
  urgent: { label: "Urgent", icon: AlertTriangle, color: "text-red" },
  high: { label: "High", icon: ChevronUp, color: "text-peach" },
  medium: { label: "Medium", icon: Equal, color: "text-yellow" },
  low: { label: "Low", icon: ChevronDown, color: "text-blue" },
  none: { label: "None", icon: Minus, color: "text-overlay0" },
};

const LABEL_COLORS = ["#a6e3a1", "#89b4fa", "#f38ba8", "#fab387", "#f9e2af", "#cba6f7", "#94e2d5", "#f5c2e7", "#74c7ec", "#eba0ac"];

function StatusIcon({ status, size = 14 }: { status: TrackerStatus; size?: number }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return <Icon size={size} className={cn(cfg.color, cfg.dashed && "opacity-60")} strokeDasharray={cfg.dashed ? "3 3" : undefined} />;
}

function PriorityIcon({ priority, size = 14 }: { priority: TrackerPriority; size?: number }) {
  const cfg = PRIORITY_CONFIG[priority];
  const Icon = cfg.icon;
  return <Icon size={size} className={cfg.color} />;
}

// --- Filter helper ---

function applyFilters(issues: TrackerIssue[], filters: TrackerFilters): TrackerIssue[] {
  return issues.filter((issue) => {
    if (filters.status.length > 0 && !filters.status.includes(issue.status)) return false;
    if (filters.priority.length > 0 && !filters.priority.includes(issue.priority)) return false;
    if (filters.assigneeId.length > 0 && (!issue.assigneeId || !filters.assigneeId.includes(issue.assigneeId))) return false;
    if (filters.labelId.length > 0 && !issue.labels.some((l) => filters.labelId.includes(l.id))) return false;
    return true;
  });
}

// --- Grouping helper ---

function groupIssues(issues: TrackerIssue[], groupBy: TGroupBy): { key: string; label: string; issues: TrackerIssue[] }[] {
  if (groupBy === "status") {
    return STATUS_ORDER.map((status) => ({
      key: status,
      label: STATUS_CONFIG[status].label,
      issues: issues.filter((i) => i.status === status).sort((a, b) => b.sortOrder - a.sortOrder),
    }));
  }
  if (groupBy === "priority") {
    return PRIORITY_ORDER.map((priority) => ({
      key: priority,
      label: PRIORITY_CONFIG[priority].label,
      issues: issues.filter((i) => i.priority === priority).sort((a, b) => b.sortOrder - a.sortOrder),
    }));
  }
  // groupBy === "assignee"
  const assigneeMap = new Map<string, { name: string; issues: TrackerIssue[] }>();
  const unassigned: TrackerIssue[] = [];
  for (const issue of issues) {
    if (!issue.assigneeId) {
      unassigned.push(issue);
    } else {
      if (!assigneeMap.has(issue.assigneeId)) {
        assigneeMap.set(issue.assigneeId, { name: issue.assigneeName || "Unknown", issues: [] });
      }
      assigneeMap.get(issue.assigneeId)!.issues.push(issue);
    }
  }
  const groups = [...assigneeMap.entries()].map(([id, { name, issues: iss }]) => ({
    key: id,
    label: name,
    issues: iss.sort((a, b) => b.sortOrder - a.sortOrder),
  }));
  if (unassigned.length > 0) {
    groups.push({ key: "unassigned", label: "Unassigned", issues: unassigned.sort((a, b) => b.sortOrder - a.sortOrder) });
  }
  return groups;
}

// --- Inline dropdown ---

function InlineSelect<T extends string>({
  value,
  options,
  onChange,
  renderOption,
}: {
  value: T;
  options: T[];
  onChange: (val: T) => void;
  renderOption: (val: T) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-md bg-transparent border-none cursor-pointer hover:bg-surface0 transition-colors"
      >
        {renderOption(value)}
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-crust border border-surface0 rounded-md shadow-lg py-1 min-w-[140px]">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1 text-md border-none cursor-pointer transition-colors text-left",
                opt === value ? "bg-surface0 text-text" : "bg-transparent text-subtext0 hover:bg-surface0 hover:text-text"
              )}
            >
              {renderOption(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- User avatar ---

function UserAvatar({ name, avatarUrl, size = 20 }: { name: string | null; avatarUrl: string | null; size?: number }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name || ""} className="rounded-full" style={{ width: size, height: size }} />;
  }
  return (
    <div
      className="rounded-full bg-surface1 flex items-center justify-center text-overlay0 font-medium"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {(name || "?")[0].toUpperCase()}
    </div>
  );
}

// --- Assignee dropdown ---

function AssigneeSelect({ value, onChange }: { value: string | null; onChange: (val: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [conversationChat] = useSubject($conversationChat);
  const users = conversationChat.users;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selectedUser = users.find((u) => u.id === value);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-md bg-transparent border-none cursor-pointer hover:bg-surface0 transition-colors"
      >
        {selectedUser ? (
          <>
            <UserAvatar name={selectedUser.name} avatarUrl={selectedUser.avatarUrl} size={16} />
            <span className="text-text">{selectedUser.name}</span>
          </>
        ) : (
          <span className="text-overlay0">Unassigned</span>
        )}
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-crust border border-surface0 rounded-md shadow-lg py-1 min-w-[160px] max-h-[200px] overflow-y-auto">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1 text-md border-none cursor-pointer transition-colors text-left",
              !value ? "bg-surface0 text-text" : "bg-transparent text-subtext0 hover:bg-surface0 hover:text-text"
            )}
          >
            <span className="text-overlay0">Unassigned</span>
          </button>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => { onChange(u.id); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1 text-md border-none cursor-pointer transition-colors text-left",
                u.id === value ? "bg-surface0 text-text" : "bg-transparent text-subtext0 hover:bg-surface0 hover:text-text"
              )}
            >
              <UserAvatar name={u.name} avatarUrl={u.avatarUrl} size={16} />
              <span>{u.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Label picker ---

function LabelPicker({ selectedIds, onChange, labels }: { selectedIds: string[]; onChange: (ids: string[]) => void; labels: TrackerLabel[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-md bg-transparent border-none cursor-pointer hover:bg-surface0 transition-colors"
      >
        {selectedIds.length === 0 ? (
          <span className="text-overlay0">No labels</span>
        ) : (
          <div className="flex gap-1 flex-wrap">
            {labels.filter((l) => selectedIds.includes(l.id)).map((l) => (
              <span key={l.id} className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: l.color + "30", color: l.color }}>
                {l.name}
              </span>
            ))}
          </div>
        )}
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-crust border border-surface0 rounded-md shadow-lg py-1 min-w-[180px] max-h-[200px] overflow-y-auto">
          {labels.length === 0 && (
            <div className="px-2 py-1 text-md text-overlay0">No labels created</div>
          )}
          {labels.map((l) => (
            <button
              key={l.id}
              onClick={() => toggle(l.id)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1 text-md border-none cursor-pointer transition-colors text-left",
                selectedIds.includes(l.id) ? "bg-surface0 text-text" : "bg-transparent text-subtext0 hover:bg-surface0 hover:text-text"
              )}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
              <span>{l.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Issue card (board) ---

function TrackerIssueCard({ issue, onClick }: { issue: TrackerIssue; onClick: () => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", issue.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onClick}
      className="bg-base rounded-md border border-surface0 px-3 py-2 cursor-pointer hover:border-surface1 transition-colors group"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] text-overlay0 font-mono">GEN-{issue.identifier}</span>
        <PriorityIcon priority={issue.priority} size={12} />
      </div>
      <p className="text-md text-text font-medium leading-snug mb-1.5 line-clamp-2">{issue.title}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {issue.labels.map((l) => (
          <span key={l.id} className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: l.color + "30", color: l.color }}>
            {l.name}
          </span>
        ))}
        <div className="flex-1" />
        {issue.assigneeId && (
          <UserAvatar name={issue.assigneeName} avatarUrl={issue.assigneeAvatar} size={18} />
        )}
      </div>
    </div>
  );
}

// --- Board column ---

function TrackerColumn({ groupKey, label, issues, groupBy, onSelectIssue }: {
  groupKey: string;
  label: string;
  issues: TrackerIssue[];
  groupBy: TGroupBy;
  onSelectIssue: (id: string) => void;
}) {
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const issueId = e.dataTransfer.getData("text/plain");
    if (!issueId) return;

    // Compute new sortOrder
    const maxSort = issues.length > 0 ? Math.max(...issues.map((i) => i.sortOrder)) : 0;
    const newSortOrder = maxSort + 1;

    // Update the issue's group property + sort order
    if (groupBy === "status") {
      updateTrackerIssue(issueId, { status: groupKey as TrackerStatus, sortOrder: newSortOrder });
    } else if (groupBy === "priority") {
      updateTrackerIssue(issueId, { priority: groupKey as TrackerPriority, sortOrder: newSortOrder });
    } else if (groupBy === "assignee") {
      updateTrackerIssue(issueId, { assigneeId: groupKey === "unassigned" ? null : groupKey, sortOrder: newSortOrder });
    }
  }, [issues, groupKey, groupBy]);

  return (
    <div
      className="flex flex-col w-[280px] shrink-0 bg-mantle rounded-lg"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0">
        {groupBy === "status" && <StatusIcon status={groupKey as TrackerStatus} size={14} />}
        {groupBy === "priority" && <PriorityIcon priority={groupKey as TrackerPriority} size={14} />}
        <span className="text-md font-semibold text-text">{label}</span>
        <span className="text-[10px] text-overlay0 ml-auto">{issues.length}</span>
      </div>
      <div className="flex flex-col gap-1.5 p-2 overflow-y-auto flex-1 min-h-[100px]">
        {issues.map((issue) => (
          <TrackerIssueCard key={issue.id} issue={issue} onClick={() => onSelectIssue(issue.id)} />
        ))}
      </div>
    </div>
  );
}

// --- Board view ---

function TrackerBoardView({ groups, groupBy, onSelectIssue }: {
  groups: { key: string; label: string; issues: TrackerIssue[] }[];
  groupBy: TGroupBy;
  onSelectIssue: (id: string) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto flex-1 p-3 pb-0">
      {groups.map((g) => (
        <TrackerColumn
          key={g.key}
          groupKey={g.key}
          label={g.label}
          issues={g.issues}
          groupBy={groupBy}
          onSelectIssue={onSelectIssue}
        />
      ))}
    </div>
  );
}

// --- List view ---

function TrackerListView({ groups, groupBy, onSelectIssue, selectedIssueId }: {
  groups: { key: string; label: string; issues: TrackerIssue[] }[];
  groupBy: TGroupBy;
  onSelectIssue: (id: string) => void;
  selectedIssueId: string | null;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-3">
      {groups.map((g) => (
        <div key={g.key} className="mb-4">
          <div className="flex items-center gap-2 px-2 py-1 mb-1">
            {groupBy === "status" && <StatusIcon status={g.key as TrackerStatus} size={14} />}
            {groupBy === "priority" && <PriorityIcon priority={g.key as TrackerPriority} size={14} />}
            <span className="text-md font-semibold text-text">{g.label}</span>
            <span className="text-[10px] text-overlay0">{g.issues.length}</span>
          </div>
          {/* Header */}
          <div className="grid grid-cols-[60px_1fr_100px_80px_120px_100px_100px] gap-2 px-2 py-1 text-[10px] text-overlay0 font-medium uppercase tracking-wider border-b border-surface0">
            <span>ID</span>
            <span>Title</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Assignee</span>
            <span>Labels</span>
            <span>Updated</span>
          </div>
          {g.issues.map((issue) => (
            <div
              key={issue.id}
              onClick={() => onSelectIssue(issue.id)}
              className={cn(
                "grid grid-cols-[60px_1fr_100px_80px_120px_100px_100px] gap-2 px-2 py-1.5 cursor-pointer transition-colors items-center",
                issue.id === selectedIssueId ? "bg-surface0" : "hover:bg-mantle"
              )}
            >
              <span className="text-[11px] text-overlay0 font-mono">GEN-{issue.identifier}</span>
              <span className="text-md text-text truncate">{issue.title}</span>
              <div>
                <InlineSelect
                  value={issue.status}
                  options={STATUS_ORDER}
                  onChange={(s) => updateTrackerIssue(issue.id, { status: s })}
                  renderOption={(s) => (
                    <span className="flex items-center gap-1">
                      <StatusIcon status={s} size={12} />
                      <span>{STATUS_CONFIG[s].label}</span>
                    </span>
                  )}
                />
              </div>
              <div>
                <InlineSelect
                  value={issue.priority}
                  options={PRIORITY_ORDER}
                  onChange={(p) => updateTrackerIssue(issue.id, { priority: p })}
                  renderOption={(p) => (
                    <span className="flex items-center gap-1">
                      <PriorityIcon priority={p} size={12} />
                      <span>{PRIORITY_CONFIG[p].label}</span>
                    </span>
                  )}
                />
              </div>
              <div className="flex items-center gap-1">
                {issue.assigneeId ? (
                  <>
                    <UserAvatar name={issue.assigneeName} avatarUrl={issue.assigneeAvatar} size={16} />
                    <span className="text-md text-subtext0 truncate">{issue.assigneeName}</span>
                  </>
                ) : (
                  <span className="text-md text-overlay0">--</span>
                )}
              </div>
              <div className="flex gap-0.5 flex-wrap overflow-hidden">
                {issue.labels.slice(0, 2).map((l) => (
                  <span key={l.id} className="px-1 py-0.5 rounded text-[9px] font-medium" style={{ backgroundColor: l.color + "30", color: l.color }}>
                    {l.name}
                  </span>
                ))}
                {issue.labels.length > 2 && <span className="text-[9px] text-overlay0">+{issue.labels.length - 2}</span>}
              </div>
              <span className="text-[11px] text-overlay0">{new Date(issue.updatedAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// --- Detail panel ---

function TrackerIssueDetail({ issue, labels, onClose }: { issue: TrackerIssue; labels: TrackerLabel[]; onClose: () => void }) {
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTitle(issue.title);
    setDescription(issue.description);
  }, [issue.id, issue.title, issue.description]);

  const saveTitle = useCallback(() => {
    if (title.trim() && title !== issue.title) {
      updateTrackerIssue(issue.id, { title: title.trim() });
    }
  }, [title, issue.id, issue.title]);

  const saveDescription = useCallback(() => {
    if (description !== issue.description) {
      updateTrackerIssue(issue.id, { description });
    }
  }, [description, issue.id, issue.description]);

  const handleDescKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      saveDescription();
    }
  }, [saveDescription]);

  return (
    <div className="absolute right-0 top-0 bottom-0 w-[400px] bg-crust border-l border-surface0 flex flex-col z-40 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface0">
        <span className="text-md text-overlay0 font-mono">GEN-{issue.identifier}</span>
        <button onClick={onClose} className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text rounded hover:bg-surface0">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
        {/* Title */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); }}
          className="text-lg font-semibold text-text bg-transparent border-none outline-none w-full px-0"
          placeholder="Issue title"
        />

        {/* Properties grid */}
        <div className="grid grid-cols-[80px_1fr] gap-y-2 gap-x-2 items-center">
          <span className="text-md text-overlay0">Status</span>
          <InlineSelect
            value={issue.status}
            options={STATUS_ORDER}
            onChange={(s) => updateTrackerIssue(issue.id, { status: s })}
            renderOption={(s) => (
              <span className="flex items-center gap-1.5">
                <StatusIcon status={s} size={14} />
                <span className="text-text">{STATUS_CONFIG[s].label}</span>
              </span>
            )}
          />

          <span className="text-md text-overlay0">Priority</span>
          <InlineSelect
            value={issue.priority}
            options={PRIORITY_ORDER}
            onChange={(p) => updateTrackerIssue(issue.id, { priority: p })}
            renderOption={(p) => (
              <span className="flex items-center gap-1.5">
                <PriorityIcon priority={p} size={14} />
                <span className="text-text">{PRIORITY_CONFIG[p].label}</span>
              </span>
            )}
          />

          <span className="text-md text-overlay0">Assignee</span>
          <AssigneeSelect
            value={issue.assigneeId}
            onChange={(id) => updateTrackerIssue(issue.id, { assigneeId: id })}
          />

          <span className="text-md text-overlay0">Labels</span>
          <LabelPicker
            selectedIds={issue.labels.map((l) => l.id)}
            onChange={(ids) => updateTrackerIssue(issue.id, { labelIds: ids })}
            labels={labels}
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1">
          <span className="text-md text-overlay0 font-medium">Description</span>
          <textarea
            ref={descRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            onKeyDown={handleDescKeyDown}
            className="w-full min-h-[120px] bg-mantle border border-surface0 rounded-md p-2 text-md text-text resize-y outline-none focus:border-blue transition-colors"
            placeholder="Add a description..."
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-surface0">
        <button
          onClick={() => { deleteTrackerIssue(issue.id); onClose(); }}
          className="flex items-center gap-1.5 px-2 py-1 text-md text-red bg-transparent border-none cursor-pointer hover:bg-red/10 rounded transition-colors"
        >
          <Trash2 size={12} />
          Delete issue
        </button>
      </div>
    </div>
  );
}

// --- Create modal ---

function TrackerCreateModal({ labels, projectId, onClose }: { labels: TrackerLabel[]; projectId: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TrackerStatus>("todo");
  const [priority, setPriority] = useState<TrackerPriority>("none");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    if (!title.trim()) return;
    createTrackerIssue({
      projectId,
      title: title.trim(),
      description,
      status,
      priority,
      assigneeId,
      labelIds: selectedLabelIds.length > 0 ? selectedLabelIds : undefined,
    });
  }, [projectId, title, description, status, priority, assigneeId, selectedLabelIds]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      handleSubmit();
    }
  }, [onClose, handleSubmit]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-crust rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col border border-surface0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface0">
          <span className="text-md font-semibold text-text">New Issue</span>
          <button onClick={onClose} className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text rounded hover:bg-surface0">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3 overflow-y-auto">
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-base font-medium text-text bg-mantle border border-surface0 rounded-md px-3 py-2 outline-none focus:border-blue transition-colors"
            placeholder="Issue title"
          />

          <div className="grid grid-cols-[80px_1fr] gap-y-2 gap-x-2 items-center">
            <span className="text-md text-overlay0">Status</span>
            <InlineSelect
              value={status}
              options={STATUS_ORDER}
              onChange={setStatus}
              renderOption={(s) => (
                <span className="flex items-center gap-1.5">
                  <StatusIcon status={s} size={14} />
                  <span className="text-text">{STATUS_CONFIG[s].label}</span>
                </span>
              )}
            />

            <span className="text-md text-overlay0">Priority</span>
            <InlineSelect
              value={priority}
              options={PRIORITY_ORDER}
              onChange={setPriority}
              renderOption={(p) => (
                <span className="flex items-center gap-1.5">
                  <PriorityIcon priority={p} size={14} />
                  <span className="text-text">{PRIORITY_CONFIG[p].label}</span>
                </span>
              )}
            />

            <span className="text-md text-overlay0">Assignee</span>
            <AssigneeSelect value={assigneeId} onChange={setAssigneeId} />

            <span className="text-md text-overlay0">Labels</span>
            <LabelPicker selectedIds={selectedLabelIds} onChange={setSelectedLabelIds} labels={labels} />
          </div>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full min-h-[80px] bg-mantle border border-surface0 rounded-md p-2 text-md text-text resize-y outline-none focus:border-blue transition-colors"
            placeholder="Add a description..."
          />
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-surface0">
          <span className="text-[10px] text-overlay0">Cmd+Enter to submit</span>
          <div className="flex gap-2">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSubmit} disabled={!title.trim()}>Create</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Label management modal ---

function LabelManagerModal({ labels, onClose }: { labels: TrackerLabel[]; onClose: () => void }) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(LABEL_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const handleCreate = () => {
    if (!newName.trim()) return;
    createTrackerLabel(newName.trim(), newColor);
    setNewName("");
  };

  const handleSaveEdit = (labelId: string) => {
    if (!editName.trim()) return;
    updateTrackerLabel(labelId, { name: editName.trim(), color: editColor });
    setEditingId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-crust rounded-lg shadow-xl w-[380px] max-h-[80vh] flex flex-col border border-surface0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface0">
          <span className="text-md font-semibold text-text">Manage Labels</span>
          <button onClick={onClose} className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text rounded hover:bg-surface0">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-2 px-4 py-3 overflow-y-auto max-h-[300px]">
          {labels.map((l) => (
            <div key={l.id} className="flex items-center gap-2">
              {editingId === l.id ? (
                <>
                  <select
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="w-8 h-6 border-none rounded cursor-pointer bg-transparent"
                    style={{ accentColor: editColor }}
                  >
                    {LABEL_COLORS.map((c) => (
                      <option key={c} value={c} style={{ backgroundColor: c }}>{c}</option>
                    ))}
                  </select>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: editColor }} />
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(l.id); }}
                    className="flex-1 bg-mantle border border-surface0 rounded px-2 py-0.5 text-md text-text outline-none"
                  />
                  <button onClick={() => handleSaveEdit(l.id)} className="text-[10px] text-green bg-transparent border-none cursor-pointer">Save</button>
                  <button onClick={() => setEditingId(null)} className="text-[10px] text-overlay0 bg-transparent border-none cursor-pointer">Cancel</button>
                </>
              ) : (
                <>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                  <span className="flex-1 text-md text-text">{l.name}</span>
                  <button
                    onClick={() => { setEditingId(l.id); setEditName(l.name); setEditColor(l.color); }}
                    className="text-[10px] text-overlay0 bg-transparent border-none cursor-pointer hover:text-text"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteTrackerLabel(l.id)}
                    className="text-[10px] text-red bg-transparent border-none cursor-pointer hover:text-red"
                  >
                    <Trash2 size={10} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-surface0 flex items-center gap-2">
          <div className="flex gap-1">
            {LABEL_COLORS.slice(0, 5).map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={cn(
                  "w-4 h-4 rounded-full border-none cursor-pointer transition-transform",
                  newColor === c ? "scale-125 ring-1 ring-text" : ""
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            className="flex-1 bg-mantle border border-surface0 rounded px-2 py-1 text-md text-text outline-none"
            placeholder="New label name"
          />
          <Button variant="primary" onClick={handleCreate} disabled={!newName.trim()}>Add</Button>
        </div>
      </div>
    </div>
  );
}

// --- Filter bar ---

function TrackerFilterBar({ filters, labels }: { filters: TrackerFilters; labels: TrackerLabel[] }) {
  const hasFilters = filters.status.length > 0 || filters.priority.length > 0 || filters.assigneeId.length > 0 || filters.labelId.length > 0;
  const [showFilters, setShowFilters] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showFilters) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowFilters(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showFilters]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setShowFilters(!showFilters)}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded text-md border-none cursor-pointer transition-colors",
          hasFilters ? "bg-blue/20 text-blue" : "bg-transparent text-overlay0 hover:bg-surface0 hover:text-text"
        )}
      >
        <Filter size={12} />
        Filter
        {hasFilters && <span className="text-[10px]">({filters.status.length + filters.priority.length + filters.assigneeId.length + filters.labelId.length})</span>}
      </button>
      {showFilters && (
        <div className="absolute z-50 top-full right-0 mt-1 bg-crust border border-surface0 rounded-md shadow-lg p-3 min-w-[260px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-md font-semibold text-text">Filters</span>
            {hasFilters && (
              <button onClick={clearTrackerFilters} className="text-[10px] text-blue bg-transparent border-none cursor-pointer">Clear all</button>
            )}
          </div>

          {/* Status filter */}
          <div className="mb-2">
            <span className="text-[10px] text-overlay0 uppercase tracking-wider font-medium">Status</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    const current = filters.status;
                    setTrackerFilters({ status: current.includes(s) ? current.filter((x) => x !== s) : [...current, s] });
                  }}
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border-none cursor-pointer transition-colors",
                    filters.status.includes(s) ? "bg-surface1 text-text" : "bg-surface0 text-overlay0 hover:text-text"
                  )}
                >
                  <StatusIcon status={s} size={10} />
                  {STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* Priority filter */}
          <div className="mb-2">
            <span className="text-[10px] text-overlay0 uppercase tracking-wider font-medium">Priority</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {PRIORITY_ORDER.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    const current = filters.priority;
                    setTrackerFilters({ priority: current.includes(p) ? current.filter((x) => x !== p) : [...current, p] });
                  }}
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border-none cursor-pointer transition-colors",
                    filters.priority.includes(p) ? "bg-surface1 text-text" : "bg-surface0 text-overlay0 hover:text-text"
                  )}
                >
                  <PriorityIcon priority={p} size={10} />
                  {PRIORITY_CONFIG[p].label}
                </button>
              ))}
            </div>
          </div>

          {/* Label filter */}
          {labels.length > 0 && (
            <div>
              <span className="text-[10px] text-overlay0 uppercase tracking-wider font-medium">Labels</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {labels.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => {
                      const current = filters.labelId;
                      setTrackerFilters({ labelId: current.includes(l.id) ? current.filter((x) => x !== l.id) : [...current, l.id] });
                    }}
                    className={cn(
                      "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border-none cursor-pointer transition-colors",
                      filters.labelId.includes(l.id) ? "bg-surface1 text-text" : "bg-surface0 text-overlay0 hover:text-text"
                    )}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Toolbar ---

function TrackerToolbar({ tracker, projects }: { tracker: TrackerState; projects: ProjectDef[] }) {
  const [showLabelManager, setShowLabelManager] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 px-3 shrink-0">
        <ViewHeader
          title="Tracker"
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={() => setShowLabelManager(true)}>
                <Tag size={12} />
                Labels
              </Button>
              <Button size="sm" variant="primary" onClick={showTrackerCreateForm} disabled={projects.length === 0}>
                <Plus size={12} />
                New Issue
              </Button>
            </>
          }
        />
      </div>
      <div className="px-3">
        <ViewTabs
          tabs={[
            { key: "board" as const, label: <span className="flex items-center gap-1"><LayoutGrid size={12} />Board</span> },
            { key: "list" as const, label: <span className="flex items-center gap-1"><List size={12} />List</span> },
          ]}
          activeTab={tracker.viewMode}
          onTabChange={setTrackerViewMode}
        />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 shrink-0">
        {/* Project selector */}
        <InlineSelect
          value={tracker.selectedProjectId || "__all__"}
          options={["__all__", ...projects.map((p) => p.id)]}
          onChange={(v) => setTrackerProject(v === "__all__" ? null : v)}
          renderOption={(v) => {
            if (v === "__all__") return <span className="text-text">All projects</span>;
            const p = projects.find((pr) => pr.id === v);
            return <span className="text-text">{p?.name || "Unknown"}</span>;
          }}
        />

        {/* Group by */}
        <InlineSelect
          value={tracker.groupBy}
          options={["status", "priority", "assignee"] as TGroupBy[]}
          onChange={setTrackerGroupBy}
          renderOption={(g) => (
            <span className="text-text">Group: {g === "status" ? "Status" : g === "priority" ? "Priority" : "Assignee"}</span>
          )}
        />

        <TrackerFilterBar filters={tracker.filters} labels={tracker.labels} />
      </div>

      {showLabelManager && <LabelManagerModal labels={tracker.labels} onClose={() => setShowLabelManager(false)} />}
    </>
  );
}

// --- Main panel ---

export function TrackerPanel() {
  // Subscribe to individual tracker paths to ensure reactivity
  // (subscribing to the parent "tracker" object doesn't trigger re-renders
  // because the object reference stays the same when its properties are mutated)
  const [trackerState] = useSubject($tracker);
  const { issues, labels, loading, viewMode, groupBy, filters, selectedIssueId, selectedProjectId, showCreateForm } = trackerState;
  const [projects] = useSubject($projects);

  const tracker: TrackerState = useMemo(() => ({
    issues, labels, loading, viewMode, groupBy, filters,
    selectedIssueId, selectedProjectId, showCreateForm,
  }), [issues, labels, loading, viewMode, groupBy, filters,
    selectedIssueId, selectedProjectId, showCreateForm]);

  useEffect(() => {
    loadTrackerIssues();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isInput) return;

      if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        showTrackerCreateForm();
      }
      if (e.key === "Escape" && selectedIssueId) {
        selectTrackerIssue(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIssueId]);

  // Filter by selected project, then by filters
  const projectFilteredIssues = useMemo(() => {
    if (!selectedProjectId) return issues;
    return issues.filter((i) => i.projectId === selectedProjectId);
  }, [issues, selectedProjectId]);

  const filteredIssues = useMemo(() => applyFilters(projectFilteredIssues, filters), [projectFilteredIssues, filters]);
  const groups = useMemo(() => groupIssues(filteredIssues, groupBy), [filteredIssues, groupBy]);

  const selectedIssue = selectedIssueId ? issues.find((i) => i.id === selectedIssueId) : null;

  // Determine which projectId to use for creating: selected filter or first project
  const createProjectId = selectedProjectId || (projects.length > 0 ? projects[0].id : null);

  const handleSelectIssue = useCallback((id: string) => {
    selectTrackerIssue(id);
  }, []);

  if (loading && issues.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-overlay0 text-md">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <TrackerToolbar tracker={tracker} projects={projects} />

      {filteredIssues.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-overlay0 text-base">
          {projects.length === 0 ? "Create a project first to start tracking issues" : "No issues yet"}
          {projects.length > 0 && (
            <Button variant="primary" onClick={showTrackerCreateForm}>+ New Issue</Button>
          )}
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div className={cn("flex-1 flex flex-col overflow-hidden", selectedIssue && "mr-[400px]")}>
            {viewMode === "board" ? (
              <TrackerBoardView groups={groups} groupBy={groupBy} onSelectIssue={handleSelectIssue} />
            ) : (
              <TrackerListView groups={groups} groupBy={groupBy} onSelectIssue={handleSelectIssue} selectedIssueId={selectedIssueId} />
            )}
          </div>

          {selectedIssue && (
            <TrackerIssueDetail
              issue={selectedIssue}
              labels={labels}
              onClose={() => selectTrackerIssue(null)}
            />
          )}
        </div>
      )}

      {showCreateForm && createProjectId && (
        <TrackerCreateModal labels={labels} projectId={createProjectId} onClose={hideTrackerCreateForm} />
      )}
    </div>
  );
}
