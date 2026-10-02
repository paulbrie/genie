"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import type { AdminState, AuditLogEntry, RailwayDeployment, RailwayLogEntry } from "@/store/types";
import { loadAuditLogs, loadProdDeployments, loadProdLogs } from "@/store/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const AUDIT_PAGE_SIZE = 50;

export function AuditPanel({ audit }: { audit: AdminState["audit"] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);

  const lowerFilter = filter.toLowerCase();
  const filteredLogs = lowerFilter
    ? audit.logs.filter((l: AuditLogEntry) =>
        l.action.toLowerCase().includes(lowerFilter) ||
        (l.userName?.toLowerCase().includes(lowerFilter)) ||
        (l.userId?.toLowerCase().includes(lowerFilter))
      )
    : audit.logs;

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / AUDIT_PAGE_SIZE));
  const safeePage = Math.min(page, totalPages - 1);
  const pagedLogs = filteredLogs.slice(safeePage * AUDIT_PAGE_SIZE, (safeePage + 1) * AUDIT_PAGE_SIZE);

  useEffect(() => { setPage(0); }, [filter]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-surface0 flex items-center gap-3">
        <Button size="sm" onClick={() => loadAuditLogs()}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Refresh
        </Button>
        <input
          type="text"
          placeholder="Filter by action or user..."
          className="bg-surface0 text-text border border-surface1 rounded px-2 py-1 text-md w-64"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="text-md text-overlay0">{filteredLogs.length} entries</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" disabled={safeePage === 0} onClick={() => setPage(safeePage - 1)}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="text-md text-overlay1">{safeePage + 1} / {totalPages}</span>
          <Button size="sm" disabled={safeePage >= totalPages - 1} onClick={() => setPage(safeePage + 1)}>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-md">
          <thead className="sticky top-0 bg-mantle z-10">
            <tr className="text-left text-overlay0">
              <th className="px-4 py-2 font-medium w-44">Time</th>
              <th className="px-4 py-2 font-medium w-40">User</th>
              <th className="px-4 py-2 font-medium w-56">Action</th>
              <th className="px-4 py-2 font-medium">Payload</th>
            </tr>
          </thead>
          <tbody>
            {audit.loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-overlay0">Loading...</td></tr>
            ) : pagedLogs.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-overlay0">No audit logs found</td></tr>
            ) : (
              pagedLogs.map((log: AuditLogEntry) => (
                <tr
                  key={log.id}
                  className="border-t border-surface0 hover:bg-surface0/50 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  <td className="px-4 py-2 text-overlay1 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-text truncate">
                    {log.userName || log.userId?.slice(0, 8) || "-"}
                  </td>
                  <td className="px-4 py-2">
                    <span className="px-1.5 py-0.5 bg-surface1 rounded text-text font-mono">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-overlay0 truncate max-w-md">
                    {expandedId === log.id ? (
                      <pre className="whitespace-pre-wrap text-md text-overlay1 max-h-60 overflow-auto">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    ) : (
                      <span className="truncate block">
                        {log.payload ? JSON.stringify(log.payload).slice(0, 100) : "-"}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProdLogsPanel({ prodlogs }: { prodlogs: AdminState["prodlogs"] }) {
  const { deployments, logs, selectedDeploymentId, logType, loading, logsLoading } = prodlogs;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Deployments sidebar */}
      <div className="w-72 shrink-0 border-r border-surface0 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-surface0 flex items-center gap-2">
          <span className="text-base font-medium text-text">Deployments</span>
          <Button size="sm" onClick={() => loadProdDeployments()}>
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && deployments.length === 0 ? (
            <div className="px-3 py-4 text-overlay0 text-base">Loading...</div>
          ) : deployments.length === 0 ? (
            <div className="px-3 py-4 text-overlay0 text-base">No deployments found</div>
          ) : (
            deployments.map((d: RailwayDeployment) => (
              <button
                key={d.id}
                onClick={() => loadProdLogs(d.id, logType)}
                className={cn(
                  "w-full text-left px-3 py-2 border-none cursor-pointer transition-colors text-base",
                  d.id === selectedDeploymentId
                    ? "bg-surface0 text-text"
                    : "bg-transparent text-subtext0 hover:bg-surface0/50"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    d.status === "SUCCESS" ? "bg-green" :
                    d.status === "FAILED" ? "bg-red" :
                    d.status === "DEPLOYING" || d.status === "BUILDING" ? "bg-yellow" :
                    "bg-overlay0"
                  )} />
                  <span className="truncate font-medium">{d.serviceName}</span>
                </div>
                <div className="text-overlay0 mt-0.5 flex items-center gap-2">
                  <span>{d.status}</span>
                  <span className="text-overlay0">&middot;</span>
                  <span>{new Date(d.createdAt).toLocaleString()}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Log viewer */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedDeploymentId ? (
          <>
            <div className="px-4 py-2 border-b border-surface0 flex items-center gap-3">
              <button
                onClick={() => loadProdLogs(selectedDeploymentId, "deploy")}
                className={cn(
                  "px-3 py-1 rounded text-base border-none cursor-pointer transition-colors",
                  logType === "deploy" ? "bg-surface0 text-text" : "bg-transparent text-overlay0 hover:text-text"
                )}
              >
                Deploy Logs
              </button>
              <button
                onClick={() => loadProdLogs(selectedDeploymentId, "build")}
                className={cn(
                  "px-3 py-1 rounded text-base border-none cursor-pointer transition-colors",
                  logType === "build" ? "bg-surface0 text-text" : "bg-transparent text-overlay0 hover:text-text"
                )}
              >
                Build Logs
              </button>
              <Button size="sm" onClick={() => loadProdLogs(selectedDeploymentId, logType)}>
                <RefreshCw className={cn("w-3.5 h-3.5", logsLoading && "animate-spin")} />
              </Button>
            </div>
            <div className="flex-1 overflow-auto bg-mantle font-mono text-base p-3">
              {logsLoading ? (
                <div className="text-overlay0">Loading logs...</div>
              ) : logs.length === 0 ? (
                <div className="text-overlay0">No logs available</div>
              ) : (
                logs.map((entry: RailwayLogEntry, i: number) => (
                  <div key={i} className="flex gap-3 leading-relaxed">
                    <span className="text-overlay0 shrink-0 select-none">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={cn(
                      entry.severity === "error" ? "text-red" :
                      entry.severity === "warn" ? "text-yellow" : "text-text"
                    )}>
                      {entry.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-overlay0 text-base">
            Select a deployment to view logs
          </div>
        )}
      </div>
    </div>
  );
}
