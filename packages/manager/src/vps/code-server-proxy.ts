// Browser→VM reverse proxy for code-server ("Open in VS Code" in the Files
// tab). The browser opens https://<manager>/code/<projectId>/<instanceId>/ and
// the manager forwards HTTP + WebSocket traffic to 127.0.0.1:CODE_SERVER_PORT
// on the VM over a direct-TCP channel (ssh2 forwardOut) multiplexed on the
// cached SSH session — the same transport every other VM feature rides, so no
// per-VM Caddy/ingress/domain configuration is needed and it works for every
// SSH-reachable provider (TazCloud via WireGuard, DO, Hetzner, generic).
//
// Auth: these are plain HTTP requests with no WS identity, so access is gated
// by an HMAC token bound to (projectId, instanceId, expiry). Tokens are minted
// ONLY by the vps:code handler after its userCanSeeProject check, arrive once
// as ?gtoken=…, and are exchanged for a scoped cookie (Path=/code/<p>/<i>) via
// a redirect that strips the token from the URL. code-server's own password
// login still applies behind this. The upstream is pinned to CODE_SERVER_PORT
// — the proxy cannot be steered at other ports or hosts.

import http from "node:http";
import crypto from "node:crypto";
import type { Duplex } from "node:stream";
import type net from "node:net";
import { getVpsConnection } from "./connection-resolver.js";
import { getCachedSession } from "./ssh-session-cache.js";
import { getGlobalSetting, setGlobalSetting } from "../settings-service.js";
import { CODE_SERVER_PORT } from "../default-recipes.js";

const COOKIE_NAME = "genie_code_auth";
/** Lifetime of the one-shot ?gtoken=… link returned to the Files tab. */
const LINK_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
/** Lifetime of the cookie the link is exchanged for. */
const COOKIE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// --- Token minting / verification ---

let cachedSecret: string | null = null;

/** HMAC secret, generated once and persisted so tokens survive restarts. */
async function getSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  let s = await getGlobalSetting<string>("codeProxySecret");
  if (!s) {
    s = crypto.randomBytes(32).toString("hex");
    await setGlobalSetting("codeProxySecret", s);
  }
  cachedSecret = s;
  return s;
}

function sign(projectId: string, instanceId: string, exp: number, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${projectId}:${instanceId}:${exp}`).digest("hex");
}

async function mintToken(projectId: string, instanceId: string, ttlMs: number): Promise<string> {
  const exp = Date.now() + ttlMs;
  return `${exp}.${sign(projectId, instanceId, exp, await getSecret())}`;
}

async function verifyToken(projectId: string, instanceId: string, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const [expStr, mac] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now() || !mac) return false;
  const expected = sign(projectId, instanceId, exp, await getSecret());
  try {
    return crypto.timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/** Tokenized entry path for the renderer — mint only after an authorization
 *  check (the vps:code handler gates on userCanSeeProject). */
export async function mintCodeProxyPath(projectId: string, instanceId: string): Promise<string> {
  const token = await mintToken(projectId, instanceId, LINK_TOKEN_TTL_MS);
  return `/code/${projectId}/${instanceId}/?folder=/opt/project&gtoken=${token}`;
}

// --- URL / cookie plumbing ---

export function isCodeProxyPath(url: string | undefined): boolean {
  return !!url && url.startsWith("/code/");
}

interface ParsedCodeUrl {
  projectId: string;
  instanceId: string;
  /** Path to forward upstream ("/", "/login", "/static/…"). */
  rest: string;
  query: URLSearchParams;
  /** Bare /code/<p>/<i> (no trailing slash) — needs a redirect so the page's
   *  relative asset URLs resolve under the prefix. */
  needsSlashRedirect: boolean;
}

const ID_RE = /^[\w-]{6,64}$/;

function parseCodeUrl(rawUrl: string): ParsedCodeUrl | null {
  let u: URL;
  try {
    u = new URL(rawUrl, "http://internal");
  } catch {
    return null;
  }
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs[0] !== "code" || segs.length < 3) return null;
  const [, projectId, instanceId, ...restSegs] = segs;
  if (!ID_RE.test(projectId) || !ID_RE.test(instanceId)) return null;
  const prefix = `/code/${projectId}/${instanceId}`;
  return {
    projectId,
    instanceId,
    rest: u.pathname.slice(prefix.length) || "/",
    query: u.searchParams,
    needsSlashRedirect: u.pathname === prefix,
  };
}

/** All values of our auth cookie — the browser can legitimately send several
 *  (same name, different Path scopes when multiple VMs' editors were opened). */
function getCookieTokens(req: http.IncomingMessage): string[] {
  const raw = req.headers.cookie;
  if (!raw) return [];
  const tokens: string[] = [];
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    try {
      tokens.push(decodeURIComponent(part.slice(eq + 1).trim()));
    } catch { /* skip malformed */ }
  }
  return tokens;
}

async function isAuthorized(req: http.IncomingMessage, parsed: ParsedCodeUrl): Promise<boolean> {
  for (const t of getCookieTokens(req)) {
    if (await verifyToken(parsed.projectId, parsed.instanceId, t)) return true;
  }
  return verifyToken(parsed.projectId, parsed.instanceId, parsed.query.get("gtoken"));
}

function upstreamPath(parsed: ParsedCodeUrl): string {
  const q = new URLSearchParams(parsed.query);
  q.delete("gtoken");
  const qs = q.toString();
  return parsed.rest + (qs ? `?${qs}` : "");
}

async function openUpstreamChannel(projectId: string, instanceId: string) {
  const conn = await getVpsConnection(projectId, instanceId);
  const session = await getCachedSession(conn);
  return session.forwardOut("127.0.0.1", CODE_SERVER_PORT);
}

/** Request path with the query stripped — safe to log (no gtoken). */
function logPath(rawUrl: string | undefined): string {
  return (rawUrl || "").split("?")[0];
}

// --- HTTP proxying ---

/** Handle a /code/… request. Call before any other routing (and before CORS
 *  headers are stamped) — proxied responses must pass through untouched. */
export async function handleCodeProxyRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const parsed = parseCodeUrl(req.url || "");
    if (!parsed) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    if (parsed.needsSlashRedirect) {
      const qs = parsed.query.toString();
      res.writeHead(302, { Location: `/code/${parsed.projectId}/${parsed.instanceId}/${qs ? `?${qs}` : ""}` });
      res.end();
      return;
    }

    // One-shot link token → scoped cookie + redirect to the clean URL, so the
    // token never sits in the address bar / browser history longer than needed.
    const linkToken = parsed.query.get("gtoken");
    if (linkToken && (await verifyToken(parsed.projectId, parsed.instanceId, linkToken))) {
      const cookieToken = await mintToken(parsed.projectId, parsed.instanceId, COOKIE_TOKEN_TTL_MS);
      const q = new URLSearchParams(parsed.query);
      q.delete("gtoken");
      const qs = q.toString();
      res.writeHead(302, {
        Location: `/code/${parsed.projectId}/${parsed.instanceId}${parsed.rest}${qs ? `?${qs}` : ""}`,
        "Set-Cookie":
          `${COOKIE_NAME}=${encodeURIComponent(cookieToken)}; ` +
          `Path=/code/${parsed.projectId}/${parsed.instanceId}; ` +
          `Max-Age=${Math.floor(COOKIE_TOKEN_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`,
      });
      res.end();
      return;
    }

    if (!(await isAuthorized(req, parsed))) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Access denied — open VS Code from the Genie Files tab.");
      return;
    }

    const channel = await openUpstreamChannel(parsed.projectId, parsed.instanceId);
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    headers.host = `127.0.0.1:${CODE_SERVER_PORT}`;
    // One SSH channel per request; don't advertise keep-alive upstream.
    headers.connection = "close";

    const proxyReq = http.request({
      createConnection: () => channel as unknown as net.Socket,
      method: req.method,
      path: upstreamPath(parsed),
      headers,
    });
    proxyReq.on("response", (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (err) => {
      console.error(`[code-proxy] upstream request failed for ${logPath(req.url)}: ${err.message}`);
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("code-server unreachable on the VM (is the service running?)");
      try { channel.destroy(); } catch { /* ignore */ }
    });
    res.on("close", () => {
      try { proxyReq.destroy(); } catch { /* ignore */ }
    });
    req.pipe(proxyReq);
  } catch (err: unknown) {
    console.error(`[code-proxy] request failed for ${logPath(req.url)}:`, err instanceof Error ? err.message : err);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Proxy error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- WebSocket tunneling ---

/** Handle an HTTP Upgrade on /code/… — replay the handshake to code-server
 *  over the SSH channel, then splice the two byte streams. code-server's
 *  editor, terminals and extensions all run over this. */
export async function handleCodeProxyUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const refuse = (status: string) => {
    console.error(`[code-proxy] upgrade refused (${status}) for ${logPath(req.url)}`);
    try { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); } catch { /* ignore */ }
    try { socket.destroy(); } catch { /* ignore */ }
  };
  try {
    const parsed = parseCodeUrl(req.url || "");
    if (!parsed) return refuse("404 Not Found");
    if (!(await isAuthorized(req, parsed))) return refuse("403 Forbidden");

    const channel = await openUpstreamChannel(parsed.projectId, parsed.instanceId);

    // Replay the client's upgrade request verbatim (rawHeaders preserves
    // duplicates/order), with only the path prefix stripped and Host/Origin
    // rewritten. Origin must match the rewritten Host: code-server rejects
    // cross-origin WebSockets (403) before its own auth even runs.
    const lines = [`${req.method || "GET"} ${upstreamPath(parsed)} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i];
      const keyLc = key.toLowerCase();
      const value =
        keyLc === "host" ? `127.0.0.1:${CODE_SERVER_PORT}`
        : keyLc === "origin" ? `http://127.0.0.1:${CODE_SERVER_PORT}`
        : req.rawHeaders[i + 1];
      lines.push(`${key}: ${value}`);
    }
    channel.write(lines.join("\r\n") + "\r\n\r\n");
    if (head?.length) channel.write(head);

    socket.pipe(channel);
    channel.pipe(socket);
    const teardown = () => {
      try { socket.destroy(); } catch { /* ignore */ }
      try { channel.destroy(); } catch { /* ignore */ }
    };
    socket.on("error", teardown);
    channel.on("error", teardown);
    socket.on("close", teardown);
    channel.on("close", teardown);
  } catch (err: unknown) {
    console.error(`[code-proxy] upgrade failed for ${logPath(req.url)}:`, err instanceof Error ? err.message : err);
    refuse("502 Bad Gateway");
  }
}
