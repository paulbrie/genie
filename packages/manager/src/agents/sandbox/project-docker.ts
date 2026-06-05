// Docker-on-the-project-VPS sandbox backend.
//
// SSH into the project's VPS, then `docker run --rm -i` a Node container that
// mounts the already-uploaded vps-agent bundle read-only and the project
// workspace read-write. The agent process inside the container speaks the
// existing JSON-line protocol over stdin/stdout — same code as today's
// `startVpsAgent`, just isolated inside a container with no host access beyond
// the workspace mount.
//
// Why no custom Docker image: `ensureVpsAgent` already syncs the bundle to
// /usr/lib/node_modules/@genie/vps-agent on the VPS, so we can mount that into
// node:20-slim. When cold-start time becomes a problem we'll publish a real
// image — the only thing that changes here is the `node:20-slim` default.

import { connectSsh, type SshSession, type StreamingChannel } from "../../vps/ssh-client.js";
import { getVpsConnection } from "../../vps/connection-resolver.js";
import { ensureVpsAgent, VPS_AGENT_REMOTE_BASE } from "../../vps/vps-agent-rsync.js";
import type { SandboxBackend, SandboxHandle, SandboxSpec } from "./index.js";

// VPS_AGENT_REMOTE_BASE (the bundle's install path on the VPS) is imported from
// vps-agent-rsync.js — the single source of truth — so the mount path here can't
// drift from where ensureVpsAgent actually writes the files.
const DEFAULT_IMAGE = "node:20-slim";
const WORKSPACE_HOST_PATH = "/opt/project";
const WORKSPACE_CONTAINER_PATH = "/workspace";
const DEFAULT_TIMEOUT_SEC = 600;

export const projectDockerBackend: SandboxBackend = {
  async spawn(spec: SandboxSpec): Promise<SandboxHandle> {
    if (spec.config.kind !== "project-docker") {
      throw new Error(
        `project-docker backend invoked with sandbox.kind=${spec.config.kind}`,
      );
    }
    const { projectId, instanceId } = spec.config;
    const image = spec.config.image ?? DEFAULT_IMAGE;
    const timeoutSec = spec.config.timeoutSec ?? DEFAULT_TIMEOUT_SEC;

    // Resolve the VPS connection and open an SSH channel for this run. We
    // intentionally open a fresh session rather than reusing ssh-session-cache
    // so a long-running container can't tie up the cached session that other
    // handlers (recipes, stats, terminals) share.
    const conn = await getVpsConnection(projectId, instanceId);

    // Make sure the agent bundle actually exists at VPS_AGENT_REMOTE_BASE before
    // we bind-mount it — otherwise `node /opt/agent/dist/index.js` dies with
    // MODULE_NOT_FOUND inside the container. This used to assume the long-running
    // SSH-agent path (startVpsAgent) had already synced it, which isn't true on a
    // VM that's only ever run sandboxed agents. ensureVpsAgent is idempotent: a
    // warm VM is one cached hash probe.
    await ensureVpsAgent(conn);

    const sshSession: SshSession = await connectSsh(conn, { timeoutMs: 30_000 });

    // `--name` lets us kill the container by predictable id without parsing
    // `docker run`'s output. The `genie-agent-` prefix scopes the namespace so
    // a janitor can reap stragglers with `docker ps -q --filter name=genie-agent-`.
    const containerName = `genie-agent-${spec.runId}`;

    // Pre-pull the image. Idempotent and fast on a warm host. Without this the
    // first run on a fresh VPS appends multi-line progress bars to the agent's
    // stdout stream before the agent itself starts, which breaks the JSON-line
    // parser's first read. Doing it as a separate exec keeps the parser clean.
    try {
      await sshSession.exec(
        // `2>&1 >/dev/null` silences both progress and final tag line.
        `docker pull ${image} >/dev/null 2>&1 || true`,
        undefined,
        { timeoutMs: 120_000 },
      );
    } catch {
      // If pull fails the run will fail on `docker run` with a cleaner message.
    }

    // Compose the `docker run` command. `-i` (interactive but no TTY) gives us
    // clean stdin/stdout for the JSON-line protocol. `--rm` cleans up on exit.
    // The vps-agent bundle is mounted read-only so a misbehaving agent can't
    // self-modify. ANTHROPIC_API_KEY is passed via env so it doesn't appear in
    // the command line (visible to anyone reading `ps`).
    const cmd = [
      "docker", "run", "--rm", "-i",
      "--name", containerName,
      "-v", `${VPS_AGENT_REMOTE_BASE}:/opt/agent:ro`,
      "-v", `${WORKSPACE_HOST_PATH}:${WORKSPACE_CONTAINER_PATH}`,
      "-w", WORKSPACE_CONTAINER_PATH,
      "-e", "ANTHROPIC_API_KEY",
      "--stop-timeout", String(Math.min(60, Math.max(1, Math.floor(timeoutSec / 10)))),
      image,
      "node", "/opt/agent/dist/index.js",
    ].join(" ");

    // Inject the API key via the SSH env wrapper. ssh2 doesn't natively forward
    // env, so we prefix the command with a bash assignment that becomes the
    // container's ANTHROPIC_API_KEY (matched by `-e ANTHROPIC_API_KEY` above).
    // The key never reaches `ps` because it lives in the env of the bash that
    // immediately exec's docker.
    const wrapped = `ANTHROPIC_API_KEY=${shellEscape(spec.anthropicApiKey)} ${cmd}`;
    const channel: StreamingChannel = await sshSession.execStreaming(wrapped);

    // --- Plumbing: parse JSON lines from stdout, surface stderr / exit. ---

    let messageHandler: ((msg: Record<string, unknown>) => void) | null = null;
    let exitHandler: ((code: number | null) => void) | null = null;
    let stderrHandler: ((text: string) => void) | null = null;
    let lineBuffer = "";
    let stopped = false;

    channel.stdout.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          messageHandler?.(JSON.parse(line));
        } catch {
          // Non-JSON noise — likely docker / node warnings before the agent
          // loop starts. Drop it; the agent's own `error` message handles
          // real errors.
        }
      }
    });

    channel.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.trim()) stderrHandler?.(text);
    });

    channel.stdout.on("end", () => {
      // The container's stdout closing == the agent process exited. We don't
      // get a real exit code over SSH-exec without an extra channel; null
      // means "we don't know" — the runner uses the last emitted message
      // (`done` vs `error`) to decide success.
      exitHandler?.(null);
    });

    const handle: SandboxHandle = {
      ref: containerName,
      send(msg) {
        if (stopped) return;
        try {
          channel.stdin.write(JSON.stringify(msg) + "\n");
        } catch {
          // Stream already closed — runner will see onExit shortly.
        }
      },
      onMessage(handler) { messageHandler = handler; },
      onExit(handler) { exitHandler = handler; },
      onStderr(handler) { stderrHandler = handler; },
      async stop() {
        if (stopped) return;
        stopped = true;
        // Close stdin first so the agent gets a clean shutdown signal (it
        // exits on stdin close — see index.ts rl.on("close")). If that
        // doesn't bring it down within a few seconds, force-kill the
        // container by name.
        try { channel.stdin.end(); } catch {}
        try {
          // Best-effort kill via a separate one-shot exec; the original
          // channel may have already torn down.
          await sshSession.exec(`docker rm -f ${containerName} >/dev/null 2>&1 || true`);
        } catch {
          // Ignore — the container may have already exited via --rm.
        }
        try { channel.close(); } catch {}
        try { sshSession.close(); } catch {}
      },
    };

    return handle;
  },
};

/** Single-arg shell escape — wraps the value in single quotes and escapes any
 *  embedded single quote. Safe for env-var assignment in bash. */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
