"use client";

import { useMemo } from "react";
import { Link2, Link2Off } from "lucide-react";
import type { SshSessionInfo } from "@/store/types/ssh";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Count manager `client` SSH sessions to `host` (the pinned programmatic tunnel). */
export function clientSessionsForHost(host: string, sessions: SshSessionInfo[]): number {
  if (!host) return 0;
  return sessions.filter((s) => s.kind === "client" && s.host === host).length;
}

interface ServerTunnelIndicatorProps {
  host: string;
  sessions: SshSessionInfo[];
  /** When the registry is still loading the first snapshot. */
  loading?: boolean;
  className?: string;
}

/** Green link = one SSH client tunnel to this host; gray = none (open Manage to connect). */
export function ServerTunnelIndicator({ host, sessions, loading, className }: ServerTunnelIndicatorProps) {
  const count = useMemo(() => clientSessionsForHost(host, sessions), [host, sessions]);
  const connected = count > 0;

  if (loading) {
    return (
      <span
        className={cn("inline-flex shrink-0 text-overlay0", className)}
        title="Checking SSH tunnel…"
        aria-label="Checking SSH tunnel"
      >
        <Link2Off size={14} className="opacity-40" />
      </span>
    );
  }

  const label = connected
    ? `SSH tunnel connected (${count} client session${count === 1 ? "" : "s"})`
    : "No SSH tunnel — open Manage to connect";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex shrink-0",
            connected ? "text-green" : "text-overlay0",
            className,
          )}
          aria-label={label}
        >
          {connected ? <Link2 size={14} /> : <Link2Off size={14} />}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
