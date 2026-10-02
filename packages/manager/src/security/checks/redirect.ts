import { v4 as uuidv4 } from "uuid";
import type { ScanCallbacks, SecurityScan } from "../types.js";
import { httpRequest, logOp } from "../util.js";

/** Try common redirect-param names with an attacker-controlled destination
 *  and confirm whether the server's `Location` header sends the user there. */
export async function checkOpenRedirects(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const params = ["redirect", "url", "next", "return", "returnUrl", "goto", "destination"];
  const evilDomain = "https://evil.example.com";

  for (const param of params) {
    if (callbacks.signal.aborted) return;

    const url = `${baseUrl}/?${param}=${encodeURIComponent(evilDomain)}`;
    const resp = await httpRequest(url, "GET", 3000, false);
    if (!resp) continue;

    if (resp.status >= 300 && resp.status < 400 && resp.redirectUrl) {
      if (resp.redirectUrl.includes("evil.example.com")) {
        scan.findings.push({
          id: uuidv4(),
          category: "redirect",
          severity: "medium",
          title: `Open Redirect via "${param}" parameter`,
          description: `The application redirects to an external domain controlled by the attacker via the "${param}" parameter.`,
          url,
          evidence: `Location: ${resp.redirectUrl}`,
        });
        logOp(scan, callbacks, `[MEDIUM] Open redirect via "${param}" parameter`);
        callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
      }
    }
  }
}
