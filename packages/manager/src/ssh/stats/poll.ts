/**
 * VPS stats poller — tmux session list always via SSH exec on the shared tunnel
 * (never injected into the user's live PTY).
 */
import { execCached } from "../../vps/ssh-session-cache.js";
import { getVpsConnection } from "../../vps/connection-resolver.js";
import { sshStatsProbeEnabled } from "../../vps/ssh-stats-disabled.js";
import {
  parseProbeOutput,
  STATS_COMMAND,
  TMUX_PROBE_COMMAND,
  statsToClient,
  tmuxSessionsToClient,
  type TmuxSessionInfo,
} from "./commands.js";

const PROBE_TIMEOUT_MS = 12_000;

export type VpsStatsPayload = {
  projectId: string;
  instanceId: string;
  stats: { cpu: number; mem: number; disk: number } | null;
  tmux: TmuxSessionInfo[];
  error: string | null;
  /** How tmux sessions were probed — client only trusts an empty list from exec. */
  tmuxProbePath: "exec" | "pty";
};

const inFlight = new Map<string, Promise<VpsStatsPayload>>();

function key(projectId: string, instanceId: string) {
  return `${projectId}-${instanceId}`;
}

export async function pollVpsStats(
  projectId: string,
  instanceId: string,
  opts?: { force?: boolean },
): Promise<VpsStatsPayload> {
  const k = key(projectId, instanceId);
  if (!opts?.force) {
    const existing = inFlight.get(k);
    if (existing) return existing;
  }

  const promise = pollVpsStatsOnce(projectId, instanceId);
  inFlight.set(k, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(k) === promise) inFlight.delete(k);
  }
}

async function execRemote(
  cfg: Parameters<typeof execCached>[0],
  command: string,
): Promise<string> {
  try {
    return await execCached(cfg, command, undefined, { timeoutMs: PROBE_TIMEOUT_MS });
  } catch (err) {
    const partial = extractProbeOutput(err);
    if (partial) return partial;
    throw err;
  }
}

function extractProbeOutput(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const marker = "Command exited with code ";
  const idx = err.message.indexOf(marker);
  if (idx < 0) return null;
  const body = err.message.slice(idx + marker.length);
  const nl = body.indexOf("\n");
  if (nl < 0) return null;
  const output = body.slice(nl + 1);
  return output.includes("GENIE_STATS") || output.includes("GENIE_TMUX") || output.includes("windows")
    ? output
    : null;
}

async function probeTmuxViaExec(
  sshCfg: Parameters<typeof execCached>[0],
): Promise<string> {
  return execRemote(sshCfg, TMUX_PROBE_COMMAND).catch(() => "");
}

async function pollVpsStatsOnce(
  projectId: string,
  instanceId: string,
): Promise<VpsStatsPayload> {
  try {
    const conn = await getVpsConnection(projectId, instanceId);
    const sshCfg = {
      host: conn.host,
      port: conn.port ?? 22,
      username: conn.username,
      privateKeyPath: conn.privateKeyPath,
    };

    const includeStats = sshStatsProbeEnabled();
    const tmuxPromise = probeTmuxViaExec(sshCfg);
    const race = includeStats
      ? Promise.race([
          Promise.all([tmuxPromise, execRemote(sshCfg, STATS_COMMAND).catch(() => "")]),
          new Promise<[string, string]>((_r, rej) =>
            setTimeout(() => rej(new Error("stats_exec_timeout")), PROBE_TIMEOUT_MS),
          ),
        ])
      : Promise.race([
          tmuxPromise.then((tmuxOutput): [string, string] => [tmuxOutput, ""]),
          new Promise<[string, string]>((_r, rej) =>
            setTimeout(() => rej(new Error("stats_exec_timeout")), PROBE_TIMEOUT_MS),
          ),
        ]);

    const [tmuxOutput, statsOutput] = await race;

    const statsProbe = parseProbeOutput(statsOutput);
    const tmuxProbeParsed = parseProbeOutput(tmuxOutput);
    return {
      projectId,
      instanceId,
      stats: statsProbe.stats ? statsToClient(statsProbe.stats) : null,
      tmux: tmuxSessionsToClient(tmuxProbeParsed.tmuxSessions),
      error: null,
      tmuxProbePath: "exec",
    };
  } catch (err) {
    return {
      projectId,
      instanceId,
      stats: null,
      tmux: [],
      error: err instanceof Error ? err.message : "stats_exec_failed",
      tmuxProbePath: "exec",
    };
  }
}
