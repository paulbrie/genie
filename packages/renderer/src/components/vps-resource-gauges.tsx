"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw, ExternalLink, Copy, Check, Globe } from "lucide-react";
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
}

// Single SSH round-trip that samples /proc/stat twice (400ms apart) so we can
// compute an instantaneous CPU %, then captures /proc/meminfo and `df` in the
// same shell — keeps the gauges in sync without 3 separate connections.
const PROBE_SCRIPT = `LC_ALL=C bash -c '
S1=$(head -1 /proc/stat); sleep 0.4; S2=$(head -1 /proc/stat)
echo "CPU1:$S1"
echo "CPU2:$S2"
echo "---MEM---"
grep -E "^(MemTotal|MemAvailable|MemFree):" /proc/meminfo
echo "---DISK---"
df -kP /
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
  };

  let cpu1: { idle: number; total: number } | null = null;
  let cpu2: { idle: number; total: number } | null = null;
  let memTotalKb: number | null = null;
  let memAvailKb: number | null = null;
  let memFreeKb: number | null = null;
  let inDisk = false;

  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("CPU1:")) cpu1 = parseCpu(line.slice(5).trim());
    else if (line.startsWith("CPU2:")) cpu2 = parseCpu(line.slice(5).trim());
    else if (line.startsWith("---DISK---")) inDisk = true;
    else if (line.startsWith("MemTotal:")) memTotalKb = parseInt(line.split(/\s+/)[1] ?? "", 10);
    else if (line.startsWith("MemAvailable:")) memAvailKb = parseInt(line.split(/\s+/)[1] ?? "", 10);
    else if (line.startsWith("MemFree:")) memFreeKb = parseInt(line.split(/\s+/)[1] ?? "", 10);
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

interface VpsResourceGaugesProps {
  exec: ExecFn;
  host: string;
  /** Optional default app port (e.g. 3000 for the Next.js dev server). */
  appPort?: number;
  /** Optional custom domain (e.g. a TazCloud ingress). When provided, shown
   *  above the raw IP URL since it's the user-friendly address. */
  domain?: { name: string; url?: string } | null;
}

/** CPU / Memory / Disk gauges + the public connect URL for a VPS. Polls every
 *  ~5 s while mounted; the probe is a single SSH command so it's cheap. */
export function VpsResourceGauges({ exec, host, appPort = 3000, domain }: VpsResourceGaugesProps) {
  const [sample, setSample] = useState<Sample | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
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
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [exec]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
    };
  }, [refresh]);

  // IPv6 hosts must be wrapped in brackets for URLs.
  const isV6 = host.includes(":");
  const hostBracketed = isV6 ? `[${host}]` : host;
  const ipUrl = `http://${hostBracketed}${appPort ? `:${appPort}` : ""}`;
  const domainUrl = domain ? (domain.url || `https://${domain.name}`) : null;

  return (
    <section className="flex flex-col gap-1.5 py-2 px-3 bg-mantle rounded-lg border border-overlay0/20">
    <div className="flex items-center gap-4">
      {/* URLs stack vertically on the left so they expand to fill width */}
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
        <UrlRow
          icon={<ExternalLink size={12} className="text-blue shrink-0" />}
          label="IP"
          url={ipUrl}
        />
      </div>

      {/* Circular gauges sit on the right edge */}
      <div className="flex items-center gap-3 shrink-0">
        <Gauge
          label="CPU"
          pct={sample?.cpuPct ?? null}
          detail="Total CPU usage (sampled over 0.4 s)."
        />
        <Gauge
          label="MEM"
          pct={sample?.memPct ?? null}
          detail={
            sample && sample.memUsedBytes != null && sample.memTotalBytes != null
              ? `${fmtBytes(sample.memUsedBytes)} used of ${fmtBytes(sample.memTotalBytes)}`
              : "Memory usage from /proc/meminfo (MemTotal − MemAvailable)."
          }
        />
        <Gauge
          label="DISK"
          pct={sample?.diskPct ?? null}
          detail={
            sample && sample.diskUsedKb != null && sample.diskTotalKb != null
              ? `${fmtKb(sample.diskUsedKb)} used of ${fmtKb(sample.diskTotalKb)} on /`
              : "Root filesystem usage from `df -kP /`."
          }
        />
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="text-overlay0 hover:text-blue transition-colors disabled:opacity-50 self-center ml-1"
          title="Refresh"
        >
          <RefreshCw size={11} className={cn(loading && "animate-spin")} />
        </button>
      </div>

    </div>
      {error && <div className="text-[10px] text-red font-mono truncate">{error}</div>}
    </section>
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
