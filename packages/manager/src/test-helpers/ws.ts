// Test-only helpers for booting ws-server in-process and driving it via a
// real `ws` client. Heavyweight — boots the full server (DB init, intervals,
// background timers). Tests that use these MUST live in suites gated by
// `describe.skipIf(!isWsIntegrationEnabled())` so they only run when explicitly
// opted in via WS_INTEGRATION=1.
//
// Caveats:
//   - PORT is captured at module-load time in ws-server.ts. This helper sets
//     process.env.PORT before its dynamic import, which works on first boot.
//     Re-booting on a different port within the same vitest process is NOT
//     supported (the import is cached).
//   - shutdown() in ws-server stops the main intervals but not all of them
//     (e.g. the 60s droplet sync interval). For a long-lived test suite that
//     boots once in beforeAll and tears down once in afterAll, this is fine.

import type { WebSocketServer } from "ws";
import WebSocket from "ws";

export function isWsIntegrationEnabled(): boolean {
  return !!process.env.DB_TEST && process.env.WS_INTEGRATION === "1";
}

interface BootedServer {
  wss: WebSocketServer;
  port: number;
  shutdown: () => void;
}

let cached: BootedServer | null = null;

/** Boot ws-server once per test process. Subsequent calls return the cached
 *  instance (PORT capture in ws-server.ts makes re-booting unsafe). */
export async function bootTestWsServer(port = 19876): Promise<BootedServer> {
  if (cached) return cached;
  process.env.PORT = String(port);
  // Dynamic imports so process.env.PORT is set before ws-server reads it.
  const { createServer, shutdown } = await import("../ws-server.js");
  const wss = await createServer();
  cached = { wss, port, shutdown: () => shutdown(wss) };
  return cached;
}

export function teardownTestWsServer(): void {
  if (cached) {
    cached.shutdown();
    cached = null;
  }
}

/** Mint a JWT for the given userId using the same secret/expiry as production
 *  createToken(). Used to skip the OAuth flow in tests. */
export async function mintTestJwt(userId: string): Promise<string> {
  const { createToken } = await import("../auth/auth.js");
  return createToken(userId);
}

interface ConnectedClient {
  ws: WebSocket;
  send: (type: string, payload?: unknown) => void;
  /** Wait for the next message whose `type` matches the predicate. Times out
   *  with a clear error rather than hanging. */
  waitFor: (predicate: (msg: { type: string; payload?: unknown }) => boolean, timeoutMs?: number) => Promise<{ type: string; payload?: unknown }>;
  close: () => void;
}

/** Open a ws connection to a booted test server and complete auth:token with
 *  the given JWT. Resolves once `auth:success` arrives. */
export async function connectAuthenticated(port: number, jwt: string): Promise<ConnectedClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox: { type: string; payload?: unknown }[] = [];
  const waiters: Array<{
    predicate: (msg: { type: string; payload?: unknown }) => boolean;
    resolve: (msg: { type: string; payload?: unknown }) => void;
  }> = [];

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; payload?: unknown };
      inbox.push(msg);
      const idx = waiters.findIndex((w) => w.predicate(msg));
      if (idx >= 0) {
        const [w] = waiters.splice(idx, 1);
        w.resolve(msg);
      }
    } catch {
      // ignore non-JSON
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  const send = (type: string, payload?: unknown) => {
    ws.send(JSON.stringify({ type, payload }));
  };

  const waitFor = (
    predicate: (msg: { type: string; payload?: unknown }) => boolean,
    timeoutMs = 5000,
  ): Promise<{ type: string; payload?: unknown }> => {
    const hit = inbox.find(predicate);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.predicate === predicate);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      waiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
  };

  // Auth handshake — server sends auth:required, client replies with auth:token.
  await waitFor((m) => m.type === "auth:required");
  send("auth:token", { token: jwt });
  const result = await waitFor((m) => m.type === "auth:success" || m.type === "auth:failed");
  if (result.type === "auth:failed") {
    throw new Error(`auth:failed in test handshake: ${JSON.stringify(result.payload)}`);
  }

  return {
    ws,
    send,
    waitFor,
    close: () => ws.close(),
  };
}
