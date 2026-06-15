import { SocksClient } from "socks";
import type { Socket } from "node:net";
import { socksDialStart, socksDialOk, socksDialFail, socksSocketClosed } from "./socks-metrics.js";

/** Open a TCP connection to (host, port) tunneled through a SOCKS5 proxy.
 *  Returns a Node Socket suitable for ssh2's `sock` connect option. The proxy
 *  is given as "host:port" — typically "127.0.0.1:25344" (wireproxy default).
 *
 *  Used by the Railway path: the manager joins the Taz private network via a
 *  userspace WireGuard (wireproxy) which exposes its tunnel as a local SOCKS5
 *  server. Kernel WireGuard hosts (local dev with the macOS app, a Linux box
 *  running wg-quick) route 10.128/16 directly and don't need this. */
export async function socksDial(
  proxy: string,
  host: string,
  port: number,
  timeoutMs = 10_000,
): Promise<Socket> {
  const [proxyHost, proxyPortStr] = proxy.split(":");
  const proxyPort = Number(proxyPortStr);
  if (!proxyHost || !Number.isFinite(proxyPort)) {
    throw new Error(`Invalid SOCKS proxy address "${proxy}" (expected host:port)`);
  }
  // Instrument the single SOCKS chokepoint: latency, outcome, in-flight, and
  // open-socket count (the `close` listener is the leak detector). See socks-metrics.ts.
  const token = socksDialStart(`${host}:${port}`);
  try {
    const { socket } = await SocksClient.createConnection({
      proxy: { host: proxyHost, port: proxyPort, type: 5, ...tazSocksAuth() },
      command: "connect",
      destination: { host, port },
      timeout: timeoutMs,
    });
    // Bastion SOCKS5 (microsocks) tuning, per Taz: disable Nagle so interactive
    // keystrokes/PTY output aren't buffered, and enable TCP keepalive so an idle
    // SSH session isn't silently dropped after ~60s.
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10_000);
    socksDialOk(token);
    socket.once("close", socksSocketClosed);
    return socket;
  } catch (err) {
    socksDialFail(token, err);
    throw err;
  }
}

/** Parse a CIDR like "10.128.0.0/16" into a numeric base + mask, for cheap
 *  membership tests via `ipv4InSubnet`. Returns null on malformed input. */
function parseCidr(cidr: string): { base: number; mask: number } | null {
  const [ip, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  if (!ip || !Number.isFinite(bits) || bits < 0 || bits > 32) return null;
  const n = ipv4ToInt(ip);
  if (n === null) return null;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { base: n & mask, mask };
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    out = ((out << 8) | n) >>> 0;
  }
  return out;
}

/** True when `host` is a literal IPv4 address that falls inside `cidr`.
 *  Returns false for IPv6 literals, hostnames, or anything that doesn't parse —
 *  callers use that as "not a Taz private address, dial it directly". */
export function ipv4InSubnet(host: string, cidr: string): boolean {
  const sub = parseCidr(cidr);
  if (!sub) return false;
  const n = ipv4ToInt(host);
  if (n === null) return false;
  return (n & sub.mask) === sub.base;
}

/** Default Taz private subnet — the one WireGuard's AllowedIPs covers. */
export const DEFAULT_TAZ_SUBNET = "10.128.0.0/16";

/** Resolve the SOCKS proxy address for Taz traffic from env, if any. Returns
 *  null when unset (caller dials directly — kernel WG or non-Taz target). */
export function tazSocksProxy(): string | null {
  return process.env.GENIE_TAZ_SOCKS || null;
}

/** SOCKS5 auth for the Taz bastion proxy (microsocks), from env. The bastion
 *  proxy requires username/password; legacy local wireproxy did not — so this is
 *  empty (no auth) when the vars are unset, keeping that path working. Spread
 *  into the `socks` proxy config: `{ ...tazSocksAuth() }`. */
export function tazSocksAuth(): { userId?: string; password?: string } {
  const userId = process.env.GENIE_TAZ_SOCKS_USER;
  const password = process.env.GENIE_TAZ_SOCKS_PASS;
  return {
    ...(userId ? { userId } : {}),
    ...(password ? { password } : {}),
  };
}

/** True when `host` should be routed through the Taz SOCKS proxy: the env
 *  pointer is set AND the host is an IPv4 inside the Taz private subnet. */
export function shouldRouteViaSocks(host: string): boolean {
  const proxy = tazSocksProxy();
  if (!proxy) return false;
  const subnet = process.env.GENIE_TAZ_SUBNET || DEFAULT_TAZ_SUBNET;
  return ipv4InSubnet(host, subnet);
}
