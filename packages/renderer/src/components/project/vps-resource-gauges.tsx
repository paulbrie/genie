"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw, ExternalLink, Copy, Check, Globe, Loader2 } from "lucide-react";
import type { VpsStats } from "@/store/types/vps";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CircularGauge } from "@/components/ui/circular-gauge";

type ExecFn = (
  command: string,
  onChunk?: (chunk: string) => void,
  signal?: AbortSignal,
) => Promise<{ output: string; error?: boolean }>;

interface Sample {
  cpuPct: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  memPct: number | null;
  diskUsedKb: number | null;
  diskTotalKb: number | null;
  diskPct: number | null;
  /** TCP ports bound to a non-loopback interface (0.0.0.0 / [::] / *). Null
   *  until the first successful probe; empty array means "probed, none open". */
  externalPorts: number[] | null;
}

// Single SSH round-trip that samples /proc/stat twice (400ms apart) so we can
// compute an instantaneous CPU %, then captures /proc/meminfo, `df`, and the
// list of listening TCP ports — keeps the readings in sync without N connections.
const PROBE_SCRIPT = `LC_ALL=C bash -c '
S1=$(head -1 /proc/stat); sleep 0.4; S2=$(head -1 /proc/stat)
echo "CPU1:$S1"
echo "CPU2:$S2"
echo "---MEM---"
grep -E "^(MemTotal|MemAvailable|MemFree):" /proc/meminfo
echo "---DISK---"
df -kP /
echo "---PORTS---"
ss -tlnH 2>/dev/null || true
' 2>/dev/null`;

function parseCpu(line: string): { idle: number; total: number } | null {
  // /proc/stat first line: "cpu user nice system idle iowait irq softirq steal guest guest_nice"
  const m = line.match(/^cpu\s+(.+)$/);
  if (!m) return null;
  const nums = m[1].trim().split(/\s+/).map(Number);
  if (nums.length < 4 || nums.some((n) => Number.isNaN(n))) return null;
  const idle = nums[3] + (nums[4] ?? 0);
  const total = nums.reduce((a, b) => a + b, 0);
  return { idle, total };
}

function parseProbe(output: string): Sample {
  const result: Sample = {
    cpuPct: null,
    memUsedBytes: null,
    memTotalBytes: null,
    memPct: null,
    diskUsedKb: null,
    diskTotalKb: null,
    diskPct: null,
    externalPorts: null,
  };

  let cpu1: { idle: number; total: number } | null = null;
  let cpu2: { idle: number; total: number } | null = null;
  let memTotalKb: number | null = null;
  let memAvailKb: number | null = null;
  let memFreeKb: number | null = null;
  let inDisk = false;
  let inPorts = false;
  const externalPortSet = new Set<number>();

  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("---PORTS---")) { inDisk = false; inPorts = true; continue; }
    if (line.startsWith("CPU1:")) cpu1 = parseCpu(line.slice(5).trim());
    else if (line.startsWith("CPU2:")) cpu2 = parseCpu(line.slice(5).trim());
    else if (line.startsWith("---DISK---")) inDisk = true;
    else if (line.startsWith("MemTotal:")) memTotalKb = parseInt(line.split(/\s+/)[1] ?? "", 10);
    else if (line.startsWith("MemAvailable:")) memAvailKb = parseInt(line.split(/\s+/)[1] ?? "", 10);
    else if (line.startsWith("MemFree:")) memFreeKb = parseInt(line.split(/\s+/)[1] ?? "", 10);
    else if (inPorts) {
      // `ss -tlnH` (no header) row: "State Recv-Q Send-Q Local-Address:Port Peer-Address:Port"
      // Treat a bind as external when the address is 0.0.0.0 / * / [::] (not 127.x or [::1]).
      const cols = line.split(/\s+/);
      if (cols.length < 4) continue;
      const localAddr = cols[3];
      const portMatch = localAddr.match(/:(\d+)$/);
      if (!portMatch) continue;
      const isExternal =
        localAddr.startsWith("0.0.0.0:") ||
        localAddr.startsWith("*:") ||
        localAddr.startsWith("[::]:") ||
        localAddr.startsWith(":::");
      if (isExternal) {
        const port = parseInt(portMatch[1], 10);
        if (!Number.isNaN(port)) externalPortSet.add(port);
      }
    }
    else if (inDisk && !line.startsWith("Filesystem")) {
      // df -kP / → second line: "Filesystem 1024-blocks Used Available Capacity Mounted-on"
      const parts = line.split(/\s+/);
      if (parts.length >= 5) {
        const used = parseInt(parts[2], 10);
        const avail = parseInt(parts[3], 10);
        if (!Number.isNaN(used) && !Number.isNaN(avail) && used + avail > 0) {
          result.diskUsedKb = used;
          result.diskTotalKb = used + avail;
          result.diskPct = (used / (used + avail)) * 100;
        }
      }
    }
  }

  if (output.includes("---PORTS---")) {
    result.externalPorts = [...externalPortSet].sort((a, b) => a - b);
  }

  if (cpu1 && cpu2) {
    const dt = cpu2.total - cpu1.total;
    const di = cpu2.idle - cpu1.idle;
    if (dt > 0) result.cpuPct = Math.max(0, Math.min(100, ((dt - di) / dt) * 100));
  }

  if (memTotalKb && memTotalKb > 0) {
    const availableKb = memAvailKb ?? memFreeKb ?? 0;
    const used = memTotalKb - availableKb;
    result.memTotalBytes = memTotalKb * 1024;
    result.memUsedBytes = used * 1024;
    result.memPct = Math.max(0, Math.min(100, (used / memTotalKb) * 100));
  }

  return result;
}

function fmtBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function fmtKb(kb: number | null): string {
  if (kb == null) return "—";
  return fmtBytes(kb * 1024);
}

function Gauge({
  label,
  pct,
  detail,
}: {
  label: string;
  pct: number | null;
  detail: string;
}) {
  // CircularGauge expects a number — render a dimmed placeholder until we have a real reading.
  const value = pct == null ? 0 : Math.round(pct);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("cursor-default", pct == null && "opacity-50")}>
          <CircularGauge label={label} percent={value} size={44} strokeWidth={4} valueFontSize={12} showPercentSign />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <span className="text-md">{detail}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function CopyButton({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={title}
      className="text-overlay0 hover:text-text transition-colors"
    >
      {copied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
    </button>
  );
}

export function isPrivateHostAddress(host: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

export interface VpsResourceBarStats {
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  externalPorts: number[];
  memUsedBytes?: number;
  memTotalBytes?: number;
  diskUsedBytes?: number;
  diskTotalBytes?: number;
}

export function vpsStatsToBarStats(stats: VpsStats): VpsResourceBarStats {
  return {
    cpuPercent: stats.cpuPercent,
    memPercent: stats.memPercent,
    diskPercent: stats.diskPercent,
    externalPorts: stats.externalPorts,
    memUsedBytes: stats.memUsedBytes,
    memTotalBytes: stats.memTotalBytes,
    diskUsedBytes: stats.diskUsedBytes,
    diskTotalBytes: stats.diskTotalBytes,
  };
}

function sampleToBarStats(sample: Sample): VpsResourceBarStats {
  return {
    cpuPercent: sample.cpuPct ?? 0,
    memPercent: sample.memPct ?? 0,
    diskPercent: sample.diskPct ?? 0,
    externalPorts: sample.externalPorts ?? [],
    memUsedBytes: sample.memUsedBytes ?? undefined,
    memTotalBytes: sample.memTotalBytes ?? undefined,
    diskUsedBytes: sample.diskUsedKb != null ? sample.diskUsedKb * 1024 : undefined,
    diskTotalBytes: sample.diskTotalKb != null ? sample.diskTotalKb * 1024 : undefined,
  };
}

export interface VpsResourceBarProps {
  host: string;
  ipv6?: boolean;
  isPrivateHost?: boolean;
  domain?: { name: string; url?: string } | null;
  appPort?: number;
  stats?: VpsResourceBarStats | null;
  statsLoading?: boolean;
  statsError?: string | null;
  onRefresh?: () => void;
  refreshLoading?: boolean;
  className?: string;
}

/** Domain / IP / port tags / CPU·MEM·DISK bar — shared by manage popup and Clouds cards. */
export function VpsResourceBar({
  host,
  ipv6,
  isPrivateHost: isPrivateHostProp,
  domain,
  appPort = 3000,
  stats,
  statsLoading = false,
  statsError,
  onRefresh,
  refreshLoading = false,
  className,
}: VpsResourceBarProps) {
  const isPrivateHost = isPrivateHostProp ?? isPrivateHostAddress(host);
  const isV6 = ipv6 ?? host.includes(":");
  const hostBracketed = isV6 ? `[${host}]` : host;
  const ipUrl = `http://${hostBracketed}${appPort ? `:${appPort}` : ""}`;
  const domainUrl = domain ? (domain.url || `https://${domain.name}`) : null;
  const ports = stats?.externalPorts ?? [];
  const gaugesDimmed = statsLoading && !stats;

  return (
    <section
      className={cn(
        "flex flex-col gap-1.5 py-2 px-3 bg-mantle rounded-lg border border-overlay0/20",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-1 flex-1 min-w-0 justify-center">
          {domainUrl ? (
            <UrlRow
              icon={<Globe size={12} className="text-green shrink-0" />}
              label="Domain"
              url={domainUrl}
            />
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-overlay0">
              <Globe size={12} className="shrink-0" />
              <span className="uppercase tracking-wide">Domain</span>
              <span className="italic">no domain attached</span>
            </div>
          )}
          {isPrivateHost ? (
            <div className="flex items-center gap-1.5 text-[11px] text-overlay0 min-w-0">
              <ExternalLink size={12} className="shrink-0" />
              <span className="uppercase tracking-wide shrink-0">IP</span>
              <span className="font-mono truncate text-overlay1" title={host}>{host}</span>
              <span className="italic text-overlay0">private — reachable only via bastion / ingress</span>
            </div>
          ) : (
            <UrlRow
              icon={<ExternalLink size={12} className="text-blue shrink-0" />}
              label="IP"
              url={ipUrl}
            />
          )}
          {ports.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] uppercase tracking-wide text-overlay0 shrink-0">Ports</span>
              {ports.map((port) => {
                const url = `http://${hostBracketed}:${port}`;
                return (
                  <a
                    key={port}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-peach/20 text-peach text-[11px] font-mono hover:bg-peach/30 transition-colors"
                    title={`Open ${url}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {port}
                    <ExternalLink size={9} />
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <div className={cn("flex items-center gap-3 shrink-0", gaugesDimmed && "opacity-50")}>
          {statsLoading && !stats ? (
            <div className="flex items-center gap-2 text-overlay0 text-xs py-2 pr-2">
              <Loader2 size={12} className="animate-spin shrink-0" />
              Probing…
            </div>
          ) : (
            <>
              <Gauge
                label="CPU"
                pct={stats ? stats.cpuPercent : null}
                detail="Total CPU usage."
              />
              <Gauge
                label="MEM"
                pct={stats ? stats.memPercent : null}
                detail={
                  stats?.memUsedBytes != null && stats.memTotalBytes != null
                    ? `${fmtBytes(stats.memUsedBytes)} used of ${fmtBytes(stats.memTotalBytes)}`
                    : "Memory usage."
                }
              />
              <Gauge
                label="DISK"
                pct={stats ? stats.diskPercent : null}
                detail={
                  stats?.diskUsedBytes != null && stats.diskTotalBytes != null
                    ? `${fmtBytes(stats.diskUsedBytes)} used of ${fmtBytes(stats.diskTotalBytes)} on /`
                    : "Root filesystem usage."
                }
              />
            </>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
              disabled={refreshLoading}
              className="text-overlay0 hover:text-blue transition-colors disabled:opacity-50 self-center ml-1"
              title="Refresh"
            >
              <RefreshCw size={11} className={cn(refreshLoading && "animate-spin")} />
            </button>
          )}
        </div>
      </div>
      {statsError && !stats && (
        <div className="text-[10px] text-red font-mono truncate" title={statsError}>
          {statsError}
        </div>
      )}
    </section>
  );
}

interface VpsResourceGaugesProps {
  exec: ExecFn;
  host: string;
  appPort?: number;
  domain?: { name: string; url?: string } | null;
  isPrivateHost?: boolean;
}

/** CPU / Memory / Disk gauges + connect URLs. Polls via SSH while mounted. */
export function VpsResourceGauges({ exec, host, appPort = 3000, domain, isPrivateHost = false }: VpsResourceGaugesProps) {
  const [sample, setSample] = useState<Sample | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await exec(PROBE_SCRIPT, undefined, ac.signal);
      if (ac.signal.aborted) return;
      if (res.error) {
        setError(res.output.slice(0, 200) || "probe failed");
      } else {
        setSample(parseProbe(res.output));
      }
    } catch (err: unknown) {
      if (!ac.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [exec]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 15_000);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
    };
  }, [refresh]);

  return (
    <VpsResourceBar
      host={host}
      ipv6={host.includes(":")}
      isPrivateHost={isPrivateHost}
      domain={domain}
      appPort={appPort}
      stats={sample ? sampleToBarStats(sample) : null}
      statsError={error}
      onRefresh={refresh}
      refreshLoading={loading}
    />
  );
}

function UrlRow({ icon, label, url }: { icon: ReactNode; label: string; url: string }) {
  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-overlay0 shrink-0">{label}</span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 text-[11px] font-mono text-blue hover:underline truncate min-w-0"
        title={`Open ${url}`}
      >
        {icon}
        <span className="truncate">{url}</span>
      </a>
      <CopyButton value={url} title="Copy URL" />
    </div>
  );
}
