import { Client } from "ssh2";
import type { ClientChannel } from "ssh2";
import type { Readable as NodeReadable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { Readable, Writable } from "node:stream";
import { sshConnOpened, sshConnClosed } from "./ssh-metrics.js";

export interface SshConnectionConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  privateKey?: string | Buffer;  // raw key content — takes precedence over privateKeyPath
  /** Optional ProxyJump-style bastion. When set, connectSsh first opens a
   *  session to the bastion, then forwardOut's a TCP channel to (host, port)
   *  through it, and connects the real ssh2 client over that channel. Lets
   *  the manager reach Taz VMs that only have a private 10.128/24 IP and are
   *  accessible solely via almalinux@188.213.48.230. */
  bastion?: {
    host: string;
    port?: number;          // default 22
    username: string;
    privateKeyPath: string;
    privateKey?: string | Buffer;
  };
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

// ── Bastion connection pool ─────────────────────────────────────────────────
// Every Taz vxlan-bastion exec tunnels through the customer bastion. Opening a
// fresh SSH connection to the bastion per exec made the Manage popup fire 15-20
// bastion handshakes in a burst on mount, tripping the bastion's sshd
// MaxStartups / fail2ban so most handshakes timed out ("waiting for handshake").
// Instead we keep ONE live SSH connection per bastion identity and multiplex
// every VM tunnel over it via forwardOut — a cheap channel, not a new handshake.
// Refcounted with idle eviction; evicted immediately if the connection drops.
type BastionConfig = NonNullable<SshConnectionConfig["bastion"]>;

interface PooledBastion {
  ready: Promise<Client>;
  conn: Client | null;
  refs: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const bastionPool = new Map<string, PooledBastion>();
const BASTION_IDLE_MS = 60_000;

/** Identity of a bastion connection: where + who + which key. The key material
 *  is hashed so we never hold a secret as a Map key (and a rotated key yields a
 *  fresh entry). */
function bastionKey(b: BastionConfig): string {
  const keyId = b.privateKey
    ? crypto.createHash("sha256").update(b.privateKey).digest("hex").slice(0, 16)
    : b.privateKeyPath;
  return `${b.username}@${b.host}:${b.port ?? 22}|${keyId}`;
}

/** Acquire a (possibly shared) live connection to the bastion, taking one lease.
 *  Concurrent callers for the same bastion await the same in-flight connection,
 *  so a burst of execs produces a single bastion handshake. */
function acquireBastion(b: BastionConfig, timeout: number): Promise<Client> {
  const key = bastionKey(b);
  const existing = bastionPool.get(key);
  if (existing) {
    existing.refs++;
    if (existing.idleTimer) { clearTimeout(existing.idleTimer); existing.idleTimer = null; }
    return existing.ready;
  }
  const entry: PooledBastion = { ready: undefined as unknown as Promise<Client>, conn: null, refs: 1, idleTimer: null };
  entry.ready = new Promise<Client>((resolve, reject) => {
    const c = new Client();
    const bKey = loadPrivateKey(b.privateKey, b.privateKeyPath);
    let settled = false;
    c.on("ready", () => { settled = true; entry.conn = c; sshConnOpened(); console.log(`[ssh] bastion connection opened: ${b.username}@${b.host}:${b.port ?? 22} (pooled, reused across execs)`); resolve(c); })
      .on("error", (err) => {
        bastionPool.delete(key); // let the next caller reconnect cleanly
        if (!settled) reject(new Error(`SSH bastion ${b.username}@${b.host}:${b.port ?? 22} failed: ${err.message}`));
      })
      .on("close", () => { if (settled) sshConnClosed(); bastionPool.delete(key); })
      .connect({
        host: b.host,
        port: b.port ?? 22,
        username: b.username,
        ...(bKey ? { privateKey: bKey } : process.env.SSH_AUTH_SOCK ? { agent: process.env.SSH_AUTH_SOCK } : {}),
        readyTimeout: timeout,
      });
  });
  bastionPool.set(key, entry);
  return entry.ready;
}

/** Release one lease. When the last lease drops we keep the connection warm for
 *  BASTION_IDLE_MS (so the next popup/exec reuses it) before closing. */
function releaseBastion(b: BastionConfig): void {
  const key = bastionKey(b);
  const entry = bastionPool.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0 && !entry.idleTimer) {
    entry.idleTimer = setTimeout(() => {
      bastionPool.delete(key);
      try { entry.conn?.end(); } catch { /* ignore */ }
      console.log(`[ssh] bastion connection closed (idle ${BASTION_IDLE_MS / 1000}s): ${key.split("|")[0]}`);
    }, BASTION_IDLE_MS);
  }
}

export async function connectSsh(config: SshConnectionConfig, opts?: { timeoutMs?: number }): Promise<SshSession> {
  const timeout = opts?.timeoutMs ?? 30_000;

  // If a bastion is configured, reuse a pooled connection to it and open a fresh
  // forwardOut tunnel to the inner host. We hold one bastion lease for the life
  // of this session and release it on close/error (releaseBastionOnce). ssh2's
  // `sock` option accepts the forwardOut channel (a Duplex) as the transport.
  let sock: NodeReadable | undefined;
  let bastionLeased = false;
  const releaseBastionOnce = (() => {
    let released = false;
    return () => {
      if (released || !bastionLeased || !config.bastion) return;
      released = true;
      releaseBastion(config.bastion);
    };
  })();

  if (config.bastion) {
    const b = config.bastion;
    const bastionConn = await acquireBastion(b, timeout);
    bastionLeased = true;
    try {
      sock = await new Promise<NodeReadable>((resolve, reject) => {
        // srcIP/srcPort are arbitrary — the bastion doesn't actually open a
        // listener; they're only used for logging on the bastion's sshd.
        bastionConn.forwardOut("127.0.0.1", 0, config.host, config.port, (err, stream) => {
          if (err) return reject(new Error(`Bastion forwardOut to ${config.host}:${config.port} failed: ${err.message}`));
          resolve(stream as unknown as NodeReadable);
        });
      });
    } catch (err) {
      releaseBastionOnce(); // forwardOut failed — don't hold the lease
      throw err;
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
        const session = makeSession(conn);
        // Wrap close() so it releases our bastion lease too. The VM connection
        // (conn.end via origClose) and its forwardOut channel close, but the
        // pooled bastion connection stays warm for the next exec.
        const origClose = session.close;
        session.close = () => {
          origClose();
          releaseBastionOnce();
        };
        resolve(session);
      })
      .on("close", () => { if (counted) { counted = false; sshConnClosed(); } })
      .on("error", (err) => {
        releaseBastionOnce();
        console.error(`[ssh] Connection to ${config.host}:${config.port}${config.bastion ? ` via ${config.bastion.username}@${config.bastion.host}` : ""} failed:`, err.message);
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
