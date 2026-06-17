import { Client } from "ssh2";
import type { ClientChannel } from "ssh2";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { dbgSsh } from "../debug/debug-ssh-log.js";
import { getActiveSshConnections, sshConnRegister, sshConnUnregister, sshConnMarkConnected, captureSshOpenerStack } from "./ssh-metrics.js";
import { shouldRouteViaSocks, socksDial, tazSocksProxy } from "./socks-dial.js";
import { recordSshEvent, classifySshDisconnect } from "./ssh-events.js";

/** Reject obvious SSRF / internal targets when a user connects an arbitrary SSH
 *  host. Blocks loopback, link-local, and cloud metadata addresses. Not a full
 *  egress firewall (the manager already dials user hosts via terminal:ssh:spawn),
 *  just a guard against the most dangerous self-/metadata targets. */
export function isBlockedSshHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  if (h.startsWith("127.")) return true;          // loopback
  if (h.startsWith("169.254.")) return true;       // link-local + cloud metadata (169.254.169.254)
  if (h.startsWith("fe80:") || h.startsWith("fd") || h.startsWith("fc")) return true; // v6 link-local / ULA
  return false;
}

export interface SshConnectionConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  privateKey?: string | Buffer;  // raw key content — takes precedence over privateKeyPath
}

/** Interactive PTY channel on a shared SSH client. `close()` tears down the
 *  channel only — not the underlying TCP/SSH connection. */
export interface ShellHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Close the PTY channel only. */
  close(): void;
  writeRemoteFile(remotePath: string, data: Buffer): Promise<void>;
  exec(command: string): Promise<string>;
  isOpen(): boolean;
  getTraffic(): { bytesIn: number; bytesOut: number };
}

export interface SshSession {
  exec(cmd: string, onData?: (data: string) => void, opts?: { timeoutMs?: number; idleTimeoutMs?: number }): Promise<string>;
  execStreaming(command: string, opts?: { pty?: boolean }): Promise<StreamingChannel>;
  /** Open an interactive shell (PTY) channel multiplexed on this connection. */
  openShell(opts: {
    cols: number;
    rows: number;
    term?: string;
    onData: (data: Buffer) => void;
    onClose: () => void;
  }): Promise<ShellHandle>;
  getChannelCount(): number;
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

function makeSession(conn: Client, onClose?: () => void, onSessionClosed?: () => void): SshSession {
  /** Reject in-flight execs when the TCP session drops — otherwise a dead
   *  connection can leave promises pending until the 15m manager timeout. */
  const pendingExecAbort = new Set<(err: Error) => void>();
  const openShellStreams = new Set<ClientChannel>();
  conn.on("close", () => {
    for (const abort of pendingExecAbort) abort(new Error("SSH connection closed"));
    pendingExecAbort.clear();
    for (const stream of [...openShellStreams]) {
      try { stream.close(); } catch { /* ignore */ }
    }
    openShellStreams.clear();
  });

  return {
    exec(cmd: string, onData?: (data: string) => void, opts?: { timeoutMs?: number; idleTimeoutMs?: number }): Promise<string> {
      return new Promise((res, rej) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const abortOnClose = (err: Error) => settle(() => rej(err));
        pendingExecAbort.add(abortOnClose);
        function settle(fn: () => void) {
          if (settled) return;
          settled = true;
          pendingExecAbort.delete(abortOnClose);
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

    openShell(opts): Promise<ShellHandle> {
      return new Promise((resolve, reject) => {
        conn.shell(
          { cols: opts.cols, rows: opts.rows, term: opts.term ?? "xterm-256color" },
          (err, stream) => {
            if (err) return reject(err);

            let closed = false;
            let bytesIn = 0;
            let bytesOut = 0;
            openShellStreams.add(stream);

            const trackIn = (data: string | Buffer) => {
              bytesIn += typeof data === "string" ? Buffer.byteLength(data) : data.length;
            };
            const trackOut = (data: Buffer) => {
              bytesOut += data.length;
            };

            stream.on("data", (data: Buffer) => {
              trackOut(data);
              opts.onData(data);
            });
            stream.stderr.on("data", (data: Buffer) => {
              trackOut(data);
              opts.onData(data);
            });
            stream.on("close", () => {
              openShellStreams.delete(stream);
              if (!closed) {
                closed = true;
                opts.onClose();
              }
            });

            const handle: ShellHandle = {
              write(data: string) {
                if (closed) return;
                trackIn(data);
                try { stream.write(data); } catch { /* ignore */ }
              },
              resize(cols: number, rows: number) {
                if (closed) return;
                try { stream.setWindow(rows, cols, 0, 0); } catch { /* ignore */ }
              },
              close() {
                if (closed) return;
                closed = true;
                openShellStreams.delete(stream);
                try { stream.close(); } catch { /* ignore */ }
              },
              writeRemoteFile(remotePath: string, data: Buffer): Promise<void> {
                return new Promise((res, rej) => {
                  if (closed) {
                    rej(new Error("SSH shell channel closed"));
                    return;
                  }
                  conn.sftp((sftpErr, sftp) => {
                    if (sftpErr) return rej(sftpErr);
                    sftp.open(remotePath, "w", (openErr, fh) => {
                      if (openErr) {
                        try { sftp.end(); } catch { /* ignore */ }
                        return rej(openErr);
                      }
                      sftp.write(fh, data, 0, data.length, 0, (writeErr) => {
                        if (writeErr) {
                          try { sftp.close(fh, () => sftp.end()); } catch { /* ignore */ }
                          return rej(writeErr);
                        }
                        sftp.close(fh, (closeErr) => {
                          try { sftp.end(); } catch { /* ignore */ }
                          if (closeErr) return rej(closeErr);
                          trackIn(data);
                          res();
                        });
                      });
                    });
                  });
                });
              },
              exec(command: string): Promise<string> {
                return new Promise((res, rej) => {
                  if (closed) {
                    rej(new Error("SSH shell channel closed"));
                    return;
                  }
                  trackIn(command);
                  conn.exec(command, (execErr, execStream) => {
                    if (execErr) return rej(execErr);
                    let output = "";
                    let stderr = "";
                    execStream.on("data", (d: Buffer) => { output += d.toString("utf8"); trackOut(d); });
                    execStream.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); trackOut(d); });
                    execStream.on("close", (code: number | null) => {
                      const combined = `${output}${stderr}`;
                      if (code !== 0 && !combined.includes("GENIE_STATS")) {
                        rej(new Error(combined.trim() || `Remote command exited with code ${code ?? "unknown"}`));
                        return;
                      }
                      res(combined);
                    });
                  });
                });
              },
              isOpen() { return !closed; },
              getTraffic() { return { bytesIn, bytesOut }; },
            };
            resolve(handle);
          },
        );
      });
    },

    getChannelCount() {
      return openShellStreams.size;
    },

    close() {
      onSessionClosed?.();
      onClose?.();
      try { conn.destroy(); } catch { /* ignore */ }
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

/** ssh2 sends a `keepalive@openssh.com` global request every interval; after
 *  `countMax` consecutive missed replies it emits `error` + `close`. This is the
 *  OpenSSH ServerAliveInterval/ServerAliveCountMax equivalent and the ONLY thing
 *  that makes a silently dropped TCP connection (NAT idle timeout, VM sleep,
 *  network blip) surface as a close event instead of hanging until the OS TCP
 *  keepalive (~2h) — or never, for an idle tunnel/terminal. Distinct from
 *  WireGuard's PersistentKeepalive, which keeps the UDP NAT mapping warm a layer
 *  below and says nothing about SSH liveness. 15s × 3 ≈ 45s to declare dead:
 *  under typical NAT/LB idle windows (so the probes also keep the path warm),
 *  faster than the PTY 90s initial-retry budget and the 5-min cache reaper, and
 *  tolerant of a single dropped probe / GC pause. */
export const SSH_KEEPALIVE_INTERVAL_MS = 15_000;
export const SSH_KEEPALIVE_COUNT_MAX = 3;

/** Minimal connection shape shared by SshConnectionConfig and SshPtyConfig —
 *  enough to dial. Both config types are structurally assignable to this. */
export interface DialConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  privateKey?: string | Buffer;
}

/** Resolve SOCKS-vs-direct for `config.host` and return the socket to hand ssh2,
 *  or null to dial directly. Centralizes the Taz/wireproxy routing decision used
 *  by both connectSsh and spawnSshPty so it can't drift. Throws if the SOCKS dial
 *  itself fails (caller decides how to surface it). */
export async function dialSock(
  config: Pick<DialConfig, "host" | "port">,
  timeoutMs: number,
): Promise<import("node:net").Socket | null> {
  if (!shouldRouteViaSocks(config.host)) return null;
  return socksDial(tazSocksProxy()!, config.host, config.port, timeoutMs);
}

/** Single source of truth for ssh2 `.connect()` options shared by connectSsh and
 *  spawnSshPty: auth fallback (private key → ssh-agent → none), readyTimeout, the
 *  SOCKS `sock` pass-through, and keepalive. Connection tuning lives here once so
 *  the (intentionally separate) dial sites stay in lockstep. */
export function buildConnectOptions(
  config: DialConfig,
  opts: { sock?: import("node:net").Socket | null; timeoutMs: number },
): import("ssh2").ConnectConfig {
  const privateKey = loadPrivateKey(config.privateKey, config.privateKeyPath);
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    ...(privateKey
      ? { privateKey }
      : process.env.SSH_AUTH_SOCK
        ? { agent: process.env.SSH_AUTH_SOCK }
        : {}),
    ...(opts.sock ? { sock: opts.sock } : {}),
    readyTimeout: opts.timeoutMs,
    keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
    keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
  };
}

export async function connectSsh(
  config: SshConnectionConfig,
  opts?: { timeoutMs?: number; /** Clear cached session slot when this connection closes. */ onSessionClosed?: () => void },
): Promise<SshSession> {
  const timeout = opts?.timeoutMs ?? 30_000;

  // On Railway (and other hosts without kernel WireGuard) Taz private addresses
  // are reachable only via the userspace WG SOCKS5 proxy spawned at boot
  // (see wireproxy-launcher.ts). Hosts with kernel WG (local dev with the macOS
  // app, a Linux box with wg-quick) leave GENIE_TAZ_SOCKS unset and dial direct.
  let sock: import("node:net").Socket | null = null;
  try {
    sock = await dialSock(config, timeout);
  } catch (err) {
    throw new Error(
      `SOCKS dial to ${config.host}:${config.port} via ${tazSocksProxy()} failed: ${(err as Error).message}. ` +
      `Check that wireproxy is running and the WireGuard tunnel is up.`,
    );
  }

  // Capture the caller's stack NOW, while we're still on it. By the time
  // ssh2 fires `ready` (async, from inside its own event loop) the original
  // call frames have unwound and a late capture in sshConnRegister would only
  // see "Client.emit (node:events…)" — useless for the /ssh Opener column.
  const openerStack = captureSshOpenerStack();
  const openerHint = openerStack.split("\n")[2]?.trim().slice(0, 100) ?? "?";
  // #region agent log
  dbgSsh("ssh-client.ts:connectSsh", "connectSsh called", "H3", {
    host: config.host,
    username: config.username,
    activeSsh: getActiveSshConnections(),
    openerHint,
  });
  // #endregion
  return new Promise((resolve, reject) => {
    const conn = new Client();

    // Flight-recorder bookkeeping: when did the handshake complete, did WE close
    // it (idle reap / caller close / kill — not a fault), and the last transport
    // error so the close handler can attribute the drop. See vps/ssh-events.ts.
    let readyAt = 0;
    let intentionalClose = false;
    let lastError: Error | null = null;
    const markIntentional = () => { intentionalClose = true; };

    let unregistered = false;
    const unregister = () => {
      if (!unregistered) {
        sshConnUnregister(registryId);
        unregistered = true;
      }
    };
    // Register as `connecting` BEFORE dialing so a hung handshake (dead SOCKS
    // proxy, unreachable host) is visible in /ssh instead of invisible until
    // `ready`. Flipped to `connected` on ready; cleaned up on close/error.
    const registryId = sshConnRegister({
      host: config.host,
      port: config.port,
      username: config.username,
      kind: "client",
      status: "connecting",
      end: () => { markIntentional(); unregister(); try { conn.destroy(); } catch { /* ignore */ } },
      openerStack,
    });
    conn
      .on("ready", () => {
        readyAt = Date.now();
        sshConnMarkConnected(registryId);
        // Wrap onClose so a caller/idle-reap close marks this as intentional —
        // recordSshEvent drops local-kill, keeping the log to real faults.
        resolve(makeSession(conn, () => { markIntentional(); unregister(); }, opts?.onSessionClosed));
      })
      .on("close", () => {
        unregister();
        recordSshEvent({
          occurredAt: Date.now(),
          host: config.host,
          port: config.port,
          username: config.username,
          kind: "client",
          event: "disconnect",
          cause: classifySshDisconnect(lastError, { wasLocalClose: intentionalClose }),
          lifetimeMs: readyAt ? Date.now() - readyAt : undefined,
          detail: lastError?.message,
        });
        opts?.onSessionClosed?.();
      })
      .on("error", (err) => {
        lastError = err;
        unregister();
        // Don't leak the SOCKS socket when the handshake fails before ssh2 has
        // fully adopted it: a half-open socket per failed attempt would pile up
        // against wireproxy. destroy() is idempotent, so this is safe even when
        // ssh2 also tears it down.
        try { sock?.destroy(); } catch { /* ignore */ }
        console.error(`[ssh] Connection to ${config.username}@${config.host}:${config.port} failed:`, err.message);
        // Include the login user — for "All authentication methods failed" this
        // tells you immediately which user/key was rejected (e.g. genie vs ubuntu).
        reject(new Error(`SSH connection failed (${config.username}@${config.host}): ${err.message}`));
      })
      .connect(buildConnectOptions(config, { sock, timeoutMs: timeout }));
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
