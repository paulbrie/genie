"use client";

import { cn } from "@/lib/utils";
import { CopyableIp } from "@/components/ui/copyable-ip";
import { CircularGauge } from "@/components/ui/circular-gauge";
import { ExternalLink, RefreshCw, Terminal, Trash2 } from "lucide-react";
import type { VpsStats } from "@/store/types";
export interface DropletInstanceBarProps {
  name: string;
  status: string;
  ip: string | null;
  region?: string;
  sizeSlug?: string;
  provider?: "digitalocean" | "tazcloud";
  stats?: VpsStats | null;
  statsLoading?: boolean;
  statsError?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
  projectName?: string | null;
  onRefresh?: () => void;
  onSshTerminal?: () => void;
  onDelete?: () => void;
  /** When provided, port/IP links call this instead of opening a new tab */
  onNavigate?: (url: string) => void;
  /** Use compact layout with circular gauges (better for narrow sidebars) */
  compact?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function LinearGauge({ label, percent, detail }: { label: string; percent: number; detail?: string }) {
  const color =
    percent >= 90 ? "bg-red" : percent >= 70 ? "bg-peach" : "bg-green";

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-md text-overlay0 font-medium w-7">{label}</span>
      <div className="w-16 h-1.5 bg-surface1 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-md text-subtext0 font-mono w-7 text-right">{percent}%</span>
      {detail && <span className="text-md text-overlay0 font-mono">{detail}</span>}
    </div>
  );
}


function formatBytesShort(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)}G`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)}M`;
}

function statusBadge(status: string) {
  const isActive = status === "active";
  const isHibernated = status === "hibernated";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-md font-medium px-1.5 py-0.5 rounded",
        isActive ? "bg-green/15 text-green" : isHibernated ? "bg-blue/15 text-blue" : "bg-overlay0/15 text-overlay0",
      )}
    >
      <span
        className={cn(
          "w-2 h-2 rounded-full shrink-0",
          isActive && "bg-green shadow-[0_0_3px_var(--color-green)]",
          isHibernated && "bg-blue shadow-[0_0_3px_var(--color-blue)]",
          !isActive && !isHibernated && "bg-overlay0",
        )}
      />
      {status}
    </span>
  );
}

export function DropletInstanceBar({
  name,
  status,
  ip,
  region,
  sizeSlug,
  provider = "digitalocean",
  stats,
  statsLoading,
  statsError,
  onRefresh,
  onSshTerminal,
  onDelete,
  onNavigate,
  compact,
}: DropletInstanceBarProps) {
  const memDetail = stats
    ? `${formatBytes(stats.memUsedBytes)}/${formatBytes(stats.memTotalBytes)}`
    : undefined;
  const diskDetail = stats
    ? `${formatBytes(stats.diskUsedBytes)}/${formatBytes(stats.diskTotalBytes)}`
    : undefined;
  // Parse vCPU count from DO size slug (e.g. "s-1vcpu-1gb", "s-2vcpu-4gb")
  const vcpuMatch = sizeSlug?.match(/(\d+)vcpu/);
  const vcpuLabel = vcpuMatch ? `${vcpuMatch[1]}v` : undefined;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-md font-semibold text-text shrink-0">{name}</span>

      {statusBadge(status)}

      {ip && (
        <span className="inline-flex items-center gap-1 shrink-0">
          <CopyableIp ip={ip} className="text-md text-overlay0" />
          {onNavigate ? (
            <button
              onClick={() => onNavigate(`http://${ip}`)}
              className="text-overlay0 hover:text-blue transition-colors"
              title="Open in browser"
            >
              <ExternalLink size={11} />
            </button>
          ) : (
            <a
              href={`http://${ip}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-overlay0 hover:text-blue transition-colors"
              title="Open in browser"
            >
              <ExternalLink size={11} />
            </a>
          )}
        </span>
      )}

      {sizeSlug && (
        <span className="text-md bg-blue/15 text-blue px-1.5 py-0.5 rounded font-mono shrink-0">
          {provider === "tazcloud" ? "Taz" : "DO"} {sizeSlug}{region ? ` · ${region}` : ""}
        </span>
      )}

      {statsLoading && !stats && (
        <span className="text-md bg-overlay0/15 text-overlay0 px-1.5 py-0.5 rounded font-medium shrink-0">
          Checking...
        </span>
      )}

      {statsError && (
        <span className="text-md bg-red/15 text-red px-1.5 py-0.5 rounded font-medium shrink-0">
          Unreachable
        </span>
      )}

      {stats && !compact && (
        <div className="flex items-center gap-3 ml-auto mr-2">
          <LinearGauge label="CPU" percent={stats.cpuPercent} />
          <LinearGauge label="MEM" percent={stats.memPercent} detail={memDetail} />
          <LinearGauge label="DISK" percent={stats.diskPercent} detail={diskDetail} />
        </div>
      )}

      {stats && compact && (
        <div className="flex items-center gap-2 ml-auto">
          <CircularGauge label="CPU" percent={stats.cpuPercent} subtitle={vcpuLabel} />
          <CircularGauge label="MEM" percent={stats.memPercent} subtitle={formatBytesShort(stats.memTotalBytes)} />
          <CircularGauge label="DISK" percent={stats.diskPercent} subtitle={formatBytesShort(stats.diskTotalBytes)} />
        </div>
      )}

      {/* Open ports */}
      {stats && stats.externalPorts.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {stats.externalPorts.map((port) => {
            const url = `http://${ip}:${port}`;
            return onNavigate ? (
              <button
                key={port}
                onClick={() => onNavigate(url)}
                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-peach/20 text-peach text-md font-mono hover:bg-peach/30 transition-colors"
                title={`Open ${url}`}
              >
                {port}<ExternalLink size={9} />
              </button>
            ) : (
              <a
                key={port}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-peach/20 text-peach text-md font-mono hover:bg-peach/30 transition-colors"
                title={`Open ${url}`}
              >
                {port}<ExternalLink size={9} />
              </a>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-1 shrink-0">
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1 text-overlay0 hover:text-text transition-colors"
            title="Refresh Status"
          >
            <RefreshCw size={14} />
          </button>
        )}
        {onSshTerminal && (
          <button
            onClick={onSshTerminal}
            className="p-1 text-overlay0 hover:text-text transition-colors"
            title="SSH Terminal"
          >
            <Terminal size={14} />
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="p-1 text-overlay0 hover:text-red transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
