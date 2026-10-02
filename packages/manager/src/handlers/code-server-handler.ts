// "Open in VS Code" orchestration for the Files tab: `vps:code:status` probes
// the VM, `vps:code:ensure` advances an idempotent state machine — install
// code-server (detached, survives WS/manager restarts) and start the service —
// and both reply on `vps:code:result` with the reqId so the renderer's
// wsRequest resolves. When running, the reply carries a tokenized *relative*
// path (/code/<projectId>/<instanceId>/…) served by the manager's own
// browser→VM proxy (vps/code-server-proxy.ts); the renderer prefixes it with
// the manager origin. No per-VM domain/Caddy/ingress setup is involved, so
// every SSH-reachable provider works. The install itself runs under nohup on
// the VM with a pidfile + INSTALL_OK/INSTALL_FAIL sentinel; the renderer polls
// `vps:code:status` for progress (ws.ts swallows reqId-matched messages, so
// streaming on the request id isn't possible).

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as projectService from "../projects/project-service.js";
import { getVpsConnection } from "../vps/connection-resolver.js";
import { execCached } from "../vps/ssh-session-cache.js";
import { mintCodeProxyPath } from "../vps/code-server-proxy.js";
import { CODE_SERVER_INSTALL_SCRIPT } from "../default-recipes.js";

export type CodeServerState =
  | "not_installed"
  | "installing"
  | "install_failed"
  | "stopped"
  | "running";

const INSTALL_LOG = "/var/log/code-server-install.log";
const PIDFILE = "/var/run/genie-code-server-install.pid";
const INSTALL_SCRIPT_PATH = "/opt/genie/code-server-install.sh";

/** POSIX single-quote a string for safe embedding in a shell command. */
function shSingleQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

// One combined probe per request — a single exec on the cached SSH session.
// Key=value lines up to the ==LOGTAIL== marker, install-log tail after it.
const PROBE_CMD = [
  `command -v code-server >/dev/null 2>&1 && echo "BIN=yes" || echo "BIN=no"`,
  `systemctl is-enabled --quiet code-server 2>/dev/null && echo "ENABLED=yes" || echo "ENABLED=no"`,
  `systemctl is-active --quiet code-server 2>/dev/null && echo "ACTIVE=yes" || echo "ACTIVE=no"`,
  `PID=$(sudo cat ${PIDFILE} 2>/dev/null || true); if [ -n "$PID" ] && sudo kill -0 "$PID" 2>/dev/null; then echo "INSTALLING=yes"; else echo "INSTALLING=no"; fi`,
  `sudo tail -n 3 ${INSTALL_LOG} 2>/dev/null | grep -q "INSTALL_FAIL" && echo "FAILED=yes" || echo "FAILED=no"`,
  `echo "PASSWORD=$(sudo awk '/^password:/{print $2}' /home/genie/.config/code-server/config.yaml 2>/dev/null | head -1)"`,
  `echo "==LOGTAIL=="`,
  `sudo tail -n 12 ${INSTALL_LOG} 2>/dev/null || true`,
].join("\n");

interface Probe {
  bin: boolean;
  enabled: boolean;
  active: boolean;
  installing: boolean;
  failed: boolean;
  password?: string;
  logTail?: string;
}

function parseProbe(out: string): Probe {
  const [head, ...rest] = out.split("==LOGTAIL==");
  const kv: Record<string, string> = {};
  for (const line of head.split("\n")) {
    const m = line.match(/^([A-Z]+)=(.*)$/);
    if (m) kv[m[1]] = m[2].trim();
  }
  const logTail = rest.join("").trim();
  return {
    bin: kv.BIN === "yes",
    enabled: kv.ENABLED === "yes",
    active: kv.ACTIVE === "yes",
    installing: kv.INSTALLING === "yes",
    failed: kv.FAILED === "yes",
    password: kv.PASSWORD || undefined,
    logTail: logTail || undefined,
  };
}

function deriveState(probe: Probe): CodeServerState {
  if (probe.installing) return "installing";
  if (!probe.bin || !probe.enabled) return probe.failed ? "install_failed" : "not_installed";
  if (!probe.active) return "stopped";
  return "running";
}

/** Kick off the recipe's install script detached on the VM. nohup + pidfile
 *  so it survives this SSH channel (and the manager) going away; the sentinel
 *  line at the end of the log tells the probe how it finished. */
async function startDetachedInstall(conn: Awaited<ReturnType<typeof getVpsConnection>>): Promise<void> {
  const runner = `bash ${INSTALL_SCRIPT_PATH} >> ${INSTALL_LOG} 2>&1 && echo INSTALL_OK >> ${INSTALL_LOG} || echo INSTALL_FAIL >> ${INSTALL_LOG}`;
  const cmd = [
    "sudo mkdir -p /opt/genie",
    `printf '%s' ${shSingleQuote(CODE_SERVER_INSTALL_SCRIPT)} | sudo tee ${INSTALL_SCRIPT_PATH} >/dev/null`,
    `sudo rm -f ${INSTALL_LOG} ${PIDFILE}`,
    `sudo touch ${INSTALL_LOG}`,
    `nohup sudo bash -c ${shSingleQuote(runner)} >/dev/null 2>&1 &`,
    `echo $! | sudo tee ${PIDFILE} >/dev/null`,
  ].join("\n");
  await execCached(conn, cmd, undefined, { timeoutMs: 30_000 });
}

export async function handleCodeServerMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
): Promise<boolean> {
  if (!msg.type.startsWith("vps:code:")) return false;
  const { projectId, instanceId, reqId } = (msg.payload ?? {}) as {
    projectId?: string;
    instanceId?: string;
    reqId?: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reply = (payload: Record<string, any>) =>
    send(ws, { type: "vps:code:result", payload: { reqId, ...payload } });

  try {
    if (!projectId || !instanceId) {
      reply({ ok: false, error: "projectId and instanceId are required" });
      return true;
    }
    // Same membership gate as vps:fs:* — these handlers resolve a server
    // purely from projectId+instanceId. This is also what makes the minted
    // proxy token trustworthy: it only ever reaches authorized users.
    if (!(await projectService.userCanSeeProject(userId, projectId))) {
      reply({ ok: false, error: "Not authorized for this project" });
      return true;
    }
    const project = await projectService.getById(projectId);
    const inst = project?.vpsInstances.find((v) => v.id === instanceId);
    if (!project || !inst) {
      reply({ ok: false, error: "VPS instance not found" });
      return true;
    }

    const conn = await getVpsConnection(projectId, instanceId);
    let probe = parseProbe(await execCached(conn, PROBE_CMD, undefined, { timeoutMs: 25_000 }));

    switch (msg.type) {
      case "vps:code:status": {
        const state = deriveState(probe);
        reply({
          ok: true,
          state,
          path: state === "running" ? await mintCodeProxyPath(projectId, instanceId) : undefined,
          password: probe.password,
          logTail: state === "installing" || state === "install_failed" ? probe.logTail : undefined,
        });
        return true;
      }

      case "vps:code:ensure": {
        if (probe.installing) {
          reply({ ok: true, state: "installing", logTail: probe.logTail });
          return true;
        }
        // Not installed (or a previous attempt failed) → (re)start the
        // detached install and let the renderer poll.
        if (!probe.bin || !probe.enabled) {
          await startDetachedInstall(conn);
          reply({ ok: true, state: "installing", logTail: "Starting code-server install…" });
          return true;
        }
        if (!probe.active) {
          await execCached(conn, "sudo systemctl restart code-server", undefined, { timeoutMs: 30_000 });
          probe = parseProbe(await execCached(conn, PROBE_CMD, undefined, { timeoutMs: 25_000 }));
          if (!probe.active) {
            reply({
              ok: false,
              state: "stopped",
              error: "code-server failed to start — check the recipe's 'Service status' / 'Tail logs' commands",
            });
            return true;
          }
        }
        reply({
          ok: true,
          state: "running",
          path: await mintCodeProxyPath(projectId, instanceId),
          password: probe.password,
        });
        return true;
      }

      default:
        reply({ ok: false, error: `Unknown message type ${msg.type}` });
        return true;
    }
  } catch (err: unknown) {
    reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}
