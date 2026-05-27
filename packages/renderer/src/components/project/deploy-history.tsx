"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Loader2, X } from "lucide-react";
import type { DeployLogEntry, ProjectDef, VpsDeployState } from "@/store/types";
import { loadDeployLogs, openWindow } from "@/store/actions";
import { ErrorMessage } from "@/components/ui/error-message";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "...";
  const secs = Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Single deploy's progress + error log, expanded on click. Used both inside
 *  the floating deploy-progress window and in the DeployHistoryPanel. */
export function DeployLog({ progress, error, deploying }: { progress: string[]; error: string | null; deploying: boolean }) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [progress, error]);

  return (
    <div
      ref={logRef}
      className="bg-background rounded p-3 max-h-96 overflow-y-auto font-mono text-base select-text scrollbar-thin"
    >
      {progress.map((line, i) => (
        <div key={i} className="flex items-start gap-1.5 py-0.5">
          <Check size={12} className="text-green shrink-0 mt-0.5" />
          <span className="text-overlay1">{line}</span>
        </div>
      ))}
      {deploying && (
        <div className="flex items-center gap-1.5 py-0.5 text-blue">
          <Loader2 size={12} className="animate-spin shrink-0" />
          <span>Waiting...</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-1.5 py-0.5">
          <X size={12} className="text-red shrink-0 mt-0.5" />
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      )}
    </div>
  );
}

/** Compact, auto-scrolling progress log with a copy-to-clipboard button.
 *  Same data shape as DeployLog but styled for the inline deploy-progress
 *  card on the project page. */
export function DeployProgressLog({ progress, error, deploying }: { progress: string[]; error: string | null; deploying: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [progress.length]);
  const fullText = [...progress, ...(error ? [error] : [])].join("\n");
  return (
    <div className="border-t border-surface0 relative">
      <button
        onClick={() => { navigator.clipboard.writeText(fullText); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute top-1.5 right-2 p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors z-10"
        title="Copy logs"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <div className="px-3 py-2 max-h-[200px] overflow-auto font-mono text-md select-text">
        {progress.map((msg, i) => (
          <div key={i} className="text-overlay1 leading-relaxed">{msg}</div>
        ))}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div ref={endRef} />
      </div>
    </div>
  );
}

/** Collapsible list of past deploys for one project. Each row expands to its
 *  full DeployLog. The "Close" button is wired by callers — leave as no-op
 *  when there's no enclosing chrome to dismiss. */
export function DeployHistoryPanel({
  logs,
  onClose,
}: {
  logs: DeployLogEntry[];
  onClose: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-md font-medium text-subtext0">Deploy History</span>
        <button onClick={onClose} className="text-md text-overlay0 hover:text-text">
          Close
        </button>
      </div>
      {logs.length === 0 ? (
        <div className="text-md text-overlay0 bg-background rounded p-3">No deploy history found.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {logs.map((entry) => {
            const isExpanded = expandedId === entry.id;
            return (
              <div key={entry.id} className="bg-background rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface0/50 transition-colors text-left"
                >
                  {entry.status === "success" && <Check size={12} className="text-green shrink-0" />}
                  {entry.status === "error" && <X size={12} className="text-red shrink-0" />}
                  {entry.status === "running" && <Loader2 size={12} className="text-blue animate-spin shrink-0" />}
                  <span className="text-md text-overlay0 flex-1">
                    {timeAgo(entry.startedAt)}
                  </span>
                  <span className="text-md text-overlay0 font-mono">
                    {formatDuration(entry.startedAt, entry.endedAt)}
                  </span>
                  {isExpanded ? <ChevronDown size={12} className="text-overlay0" /> : <ChevronRight size={12} className="text-overlay0" />}
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3">
                    <DeployLog
                      progress={entry.progress}
                      error={entry.error}
                      deploying={entry.status === "running"}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "Deploy History" tab content: in-flight deploys at the top (jump back to
 *  the floating progress window), then DeployHistoryPanel for the persisted
 *  log entries. Fired off `loadDeployLogs` on mount so the list is always
 *  up to date when the user switches into the tab. */
export function DeployHistoryTab({
  project,
  vpsDeploy,
}: {
  project: ProjectDef;
  vpsDeploy: VpsDeployState;
}) {
  useEffect(() => {
    loadDeployLogs(project.id);
  }, [project.id]);

  // Active deploys for this project
  const projectDeploys = Object.values(vpsDeploy.activeDeploys).filter(
    (d) => d.projectId === project.id
  );

  return (
    <div className="py-4">
      {projectDeploys.length > 0 && (
        <div className="flex flex-col gap-1 mb-3">
          {projectDeploys.map((d) => (
            <button
              key={d.instanceId}
              onClick={() => {
                openWindow("deploy-" + d.instanceId);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 bg-background rounded-lg hover:bg-surface0/50 transition-colors text-left"
            >
              {d.deploying && <Loader2 size={12} className="text-blue animate-spin shrink-0" />}
              {!d.deploying && !d.error && <Check size={12} className="text-green shrink-0" />}
              {!d.deploying && d.error && <X size={12} className="text-red shrink-0" />}
              <span className="text-md text-text flex-1">
                {d.deploying ? "Deploying..." : d.error ? "Failed" : "Complete"}
              </span>
              <span className="text-md text-overlay0">
                Open window
              </span>
              <ExternalLink size={10} className="text-overlay0" />
            </button>
          ))}
        </div>
      )}
      <DeployHistoryPanel
        logs={vpsDeploy.deployLogs}
        onClose={() => {}}
      />
    </div>
  );
}
