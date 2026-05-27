import { v4 as uuidv4 } from "uuid";
import { SQL_ERROR_PATTERNS } from "../constants.js";
import type { ScanCallbacks, SecurityScan } from "../types.js";
import { httpRequest, logOp } from "../util.js";

/** Inject SQL meta-characters into common query parameters and look for
 *  database error fingerprints in the response. Also falls through to a
 *  time-based blind probe (SLEEP/WAITFOR/pg_sleep) when no error leaked. */
export async function checkSqlInjection(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const testPaths = ["/", "/search", "/login", "/api", "/api/v1", "/admin"];
  const payloads = ["'", "' OR 1=1--", "\" OR 1=1--", "1' UNION SELECT NULL--", "' AND 1=1--", "1; DROP TABLE test--"];

  let foundError = false;

  for (const pathStr of testPaths) {
    if (callbacks.signal.aborted || foundError) return;

    for (const payload of payloads) {
      const url = `${baseUrl}${pathStr}?q=${encodeURIComponent(payload)}&id=${encodeURIComponent(payload)}`;
      const resp = await httpRequest(url, "GET", 3000);
      if (!resp) continue;

      for (const pattern of SQL_ERROR_PATTERNS) {
        if (pattern.test(resp.body)) {
          scan.findings.push({
            id: uuidv4(),
            category: "sqli",
            severity: "critical",
            title: `Potential SQL Injection: ${pathStr}`,
            description: `SQL error detected in response when injecting test payload. The application may be vulnerable to SQL injection.`,
            url,
            evidence: resp.body.match(pattern)?.[0] || "SQL error pattern matched",
          });
          logOp(scan, callbacks, `[CRITICAL] SQL injection detected at ${pathStr} — SQL error in response`);
          callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
          foundError = true;
          break;
        }
      }
      if (foundError) break;
    }
  }

  // Time-based blind SQL injection detection
  if (!foundError && !callbacks.signal.aborted) {
    const blindPaths = ["/", "/search", "/login", "/api"];
    const sleepPayloads = ["' OR SLEEP(2)--", "1; WAITFOR DELAY '0:0:2'--", "' OR pg_sleep(2)--"];

    for (const pathStr of blindPaths) {
      if (callbacks.signal.aborted) return;

      for (const payload of sleepPayloads) {
        const url = `${baseUrl}${pathStr}?q=${encodeURIComponent(payload)}&id=${encodeURIComponent(payload)}`;
        const start = Date.now();
        const resp = await httpRequest(url, "GET", 8000);
        const elapsed = Date.now() - start;

        if (resp && elapsed > 1800) {
          // Verify with a normal request to rule out slow server
          const verifyStart = Date.now();
          await httpRequest(`${baseUrl}${pathStr}?q=test&id=1`, "GET", 5000);
          const verifyElapsed = Date.now() - verifyStart;

          if (elapsed > verifyElapsed * 3 && elapsed > 1800) {
            scan.findings.push({
              id: uuidv4(),
              category: "sqli",
              severity: "critical",
              title: `Time-Based Blind SQL Injection: ${pathStr}`,
              description: `Response delayed by ~${Math.round(elapsed / 1000)}s with sleep payload (normal: ~${Math.round(verifyElapsed / 1000)}s). Indicates potential blind SQL injection.`,
              url,
              evidence: `Sleep payload response: ${elapsed}ms vs normal: ${verifyElapsed}ms`,
            });
            logOp(scan, callbacks, `[CRITICAL] Time-based blind SQLi at ${pathStr} — ${elapsed}ms delay`);
            callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
            return;
          }
        }
      }
    }
  }
}

/** Reflected-XSS + Server-Side Template Injection probe. First tries common
 *  XSS payloads to see if user input bounces back unencoded; then tries
 *  template syntax (`{{7*7}}`, `${7*7}`, `<%=7*7%>`) and looks for the
 *  evaluated result without the raw payload — a strong SSTI signal. */
export async function checkXssReflection(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const testPaths = ["/", "/search", "/api"];
  const xssPayloads: { payload: string; label: string }[] = [
    { payload: "<script>alert(1)</script>", label: "script tag" },
    { payload: "\"><img src=x onerror=alert(1)>", label: "attribute breakout (img onerror)" },
    { payload: "'-alert(1)-'", label: "JavaScript context breakout" },
  ];

  for (const pathStr of testPaths) {
    if (callbacks.signal.aborted) return;

    for (const { payload, label } of xssPayloads) {
      const encoded = encodeURIComponent(payload);
      const url = `${baseUrl}${pathStr}?q=${encoded}&search=${encoded}`;
      const resp = await httpRequest(url, "GET", 3000);
      if (!resp) continue;

      if (resp.body.includes(payload)) {
        scan.findings.push({
          id: uuidv4(),
          category: "xss",
          severity: "high",
          title: `Reflected XSS: ${pathStr}`,
          description: `The application reflects user input without encoding (${label}). An attacker could inject malicious scripts.`,
          url,
          evidence: `Payload "${payload}" reflected in response body`,
        });
        logOp(scan, callbacks, `[HIGH] Reflected XSS at ${pathStr} — ${label} payload reflected`);
        callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
        break; // One XSS per path is enough
      }
    }
  }

  // Server-Side Template Injection (SSTI) detection
  if (!callbacks.signal.aborted) {
    const sstiPayloads: { payload: string; expected: string; engine: string }[] = [
      { payload: "{{7*7}}", expected: "49", engine: "Jinja2/Twig/Angular" },
      { payload: "${7*7}", expected: "49", engine: "FreeMarker/Mako" },
      { payload: "<%=7*7%>", expected: "49", engine: "ERB/JSP" },
    ];

    for (const pathStr of testPaths) {
      if (callbacks.signal.aborted) return;

      for (const { payload, expected, engine } of sstiPayloads) {
        const encoded = encodeURIComponent(payload);
        const url = `${baseUrl}${pathStr}?q=${encoded}&name=${encoded}`;
        const resp = await httpRequest(url, "GET", 3000);
        if (!resp) continue;

        // Check if the template was evaluated (e.g., {{7*7}} → 49) but the raw payload is NOT in the response
        if (resp.body.includes(expected) && !resp.body.includes(payload)) {
          scan.findings.push({
            id: uuidv4(),
            category: "ssti",
            severity: "critical",
            title: `Server-Side Template Injection: ${pathStr}`,
            description: `Template expression "${payload}" was evaluated to "${expected}" by the server. This indicates ${engine} template injection, which can lead to remote code execution.`,
            url,
            evidence: `Input: ${payload} → Output contains: ${expected}`,
          });
          logOp(scan, callbacks, `[CRITICAL] SSTI at ${pathStr} — ${engine} template evaluated`);
          callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
          break;
        }
      }
    }
  }
}
