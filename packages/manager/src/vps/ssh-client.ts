import { Client } from "ssh2";
import type { ClientChannel } from "ssh2";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { sshConnOpened, sshConnClosed } from "./ssh-metrics.js";
import { shouldRouteViaSocks, socksDial, tazSocksProxy } from "./socks-dial.js";

export interface SshConnectionConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  privateKey?: string | Buffer;  // raw key content — takes precedence over privateKeyPath
}

export interface SshSession {
  exec(cmd: string, onData?: (data: string) => void, opts?: { timeoutMs?: number; idleTimeoutMs?: number }): Promise<string>;
  execStreaming(command: string, opts?: { pty?: boolean }): Promise<StreamingChannel>;
  forwardIn(bindAddr: string, bindPort: number): Promise<number>;
  unforwardIn(bindAddr: string, bindPort: number): Promise<void>;
  onTcpConnection(handler: (info: { destPort: number }, accept: () => ClientChannel) => void): void;
  /** OpenSSH unix-socket reverse forward: ask the server to bind a unix socket
   *  at `socketPath`. Incoming connections surface via {@link onUnixConnection}. */
  forwardInUnixSocket(socketPath: string): Promise<void>;
  unforwardInUnixSocket(socketPath: string): Promise<void>;
  /** Fires for every incoming connection on a forwarded unix socket. */
  onUnixConnection(handler: (info: { socketPath: string }, accept: () => ClientChannel) => void): void;
  sftpOpenWrite(remotePath: string): Promise<SftpWriteHandle>;
  close(): void;
}

export interface StreamingChannel {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  close(): void;
}

export interface SftpWriteHandle {
  write(buffer: Buffer, offset: number): Promise<void>;
  close(): Promise<void>;
}

function resolveHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return p.replace("~", os.homedir());
  }
  // Normalize absolute paths containing .genie/ssh/ to use current home dir
  // (handles paths stored from a different machine, e.g. /Users/x/.genie/ssh/... → /root/.genie/ssh/...)
  const genieIdx = p.indexOf(".genie/ssh/");
  if (genieIdx > 0) {
    return path.join(os.homedir(), p.slice(genieIdx));
  }
  return p;
}

function makeSession(conn: Client): SshSession {
  return {
    exec(cmd: string, onData?: (data: string) => void, opts?: { timeoutMs?: number; idleTimeoutMs?: number }): Promise<string> {
      return new Promise((res, rej) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        function settle(fn: () => void) {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (idleTimer) clearTimeout(idleTimer);
          fn();
        }

        function resetIdleTimer(stream: ClientChannel) {
          if (!opts?.idleTimeoutMs) return;
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            settle(() => {
              try { stream.close(); } catch {}
              res(output);
            });
          }, opts.idleTimeoutMs);
        }

        let output = "";

        conn.exec(cmd, (err, stream) => {
          if (err) return settle(() => rej(err));

          if (opts?.timeoutMs) {
            timer = setTimeout(() => {
              settle(() => {
                try { stream.close(); } catch {}
                rej(new Error(`Command timed out after ${Math.round(opts.timeoutMs! / 1000)}s`));
              });
            }, opts.timeoutMs);
          }

          resetIdleTimer(stream);

          stream
            .on("data", (data: Buffer) => {
              const chunk = data.toString();
              output += chunk;
              onData?.(chunk);
              resetIdleTimer(stream);
            })
            .stderr.on("data", (data: Buffer) => {
              const chunk = data.toString();
              output += chunk;
              onData?.(chunk);
              resetIdleTimer(stream);
            });
          stream.on("close", (code: number) => {
            settle(() => {
              if (code !== 0) {
                // Tail rather than head — for install scripts, the actionable error
                // (npm ERR!, apt failure, "complete log can be found in: …") lives at
                // the bottom of the output, not the top. 8 KiB is enough to capture
                // a multi-line npm error block plus the log-file path.
                const tail = output.length > 8192 ? "…[truncated]…\n" + output.slice(-8192) : output;
                rej(new Error(`Command exited with code ${code}:\n${tail}`));
              } else {
                res(output);
              }
            });
          });
        });
      });
    },

    execStreaming(command: string, opts?: { pty?: boolean }): Promise<StreamingChannel> {
      return new Promise((resolve, reject) => {
        const run = (err: Error | undefined, stream: ClientChannel) => {
          if (err) return reject(err);

          // Wrap ssh2 channel stdin as a Node Writable
          const stdinWritable = new Writable({
            write(chunk, _encoding, callback) {
              stream.write(chunk, callback);
            },
            final(callback) {
              stream.end();
              callback();
            },
          });

          // Wrap ssh2 channel stdout/stderr as Node Readables
          const stdoutReadable = new Readable({
            read() {},
          });
          const stderrReadable = new Readable({
            read() {},
          });

          // With PTY, all output comes on stdout (no separate stderr stream)
          stream.on("data", (data: Buffer) => {
            stdoutReadable.push(data);
          });
          if (stream.stderr) {
            stream.stderr.on("data", (data: Buffer) => {
              stderrReadable.push(data);
            });
          }
          stream.on("close", () => {
            stdoutReadable.push(null);
            stderrReadable.push(null);
          });

          resolve({
            stdin: stdinWritable,
            stdout: stdoutReadable,
            stderr: stderrReadable,
            close() {
              stream.close();
            },
          });
        };

        if (opts?.pty) {
          conn.exec(command, { pty: true }, run);
        } else {
          conn.exec(command, run);
        }
      });
    },

    forwardIn(bindAddr: string, bindPort: number): Promise<number> {
      return new Promise((resolve, reject) => {
        conn.forwardIn(bindAddr, bindPort, (err, actualPort) => {
          if (err) return reject(err);
          resolve(actualPort);
        });
      });
    },

    unforwardIn(bindAddr: string, bindPort: number): Promise<void> {
      return new Promise((resolve, reject) => {
        conn.unforwardIn(bindAddr, bindPort, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    },

    onTcpConnection(handler: (info: { destPort: number }, accept: () => ClientChannel) => void): void {
      conn.on("tcp connection", (details: { destPort: number }, accept: () => ClientChannel) => {
        handler({ destPort: details.destPort }, accept);
      });
    },

    forwardInUnixSocket(socketPath: string): Promise<void> {
      return new Promise((resolve, reject) => {
        conn.openssh_forwardInStreamLocal(socketPath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    },

    unforwardInUnixSocket(socketPath: string): Promise<void> {
      return new Promise((resolve, reject) => {
        conn.openssh_unforwardInStreamLocal(socketPath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    },

    onUnixConnection(handler: (info: { socketPath: string }, accept: () => ClientChannel) => void): void {
      conn.on("unix connection", (details: { socketPath: string }, accept) => {
        handler({ socketPath: details.socketPath }, accept as () => ClientChannel);
      });
    },

    async sftpOpenWrite(remotePath: string): Promise<SftpWriteHandle> {
      const sftp = await new Promise<import("ssh2").SFTPWrapper>((res, rej) => {
        conn.sftp((err, s) => err ? rej(err) : res(s));
      });
      const handle = await new Promise<Buffer>((res, rej) => {
        sftp.open(remotePath, "w", (err, h) => err ? rej(err) : res(h));
      });
      return {
        write(buffer: Buffer, offset: number) {
          return new Promise<void>((res, rej) => {
            sftp.write(handle, buffer, 0, buffer.length, offset, (err) => err ? rej(err) : res());
          });
        },
        close() {
          return new Promise<void>((res) => {
            sftp.close(handle, () => { try { sftp.end(); } catch { /* ignore */ } res(); });
          });
        },
      };
    },

    close() {
      conn.end();
    },
  };
}

function loadPrivateKey(privateKey: SshConnectionConfig["privateKey"], privateKeyPath: string): Buffer | undefined {
  if (privateKey) {
    return Buffer.isBuffer(privateKey) ? privateKey : Buffer.from(privateKey);
  }
  try {
    return fs.readFileSync(resolveHome(privateKeyPath));
  } catch (err) {
    console.error(`[ssh] Failed to read key from ${privateKeyPath}:`, (err as Error).message);
    return undefined;
  }
}

export async function connectSsh(config: SshConnectionConfig, opts?: { timeoutMs?: number }): Promise<SshSession> {
  const timeout = opts?.timeoutMs ?? 30_000;

  // On Railway (and other hosts without kernel WireGuard) Taz private addresses
  // are reachable only via the userspace WG SOCKS5 proxy spawned at boot
  // (see wireproxy-launcher.ts). Hosts with kernel WG (local dev with the macOS
  // app, a Linux box with wg-quick) leave GENIE_TAZ_SOCKS unset and dial direct.
  let sock: import("node:net").Socket | undefined;
  if (shouldRouteViaSocks(config.host)) {
    const proxy = tazSocksProxy()!;
    try {
      sock = await socksDial(proxy, config.host, config.port, timeout);
    } catch (err) {
      throw new Error(
        `SOCKS dial to ${config.host}:${config.port} via ${proxy} failed: ${(err as Error).message}. ` +
        `Check that wireproxy is running and the WireGuard tunnel is up.`,
      );
    }
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    const privateKey = loadPrivateKey(config.privateKey, config.privateKeyPath);

    let counted = false;
    conn
      .on("ready", () => {
        counted = true;
        sshConnOpened();
        resolve(makeSession(conn));
      })
      .on("close", () => { if (counted) { counted = false; sshConnClosed(); } })
      .on("error", (err) => {
        console.error(`[ssh] Connection to ${config.host}:${config.port} failed:`, err.message);
        reject(new Error(`SSH connection failed: ${err.message}`));
      })
      .connect({
        host: config.host,
        port: config.port,
        username: config.username,
        ...(privateKey
          ? { privateKey }
          : process.env.SSH_AUTH_SOCK
            ? { agent: process.env.SSH_AUTH_SOCK }
            : {}),
        ...(sock ? { sock } : {}),
        readyTimeout: timeout,
      });
  });
}

/** Try each candidate username in order and return the first one whose SSH
 *  login succeeds with the given key. Used at VPS-attach time so that a VM
 *  which has had the Genie recipe installed gets the `genie` user picked over
 *  the image-default user (e.g. `ubuntu`), avoiding Permission-denied surprises
 *  on `/opt/project` writes later. Returns null if no candidate connects. */
export async function pickWorkingSshUser(
  base: Omit<SshConnectionConfig, "username">,
  candidates: string[],
): Promise<string | null> {
  for (const username of candidates) {
    let session;
    try {
      session = await connectSsh({ ...base, username }, { timeoutMs: 8_000 });
    } catch {
      continue;
    }
    session.close();
    return username;
  }
  return null;
}
