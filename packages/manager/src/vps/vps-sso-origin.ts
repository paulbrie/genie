// Where a genie-local server may receive its "Sign in with Genie" assertion.
//
// The manager never trusts the request for this: the `return` URL handed to
// /auth/vps/start must point at a host genie itself knows for that instance,
// i.e. its attached domain (`domain` / `domainUrl`, mirrored from the provider)
// or the per-instance `ssoOrigin` a project manager set in the UI. An instance
// with neither refuses server sign-in until one is set. Pure helpers.

import type { VpsInstance } from "../types.js";

/** genie-local's callback path, under its basePath (e.g. /admin). */
export const VPS_SSO_CALLBACK_SUFFIX = "/api/auth/genie/callback";

/** Normalise a user-entered origin to `https://host[:port]`. A bare host gets
 *  https:// in front. Throws on anything else (http, a path, credentials…). */
export function normalizeSsoOrigin(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("Origin is empty");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error("Not a valid origin");
  }
  if (u.protocol !== "https:") throw new Error("The origin must use https://");
  if (u.username || u.password) throw new Error("The origin must not contain credentials");
  if ((u.pathname && u.pathname !== "/") || u.search || u.hash || /[?#]/.test(raw)) {
    throw new Error("Only the origin (https://host[:port]), without a path");
  }
  if (!u.hostname || u.hostname.includes("*")) throw new Error("Not a valid host");
  return u.origin; // lowercased host, default port dropped
}

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Hosts (URL.host, so with a non-default port) a server sign-in may return to. */
export function allowedSsoReturnHosts(instance: Pick<VpsInstance, "domain" | "domainUrl" | "ssoOrigin">): Set<string> {
  const hosts = new Set<string>();
  for (const h of [hostOf(instance.ssoOrigin), hostOf(instance.domain), hostOf(instance.domainUrl)]) {
    if (h) hosts.add(h);
  }
  return hosts;
}

/** The public origin written to the server's identity file, or null. */
export function instancePublicOrigin(instance: Pick<VpsInstance, "domain" | "domainUrl" | "ssoOrigin">): string | null {
  if (instance.ssoOrigin) return instance.ssoOrigin;
  const h = hostOf(instance.domain) ?? hostOf(instance.domainUrl);
  return h ? `https://${h}` : null;
}

export type ReturnUrlCheck = { ok: true; url: string; origin: string } | { ok: false; reason: string };

/** Check `return` against what genie knows for the instance: https, no
 *  credentials / query / fragment, an allowed host, and genie-local's callback
 *  path (any basePath in front). */
export function checkSsoReturnUrl(
  raw: string | null | undefined,
  instance: Pick<VpsInstance, "domain" | "domainUrl" | "ssoOrigin">,
): ReturnUrlCheck {
  if (!raw) return { ok: false, reason: "missing return" };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "bad return" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "return not https" };
  if (u.username || u.password) return { ok: false, reason: "return has credentials" };
  if (u.search || u.hash || raw.includes("?") || raw.includes("#")) return { ok: false, reason: "return has query" };
  if (!u.pathname.endsWith(VPS_SSO_CALLBACK_SUFFIX)) return { ok: false, reason: "return path" };
  const allowed = allowedSsoReturnHosts(instance);
  if (allowed.size === 0) return { ok: false, reason: "no origin" };
  if (!allowed.has(u.host.toLowerCase())) return { ok: false, reason: "return host" };
  return { ok: true, url: u.href, origin: u.origin };
}
