// "Sign in with Genie" for genie-local servers: the manager side.
//
//   GET /auth/vps/start?project&instance&nonce&return
//     The instance must belong to the project; `return` must be
//     https://<host>/…/api/auth/genie/callback with <host> one genie knows for
//     that instance (vps/vps-sso-origin.ts), never taken from the request.
//     Then the same Google OAuth client and /auth/callback redirect URI as the
//     genie sign-in, with a `state` of "vps.<random>" naming the pending server
//     sign-in. The state is also put in an HttpOnly cookie, so the callback
//     only completes in the browser that started it (login CSRF).
//   GET /auth/callback?state=vps.…  (Google's redirect)
//     Google account → genie user (findOrHydrateGoogleUser: existing user or
//     invited stub; never a new one) who can see the project
//     (userCanSeeProject). Not a member → a plain error page, audited.
//     Member → an auto-submitting form POSTing `assertion` (EdDSA JWS, 120 s,
//     with a jti and the server's nonce passed through untouched) to the
//     validated return URL, audited. no-store, a strict CSP, no referrer.
//   GET /api/vps/sso/jwks  → the public keys (vps/vps-sso-keys.ts).
//
// The genie sign-in's single pending slot in auth.ts is never touched here.

import crypto from "node:crypto";
import type http from "node:http";
import { OAuth2Client } from "google-auth-library";
import { findOrHydrateGoogleUser, REDIRECT_URI, type GoogleUserInfo } from "./auth.js";
import * as projectService from "../projects/project-service.js";
import { logAction } from "../logging/audit-service.js";
import { mcpRestBaseUrl } from "../vps/mcp-config-merge.js";
import { checkSsoReturnUrl } from "../vps/vps-sso-origin.js";
import { getVpsSsoJwks, isVpsSsoAvailable, signVpsSsoAssertion } from "../vps/vps-sso-keys.js";

export const VPS_SSO_START_PATH = "/auth/vps/start";
export const VPS_SSO_JWKS_PATH = "/api/vps/sso/jwks";
const CALLBACK_PATH = "/auth/callback";
/** Prefix of the OAuth `state` for a server sign-in; genie sign-ins send none. */
const STATE_PREFIX = "vps.";
export const VPS_SSO_COOKIE = "genie_vps_sso";
const PENDING_TTL_MS = 10 * 60_000;
/** Unauthenticated starts can't grow memory without bound. */
const MAX_PENDING = 1000;
export const VPS_SSO_ASSERTION_TTL_S = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** genie-local sends 32 random bytes as base64url (43 chars). */
const NONCE_RE = /^[A-Za-z0-9_-]{22,128}$/;
const INSTANCE_RE = /^[A-Za-z0-9_-]{1,100}$/;

interface PendingVpsSso {
  oauth2Client: OAuth2Client;
  projectId: string;
  instanceId: string;
  nonce: string;
  returnUrl: string;
  expiresAt: number;
}

const pending = new Map<string, PendingVpsSso>();

function prunePending(now: number): void {
  for (const [k, v] of pending) if (v.expiresAt <= now) pending.delete(k);
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
}

/** The manager URL a server knows (the stats drop-in's GENIE_MANAGER_URL). */
export function vpsSsoIssuer(): string {
  return mcpRestBaseUrl().replace(/\/+$/, "");
}

// ── Responses ────────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function sendPage(res: http.ServerResponse, status: number, title: string, message: string): void {
  res.writeHead(status, {
    ...BASE_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title></head>` +
      `<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1e1e2e;color:#cdd6f4">` +
      `<div style="text-align:center;max-width:32rem;padding:1rem"><h2>${esc(title)}</h2><p style="color:#a6adc8">${esc(message)}</p></div></body></html>`,
  );
}

/** The page that carries the assertion: a form auto-POSTed to the return URL. */
function sendAssertionPage(res: http.ServerResponse, returnUrl: string, returnOrigin: string, assertion: string): void {
  const nonce = crypto.randomBytes(16).toString("base64");
  res.writeHead(200, {
    ...BASE_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy":
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; ` +
      `form-action ${returnOrigin}; base-uri 'none'; frame-ancestors 'none'`,
  });
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Signing in…</title>` +
      `<style nonce="${nonce}">body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1e1e2e;color:#cdd6f4}button{font:inherit;padding:.4rem 1rem}</style></head>` +
      `<body><form method="post" action="${esc(returnUrl)}"><input type="hidden" name="assertion" value="${esc(assertion)}">` +
      `<noscript><p>Continue to the server.</p><button type="submit">Continue</button></noscript></form>` +
      `<script nonce="${nonce}">document.forms[0].submit();</script></body></html>`,
  );
}

function clientIp(req: http.IncomingMessage): string | undefined {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress || undefined;
}

function readCookie(req: http.IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function sameString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function stateCookie(value: string, maxAge: number): string {
  const secure = REDIRECT_URI.startsWith("https://") ? "; Secure" : "";
  return `${VPS_SSO_COOKIE}=${value}; HttpOnly${secure}; SameSite=Lax; Path=/auth; Max-Age=${maxAge}`;
}

// ── /auth/vps/start ──────────────────────────────────────────────────────────

async function handleStart(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("project") ?? "";
  const instanceId = url.searchParams.get("instance") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const returnRaw = url.searchParams.get("return");
  const refuse = (reason: string, message: string) => {
    console.warn(`[vps-sso] start refused (${reason}) project=${projectId.slice(0, 36)} instance=${instanceId.slice(0, 100)}`);
    sendPage(res, 400, "Can't sign in to this server", message);
  };

  if (!UUID_RE.test(projectId) || !INSTANCE_RE.test(instanceId)) {
    refuse("bad ids", "This sign-in link is not valid.");
    return;
  }
  if (!NONCE_RE.test(nonce)) {
    refuse("nonce", "This sign-in link is not valid.");
    return;
  }
  const project = await projectService.getById(projectId);
  const instance = project?.vpsInstances.find((v) => v.id === instanceId);
  if (!instance) {
    refuse("unknown instance", "Genie doesn't know this server.");
    return;
  }
  const ret = checkSsoReturnUrl(returnRaw, instance);
  if (!ret.ok) {
    refuse(ret.reason, ret.reason === "no origin"
      ? "Genie doesn't know this server's address yet. A project owner can set its sign-in origin on the project's Servers tab."
      : "This sign-in link doesn't point back to the server Genie knows.");
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !isVpsSsoAvailable()) {
    console.warn("[vps-sso] start refused: Google OAuth or the manager secret (GENIE_SECRET) is not configured");
    sendPage(res, 503, "Sign in with Genie is unavailable", "Server sign-in is not configured on this Genie.");
    return;
  }

  const now = Date.now();
  prunePending(now);
  const state = `${STATE_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const oauth2Client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });
  pending.set(state, { oauth2Client, projectId, instanceId, nonce, returnUrl: ret.url, expiresAt: now + PENDING_TTL_MS });
  res.writeHead(302, {
    ...BASE_HEADERS,
    "Set-Cookie": stateCookie(state, PENDING_TTL_MS / 1000),
    Location: authUrl,
  });
  res.end();
}

// ── /auth/callback with a vps.* state ────────────────────────────────────────

async function handleCallback(req: http.IncomingMessage, res: http.ServerResponse, url: URL, state: string): Promise<void> {
  const entry = pending.get(state);
  pending.delete(state); // one use, whatever happens next
  const cookie = readCookie(req, VPS_SSO_COOKIE);
  res.setHeader("Set-Cookie", stateCookie("", 0));
  if (!entry || entry.expiresAt <= Date.now()) {
    sendPage(res, 400, "This sign-in has expired", "Start again from the server's login page.");
    return;
  }
  if (!cookie || !sameString(cookie, state)) {
    console.warn(`[vps-sso] callback without the browser's state cookie · ${entry.projectId}:${entry.instanceId}`);
    sendPage(res, 400, "Can't finish this sign-in", "It was started in a different browser. Start again from the server's login page.");
    return;
  }
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) {
    sendPage(res, 400, "Sign-in cancelled", "Google sign-in did not complete. Start again from the server's login page.");
    return;
  }

  let userInfo: GoogleUserInfo;
  try {
    const { tokens } = await entry.oauth2Client.getToken(code);
    entry.oauth2Client.setCredentials(tokens);
    userInfo = (await entry.oauth2Client.request<GoogleUserInfo>({ url: "https://www.googleapis.com/oauth2/v3/userinfo" })).data;
  } catch (err: unknown) {
    console.error("[vps-sso] Google exchange failed:", err instanceof Error ? err.message : String(err));
    sendPage(res, 502, "Sign-in failed", "Google sign-in could not be completed. Try again.");
    return;
  }
  await completeVpsSignIn(req, res, entry, userInfo);
}

/** After Google: membership, then the assertion. Exported for tests. */
export async function completeVpsSignIn(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  entry: Pick<PendingVpsSso, "projectId" | "instanceId" | "nonce" | "returnUrl">,
  userInfo: GoogleUserInfo,
): Promise<void> {
  const ip = clientIp(req);
  const { projectId, instanceId } = entry;
  const email = (userInfo.email ?? "").trim().toLowerCase();
  const deny = async (userId: string | null, userName: string | null, reason: string) => {
    await logAction(userId, userName, "auth:vps:denied", { projectId, instanceId, email, reason }, ip);
    sendPage(res, 403, "You're not a member of this server's project", "Ask a project owner in Genie to add you, then sign in again.");
  };

  if (!userInfo.sub || !email || userInfo.email_verified !== true) {
    await logAction(null, userInfo.name ?? null, "auth:vps:denied", { projectId, instanceId, email, reason: "email_not_verified" }, ip);
    sendPage(res, 403, "Can't sign in with this Google account", "Google hasn't verified this account's email address.");
    return;
  }
  const user = await findOrHydrateGoogleUser(userInfo);
  if (!user) return deny(null, userInfo.name ?? null, "no_genie_user");
  if (user.isAgent || !user.validated) return deny(user.id, user.name, "not_validated");

  // The instance and its known hosts may have changed during the Google round trip.
  const project = await projectService.getById(projectId);
  const instance = project?.vpsInstances.find((v) => v.id === instanceId);
  const ret = instance ? checkSsoReturnUrl(entry.returnUrl, instance) : null;
  if (!instance || !ret?.ok) {
    sendPage(res, 400, "Can't sign in to this server", "This server is no longer attached to the project, or its address changed.");
    return;
  }
  if (!(await projectService.userCanSeeProject(user.id, projectId))) return deny(user.id, user.name, "not_member");

  const iat = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const assertion = await signVpsSsoAssertion({
    iss: vpsSsoIssuer(),
    aud: `genie-vps:${instanceId}`,
    sub: user.id,
    email,
    name: user.name,
    project: projectId,
    nonce: entry.nonce,
    iat,
    exp: iat + VPS_SSO_ASSERTION_TTL_S,
    jti,
  });
  await logAction(user.id, user.name, "auth:vps:assertion", { projectId, instanceId, email, jti, returnHost: new URL(ret.url).host }, ip);
  sendAssertionPage(res, ret.url, ret.origin, assertion);
}

// ── Router ───────────────────────────────────────────────────────────────────

/** Handle the server sign-in routes; false when the request isn't one of them
 *  (a genie sign-in's /auth/callback carries no vps.* state and falls through). */
export async function handleVpsSsoRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  if (!req.url) return false;
  let url: URL;
  try {
    url = new URL(req.url, "http://manager.invalid");
  } catch {
    return false;
  }
  try {
    if (url.pathname === VPS_SSO_JWKS_PATH && req.method === "GET") {
      const jwks = await getVpsSsoJwks();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" });
      res.end(JSON.stringify(jwks));
      return true;
    }
    if (url.pathname === VPS_SSO_START_PATH && req.method === "GET") {
      await handleStart(req, res, url);
      return true;
    }
    const state = url.searchParams.get("state");
    if (url.pathname === CALLBACK_PATH && state?.startsWith(STATE_PREFIX)) {
      await handleCallback(req, res, url, state);
      return true;
    }
  } catch (err: unknown) {
    console.error("[vps-sso] request failed:", err instanceof Error ? err.message : String(err));
    if (!res.headersSent) sendPage(res, 500, "Sign-in failed", "Something went wrong. Try again.");
    return true;
  }
  return false;
}
