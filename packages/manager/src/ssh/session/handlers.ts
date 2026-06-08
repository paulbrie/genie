/**
 * WebSocket handlers for interactive SSH terminals.
 * Glue between ws-server.ts and the SshShellSession layer.
 *
 * Protocol (replaces the old terminal:* / pty:* surface):
 *   client → server                          server → client
 *   --------------                           --------------
 *   terminal:start  {terminalId,...}         terminal:ready    {terminalId,...}
 *   terminal:data   {terminalId,data}        terminal:output   {terminalId,dataB64}
 *   terminal:resize {terminalId,cols,rows}   terminal:error    {terminalId?,message}
 *   terminal:close  {terminalId}             terminal:closed   {terminalId}
 *   terminal:inject {terminalId,command}     terminal:traffic  {terminalId,bytesIn,bytesOut}
 *
 * One shared SSH connection per (host, port, username); each terminalId gets
 * a leased PTY channel on that connection.
 */
import type { WebSocket } from "ws";

import { getVpsConnection } from "../../vps/connection-resolver.js";
import { getClientUserName } from "../../ws-server.js";
import { SshShellSession, type SshShellOptions } from "./shell.js";
import { sessions, sessionMeta, getSshSession } from "./registry.js";
import { clearOutputBatch, scheduleOutputBatch } from "./output-batch.js";
import { countCommandsInChunk, clearCommandTracking } from "./command-tracker.js";
import * as analyticsService from "../../analytics-service.js";
import { scheduleShellCommand, SHELL_COMMAND_DELAY_MS, type ShellCommandCancel } from "./shell-line.js";
import {
  createTmuxSessionName,
  resolveTmuxShellCommand,
  tmuxNewSessionWithCommandShellCommand,
  wrapSilentPtyCommand,
  type TmuxShellIntent,
} from "../tmux/commands.js";
import { provisionMcpRestConfig } from "../../vps/mcp-config-merge.js";
import { execCached } from "../../vps/ssh-session-cache.js";

export type WsSendFn = (ws: WebSocket, msg: { type: string; payload: unknown }) => void;

const trafficEmitTimers = new Map<string, ReturnType<typeof setTimeout>>();
const injectCancellers = new Map<string, ShellCommandCancel>();

let sendFn: WsSendFn | null = null;
export function setWsSend(fn: WsSendFn) {
  sendFn = fn;
}
function send(ws: WebSocket, msg: { type: string; payload: unknown }) {
  sendFn?.(ws, msg);
}

function sendOutput(ws: WebSocket, terminalId: string, data: Buffer) {
  // genie's WS is JSON-only — base64-encode binary chunks. The renderer
  // base64-decodes into a Uint8Array and feeds xterm directly.
  send(ws, {
    type: "terminal:output",
    payload: { terminalId, dataB64: data.toString("base64") },
  });
}

function scheduleTrafficEmit(terminalId: string, ws: WebSocket) {
  if (trafficEmitTimers.has(terminalId)) return;
  trafficEmitTimers.set(
    terminalId,
    setTimeout(() => {
      trafficEmitTimers.delete(terminalId);
      emitTraffic(terminalId, ws);
    }, 250),
  );
}

function emitTraffic(terminalId: string, ws: WebSocket) {
  const session = getSshSession(terminalId);
  if (!session) return;
  const t = session.getTraffic();
  send(ws, {
    type: "terminal:traffic",
    payload: { terminalId, bytesIn: t.bytesIn, bytesOut: t.bytesOut },
  });
}

function clearTrafficEmitTimer(terminalId: string) {
  const timer = trafficEmitTimers.get(terminalId);
  if (timer) {
    clearTimeout(timer);
    trafficEmitTimers.delete(terminalId);
  }
}

function clearInjectTimer(terminalId: string) {
  injectCancellers.get(terminalId)?.();
  injectCancellers.delete(terminalId);
}

function scheduleSessionCommand(
  terminalId: string,
  session: SshShellSession,
  command: string,
  delayMs = SHELL_COMMAND_DELAY_MS,
  opts?: { silent?: boolean },
) {
  clearInjectTimer(terminalId);
  const line = opts?.silent ? wrapSilentPtyCommand(command) : command;
  injectCancellers.set(terminalId, scheduleShellCommand(session, line, delayMs));
}

function isCurrentSession(terminalId: string, session: SshShellSession) {
  return sessions.get(terminalId) === session;
}

export function closeSshSession(terminalId: string, notifyWs?: WebSocket) {
  clearInjectTimer(terminalId);
  clearTrafficEmitTimer(terminalId);
  clearOutputBatch(terminalId, sendOutput, scheduleTrafficEmit);

  sessions.get(terminalId)?.dispose();
  sessions.delete(terminalId);
  sessionMeta.delete(terminalId);
  clearCommandTracking(terminalId);

  if (notifyWs) {
    send(notifyWs, { type: "terminal:closed", payload: { terminalId } });
  }
}

export function closeAllSessionsForWs(ws: WebSocket) {
  for (const [terminalId, meta] of [...sessionMeta]) {
    if (meta.ws === ws) closeSshSession(terminalId, ws);
  }
}

export type StartParams =
  | { kind: "project"; projectId: string; instanceId: string }
  | { kind: "direct"; host: string; port?: number; username: string; privateKeyPath: string };

export async function startSshSession(
  ws: WebSocket,
  params: StartParams,
  terminalId: string,
  cols: number,
  rows: number,
  tmuxIntent: TmuxShellIntent | null = null,
  tmuxSessionName: string | null = null,
  initialCommand: string | null = null,
  kind: "claude" | "shell" = "shell",
): Promise<void> {
  closeSshSession(terminalId);

  let shellOpts: SshShellOptions;
  let host: string;
  let projectId: string | null = null;
  let instanceId: string | null = null;

  if (params.kind === "project") {
    const conn = await getVpsConnection(params.projectId, params.instanceId);
    shellOpts = {
      host: conn.host,
      port: conn.port ?? 22,
      username: conn.username,
      privateKeyPath: conn.privateKeyPath,
    };
    host = conn.host;
    projectId = params.projectId;
    instanceId = params.instanceId;
  } else {
    shellOpts = {
      host: params.host,
      port: params.port ?? 22,
      username: params.username,
      privateKeyPath: params.privateKeyPath,
    };
    host = params.host;
  }

  const openedByUserName = getClientUserName(ws);

  const session = new SshShellSession(shellOpts, terminalId, {
    onData: (data) => {
      if (!isCurrentSession(terminalId, session)) return;
      scheduleOutputBatch(ws, terminalId, data, sendOutput, scheduleTrafficEmit);
    },
    onReady: () => {
      if (!isCurrentSession(terminalId, session)) return;
      sessionMeta.set(terminalId, { projectId, instanceId, host, ws, kind });
      emitTraffic(terminalId, ws);
      console.log(`[ssh] ready terminal=${terminalId} ${shellOpts.username}@${host}`);
      // Push mouse + scrollback into the running tmux server via a side-channel
      // exec (NOT the PTY). Affects already-running sessions immediately — tmux
      // sends the mouse-tracking DECSET to attached clients when the option
      // flips, so the popup's wheel handler starts forwarding scroll without
      // needing the user to relaunch Claude. Fire-and-forget; ignored if no
      // tmux server is up yet (the next new-session command provisions both).
      void execCached(
        shellOpts,
        'T=$(command -v tmux 2>/dev/null || true); [ -z "$T" ] && [ -e /snap/bin/tmux ] && T=/snap/bin/tmux; ' +
          '[ -n "$T" ] && { "$T" set-option -gq mouse on 2>/dev/null; "$T" set-option -gq history-limit 50000 2>/dev/null; }; true',
      ).catch(() => { /* tmux not installed / server down — handled by tmux command builders */ });
      send(ws, {
        type: "terminal:ready",
        payload: {
          terminalId,
          host,
          port: shellOpts.port,
          username: shellOpts.username,
          projectId,
          instanceId,
        },
      });
      if (tmuxIntent === "new" && initialCommand) {
        // The Claude button: launch `cd /opt/project && claude …` inside a fresh
        // tmux session so it survives SSH drops and is reattachable. `-A` makes a
        // re-launch with the same name reattach instead of duplicating.
        const name = tmuxSessionName ?? createTmuxSessionName();
        const launchClaude = () =>
          scheduleSessionCommand(terminalId, session, tmuxNewSessionWithCommandShellCommand(name, initialCommand));
        if (projectId && instanceId) {
          // Write the genie-* MCP REST config into /opt/project/.mcp.json BEFORE
          // Claude reads it, so `/mcp` shows the genie servers for terminal
          // launches too (the browser-chat path already does this). Uses a
          // separate cached SSH exec; runs only for project-linked instances
          // (the bearer token is per (project, instance)).
          void (async () => {
            try {
              await provisionMcpRestConfig((cmd) => execCached(shellOpts, cmd), "/opt/project", projectId, instanceId);
            } catch (err) {
              console.warn(`[mcp] failed to write MCP config before Claude launch: ${err instanceof Error ? err.message : err}`);
            }
            launchClaude();
          })();
        } else {
          launchClaude();
        }
      } else if (tmuxIntent && tmuxSessionName) {
        scheduleSessionCommand(
          terminalId,
          session,
          resolveTmuxShellCommand(tmuxIntent, tmuxSessionName),
          SHELL_COMMAND_DELAY_MS,
          { silent: true },
        );
      } else if (initialCommand) {
        scheduleSessionCommand(terminalId, session, initialCommand);
      }
    },
    onError: (message) => {
      if (!isCurrentSession(terminalId, session)) return;
      console.warn(`[ssh] error terminal=${terminalId} ${message}`);
      send(ws, { type: "terminal:error", payload: { terminalId, message } });
      closeSshSession(terminalId);
    },
    onClose: () => {
      if (!isCurrentSession(terminalId, session)) return;
      closeSshSession(terminalId, ws);
    },
  }, { projectId, instanceId, openedByUserName });

  sessions.set(terminalId, session);
  session.start(cols, rows);
}

export function handleTerminalData(ws: WebSocket, terminalId: string, data: string, userId: string | null) {
  getSshSession(terminalId)?.write(data);
  scheduleTrafficEmit(terminalId, ws);
  // Count submitted commands (Enter on a non-empty line) for analytics. The
  // command text itself is never recorded — only metadata.
  if (userId) {
    const n = countCommandsInChunk(terminalId, data);
    if (n > 0) {
      const meta = sessionMeta.get(terminalId);
      for (let i = 0; i < n; i++) {
        void analyticsService.recordEvent({
          userId,
          userName: null,
          event: "terminal.command_sent",
          projectId: meta?.projectId ?? null,
          props: { kind: meta?.kind ?? "shell", source: "keystroke" },
          ip: null,
        });
      }
    }
  }
}

export function handleTerminalResize(terminalId: string, cols: number, rows: number) {
  getSshSession(terminalId)?.resize(cols, rows);
}

export function handleTerminalInject(
  ws: WebSocket,
  terminalId: string,
  command: string,
  userId: string | null,
  opts?: { silent?: boolean },
) {
  const session = getSshSession(terminalId);
  if (!session) return;
  scheduleSessionCommand(terminalId, session, command, 0, opts);
  scheduleTrafficEmit(terminalId, ws);
  // Programmatically injected command (e.g. the Commands tab). Metadata only —
  // never the command text. Same event/schema as typed commands.
  if (userId) {
    const meta = sessionMeta.get(terminalId);
    void analyticsService.recordEvent({
      userId,
      userName: null,
      event: "terminal.command_sent",
      projectId: meta?.projectId ?? null,
      props: { kind: meta?.kind ?? "shell", source: "inject", silent: !!opts?.silent },
      ip: null,
    });
  }
}

const SAFE_EXT = /^[a-z0-9]{1,8}$/i;

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Take a base64-encoded image from the browser clipboard, write it to a temp
 *  file on the VM via SFTP, then type the file path into the live PTY so the
 *  process the user is interacting with (Claude Code) reads it from its prompt.
 *  Returns the remote path so the renderer can surface it / show a toast. */
export async function handleTerminalPasteImage(
  ws: WebSocket,
  terminalId: string,
  dataB64: string,
  ext: string,
): Promise<{ ok: true; remotePath: string } | { ok: false; error: string }> {
  const session = getSshSession(terminalId);
  if (!session) return { ok: false, error: "no_session" };

  if (!SAFE_EXT.test(ext)) ext = "png";

  let bytes: Buffer;
  try {
    bytes = Buffer.from(dataB64, "base64");
  } catch {
    return { ok: false, error: "invalid_base64" };
  }
  if (bytes.length === 0) return { ok: false, error: "empty_image" };

  const remotePath = `/tmp/genie-paste-${randomId()}.${ext.toLowerCase()}`;
  try {
    await session.writeRemoteFile(remotePath, bytes);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "sftp_write_failed" };
  }

  // Type the path (plus a trailing space) into the live PTY. Claude Code reads
  // file paths from its prompt and auto-attaches them when sent.
  session.write(`${remotePath} `);
  scheduleTrafficEmit(terminalId, ws);
  return { ok: true, remotePath };
}
