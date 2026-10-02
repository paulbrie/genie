import { v4 as uuidv4 } from "uuid";
import type { ScanCallbacks, SecurityScan } from "../types.js";
import { httpRequest, logOp } from "../util.js";

/** OPTIONS-probe the server's allowed methods, flag dangerous ones (TRACE,
 *  PUT, DELETE, CONNECT). Then verify TRACE directly — some servers don't
 *  list it in OPTIONS but still echo requests, enabling Cross-Site Tracing. */
export async function checkHttpMethods(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  // Send OPTIONS to discover allowed methods
  const resp = await httpRequest(baseUrl, "OPTIONS", 5000);
  if (resp) {
    const allow = resp.headers["allow"] || resp.headers["access-control-allow-methods"];
    if (allow) {
      const methods = allow.split(",").map((m) => m.trim().toUpperCase());
      const dangerousMethods = ["TRACE", "PUT", "DELETE", "CONNECT"];
      const found = methods.filter((m) => dangerousMethods.includes(m));

      for (const method of found) {
        scan.findings.push({
          id: uuidv4(),
          category: "method",
          severity: method === "TRACE" ? "medium" : "low",
          title: `Dangerous HTTP Method Allowed: ${method}`,
          description: `The server allows the ${method} HTTP method. ${method === "TRACE" ? "TRACE can be used for Cross-Site Tracing (XST) attacks to steal credentials." : `${method} may allow unauthorized modification or deletion of resources.`}`,
          url: baseUrl,
          evidence: `Allow: ${allow}`,
        });
        logOp(scan, callbacks, `[${method === "TRACE" ? "MEDIUM" : "LOW"}] HTTP method ${method} allowed`);
      }
      if (found.length > 0) callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    }
  }

  if (callbacks.signal.aborted) return;

  // Verify TRACE directly (Cross-Site Tracing)
  const traceResp = await httpRequest(baseUrl, "TRACE", 3000);
  if (traceResp && traceResp.status === 200 && traceResp.body.toUpperCase().includes("TRACE")) {
    // Only add if not already found via OPTIONS
    if (!scan.findings.some((f) => f.category === "method" && f.title.includes("TRACE"))) {
      scan.findings.push({
        id: uuidv4(),
        category: "method",
        severity: "medium",
        title: "TRACE Method Enabled (Verified)",
        description: "The TRACE HTTP method is active and echoes request data. This enables Cross-Site Tracing (XST) attacks which can steal cookies and authorization headers.",
        url: baseUrl,
        evidence: `TRACE response (HTTP ${traceResp.status}): ${traceResp.body.slice(0, 200)}`,
      });
      logOp(scan, callbacks, "[MEDIUM] TRACE method active — Cross-Site Tracing possible");
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    }
  }
}
