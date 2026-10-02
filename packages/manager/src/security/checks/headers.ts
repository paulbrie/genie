import { v4 as uuidv4 } from "uuid";
import { DISCLOSURE_HEADERS, SECURITY_HEADERS } from "../constants.js";
import type { ScanCallbacks, SecurityScan, WebFinding } from "../types.js";
import { httpRequest, logOp } from "../util.js";

/** Flag missing security headers (HSTS, CSP, X-Frame-Options, …) and any
 *  technology-disclosure headers (Server, X-Powered-By, …). */
export async function checkHeaders(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const resp = await httpRequest(baseUrl, "GET", 5000);
  if (!resp) {
    logOp(scan, callbacks, `No response from ${baseUrl}, skipping header checks`);
    return;
  }

  logOp(scan, callbacks, `Received HTTP ${resp.status} from ${baseUrl}, analyzing headers`);

  // Check missing security headers
  for (const check of SECURITY_HEADERS) {
    if (!resp.headers[check.header]) {
      const finding: WebFinding = {
        id: uuidv4(),
        category: "header",
        severity: check.severity,
        title: check.title,
        description: check.description,
        url: baseUrl,
      };
      scan.findings.push(finding);
      logOp(scan, callbacks, `[${check.severity.toUpperCase()}] ${check.title}`);
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    }
  }

  // Check disclosure headers
  for (const hdr of DISCLOSURE_HEADERS) {
    if (resp.headers[hdr]) {
      const finding: WebFinding = {
        id: uuidv4(),
        category: "disclosure",
        severity: "low",
        title: `Information Disclosure: ${hdr}`,
        description: `The ${hdr} header reveals server technology information.`,
        url: baseUrl,
        evidence: `${hdr}: ${resp.headers[hdr]}`,
      };
      scan.findings.push(finding);
      logOp(scan, callbacks, `[LOW] Server discloses ${hdr}: ${resp.headers[hdr]}`);
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    }
  }
}
