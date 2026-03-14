import { Client } from "ssh2";
import type { ClientChannel } from "ssh2";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { Readable, Writable } from "node:stream";

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
  close(): void;
}

export interface StreamingChannel {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  close(): void;
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
                rej(new Error(`Command exited with code ${code}: ${output.slice(0, 500)}`));
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

    close() {
      conn.end();
    },
  };
}

export function connectSsh(config: SshConnectionConfig, opts?: { timeoutMs?: number }): Promise<SshSession> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let privateKey: Buffer | undefined;
    if (config.privateKey) {
      privateKey = Buffer.isBuffer(config.privateKey)
        ? config.privateKey
        : Buffer.from(config.privateKey);
    } else {
      try {
        const keyPath = resolveHome(config.privateKeyPath);
        privateKey = fs.readFileSync(keyPath);
        console.log(`[ssh] Loaded key from ${keyPath} (${privateKey.length} bytes)`);
      } catch (err) {
        console.error(`[ssh] Failed to read key from ${config.privateKeyPath}:`, (err as Error).message);
        // Key file not readable — will try agent auth
      }
    }

    conn
      .on("ready", () => {
        resolve(makeSession(conn));
      })
      .on("error", (err) => {
        console.error(`[ssh] Connection to ${config.host}:${config.port} failed:`, err.message);
        reject(new Error(`SSH connection failed: ${err.message}`));
      })
      .connect({
        host: config.host,
        port: config.port,
        username: config.username,
        // Use raw key when available; fall back to SSH agent for passphrase-protected keys
        ...(privateKey
          ? { privateKey }
          : process.env.SSH_AUTH_SOCK
            ? { agent: process.env.SSH_AUTH_SOCK }
            : {}),
        readyTimeout: opts?.timeoutMs ?? 30_000,
      });
  });
}
