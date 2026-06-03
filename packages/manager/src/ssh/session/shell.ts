/**
 * Interactive SSH shell session — one PTY channel leased on the shared tunnel
 * for (host, port, username). Multiple terminals multiplex channels on one
 * SSH connection via ssh-session-cache.
 */
import type { SshConnectionConfig } from "../../vps/ssh-client.js";
import {
  acquireTerminalTunnel,
  closeTerminalChannel,
  getTerminalChannelHandle,
  openTerminalChannel,
  type OpenTerminalChannelOpts,
} from "../../vps/ssh-session-cache.js";
import type { ShellHandle } from "../../vps/ssh-client.js";

export type SshShellOptions = SshConnectionConfig;

export type SshShellHandlers = {
  onData: (data: Buffer) => void;
  onReady: () => void;
  onError: (message: string) => void;
  onClose: () => void;
};

export class SshShellSession {
  private handle: ShellHandle | null = null;
  private closed = false;
  private reportedError = false;

  constructor(
    private readonly options: SshShellOptions,
    private readonly terminalId: string,
    private readonly handlers: SshShellHandlers,
    private readonly meta: { projectId: string | null; instanceId: string | null },
  ) {}

  getTraffic() {
    return this.handle?.getTraffic() ?? { bytesIn: 0, bytesOut: 0 };
  }

  isActive() {
    return !this.closed;
  }

  isExecReady() {
    return !this.closed && this.handle?.isOpen() === true;
  }

  private reportError(message: string) {
    if (this.reportedError) return;
    this.reportedError = true;
    this.handlers.onError(message);
  }

  start(cols: number, rows: number) {
    void this.openChannel(cols, rows);
  }

  private async openChannel(cols: number, rows: number) {
    if (this.closed) return;
    const channelOpts: OpenTerminalChannelOpts = {
      terminalId: this.terminalId,
      cols,
      rows,
      projectId: this.meta.projectId,
      instanceId: this.meta.instanceId,
      onData: (data) => {
        if (this.closed) return;
        this.handlers.onData(data);
      },
      onReady: () => {
        if (this.closed) return;
        this.handle = getTerminalChannelHandle(this.terminalId);
        this.handlers.onReady();
      },
      onError: (message) => {
        if (this.closed) return;
        this.reportError(message);
      },
      onClose: () => {
        if (this.closed) return;
        this.handle = null;
        if (!this.reportedError) this.handlers.onClose();
      },
    };

    try {
      await acquireTerminalTunnel(this.options);
      await openTerminalChannel(this.options, channelOpts);
      this.handle = getTerminalChannelHandle(this.terminalId);
      console.log(
        `[ssh] channel ready terminal=${this.terminalId} ${this.options.username}@${this.options.host}:${this.options.port}`,
      );
    } catch (err) {
      this.reportError(err instanceof Error ? err.message : "Failed to open shell channel");
    }
  }

  write(data: string) {
    if (this.closed || !this.handle?.isOpen()) return;
    try {
      this.handle.write(data);
    } catch (error) {
      this.reportError(error instanceof Error ? error.message : "Failed to write to SSH stream");
    }
  }

  resize(cols: number, rows: number) {
    this.handle?.resize(cols, rows);
  }

  writeRemoteFile(remotePath: string, data: Buffer): Promise<void> {
    if (!this.handle?.isOpen()) return Promise.reject(new Error("SSH session closed"));
    return this.handle.writeRemoteFile(remotePath, data);
  }

  exec(command: string): Promise<string> {
    if (!this.handle?.isOpen()) return Promise.reject(new Error("SSH session closed"));
    return this.handle.exec(command);
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    closeTerminalChannel(this.terminalId);
    this.handle = null;
  }
}
