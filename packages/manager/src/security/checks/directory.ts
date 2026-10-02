import { v4 as uuidv4 } from "uuid";
import { COMMON_PATHS, SENSITIVE_PATHS } from "../constants.js";
import type { ScanCallbacks, SecurityScan, Severity, WebFinding } from "../types.js";
import { httpRequest, logOp } from "../util.js";

/** HEAD-probe every COMMON_PATH (10 at a time). Skip noisy 404/3xx/401/403
 *  responses on non-sensitive paths so the findings list stays signal-heavy.
 *  Sensitive paths (`.env`, `.git`, …) are still flagged even when blocked. */
export async function enumerateDirectories(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const batchSize = 10;
  for (let i = 0; i < COMMON_PATHS.length; i += batchSize) {
    if (callbacks.signal.aborted) return;

    const batch = COMMON_PATHS.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (pathStr) => {
        const url = `${baseUrl}${pathStr}`;
        const resp = await httpRequest(url, "HEAD", 3000);
        return { pathStr, url, resp };
      }),
    );

    for (const { pathStr, url, resp } of results) {
      if (!resp || resp.status === 0) continue;

      const status = resp.status;
      const isSensitive = SENSITIVE_PATHS.has(pathStr) || pathStr.includes(".env") || pathStr.includes(".git");

      // Skip non-interesting responses:
      // - 404/410: not found
      // - 3xx redirects: almost always a generic redirect, not evidence of the path existing
      // - 400: bad request
      // - 401/403 on non-sensitive paths: generic deny, not interesting
      if (status === 404 || status === 410 || status === 400) continue;
      if (status >= 300 && status < 400) continue;
      if ((status === 401 || status === 403) && !isSensitive) continue;

      let severity: Severity = "info";
      let title = `Accessible path: ${pathStr}`;
      let description = `${pathStr} returned HTTP ${status}`;

      if (isSensitive) {
        // 403 on sensitive paths means it exists but is blocked — still noteworthy
        if (status === 403 || status === 401) {
          severity = "medium";
          title = `Sensitive path exists (blocked): ${pathStr}`;
          description = `${pathStr} returned HTTP ${status}. The file exists but access is denied. Verify it cannot be accessed via other means.`;
        } else {
          severity = "high";
          title = `Sensitive file exposed: ${pathStr}`;
          description = `${pathStr} is accessible (HTTP ${status}). This may expose sensitive configuration or source code.`;
        }
      } else if (pathStr.includes("admin") || pathStr.includes("phpmyadmin") || pathStr.includes("console")) {
        severity = "medium";
        title = `Admin interface found: ${pathStr}`;
        description = `${pathStr} is accessible (HTTP ${status}). Administrative interfaces should be restricted.`;
      } else if (pathStr.includes("backup") || pathStr.includes("dump") || pathStr.includes("debug")) {
        severity = "medium";
        title = `Potentially sensitive path: ${pathStr}`;
        description = `${pathStr} returned HTTP ${status}. This may contain sensitive data.`;
      }

      const finding: WebFinding = {
        id: uuidv4(),
        category: "directory",
        severity,
        title,
        description,
        url,
        evidence: `HTTP ${status}`,
      };
      scan.findings.push(finding);
      logOp(scan, callbacks, `[${severity.toUpperCase()}] ${pathStr} → HTTP ${status}`);
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    }
  }
}
