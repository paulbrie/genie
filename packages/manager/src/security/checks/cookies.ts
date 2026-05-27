import { v4 as uuidv4 } from "uuid";
import type { ScanCallbacks, SecurityScan } from "../types.js";
import { httpRequest, logOp } from "../util.js";

/** For each Set-Cookie, flag missing Secure / HttpOnly / SameSite attributes.
 *  Skips tracking/analytics cookies (when there are 4+ total) so we focus on
 *  session-shaped cookie names — keeps the noise down on cookie-heavy sites. */
export async function checkCookieSecurity(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const resp = await httpRequest(baseUrl, "GET", 5000);
  if (!resp) return;

  const setCookieRaw = resp.headers["set-cookie"];
  if (!setCookieRaw) return;

  // Split on newline (we joined with \n in httpRequest for Set-Cookie)
  const cookies = setCookieRaw.split("\n").filter(Boolean);

  for (const cookie of cookies) {
    const cookieName = cookie.split("=")[0].trim();
    const lower = cookie.toLowerCase();

    // Skip tracking/analytics cookies — focus on session/auth cookies
    const isLikelySession = /sess|token|auth|jwt|sid|login|user/i.test(cookieName);
    if (!isLikelySession && cookies.length > 3) continue;

    if (!lower.includes("secure")) {
      scan.findings.push({
        id: uuidv4(),
        category: "cookie",
        severity: "medium",
        title: `Cookie Missing Secure Flag: ${cookieName}`,
        description: `The "${cookieName}" cookie is not marked as Secure. It will be sent over unencrypted HTTP connections, allowing interception.`,
        url: baseUrl,
        evidence: cookie.slice(0, 200),
      });
      logOp(scan, callbacks, `[MEDIUM] Cookie "${cookieName}" missing Secure flag`);
    }

    if (!lower.includes("httponly")) {
      scan.findings.push({
        id: uuidv4(),
        category: "cookie",
        severity: "medium",
        title: `Cookie Missing HttpOnly Flag: ${cookieName}`,
        description: `The "${cookieName}" cookie is not marked as HttpOnly. It can be accessed via JavaScript, increasing XSS impact.`,
        url: baseUrl,
        evidence: cookie.slice(0, 200),
      });
      logOp(scan, callbacks, `[MEDIUM] Cookie "${cookieName}" missing HttpOnly flag`);
    }

    if (!lower.includes("samesite")) {
      scan.findings.push({
        id: uuidv4(),
        category: "cookie",
        severity: "low",
        title: `Cookie Missing SameSite Attribute: ${cookieName}`,
        description: `The "${cookieName}" cookie has no SameSite attribute. Browsers default to Lax, but explicit setting is recommended for CSRF protection.`,
        url: baseUrl,
        evidence: cookie.slice(0, 200),
      });
      logOp(scan, callbacks, `[LOW] Cookie "${cookieName}" missing SameSite attribute`);
    }

    callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
  }
}
