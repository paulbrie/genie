/**
 * VPS stats poller — one CPU/mem/disk + tmux probe per VPS.
 * Piggybacks on an existing live shell session when one is open (no extra
 * SSH dial); falls back to a short-lived exec via genie's connectSsh.
 */
import { connectSsh } from "../../vps/ssh-client.js";
import { getVpsConnection } from "../../vps/connection-resolver.js";
import { findShellSessionForVps } from "../session/registry.js";
import { parseProbeOutput, STATS_COMMAND, statsToClient, tmuxSessionsToClient, type TmuxSessionInfo } from "./commands.js";

const STATS_EXEC_TIMEOUT_MS = 12_000;

export type VpsStatsPayload = {
  projectId: string;
  instanceId: string;
  stats: { cpu: number; mem: number; disk: number } | null;
  tmux: TmuxSessionInfo[];
  error: string | null;
};

const inFlight = new Set<string>();

function key(projectId: string, instanceId: string) {
  return `${projectId}-${instanceId}`;
}

export async function pollVpsStats(
  projectId: string,
  instanceId: string,
): Promise<VpsStatsPayload> {
  const k = key(projectId, instanceId);
  if (inFlight.has(k)) {
    return { projectId, instanceId, stats: null, tmux: [], error: "in_flight" };
  }
  inFlight.add(k);

  try {
    const shellSession = findShellSessionForVps(projectId, instanceId);
    let output: string;
    if (shellSession?.isExecReady()) {
      output = await Promise.race([
        shellSession.exec(STATS_COMMAND),
        new Promise<string>((_r, rej) => setTimeout(() => rej(new Error("stats_exec_timeout")), STATS_EXEC_TIMEOUT_MS)),
      ]);
    } else {
      const conn = await getVpsConnection(projectId, instanceId);
      const sshSession = await connectSsh(
        {
          host: conn.host,
          port: conn.port ?? 22,
          username: conn.username,
          privateKeyPath: conn.privateKeyPath,
        },
        { timeoutMs: STATS_EXEC_TIMEOUT_MS },
      );
      try {
        output = await sshSession.exec(STATS_COMMAND, undefined, { timeoutMs: STATS_EXEC_TIMEOUT_MS });
      } finally {
        sshSession.close();
      }
    }

    const probe = parseProbeOutput(output);
    return {
      projectId,
      instanceId,
      stats: probe.stats ? statsToClient(probe.stats) : null,
      tmux: tmuxSessionsToClient(probe.tmuxSessions),
      error: probe.stats ? null : "parse_failed",
    };
  } catch (err) {
    return {
      projectId,
      instanceId,
      stats: null,
      tmux: [],
      error: err instanceof Error ? err.message : "stats_exec_failed",
    };
  } finally {
    inFlight.delete(k);
  }
}
