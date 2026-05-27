import { v4 as uuidv4 } from "uuid";
import type { ScanCallbacks, SecurityScan } from "../types.js";
import { httpRequest, logOp } from "../util.js";

/** Swap in an attacker-controlled Host (and X-Forwarded-Host) header and
 *  look for the value bouncing back in the body or in a redirect Location —
 *  the building blocks of password-reset poisoning, cache poisoning, and
 *  OAuth hijacking. */
export async function checkHostHeaderInjection(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const evilHost = "evil.example.com";

  // Test 1: Replace Host header entirely
  const resp = await httpRequest(baseUrl, "GET", 5000, false, { "Host": evilHost });
  if (!resp) return;

  if (resp.body.includes(evilHost)) {
    scan.findings.push({
      id: uuidv4(),
      category: "host",
      severity: "medium",
      title: "Host Header Reflected in Response Body",
      description: "The server reflects the Host header value in the response body. This can enable cache poisoning, password reset poisoning, and phishing via manipulated links.",
      url: baseUrl,
      evidence: `Host: ${evilHost} reflected in response body`,
    });
    logOp(scan, callbacks, "[MEDIUM] Host header reflected in response body");
    callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
  }

  if (resp.redirectUrl?.includes(evilHost)) {
    scan.findings.push({
      id: uuidv4(),
      category: "host",
      severity: "high",
      title: "Host Header Injection in Redirect",
      description: "The server uses the Host header to construct redirect URLs. An attacker can redirect users to a malicious domain (password reset poisoning, OAuth hijacking).",
      url: baseUrl,
      evidence: `Location: ${resp.redirectUrl}`,
    });
    logOp(scan, callbacks, "[HIGH] Host header injection — redirect to attacker domain");
    callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
  }

  if (callbacks.signal.aborted) return;

  // Test 2: X-Forwarded-Host header (bypasses some Host header validation)
  const resp2 = await httpRequest(baseUrl, "GET", 5000, false, { "X-Forwarded-Host": evilHost });
  if (resp2 && resp2.body.includes(evilHost)) {
    scan.findings.push({
      id: uuidv4(),
      category: "host",
      severity: "medium",
      title: "X-Forwarded-Host Header Injection",
      description: "The server trusts the X-Forwarded-Host header and reflects it in responses. This can enable cache poisoning and link manipulation behind reverse proxies.",
      url: baseUrl,
      evidence: `X-Forwarded-Host: ${evilHost} reflected in response body`,
    });
    logOp(scan, callbacks, "[MEDIUM] X-Forwarded-Host header reflected in response body");
    callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
  }
}
