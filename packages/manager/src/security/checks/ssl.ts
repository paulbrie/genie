import tls from "node:tls";
import { v4 as uuidv4 } from "uuid";
import type { ScanCallbacks, SecurityScan } from "../types.js";
import { logOp } from "../util.js";

/** Inspect the peer certificate: flag expired/expiring soon and self-signed.
 *  `rejectUnauthorized: false` lets us see broken certs we'd otherwise be
 *  prevented from inspecting. */
export async function checkSsl(host: string, port: number, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port,
        rejectUnauthorized: false,
        timeout: 5000,
      },
      () => {
        const cert = socket.getPeerCertificate();
        if (cert && Object.keys(cert).length > 0) {
          // Check expiry
          const validTo = new Date(cert.valid_to);
          const now = new Date();
          const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          if (daysUntilExpiry < 0) {
            scan.findings.push({
              id: uuidv4(),
              category: "ssl",
              severity: "critical",
              title: "SSL Certificate Expired",
              description: `Certificate expired ${Math.abs(daysUntilExpiry)} days ago (${cert.valid_to}).`,
              url: `https://${host}:${port}`,
              evidence: `Valid to: ${cert.valid_to}`,
            });
            logOp(scan, callbacks, `[CRITICAL] SSL certificate expired ${Math.abs(daysUntilExpiry)} days ago`);
          } else if (daysUntilExpiry < 30) {
            scan.findings.push({
              id: uuidv4(),
              category: "ssl",
              severity: "medium",
              title: "SSL Certificate Expiring Soon",
              description: `Certificate expires in ${daysUntilExpiry} days (${cert.valid_to}).`,
              url: `https://${host}:${port}`,
              evidence: `Valid to: ${cert.valid_to}`,
            });
            logOp(scan, callbacks, `[MEDIUM] SSL certificate expires in ${daysUntilExpiry} days`);
          } else {
            logOp(scan, callbacks, `SSL certificate valid for ${daysUntilExpiry} days`);
          }

          // Check self-signed
          if (cert.issuer && cert.subject &&
            JSON.stringify(cert.issuer) === JSON.stringify(cert.subject)) {
            scan.findings.push({
              id: uuidv4(),
              category: "ssl",
              severity: "medium",
              title: "Self-Signed Certificate",
              description: "The server uses a self-signed certificate. This is not trusted by browsers.",
              url: `https://${host}:${port}`,
              evidence: `Issuer: ${cert.issuer?.CN || "N/A"}`,
            });
            logOp(scan, callbacks, `[MEDIUM] Self-signed certificate detected (issuer: ${cert.issuer?.CN || "N/A"})`);
          }

          callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
        }
        socket.end();
        resolve();
      },
    );

    socket.on("error", () => {
      resolve();
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve();
    });
  });
}
