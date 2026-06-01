/**
 * Interactive SSH shell session — one ssh2 PTY stream per terminal.
 *
 * Ported from socket-testing-genie/server/ssh/session/shell.ts. Uses genie's
 * existing dial layer (`dialSock` + `buildConnectOptions` in vps/ssh-client.ts)
 * so SOCKS routing for Taz 10.128/16 hosts and direct dial for public IPv4
 * (DigitalOcean droplets) keep working without duplicate logic.
 *
 * One SSH connection per terminal session — NO reverse tunnel per server,
 * NO long-lived cached session for terminals.
 */
import { Client, type ClientChannel } from "ssh2";

import {
  buildConnectOptions,
  dialSock,
  SSH_KEEPALIVE_COUNT_MAX,
  SSH_KEEPALIVE_INTERVAL_MS,
  type DialConfig,
} from "../../vps/ssh-client.js";

export type SshShellOptions = {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  privateKey?: string | Buffer;
};

export type SshShellHandlers = {
  onData: (data: Buffer) => void;
  onReady: () => void;
  onError: (message: string) => void;
  onClose: () => void;
};

const READY_TIMEOUT_MS = 30_000;

export class SshShellSession {
  private conn = new Client();
  private stream: ClientChannel | null = null;
  private closed = false;
  private reportedError = false;
  private bytesIn = 0;
  private bytesOut = 0;

  constructor(
    private readonly options: SshShellOptions,
    private readonly handlers: SshShellHandlers,
  ) {}

  getTraffic() {
    return { bytesIn: this.bytesIn, bytesOut: this.bytesOut };
  }

  isActive() {
    return !this.closed;
  }

  /** True once the PTY is open — safe to call exec() on the same SSH client. */
  isExecReady() {
    return !this.closed && this.stream !== null;
  }

  private trackIn(data: string | Buffer) {
    this.bytesIn += typeof data === "string" ? Buffer.byteLength(data) : data.length;
  }

  private trackOut(data: string | Buffer) {
    this.bytesOut += typeof data === "string" ? Buffer.byteLength(data) : data.length;
  }

  start(cols: number, rows: number) {
    void this.connectAndShell(cols, rows);
  }

  private reportError(message: string) {
    if (this.reportedError) return;
    this.reportedError = true;
    this.handlers.onError(message);
  }

  private bindConnectionHandlers(cols: number, rows: number) {
    this.conn.on("ready", () => {
      this.conn.shell({ cols, rows, term: "xterm-256color" }, (err, stream) => {
        if (err) {
          this.reportError(err.message);
          this.dispose();
          return;
        }

        this.stream = stream;
        stream.on("data", (data: Buffer) => {
          this.trackOut(data);
          this.handlers.onData(data);
        });
        stream.stderr.on("data", (data: Buffer) => {
          this.trackOut(data);
          this.handlers.onData(data);
        });
        stream.on("close", () => {
          if (this.closed) return;
          if (!this.reportedError) this.reportError("Remote shell stream closed");
          if (!this.closed) {
            this.handlers.onClose();
            this.dispose();
          }
        });
        this.handlers.onReady();
      });
    });

    this.conn.on("error", (err) => {
      this.reportError(err.message);
      this.dispose();
    });

    this.conn.on("close", () => {
      if (this.closed) return;
      if (!this.reportedError) this.reportError("SSH connection closed unexpectedly");
      if (!this.closed) {
        this.handlers.onClose();
        this.dispose();
      }
    });
  }

  private async connectAndShell(cols: number, rows: number) {
    try {
      const dialConfig: DialConfig = {
        host: this.options.host,
        port: this.options.port,
        username: this.options.username,
        privateKeyPath: this.options.privateKeyPath,
        privateKey: this.options.privateKey,
      };

      // dialSock returns a SOCKS5-tunneled Socket for Taz 10.128/16 hosts (via
      // wireproxy) and null for direct dial — same routing genie uses
      // everywhere else.
      const sock = await dialSock(dialConfig, READY_TIMEOUT_MS);
      if (this.closed) return;

      console.log(
        `[ssh] connecting ${this.options.username}@${this.options.host}:${this.options.port} timeout=${READY_TIMEOUT_MS}ms${sock ? " via SOCKS" : " direct"}`,
      );

      this.bindConnectionHandlers(cols, rows);

      this.conn.connect({
        ...buildConnectOptions(dialConfig, { sock, timeoutMs: READY_TIMEOUT_MS }),
        keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
        keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
      });
    } catch (error) {
      this.reportError(error instanceof Error ? error.message : "SSH connect failed");
      this.dispose();
    }
  }

  write(data: string) {
    if (this.closed || !this.stream) return;
    this.trackIn(data);
    try {
      this.stream.write(data);
    } catch (error) {
      this.reportError(error instanceof Error ? error.message : "Failed to write to SSH stream");
    }
  }

  resize(cols: number, rows: number) {
    this.stream?.setWindow(rows, cols, 0, 0);
  }

  exec(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error("SSH session closed"));
        return;
      }

      this.conn.exec(command, (err, stream) => {
        if (err) return reject(err);
        this.trackIn(command);

        let output = "";
        let stderr = "";
        stream.on("data", (data: Buffer) => {
          output += data.toString("utf8");
          this.trackOut(data);
        });
        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString("utf8");
          this.trackOut(data);
        });
        stream.on("close", (code: number | null) => {
          const combined = `${output}${stderr}`;
          if (code !== 0 && !combined.includes("GENIE_STATS")) {
            reject(new Error(combined.trim() || `Remote command exited with code ${code ?? "unknown"}`));
            return;
          }
          resolve(combined);
        });
      });
    });
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.stream?.close();
    this.conn.end();
    this.stream = null;
  }
}
