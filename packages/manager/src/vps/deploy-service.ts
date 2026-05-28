import { parseProbeOutput } from "@genie/vps-stats";
import type { VpsProcessInfo, VpsStatsPayload } from "@genie/vps-stats";
import { connectSsh, type SshConnectionConfig, type SshSession } from "./ssh-client.js";
import { execCached, evictSession } from "./ssh-session-cache.js";

export type { VpsProcessInfo, VpsStatsPayload as VpsStats };

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
  onProgress("Waiting for system SSH to stabilize...");
  for (let i = 1; i <= 12; i++) {
    let checkSession: SshSession | null = null;
    try {
      checkSession = await connectSsh(config);
      await checkSession.exec("true");
      onProgress("System SSH ready");
      break;
    } catch {
      if (i === 12) throw new Error("System SSH did not become available after 60s");
      onProgress(`System SSH not ready (attempt ${i}/12), waiting 5s...`);
      await new Promise((r) => setTimeout(r, 5_000));
    } finally {
      checkSession?.close();
    }
  }

  // 3. Write DB-stored setup files to remote (base64 piped through stdin)
  if (setupFiles && Object.keys(setupFiles).length > 0) {
    onProgress("Writing setup files...");
    for (const [name, content] of Object.entries(setupFiles)) {
      const sfSession = await connectSsh(config);
      try {
        const b64 = Buffer.from(content).toString("base64");
        const ch = await sfSession.execStreaming(`base64 -d > ${dest}/${name}`);
        await new Promise<void>((resolve, reject) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          ch.stdin.on("error", (e: Error) => { if (!done) { done = true; reject(e); } });
          ch.stdin.write(b64 + "\n", () => {
            ch.stdin.end();
          });
          // Resolve when the remote command closes after stdin ends
          ch.stdout.on("end", finish);
          ch.stderr.on("end", finish);
          setTimeout(finish, 5000); // Safety timeout
        });
      } finally {
        sfSession.close();
      }
    }
    onProgress("Setup files written");
  }

  // 3b. Update Claude Code to latest
  {
    onProgress("Updating Claude Code...");
    const claudeSession = await connectSsh(config);
    try {
      await claudeSession.exec("sudo npm install -g @anthropic-ai/claude-code 2>&1 | tail -1", (chunk) => {
        const line = chunk.trimEnd();
        if (line) onProgress(line);
      });
    } finally {
      claudeSession.close();
    }
  }

  // 3c. Ensure .mcp.json exists (tunnel-based MCP servers are added dynamically when tunnels connect)
  {
    onProgress("Preparing .mcp.json...");
    const mcpSession = await connectSsh(config);
    try {
      // Only ensure the file exists with a valid structure — actual MCP server entries
      // are merged when SSH tunnels are established (by ws-server tunnel setup code)
      await mcpSession.exec(`test -f ${dest}/.mcp.json || echo '{"mcpServers":{}}' > ${dest}/.mcp.json`);
    } finally {
      mcpSession.close();
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

      const execPromise = setupSession.exec(`cd ${dest} && chmod +x setup.sh && sudo bash setup.sh 2>&1`, (chunk) => {
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

      // Restore ownership of project files to genie after sudo setup.sh
      onProgress("Fixing file ownership...");
      const chownSession = await connectSsh(config);
      try {
        await chownSession.exec(`sudo chown -R genie:genie ${dest}`);
      } finally {
        chownSession.close();
      }

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

export async function vpsStats(
  config: SshConnectionConfig,
): Promise<VpsStatsPayload> {
  // Use the dial cache for the probe, then evict — the Taz/DO clouds panels
  // SSH every ACTIVE VM on reconnect; leaving sessions cached was holding ~1
  // connection per VM (45+) until the 5m idle reaper ran.
  try {
    const output = await execCached(
      config,
      `grep 'cpu ' /proc/stat; sleep 0.4; echo "===CPU2==="; grep 'cpu ' /proc/stat; echo "===MEM==="; grep -E "^(MemTotal|MemAvailable):" /proc/meminfo; echo "===DISK==="; df -B1 / | tail -1; echo "===PORTS==="; ss -tlnH 2>/dev/null || true`,
      undefined,
      { timeoutMs: 15_000 },
    );
    return parseProbeOutput(output);
  } finally {
    evictSession(config);
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
