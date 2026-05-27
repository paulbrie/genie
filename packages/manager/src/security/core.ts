import { v4 as uuidv4 } from "uuid";
import { COMMON_PATHS, HTTP_PORTS, TOP_PORTS } from "./constants.js";
import { scanPorts } from "./scan-ports.js";
import type { PortResult, ScanCallbacks, SecurityScan } from "./types.js";
import { httpRequest, logOp } from "./util.js";
import { checkHeaders } from "./checks/headers.js";
import { enumerateDirectories } from "./checks/directory.js";
import { checkSsl } from "./checks/ssl.js";
import { checkSqlInjection, checkXssReflection } from "./checks/injection.js";
import { checkOpenRedirects } from "./checks/redirect.js";
import { checkCorsMisconfiguration } from "./checks/cors.js";
import { checkCookieSecurity } from "./checks/cookies.js";
import { checkHttpMethods } from "./checks/methods.js";
import { checkHostHeaderInjection } from "./checks/host-header.js";

/** Parse a target string which may be an IP, hostname, or full URL. Returns
 *  the bare hostname for TCP scanning and optional scheme/port hints. */
function parseTarget(raw: string): { hostname: string; scheme?: string; explicitPort?: number } {
  const trimmed = raw.trim();
  // If it looks like a URL (has ://), parse it
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return {
        hostname: url.hostname,
        scheme: url.protocol.replace(":", ""),
        explicitPort: url.port ? parseInt(url.port, 10) : undefined,
      };
    } catch {
      // Fall through to plain hostname extraction
    }
  }
  // Strip any trailing path/port: "host:port/path" → "host"
  const noPath = trimmed.split("/")[0];
  const colonIdx = noPath.lastIndexOf(":");
  if (colonIdx > 0) {
    const portStr = noPath.slice(colonIdx + 1);
    const port = parseInt(portStr, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      return { hostname: noPath.slice(0, colonIdx), explicitPort: port };
    }
  }
  return { hostname: noPath };
}

/** Run the full two-phase scan (port scan → web checks) against `target`.
 *  Aborts cleanly when `callbacks.signal` fires. Returns the final scan
 *  record; the same record is streamed incrementally via `callbacks.onProgress`. */
export async function runSecurityScan(target: string, callbacks: ScanCallbacks): Promise<SecurityScan> {
  const parsed = parseTarget(target);
  const hostname = parsed.hostname;

  const scan: SecurityScan = {
    id: uuidv4(),
    target,
    status: "running",
    startedAt: Date.now(),
    progress: 0,
    phase: "Initializing",
    ports: [],
    findings: [],
    operations: [],
  };

  callbacks.onProgress({ id: scan.id, status: "running", startedAt: scan.startedAt, phase: "Port scanning", progress: 0 });
  logOp(scan, callbacks, `Starting security scan on ${target} (host: ${hostname})`);

  try {
    // Phase 1: Port scanning
    logOp(scan, callbacks, `Beginning TCP port scan (${new Set(TOP_PORTS).size} ports)`);
    await scanPorts(hostname, scan, callbacks);
    if (callbacks.signal.aborted) {
      logOp(scan, callbacks, "Scan aborted by user");
      scan.status = "stopping";
      scan.completedAt = Date.now();
      return scan;
    }
    logOp(scan, callbacks, `Port scan complete — ${scan.ports.length} open port(s) found`);

    // Phase 2: Web vulnerability checks
    // Start with discovered HTTP ports from the scan
    const httpPorts = scan.ports.filter((p) => p.state === "open" && HTTP_PORTS.has(p.port));
    const includedPorts = new Set(httpPorts.map((p) => p.port));

    // Always probe standard HTTP/HTTPS even if port scan didn't detect them
    // (CDNs, load balancers, cloud proxies often don't respond to raw TCP SYN)
    const alwaysProbe: { port: number; service: string }[] = [
      { port: 80, service: "http" },
      { port: 443, service: "https" },
    ];

    // If target had an explicit port, include that too
    if (parsed.explicitPort && !includedPorts.has(parsed.explicitPort)) {
      alwaysProbe.push({ port: parsed.explicitPort, service: parsed.scheme === "https" ? "https" : "http" });
    }

    for (const { port, service } of alwaysProbe) {
      if (includedPorts.has(port)) continue;
      // Quick HTTP probe to see if the service responds
      const isHttps = port === 443 || port === 8443 || port === 4443 || service === "https";
      const probeUrl = `${isHttps ? "https" : "http"}://${hostname}${port === 80 || port === 443 ? "" : `:${port}`}/`;
      const probeResp = await httpRequest(probeUrl, "HEAD", 3000);
      if (probeResp && probeResp.status > 0) {
        logOp(scan, callbacks, `HTTP probe: ${probeUrl} responds (HTTP ${probeResp.status})`);
        httpPorts.push({ port, state: "open", service });
        includedPorts.add(port);
      }
    }

    if (httpPorts.length > 0) {
      logOp(scan, callbacks, `Starting web vulnerability checks on ${httpPorts.length} HTTP service(s)`);
      await runWebChecks(hostname, httpPorts, scan, callbacks);
      logOp(scan, callbacks, `Web checks complete — ${scan.findings.length} finding(s) total`);
    } else {
      logOp(scan, callbacks, "No HTTP services detected, skipping web vulnerability checks");
    }

    scan.status = "completed";
    scan.completedAt = Date.now();
    scan.progress = 100;
    scan.phase = "Complete";
    logOp(scan, callbacks, `Scan finished: ${scan.ports.length} open ports, ${scan.findings.length} findings`);
    callbacks.onProgress({ id: scan.id, status: "completed", completedAt: scan.completedAt, progress: 100, phase: "Complete" });
  } catch (err: unknown) {
    scan.status = "error";
    scan.error = err instanceof Error ? err.message : String(err);
    scan.completedAt = Date.now();
    logOp(scan, callbacks, `Scan error: ${scan.error}`);
    callbacks.onProgress({ id: scan.id, status: "error", error: scan.error, completedAt: scan.completedAt });
  }

  return scan;
}

/** Loop the per-host web checks across every HTTP port we found. Each
 *  individual check lives in `./checks/*` — this only sequences them and
 *  updates the phase string so the UI can show what's running. */
async function runWebChecks(host: string, httpPorts: PortResult[], scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const totalPhases = 9;
  let completedPhases = 0;

  for (const portResult of httpPorts) {
    if (callbacks.signal.aborted) return;

    const isHttps = portResult.port === 443 || portResult.port === 8443 || portResult.port === 4443;
    const protocol = isHttps ? "https" : "http";
    const portSuffix = (portResult.port === 80 || portResult.port === 443) ? "" : `:${portResult.port}`;
    const baseUrl = `${protocol}://${host}${portSuffix}`;

    // Phase 2a: Header security checks
    scan.phase = `Checking headers (${baseUrl})`;
    scan.progress = 50 + Math.round((completedPhases / totalPhases) * 50 / httpPorts.length);
    logOp(scan, callbacks, `Checking security headers on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase, progress: scan.progress });

    await checkHeaders(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2b: Directory enumeration
    scan.phase = `Directory scan (${baseUrl})`;
    logOp(scan, callbacks, `Enumerating ${COMMON_PATHS.length} common paths on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await enumerateDirectories(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2c: SSL/TLS analysis (only for HTTPS)
    if (isHttps) {
      scan.phase = `SSL/TLS analysis (${baseUrl})`;
      logOp(scan, callbacks, `Analyzing SSL/TLS certificate on ${host}:${portResult.port}`);
      callbacks.onProgress({ id: scan.id, phase: scan.phase });

      await checkSsl(host, portResult.port, scan, callbacks);
    }
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2d: SQL injection check
    scan.phase = `SQL injection check (${baseUrl})`;
    logOp(scan, callbacks, `Testing SQL injection vectors on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await checkSqlInjection(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2e: XSS reflection check
    scan.phase = `XSS reflection check (${baseUrl})`;
    logOp(scan, callbacks, `Testing XSS reflection on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await checkXssReflection(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2f: Open redirect check
    scan.phase = `Open redirect check (${baseUrl})`;
    logOp(scan, callbacks, `Testing open redirect parameters on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await checkOpenRedirects(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2g: CORS misconfiguration check
    scan.phase = `CORS check (${baseUrl})`;
    logOp(scan, callbacks, `Testing CORS configuration on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await checkCorsMisconfiguration(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2h: Cookie security check
    scan.phase = `Cookie security check (${baseUrl})`;
    logOp(scan, callbacks, `Checking cookie security attributes on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await checkCookieSecurity(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2i: HTTP method enumeration
    scan.phase = `HTTP methods check (${baseUrl})`;
    logOp(scan, callbacks, `Enumerating HTTP methods on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await checkHttpMethods(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2j: Host header injection
    scan.phase = `Host header injection check (${baseUrl})`;
    logOp(scan, callbacks, `Testing host header injection on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await checkHostHeaderInjection(baseUrl, scan, callbacks);
    if (callbacks.signal.aborted) return;
  }
}
