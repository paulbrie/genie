import { connectSsh, type SshConnectionConfig, type SshSession } from "./ssh-client.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function remoteDir(_projectName: string): string {
  return "/opt/project";
}

export async function vpsDeploy(
  projectName: string,
  config: SshConnectionConfig,
  onProgress: (msg: string) => void,
  envVars?: Record<string, string>,
  setupFiles?: Record<string, string>,
): Promise<void> {
  const dest = remoteDir(projectName);

  // 1. Create remote directory via ssh2
  onProgress("Creating remote directory...");
  const preSession = await connectSsh(config);
  try {
    await preSession.exec(`mkdir -p ${dest}`);
  } finally {
    preSession.close();
  }

  // 2. Wait for system ssh to be ready (cloud-init may restart sshd)
  const sshArgs = [
    "-p", String(config.port),
    "-i", config.privateKeyPath,
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=5",
    "-o", "IdentitiesOnly=yes",
    `${config.username}@${config.host}`,
    "true",
  ];

  onProgress("Waiting for system SSH to stabilize...");
  for (let i = 1; i <= 12; i++) {
    try {
      await execFileAsync("ssh", sshArgs, { timeout: 10_000 });
      onProgress("System SSH ready");
      break;
    } catch {
      if (i === 12) throw new Error("System SSH did not become available after 60s");
      onProgress(`System SSH not ready (attempt ${i}/12), waiting 5s...`);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  // 3. Write DB-stored setup files to remote
  if (setupFiles && Object.keys(setupFiles).length > 0) {
    onProgress("Writing setup files...");
    const sfSession = await connectSsh(config);
    try {
      for (const [name, content] of Object.entries(setupFiles)) {
        await sfSession.exec(`cat > ${dest}/${name} << 'GENIEEOF'\n${content}\nGENIEEOF`);
      }
      onProgress("Setup files written");
    } finally {
      sfSession.close();
    }
  }

  // 4. Run setup.sh — this is the single entry point for all deployment logic
  //    (env vars, docker compose build/up, etc. should all be in setup.sh)
  if (setupFiles && setupFiles["setup.sh"]) {
    onProgress("Running setup.sh...");
    const setupSession = await connectSsh(config);
    try {
      // Collect secret values to mask from logs
      const secrets = envVars ? Object.values(envVars).filter(Boolean) : [];
      function maskSecrets(text: string): string {
        let masked = text;
        for (const secret of secrets) {
          if (secret.length > 4) {
            masked = masked.replaceAll(secret, secret.slice(0, 4) + "***");
          }
        }
        return masked;
      }

      // Track docker compose container states to detect when all services are up.
      // `docker compose up` (without -d) never exits — it keeps streaming logs and
      // health-check output, which resets the idle timer indefinitely.
      const pendingContainers = new Set<string>();
      let allStartedTimer: ReturnType<typeof setTimeout> | null = null;
      let resolveEarly: (() => void) | null = null;
      const earlyDone = new Promise<void>((r) => { resolveEarly = r; });

      const execPromise = setupSession.exec(`cd ${dest} && chmod +x setup.sh && bash setup.sh 2>&1`, (chunk) => {
        const line = maskSecrets(chunk.trimEnd());
        if (line) onProgress(line);

        // Detect docker compose container lifecycle messages
        const startingMatch = chunk.match(/Container\s+(\S+)\s+Starting/);
        const startedMatch = chunk.match(/Container\s+(\S+)\s+Started/);
        if (startingMatch) {
          pendingContainers.add(startingMatch[1]);
          if (allStartedTimer) { clearTimeout(allStartedTimer); allStartedTimer = null; }
        }
        if (startedMatch) {
          pendingContainers.delete(startedMatch[1]);
          if (pendingContainers.size === 0 && allStartedTimer === null) {
            // All tracked containers started — wait a short grace period then finish
            allStartedTimer = setTimeout(() => { resolveEarly?.(); }, 10_000);
          }
        }
      }, { timeoutMs: 1_800_000, idleTimeoutMs: 300_000 });

      await Promise.race([execPromise, earlyDone]);
      if (allStartedTimer) clearTimeout(allStartedTimer);
      onProgress("Deployment complete!");
    } finally {
      setupSession.close();
    }
  } else {
    onProgress("No setup.sh found — skipping deployment commands.");
  }
}

export interface VpsContainerStatus {
  name: string;
  service: string;
  status: string;
  state: string;
  ports: string;
}

export async function vpsStatus(
  projectName: string,
  config: SshConnectionConfig,
): Promise<VpsContainerStatus[]> {
  const dest = remoteDir(projectName);
  const session = await connectSsh(config);
  try {
    const output = await session.exec(
      `cd ${dest} && docker compose ps --format json 2>/dev/null || true`,
    );
    if (!output.trim()) return [];

    // docker compose ps --format json outputs one JSON object per line
    const containers: VpsContainerStatus[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        containers.push({
          name: obj.Name || obj.name || "",
          service: obj.Service || obj.service || "",
          status: obj.Status || obj.status || "",
          state: obj.State || obj.state || "",
          ports: obj.Ports || obj.ports || "",
        });
      } catch {
        // Skip non-JSON lines
      }
    }
    return containers;
  } finally {
    session.close();
  }
}

export interface VpsProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  cpu: number;
  mem: number; // MB
  user: string;
  port: string;
}

export interface VpsStats {
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  memPercent: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskPercent: number;
  processes: VpsProcessInfo[];
  openPorts: number[];
  externalPorts: number[];
}

export async function vpsStats(
  config: SshConnectionConfig,
): Promise<VpsStats> {
  const session = await connectSsh(config);
  try {
    // Two /proc/stat samples 1s apart for real-time CPU, plus memory, disk, processes and ports
    const output = await session.exec(
      `grep 'cpu ' /proc/stat; sleep 1; echo "===CPU2==="; grep 'cpu ' /proc/stat; echo "===MEM==="; cat /proc/meminfo; echo "===DISK==="; df -B1 / | tail -1; echo "===PROCS==="; ps -eo pid=,ppid=,user=,pcpu=,rss=,comm= --sort=-pcpu | head -50; echo "===PORTS==="; ss -tlnp 2>/dev/null || true`,
    );

    let cpuPercent = 0;
    let memUsedBytes = 0;
    let memTotalBytes = 0;
    let diskUsedBytes = 0;
    let diskTotalBytes = 0;

    // Parse two CPU samples and compute delta
    const cpuLines = output.split("===CPU2===");
    const parseCpu = (s: string) => {
      const m = s.match(/^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
      if (!m) return null;
      const vals = m.slice(1).map(Number);
      const total = vals.reduce((a, b) => a + b, 0);
      const idle = vals[3] + vals[4]; // idle + iowait
      return { total, idle };
    };
    const s1 = parseCpu(cpuLines[0]);
    const s2 = cpuLines[1] ? parseCpu(cpuLines[1]) : null;
    if (s1 && s2) {
      const dTotal = s2.total - s1.total;
      const dIdle = s2.idle - s1.idle;
      cpuPercent = dTotal > 0 ? Math.round(((dTotal - dIdle) / dTotal) * 100) : 0;
    }

    // Parse memory from /proc/meminfo
    const memTotal = output.match(/MemTotal:\s+(\d+)\s+kB/);
    const memAvailable = output.match(/MemAvailable:\s+(\d+)\s+kB/);
    if (memTotal) {
      memTotalBytes = parseInt(memTotal[1]) * 1024;
      const availBytes = memAvailable ? parseInt(memAvailable[1]) * 1024 : 0;
      memUsedBytes = memTotalBytes - availBytes;
    }

    // Parse disk from df output: filesystem 1B-blocks used available use% mount
    const diskLine = output.split("===DISK===")[1]?.trim();
    if (diskLine) {
      const parts = diskLine.split(/\s+/);
      if (parts.length >= 4) {
        diskTotalBytes = parseInt(parts[1]) || 0;
        diskUsedBytes = parseInt(parts[2]) || 0;
      }
    }

    const memPercent = memTotalBytes > 0 ? Math.round((memUsedBytes / memTotalBytes) * 100) : 0;
    const diskPercent = diskTotalBytes > 0 ? Math.round((diskUsedBytes / diskTotalBytes) * 100) : 0;

    // Parse ss output to build pid → port mapping and track external vs local binds
    const pidPortMap = new Map<number, string>();
    const externalPortSet = new Set<number>();
    const allPortSet = new Set<number>();
    const portsSection = output.split("===PORTS===")[1];
    if (portsSection) {
      for (const line of portsSection.trim().split("\n")) {
        // ss -tlnp format: State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
        const cols = line.trim().split(/\s+/);
        if (cols.length < 5) continue;
        const localAddr = cols[3]; // e.g. "0.0.0.0:22", "127.0.0.1:3000", "[::]:80", "[::1]:5432"
        const portMatch = localAddr.match(/:(\d+)$/);
        const pidMatch = line.match(/pid=(\d+)/);
        if (portMatch) {
          const port = parseInt(portMatch[1]);
          allPortSet.add(port);
          // External if bound to 0.0.0.0, *, or [::] (not 127.x or [::1])
          const isExternal = localAddr.startsWith("0.0.0.0:") || localAddr.startsWith("*:") || localAddr.startsWith("[::]:") || localAddr.startsWith(":::") ;
          if (isExternal) externalPortSet.add(port);
          if (pidMatch) {
            const pid = parseInt(pidMatch[1]);
            const existing = pidPortMap.get(pid);
            pidPortMap.set(pid, existing ? `${existing},${port}` : String(port));
          }
        }
      }
    }

    // Parse ps output into VpsProcessInfo[]
    const processes: VpsProcessInfo[] = [];
    const procsSection = output.split("===PROCS===")[1]?.split("===PORTS===")[0];
    if (procsSection) {
      for (const line of procsSection.trim().split("\n")) {
        if (!line.trim()) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;
        const pid = parseInt(parts[0]);
        if (isNaN(pid)) continue;
        const ppid = parseInt(parts[1]) || 0;
        const user = parts[2];
        const cpu = parseFloat(parts[3]) || 0;
        const rssKb = parseInt(parts[4]) || 0;
        const name = parts.slice(5).join(" ");
        processes.push({
          pid,
          ppid,
          name,
          cpu,
          mem: Math.round((rssKb / 1024) * 10) / 10, // KB → MB with 1 decimal
          user,
          port: pidPortMap.get(pid) || "",
        });
      }
    }

    const openPorts = [...allPortSet].sort((a, b) => a - b);
    const externalPorts = [...externalPortSet].sort((a, b) => a - b);

    return { cpuPercent, memUsedBytes, memTotalBytes, memPercent, diskUsedBytes, diskTotalBytes, diskPercent, processes, openPorts, externalPorts };
  } finally {
    session.close();
  }
}

export async function vpsLogs(
  projectName: string,
  config: SshConnectionConfig,
  serviceName?: string,
  tail: number = 100,
): Promise<string> {
  const dest = remoteDir(projectName);
  const session = await connectSsh(config);
  try {
    const svcArg = serviceName ? ` ${serviceName}` : "";
    const output = await session.exec(
      `cd ${dest} && docker compose logs --tail=${tail}${svcArg} 2>&1`,
    );
    return output;
  } finally {
    session.close();
  }
}

export async function vpsTeardown(
  projectName: string,
  config: SshConnectionConfig,
  onProgress: (msg: string) => void,
): Promise<void> {
  const dest = remoteDir(projectName);
  const session = await connectSsh(config);
  try {
    onProgress("Stopping containers...");
    await session.exec(`cd ${dest} && docker compose down --remove-orphans 2>&1`, (chunk) => {
      const line = chunk.trimEnd(); if (line) onProgress(line);
    });
    onProgress("Removing project files...");
    await session.exec(`rm -rf ${dest}`);
    onProgress("Teardown complete");
  } finally {
    session.close();
  }
}
