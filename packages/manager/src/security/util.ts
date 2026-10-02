import type { ScanCallbacks, SecurityScan } from "./types.js";

/** Append a timestamped operation log entry and notify the caller. Every check
 *  module uses this to emit per-event progress lines that the UI renders as a
 *  live console. */
export function logOp(scan: SecurityScan, callbacks: ScanCallbacks, message: string): void {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const entry = `[${ts}] ${message}`;
  scan.operations.push(entry);
  callbacks.onProgress({ id: scan.id, operations: [...scan.operations] });
}

/** Minimal HTTP client used by every web check. Resolves to `null` on any
 *  network error so callers can `if (!resp) continue;` without try/catch.
 *  Body is capped at 50 KB to keep memory predictable across the scan. */
export async function httpRequest(
  url: string,
  method: string = "GET",
  timeoutMs: number = 5000,
  followRedirects: boolean = false,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string>; body: string; redirectUrl?: string } | null> {
  try {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const mod = isHttps ? await import("node:https") : await import("node:http");

    return new Promise((resolve) => {
      let settled = false;
      const done = (result: { status: number; headers: Record<string, string>; body: string; redirectUrl?: string } | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        resolve(result);
      };

      // Hard timeout — kills the request no matter what
      const hardTimer = setTimeout(() => {
        if (!settled) { req.destroy(); done(null); }
      }, timeoutMs + 1000);

      const req = mod.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method,
          timeout: timeoutMs,
          rejectUnauthorized: false,
          headers: {
            "User-Agent": "Genie-Security-Scanner/1.0",
            "Accept": "*/*",
            ...extraHeaders,
          },
        },
        (res) => {
          const headers: Record<string, string> = {};
          for (const [key, val] of Object.entries(res.headers)) {
            const lk = key.toLowerCase();
            if (lk === "set-cookie" && Array.isArray(val)) {
              headers["set-cookie"] = val.join("\n");
            } else if (typeof val === "string") {
              headers[lk] = val;
            } else if (Array.isArray(val)) {
              headers[lk] = val.join(", ");
            }
          }

          if (!followRedirects && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
            done({ status: res.statusCode, headers, body: "", redirectUrl: headers.location });
            req.destroy();
            return;
          }

          let body = "";
          res.setEncoding("utf-8");
          res.on("data", (chunk: string) => {
            body += chunk;
            if (body.length > 50000) {
              body = body.slice(0, 50000);
              res.destroy();
            }
          });
          res.on("end", () => done({ status: res.statusCode || 0, headers, body }));
          res.on("error", () => done(null));
        },
      );
      req.on("timeout", () => { req.destroy(); done(null); });
      req.on("error", () => done(null));
      req.end();
    });
  } catch {
    return null;
  }
}
