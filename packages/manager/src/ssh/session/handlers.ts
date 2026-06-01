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
 * One SSH connection per terminalId. No tunnel-per-server, no shared session
 * across tabs.
 */
import type { WebSocket } from "ws";

import { getVpsConnection } from "../../vps/connection-resolver.js";
import { SshShellSession, type SshShellOptions } from "./shell.js";
import { sessions, sessionMeta, getSshSession } from "./registry.js";
import { clearOutputBatch, scheduleOutputBatch } from "./output-batch.js";
import { scheduleShellCommand, SHELL_COMMAND_DELAY_MS, type ShellCommandCancel } from "./shell-line.js";
import { resolveTmuxShellCommand, type TmuxShellIntent } from "../tmux/commands.js";

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
) {
  clearInjectTimer(terminalId);
  injectCancellers.set(terminalId, scheduleShellCommand(session, command, delayMs));
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

  if (notifyWs) {
    send(notifyWs, { type: "terminal:closed", payload: { terminalId } });
  }
}

export function closeAllSessionsForWs(ws: WebSocket) {
  for (const [terminalId, meta] of [...sessionMeta]) {
    if (meta.ws === ws) closeSshSession(terminalId);
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

  const session = new SshShellSession(shellOpts, {
    onData: (data) => {
      if (!isCurrentSession(terminalId, session)) return;
      scheduleOutputBatch(ws, terminalId, data, sendOutput, scheduleTrafficEmit);
    },
    onReady: () => {
      if (!isCurrentSession(terminalId, session)) return;
      sessionMeta.set(terminalId, { projectId, instanceId, host, ws });
      emitTraffic(terminalId, ws);
      console.log(`[ssh] ready terminal=${terminalId} ${shellOpts.username}@${host}`);
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
      if (tmuxIntent && tmuxSessionName) {
        scheduleSessionCommand(terminalId, session, resolveTmuxShellCommand(tmuxIntent, tmuxSessionName));
      } else if (initialCommand) {
        // e.g. the Claude button: `cd /opt/project && claude --dangerously-skip-permissions`
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
  });

  sessions.set(terminalId, session);
  session.start(cols, rows);
}

export function handleTerminalData(ws: WebSocket, terminalId: string, data: string) {
  getSshSession(terminalId)?.write(data);
  scheduleTrafficEmit(terminalId, ws);
}

export function handleTerminalResize(terminalId: string, cols: number, rows: number) {
  getSshSession(terminalId)?.resize(cols, rows);
}

export function handleTerminalInject(ws: WebSocket, terminalId: string, command: string) {
  const session = getSshSession(terminalId);
  if (!session) return;
  scheduleSessionCommand(terminalId, session, command, 0);
  scheduleTrafficEmit(terminalId, ws);
}
