import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import type { VpsProcessInfo, VpsStatsPayload } from "./types.js";

const execFileAsync = promisify(execFile);

function readCpuSample(): { total: number; idle: number } | null {
  const raw = fs.readFileSync("/proc/stat", "utf8");
  const line = raw.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  const total = parts.reduce((a, b) => a + b, 0);
  const idle = parts[3] + parts[4];
  return { total, idle };
}

function cpuPercentFromSamples(
  prev: { total: number; idle: number } | null,
  curr: { total: number; idle: number },
): number {
  if (!prev) return 0;
  const dTotal = curr.total - prev.total;
  const dIdle = curr.idle - prev.idle;
  return dTotal > 0 ? Math.round(((dTotal - dIdle) / dTotal) * 100) : 0;
}

function readMemory(): { memUsedBytes: number; memTotalBytes: number; memPercent: number } {
  const raw = fs.readFileSync("/proc/meminfo", "utf8");
  const totalMatch = raw.match(/MemTotal:\s+(\d+)\s+kB/);
  const availMatch = raw.match(/MemAvailable:\s+(\d+)\s+kB/);
  const memTotalBytes = totalMatch ? parseInt(totalMatch[1], 10) * 1024 : 0;
  const availBytes = availMatch ? parseInt(availMatch[1], 10) * 1024 : 0;
  const memUsedBytes = memTotalBytes - availBytes;
  const memPercent = memTotalBytes > 0 ? Math.round((memUsedBytes / memTotalBytes) * 100) : 0;
  return { memUsedBytes, memTotalBytes, memPercent };
}

async function readDisk(): Promise<{ diskUsedBytes: number; diskTotalBytes: number; diskPercent: number }> {
  try {
    const { stdout } = await execFileAsync("df", ["-B1", "/"], { maxBuffer: 64 * 1024 });
    const line = stdout.trim().split("\n").pop() ?? "";
    const parts = line.split(/\s+/);
    if (parts.length < 4) return { diskUsedBytes: 0, diskTotalBytes: 0, diskPercent: 0 };
    const diskTotalBytes = parseInt(parts[1], 10) || 0;
    const diskUsedBytes = parseInt(parts[2], 10) || 0;
    const diskPercent = diskTotalBytes > 0 ? Math.round((diskUsedBytes / diskTotalBytes) * 100) : 0;
    return { diskUsedBytes, diskTotalBytes, diskPercent };
  } catch {
    return { diskUsedBytes: 0, diskTotalBytes: 0, diskPercent: 0 };
  }
}

async function readProcessesAndPorts(): Promise<{
  processes: VpsProcessInfo[];
  openPorts: number[];
  externalPorts: number[];
}> {
  const pidPortMap = new Map<number, string>();
  const externalPortSet = new Set<number>();
  const allPortSet = new Set<number>();

  try {
    const { stdout: ssOut } = await execFileAsync("ss", ["-tlnp"], { maxBuffer: 512 * 1024 });
    for (const line of ssOut.trim().split("\n")) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5) continue;
      const localAddr = cols[3];
      const portMatch = localAddr.match(/:(\d+)$/);
      const pidMatch = line.match(/pid=(\d+)/);
      if (portMatch) {
        const port = parseInt(portMatch[1], 10);
        allPortSet.add(port);
        const isExternal =
          localAddr.startsWith("0.0.0.0:") ||
          localAddr.startsWith("*:") ||
          localAddr.startsWith("[::]:") ||
          localAddr.startsWith(":::");
        if (isExternal) externalPortSet.add(port);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          const existing = pidPortMap.get(pid);
          pidPortMap.set(pid, existing ? `${existing},${port}` : String(port));
        }
      }
    }
  } catch {
    // ss may be missing or require privileges
  }

  const processes: VpsProcessInfo[] = [];
  try {
    const { stdout: psOut } = await execFileAsync(
      "ps",
      ["-eo", "pid=,ppid=,user=,pcpu=,rss=,comm=", "--sort=-pcpu"],
      { maxBuffer: 256 * 1024 },
    );
    const lines = psOut.trim().split("\n").slice(0, 50);
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const pid = parseInt(parts[0], 10);
      if (Number.isNaN(pid)) continue;
      processes.push({
        pid,
        ppid: parseInt(parts[1], 10) || 0,
        user: parts[2],
        cpu: parseFloat(parts[3]) || 0,
        mem: Math.round((parseInt(parts[4], 10) || 0) / 1024 * 10) / 10,
        name: parts.slice(5).join(" "),
        port: pidPortMap.get(pid) || "",
      });
    }
  } catch {
    // ps failure is non-fatal
  }

  return {
    processes,
    openPorts: [...allPortSet].sort((a, b) => a - b),
    externalPorts: [...externalPortSet].sort((a, b) => a - b),
  };
}

// sshd's MaxStartups rarely changes, so read it once and cache. `undefined` =
// not yet attempted; `null` = read failed (not root / sshd not found).
let cachedMaxStartups: string | null | undefined;

/** Read the effective `MaxStartups` from `sshd -T` (authoritative — includes the
 *  built-in default). Best-effort; needs root, which the stats daemon has. */
async function readMaxStartupsConfig(): Promise<string | null> {
  if (cachedMaxStartups !== undefined) return cachedMaxStartups;
  for (const bin of ["/usr/sbin/sshd", "sshd"]) {
    try {
      const { stdout } = await execFileAsync(bin, ["-T"], { maxBuffer: 256 * 1024 });
      const line = stdout.split("\n").find((l) => l.toLowerCase().startsWith("maxstartups"));
      cachedMaxStartups = line ? (line.trim().split(/\s+/)[1] ?? null) : null;
      return cachedMaxStartups;
    } catch {
      // try next candidate
    }
  }
  cachedMaxStartups = null;
  return cachedMaxStartups;
}

/** Count "past MaxStartups" connection-drop log lines in the journal window
 *  `(sinceSec, untilSec]`. Bounded to the interval so the journal scan stays
 *  cheap. Returns 0 on the first tick (no baseline) or if journalctl is
 *  unavailable. The unit is `ssh` on Debian/Ubuntu and `sshd` elsewhere — match
 *  both. */
async function readMaxStartupsDrops(sinceSec: number | null, untilSec: number): Promise<number> {
  if (sinceSec == null) return 0;
  try {
    const { stdout } = await execFileAsync(
      "journalctl",
      ["-u", "ssh", "-u", "sshd", "--since", `@${sinceSec}`, "--until", `@${untilSec}`, "-g", "past MaxStartups", "-o", "cat", "--no-pager"],
      { maxBuffer: 256 * 1024 },
    );
    return stdout.split("\n").filter((l) => l.includes("MaxStartups")).length;
  } catch {
    return 0;
  }
}

/** Count interactive SSH login sessions via `who` (one line per pty login).
 *  Counts only login shells — the manager's non-pty exec/tunnel SSH channels
 *  don't create utmp entries, so this reflects open terminals, not every
 *  established :22 socket. */
async function readSshSessions(): Promise<number> {
  try {
    const { stdout } = await execFileAsync("who", [], { maxBuffer: 64 * 1024 });
    return stdout.split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

export interface CollectStatsOptions {
  /** Previous /proc/stat sample for CPU delta (omit on first tick). */
  prevCpu?: { total: number; idle: number } | null;
  /** Wait 1s and read a second CPU sample when no prevCpu is available. */
  warmCpu?: boolean;
  /** Epoch seconds of the previous sample, so MaxStartups drops are counted for
   *  exactly the interval since then (null on the first tick → reports 0). */
  prevDropCheckSec?: number | null;
}

export async function collectStats(opts: CollectStatsOptions = {}): Promise<{
  stats: VpsStatsPayload;
  cpuSample: { total: number; idle: number };
  /** Pass back as `prevDropCheckSec` next tick to bound the drops window. */
  dropCheckSec: number;
}> {
  let prev = opts.prevCpu ?? null;
  if (!prev && opts.warmCpu !== false) {
    const first = readCpuSample();
    if (first) {
      await new Promise((r) => setTimeout(r, 1000));
      prev = first;
    }
  }

  const cpuEnd = readCpuSample();
  const cpuPercent = cpuEnd ? cpuPercentFromSamples(prev, cpuEnd) : 0;
  const cpuSample = cpuEnd ?? { total: 0, idle: 0 };

  const { memUsedBytes, memTotalBytes, memPercent } = readMemory();
  const { diskUsedBytes, diskTotalBytes, diskPercent } = await readDisk();
  const { processes, openPorts, externalPorts } = await readProcessesAndPorts();
  const sshSessions = await readSshSessions();
  // Bound the drops window to [prev, now] so the next tick starts exactly here.
  const dropCheckSec = Math.floor(Date.now() / 1000);
  const [sshMaxStartups, sshMaxStartupsDrops] = await Promise.all([
    readMaxStartupsConfig(),
    readMaxStartupsDrops(opts.prevDropCheckSec ?? null, dropCheckSec),
  ]);

  return {
    stats: {
      cpuPercent,
      memUsedBytes,
      memTotalBytes,
      memPercent,
      diskUsedBytes,
      diskTotalBytes,
      diskPercent,
      processes,
      openPorts,
      externalPorts,
      sshSessions,
      sshMaxStartups,
      sshMaxStartupsDrops,
    },
    cpuSample,
    dropCheckSec,
  };
}
