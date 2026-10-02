import os from "node:os";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pidusage from "pidusage";
import type { DockerContainerInfo, DockerInfo, MemoryInfo, ProcessInfo, StatsPayload } from "../types.js";

const execFileAsync = promisify(execFile);

// macOS GUI apps often lack /usr/local/bin in PATH — resolve docker once
let _dockerBin: string | null = null;
export function getDockerBin(): string | null {
  return dockerBin();
}
function dockerBin(): string | null {
  if (_dockerBin !== null) return _dockerBin || null;
  const home = os.homedir();
  const candidates = [
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/usr/bin/docker",
    `${home}/.docker/bin/docker`,
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        console.log(`[docker] Found binary at ${p}`);
        _dockerBin = p;
        return p;
      }
    } catch { /* skip */ }
  }
  console.log("[docker] Binary not found in any known location");
  _dockerBin = "";
  return null;
}

let prevIdle = 0;
let prevTotal = 0;

function getCpuUsage(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.irq +
      cpu.times.idle;
  }
  const diffIdle = idle - prevIdle;
  const diffTotal = total - prevTotal;
  prevIdle = idle;
  prevTotal = total;
  if (diffTotal === 0) return 0;
  return Math.round(((diffTotal - diffIdle) / diffTotal) * 100);
}

async function collectMemoryInfo(): Promise<MemoryInfo | null> {
  try {
    const [{ stdout: vmOut }, { stdout: memOut }, { stdout: swapOut }] =
      await Promise.all([
        execFileAsync("vm_stat"),
        execFileAsync("sysctl", ["-n", "hw.memsize"]),
        execFileAsync("sysctl", ["vm.swapusage"]),
      ]);

    const physical = parseInt(memOut.trim(), 10);

    // Parse page size from vm_stat header
    const pageSizeMatch = vmOut.match(/page size of (\d+) bytes/);
    const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 16384;

    // Parse vm_stat fields (values end with '.')
    const field = (name: string): number => {
      const re = new RegExp(`${name}:\\s+([\\d]+)`);
      const m = vmOut.match(re);
      return m ? parseInt(m[1], 10) : 0;
    };

    const free = field("Pages free");
    const active = field("Pages active");
    const speculative = field("Pages speculative");
    const wiredPages = field("Pages wired down");
    const compressorPages = field("Pages occupied by compressor");
    const purgeable = field("Pages purgeable");
    const fileBacked = field("File-backed pages");
    const anonymous = field("Anonymous pages");

    const wired = wiredPages * pageSize;
    const compressed = compressorPages * pageSize;
    const cached = (fileBacked + purgeable) * pageSize;
    const appMem = (anonymous - purgeable) * pageSize;
    const used = (active + wiredPages + compressorPages + speculative) * pageSize;

    // Parse swap: "vm.swapusage: total = 0.00M  used = 0.00M  free = 0.00M ..."
    let swap = 0;
    const swapMatch = swapOut.match(/used\s*=\s*([\d.]+)M/);
    if (swapMatch) {
      swap = Math.round(parseFloat(swapMatch[1]) * 1024 * 1024);
    }

    return { physical, used, cached, swap, appMem: Math.max(appMem, 0), wired, compressed };
  } catch {
    return null;
  }
}

async function collectPortMap(): Promise<Map<number, string>> {
  const portMap = new Map<number, string>();
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-iTCP", "-sTCP:LISTEN", "-nP", "-Fn", "-Fp",
    ]);
    let currentPid = 0;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) {
        currentPid = parseInt(line.slice(1), 10);
      } else if (line.startsWith("n") && currentPid) {
        const match = line.match(/:(\d+)$/);
        if (match) {
          const port = match[1];
          const existing = portMap.get(currentPid);
          if (existing) {
            // avoid duplicates
            if (!existing.split(",").includes(port)) {
              portMap.set(currentPid, existing + "," + port);
            }
          } else {
            portMap.set(currentPid, port);
          }
        }
      }
    }
  } catch {
    // lsof may not be available or may require privileges
  }
  return portMap;
}

async function collectProcesses(): Promise<ProcessInfo[]> {
  try {
    const [{ stdout }, portMap] = await Promise.all([
      execFileAsync("ps", ["-axo", "pid=,ppid=,user=,pcpu=,rss=,state=,comm="]),
      collectPortMap(),
    ]);
    const lines = stdout.trim().split("\n");
    const procs: ProcessInfo[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 7) continue;
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      const user = parts[2];
      const cpu = parseFloat(parts[3]);
      const rss = parseInt(parts[4], 10);
      const state = parts[5];
      const comm = parts.slice(6).join(" ");
      if (isNaN(pid)) continue;
      if (state.includes("Z")) continue;
      const name = comm.includes("/") ? comm.split("/").pop()! : comm;
      procs.push({
        pid,
        ppid: isNaN(ppid) ? 0 : ppid,
        name,
        cpu: Math.round(cpu * 10) / 10,
        mem: Math.round((rss / 1024) * 10) / 10,
        user,
        port: portMap.get(pid) || "",
      });
    }
    procs.sort((a, b) => b.cpu - a.cpu);
    return procs;
  } catch {
    return [];
  }
}

function parseMemValue(raw: string): number {
  const match = raw.match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB|kB|MB|GB|TB)$/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "b": return val / (1024 * 1024);
    case "kib": case "kb": return val / 1024;
    case "mib": case "mb": return val;
    case "gib": case "gb": return val * 1024;
    case "tib": case "tb": return val * 1024 * 1024;
    default: return 0;
  }
}

const DOCKER_PROCESS_NAMES = ["com.docker.backend", "Docker Desktop", "Docker"];

function isDockerRunning(processes: ProcessInfo[]): boolean {
  return processes.some((p) => DOCKER_PROCESS_NAMES.includes(p.name));
}

async function collectDockerContainers(): Promise<DockerContainerInfo[]> {
  const bin = dockerBin();
  if (!bin) return [];
  try {
    const { stdout: psOut } = await execFileAsync(bin, [
      "ps", "-a", "--format",
      '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}\t{{.Ports}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}',
    ]);

    const lines = psOut.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return [];

    const containers: DockerContainerInfo[] = lines.map((line) => {
      const [id, name, image, status, state, ports, project, service] = line.split("\t");
      return { id, name, image, status, state: state || "", ports: ports || "", cpu: 0, mem: 0, memLimit: 0, memPercent: 0, project: project || "", service: service || "" };
    });

    // Collect stats only for running containers
    const runningIds = containers.filter((c) => c.state === "running").map((c) => c.id);
    if (runningIds.length > 0) {
      try {
        const { stdout: statsOut } = await execFileAsync(bin, [
          "stats", "--no-stream", "--format",
          "{{.ID}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}",
        ], { timeout: 5000 });

        const statsMap = new Map<string, { cpu: number; mem: number; memLimit: number; memPercent: number }>();
        for (const sLine of statsOut.trim().split("\n").filter(Boolean)) {
          const [sId, cpuStr, memUsage, memPercStr] = sLine.split("\t");
          const cpu = parseFloat(cpuStr?.replace("%", "") || "0") || 0;
          const memPercent = parseFloat(memPercStr?.replace("%", "") || "0") || 0;
          const memParts = (memUsage || "").split("/").map((s) => s.trim());
          const mem = parseMemValue(memParts[0] || "0B");
          const memLimit = parseMemValue(memParts[1] || "0B");
          statsMap.set(sId, { cpu: Math.round(cpu * 10) / 10, mem: Math.round(mem * 10) / 10, memLimit: Math.round(memLimit), memPercent: Math.round(memPercent * 10) / 10 });
        }

        for (const c of containers) {
          // docker stats ID may be a prefix match
          for (const [sId, stats] of statsMap) {
            if (c.id.startsWith(sId) || sId.startsWith(c.id)) {
              c.cpu = stats.cpu;
              c.mem = stats.mem;
              c.memLimit = stats.memLimit;
              c.memPercent = stats.memPercent;
              break;
            }
          }
        }
      } catch {
        // stats collection failed, leave at 0
      }
    }

    return containers;
  } catch {
    return [];
  }
}

async function collectDockerInfo(processes: ProcessInfo[]): Promise<DockerInfo> {
  if (!isDockerRunning(processes)) {
    return { daemonRunning: false, containers: [] };
  }
  const containers = await collectDockerContainers();
  return { daemonRunning: true, containers };
}

export async function collectStats(): Promise<StatsPayload> {
  const systemCpu = getCpuUsage();

  const [processes, memoryInfo] = await Promise.all([
    collectProcesses(),
    collectMemoryInfo(),
  ]);

  cachedProcesses = processes;

  // Compute mem% from vm_stat data (wired + app + compressed) for an accurate
  // "pressure" reading.  Fall back to os.freemem() if vm_stat failed.
  let systemMem: number;
  if (memoryInfo) {
    const activeBytes = memoryInfo.wired + memoryInfo.appMem + memoryInfo.compressed;
    systemMem = Math.round((activeBytes / memoryInfo.physical) * 100);
  } else {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    systemMem = Math.round(((totalMem - freeMem) / totalMem) * 100);
  }

  return {
    system: { cpu: systemCpu, mem: systemMem, memory: memoryInfo ?? undefined },
    processes,
    docker: cachedDockerInfo,
  };
}

// Docker info is collected on its own timer to avoid blocking system stats
let cachedDockerInfo: DockerInfo = { daemonRunning: false, containers: [] };
let cachedProcesses: ProcessInfo[] = [];

export function getCachedProcesses(): ProcessInfo[] {
  return cachedProcesses;
}

export function getCachedDockerInfo(): DockerInfo {
  return cachedDockerInfo;
}
let dockerCollecting = false;

async function refreshDockerInfo(): Promise<void> {
  if (dockerCollecting) return;
  dockerCollecting = true;
  try {
    cachedDockerInfo = await collectDockerInfo(cachedProcesses);
  } catch {
    // keep previous cached value
  } finally {
    dockerCollecting = false;
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;
let dockerIntervalId: ReturnType<typeof setInterval> | null = null;

export function startMonitoring(
  onStats: (stats: StatsPayload) => void,
  intervalMs = 2000
): void {
  // Initialize CPU baseline
  getCpuUsage();
  intervalId = setInterval(async () => {
    const stats = await collectStats();
    onStats(stats);
  }, intervalMs);

  // Docker collection on a separate, slower cycle
  refreshDockerInfo();
  dockerIntervalId = setInterval(refreshDockerInfo, 5000);
}

export function setMonitoringInterval(
  onStats: (stats: StatsPayload) => void,
  intervalMs: number,
): void {
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(async () => {
    const stats = await collectStats();
    onStats(stats);
  }, intervalMs);
}

export function stopMonitoring(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (dockerIntervalId) {
    clearInterval(dockerIntervalId);
    dockerIntervalId = null;
  }
}
