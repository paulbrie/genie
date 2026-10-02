import { v4 as uuidv4 } from "uuid";
import type { ScanCallbacks, SecurityScan } from "../types.js";
import { httpRequest, logOp } from "../util.js";

/** Detect three classic CORS misconfigurations: arbitrary origin reflection,
 *  origin reflection with credentials, and wildcard-with-credentials. Plus a
 *  separate probe for the `null` origin (exploitable via sandboxed iframes). */
export async function checkCorsMisconfiguration(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const evilOrigin = "https://evil.example.com";

  // Test 1: Arbitrary origin reflection
  const resp = await httpRequest(baseUrl, "GET", 5000, false, { "Origin": evilOrigin });
  if (resp) {
    const acao = resp.headers["access-control-allow-origin"];
    const acac = resp.headers["access-control-allow-credentials"];

    if (acao === evilOrigin && acac === "true") {
      scan.findings.push({
        id: uuidv4(),
        category: "cors",
        severity: "critical",
        title: "CORS: Origin Reflected with Credentials",
        description: "The server reflects arbitrary Origin headers in Access-Control-Allow-Origin and allows credentials. An attacker can steal authenticated data from any origin.",
        url: baseUrl,
        evidence: `Access-Control-Allow-Origin: ${acao}, Access-Control-Allow-Credentials: true`,
      });
      logOp(scan, callbacks, "[CRITICAL] CORS misconfiguration — arbitrary origin reflected with credentials");
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    } else if (acao === evilOrigin) {
      scan.findings.push({
        id: uuidv4(),
        category: "cors",
        severity: "high",
        title: "CORS: Arbitrary Origin Reflected",
        description: "The server reflects arbitrary Origin headers in Access-Control-Allow-Origin. Cross-origin pages can read responses from this server.",
        url: baseUrl,
        evidence: `Access-Control-Allow-Origin: ${acao}`,
      });
      logOp(scan, callbacks, "[HIGH] CORS misconfiguration — arbitrary origin reflected");
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    } else if (acao === "*" && acac === "true") {
      scan.findings.push({
        id: uuidv4(),
        category: "cors",
        severity: "high",
        title: "CORS: Wildcard with Credentials",
        description: "The server sets Access-Control-Allow-Origin: * with Access-Control-Allow-Credentials: true. While browsers reject this combination, it indicates a misconfigured CORS policy.",
        url: baseUrl,
        evidence: `Access-Control-Allow-Origin: *, Access-Control-Allow-Credentials: true`,
      });
      logOp(scan, callbacks, "[HIGH] CORS misconfiguration — wildcard with credentials");
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    }
  }

  if (callbacks.signal.aborted) return;

  // Test 2: null origin (exploitable via sandboxed iframes)
  const resp2 = await httpRequest(baseUrl, "GET", 5000, false, { "Origin": "null" });
  if (resp2) {
    const acao2 = resp2.headers["access-control-allow-origin"];
    if (acao2 === "null") {
      scan.findings.push({
        id: uuidv4(),
        category: "cors",
        severity: "high",
        title: "CORS: Null Origin Allowed",
        description: "The server allows the 'null' origin, which can be exploited via sandboxed iframes to bypass CORS restrictions.",
        url: baseUrl,
        evidence: `Access-Control-Allow-Origin: null`,
      });
      logOp(scan, callbacks, "[HIGH] CORS misconfiguration — null origin allowed");
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    }
  }
}
