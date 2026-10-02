/**
 * SSH terminal module — server side.
 *
 * Replaces the deleted pty-manager + dtach-ensure + pty-session-service stack.
 * One SSH connection per terminal, no per-VPS reverse tunnel, no long-lived
 * cached session. Reuses genie's existing dial layer (vps/ssh-client.ts +
 * vps/socks-dial.ts) for SOCKS routing of Taz 10.128/16 hosts.
 *
 * Ported from socket-testing-genie/server/ssh/.
 */
export { SshShellSession } from "./session/shell.js";
export {
  setWsSend,
  startSshSession,
  reattachSshSession,
  closeSshSession,
  closeAllSessionsForWs,
  handleTerminalData,
  handleTerminalResize,
  handleTerminalInject,
  handleTerminalPasteImage,
  type StartParams,
  type WsSendFn,
} from "./session/handlers.js";
export { sessions, sessionMeta, getSessionCountForHost, findShellSessionForVps } from "./session/registry.js";
export { pollVpsStats, type VpsStatsPayload } from "./stats/poll.js";
export {
  createTmuxSessionName,
  tmuxRenameCommand,
  tmuxKillSessionCommand,
  execShellScript,
  resolveTmuxShellCommand,
  type TmuxShellIntent,
} from "./tmux/commands.js";
export type { VpsResourceStats, TmuxSessionInfo } from "./stats/commands.js";
