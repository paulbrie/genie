import net from "node:net";
import { PORT_SERVICES, TOP_PORTS } from "./constants.js";
import type { PortResult, ScanCallbacks, SecurityScan } from "./types.js";
import { logOp } from "./util.js";

/** Map (port, banner) → service name. Banner inspection wins because some
 *  services run on non-standard ports (e.g. ssh on 2222). */
export function resolveService(port: number, banner?: string): string {
  if (banner) {
    const bl = banner.toLowerCase();
    if (bl.includes("ssh")) return "ssh";
    if (bl.includes("ftp")) return "ftp";
    if (bl.includes("smtp")) return "smtp";
    if (bl.includes("http")) return "http";
    if (bl.includes("mysql")) return "mysql";
    if (bl.includes("postgresql") || bl.includes("postgres")) return "postgresql";
    if (bl.includes("redis")) return "redis";
    if (bl.includes("mongodb")) return "mongodb";
  }
  return PORT_SERVICES[port] || "unknown";
}

/** Single-port TCP connect with a brief post-connect wait for the server's
 *  banner. Returns immediately on connection error. */
export async function tcpConnect(host: string, port: number, timeoutMs: number): Promise<{ open: boolean; banner?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let banner: string | undefined;
    let settled = false;

    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({ open, banner });
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      // Wait briefly for banner
      socket.setTimeout(500);
    });
    socket.on("data", (data) => {
      banner = data.toString("utf-8").trim().slice(0, 256);
      finish(true);
    });
    socket.on("timeout", () => {
      if (socket.connecting) {
        finish(false);
      } else {
        // Connected but no banner
        finish(true);
      }
    });
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
    socket.connect(port, host);
  });
}

/** Scan TOP_PORTS in batches of 100. Each open port is appended to the scan
 *  record and progress is reported continuously (0–50% of the overall scan). */
export async function scanPorts(host: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const uniquePorts = [...new Set(TOP_PORTS)].sort((a, b) => a - b);
  const totalPorts = uniquePorts.length;
  const batchSize = 100;
  let scanned = 0;

  for (let i = 0; i < totalPorts; i += batchSize) {
    if (callbacks.signal.aborted) return;

    const batch = uniquePorts.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (port) => {
        const { open, banner } = await tcpConnect(host, port, 300);
        return { port, open, banner };
      }),
    );

    for (const { port, open, banner } of results) {
      if (open) {
        const service = resolveService(port, banner);
        const portResult: PortResult = {
          port,
          state: "open",
          service,
          banner,
        };
        scan.ports.push(portResult);
        logOp(scan, callbacks, `Port ${port} open — ${service}${banner ? ` (${banner.slice(0, 60)})` : ""}`);
        callbacks.onProgress({
          id: scan.id,
          ports: [...scan.ports],
          phase: `Port scanning (${port})`,
        });
      }
    }

    scanned += batch.length;
    const progress = Math.round((scanned / totalPorts) * 50); // Port scanning = 0-50%
    scan.progress = progress;
    callbacks.onProgress({ id: scan.id, progress, phase: `Port scanning (${scanned}/${totalPorts})` });
  }
}
