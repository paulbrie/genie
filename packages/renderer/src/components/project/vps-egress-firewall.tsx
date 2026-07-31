"use client";

// Claude egress-firewall card for the VM card's main tab (sits under the UFW
// inbound "Firewall" section). Talks to the manager's vps:firewall:* handler
// (firewall-handler.ts): one combined status probe on mount, then explicit
// actions — toggle enforcement (installing the firewall on VMs whose Standard
// Setup predates hardening), add/remove allowlist entries, and one-click
// "Allow" from the recent-blocks list. All mutations reply with a fresh
// status, so local state is always the VM's truth, never optimistic.

import { useState, useEffect, useRef, useCallback } from "react";
import { ShieldCheck, RefreshCw, Loader2, Plus, X, ChevronDown, ChevronRight } from "lucide-react";
import { wsRequest } from "@/lib/ws";
import { cn } from "@/lib/utils";

interface AllowEntry {
  entry: string;
  comment?: string;
  protected: boolean;
}

interface Block {
  ip: string;
  port?: number;
  proto?: string;
  count: number;
  lastSeen?: string;
  ptr?: string;
}

interface EgressStatus {
  installed: boolean;
  enforced: boolean;
  allowedIps: number;
  allowlist: AllowEntry[];
  blocks: Block[];
}

interface FirewallResult {
  ok: boolean;
  status?: EgressStatus;
  error?: string;
}

export function VpsEgressFirewall({ projectId, instanceId }: { projectId: string; instanceId: string }) {
  const [status, setStatus] = useState<EgressStatus | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [pendingEntry, setPendingEntry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [newEntry, setNewEntry] = useState("");

  const mountedRef = useRef(true);

  const applyResult = useCallback((res: FirewallResult) => {
    if (!mountedRef.current) return;
    if (res.ok && res.status) {
      setStatus(res.status);
      setError(null);
    } else {
      setError(res.error || "Request failed");
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      applyResult(await wsRequest<FirewallResult>("vps:firewall:status", { projectId, instanceId }, 30_000));
    } catch (err: unknown) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
        setInitialLoading(false);
      }
    }
  }, [projectId, instanceId, applyResult]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchStatus();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchStatus]);

  const toggle = useCallback(async (enabled: boolean) => {
    setToggling(true);
    setError(null);
    try {
      // Enabling can run the full setup script (apt install + units) on VMs
      // where Standard Setup predates hardening — allow it time.
      applyResult(await wsRequest<FirewallResult>("vps:firewall:toggle", { projectId, instanceId, enabled }, 250_000));
    } catch (err: unknown) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setToggling(false);
    }
  }, [projectId, instanceId, applyResult]);

  const addEntry = useCallback(async (entry: string) => {
    const value = entry.trim().toLowerCase();
    if (!value) return;
    setPendingEntry(value);
    setError(null);
    try {
      const res = await wsRequest<FirewallResult>("vps:firewall:add", { projectId, instanceId, entry: value }, 45_000);
      applyResult(res);
      if (res.ok && mountedRef.current) setNewEntry("");
    } catch (err: unknown) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setPendingEntry(null);
    }
  }, [projectId, instanceId, applyResult]);

  const removeEntry = useCallback(async (entry: string) => {
    setPendingEntry(entry);
    setError(null);
    try {
      applyResult(await wsRequest<FirewallResult>("vps:firewall:remove", { projectId, instanceId, entry }, 45_000));
    } catch (err: unknown) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setPendingEntry(null);
    }
  }, [projectId, instanceId, applyResult]);

  const badge = initialLoading
    ? "..."
    : !status
      ? "Unknown"
      : status.enforced
        ? `Enforced · ${status.allowedIps} IPs`
        : status.installed
          ? "Off"
          : "Not set up";

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 text-md font-medium text-subtext0 hover:text-text transition-colors"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <ShieldCheck size={12} className="text-mauve" />
          Claude egress
        </button>
        <span className={cn(
          "text-[11px] px-1.5 py-0.5 rounded font-medium",
          error && !status ? "bg-red/15 text-red"
            : status?.enforced ? "bg-green/15 text-green"
            : "bg-overlay0/15 text-overlay0"
        )}>
          {badge}
        </span>
        <div className="flex-1" />
        {!initialLoading && status && (
          <button
            onClick={() => void toggle(!status.enforced)}
            disabled={toggling || refreshing}
            className={cn(
              "text-md px-2 py-0.5 rounded transition-colors",
              status.enforced ? "text-red hover:bg-red/10" : "text-green hover:bg-green/10"
            )}
            title={status.enforced
              ? "Stop filtering the genie user's outbound traffic"
              : status.installed
                ? "Re-enable the outbound allowlist for the genie user"
                : "Install the egress firewall on this VM (outbound allowlist for Claude sessions)"}
          >
            {toggling ? (status.installed ? "..." : "Setting up…") : status.enforced ? "Disable" : "Enable"}
          </button>
        )}
        <button onClick={() => void fetchStatus()} disabled={refreshing} className="text-overlay0 hover:text-text transition-colors p-0.5">
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="mt-1 text-md text-red truncate" title={error}>{error}</div>
      )}

      {expanded && status && (
        <div className="mt-2 space-y-2">
          {/* Allowlist */}
          <div>
            <div className="text-[11px] text-overlay0 mb-1">
              Allowed destinations — traffic from the genie user (Claude sessions, dev services) to anything else is blocked while enforced.
            </div>
            <div className="flex flex-wrap gap-1">
              {status.allowlist.map((a) => (
                <span
                  key={a.entry}
                  className="flex items-center gap-1 text-[11px] font-mono bg-surface0 text-subtext0 px-1.5 py-0.5 rounded"
                  title={a.comment || a.entry}
                >
                  {a.entry}
                  {!a.protected && (
                    <button
                      onClick={() => void removeEntry(a.entry)}
                      disabled={pendingEntry !== null}
                      className="text-overlay0 hover:text-red transition-colors bg-transparent border-none cursor-pointer p-0 flex items-center"
                      title={`Remove ${a.entry}`}
                    >
                      {pendingEntry === a.entry ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
                    </button>
                  )}
                </span>
              ))}
              {status.allowlist.length === 0 && (
                <span className="text-[11px] text-overlay0">No allowlist on this VM yet — enable the firewall to seed it.</span>
              )}
            </div>
            <form
              className="flex items-center gap-1.5 mt-1.5"
              onSubmit={(e) => { e.preventDefault(); void addEntry(newEntry); }}
            >
              <input
                value={newEntry}
                onChange={(e) => setNewEntry(e.target.value)}
                placeholder="api.example.com"
                className="bg-surface0 text-text text-[11px] font-mono rounded px-1.5 py-0.5 border border-surface1 focus:border-blue outline-none w-44"
              />
              <button
                type="submit"
                disabled={!newEntry.trim() || pendingEntry !== null}
                className="flex items-center gap-0.5 text-md text-blue hover:text-sapphire transition-colors bg-transparent border-none cursor-pointer p-0 disabled:opacity-50"
              >
                {pendingEntry === newEntry.trim().toLowerCase() ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                Allow
              </button>
            </form>
          </div>

          {/* Recent blocks */}
          {status.blocks.length > 0 && (
            <div>
              <div className="text-[11px] text-overlay0 mb-1">Blocked in the last 24h</div>
              <div className="space-y-0.5">
                {status.blocks.slice(0, 8).map((b) => (
                  <div key={`${b.ip}:${b.port ?? "-"}`} className="flex items-center gap-2 text-[11px] font-mono text-subtext0">
                    <span className="truncate" title={b.ptr ? `${b.ip} (${b.ptr})` : b.ip}>
                      {b.ptr ?? b.ip}
                    </span>
                    <span className="text-overlay0 shrink-0">
                      {b.proto?.toLowerCase()}{b.port ? `:${b.port}` : ""} · ×{b.count}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={() => void addEntry(b.ptr ?? b.ip)}
                      disabled={pendingEntry !== null}
                      className="text-blue hover:text-sapphire transition-colors bg-transparent border-none cursor-pointer text-[11px] p-0 shrink-0"
                      title={`Allow ${b.ptr ?? b.ip}`}
                    >
                      + Allow
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
