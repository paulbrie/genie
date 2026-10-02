// Claude egress-firewall management for the VM card: `vps:firewall:status`
// probes enforcement state + allowlist + recent blocks in one exec on the
// cached SSH session; `:add` / `:remove` edit /etc/genie/firewall-allow.txt
// and re-apply; `:toggle` enables (running GENIE_FIREWALL_SETUP_SCRIPT when
// the VM's Standard Setup predates hardening) or disables enforcement. All
// verbs reply on `vps:firewall:result` with the reqId so the renderer's
// wsRequest resolves.
//
// SECURITY: the write path is deliberately UI-only. Never expose these verbs
// (or equivalent shell) as an agent/MCP tool — a prompt-injected Claude
// session on the VM could otherwise allowlist its own exfiltration host,
// which defeats the firewall's purpose.

import { type WebSocket } from "ws";
import { reverse } from "node:dns/promises";
import type { WsMessage } from "../types.js";
import * as projectService from "../projects/project-service.js";
import { getVpsConnection } from "../vps/connection-resolver.js";
import { execCached } from "../vps/ssh-session-cache.js";
import { GENIE_FIREWALL_SETUP_SCRIPT, GENIE_FIREWALL_ALLOW_FILE } from "../default-recipes.js";

export interface EgressAllowEntry {
  entry: string;
  comment?: string;
  /** Removal is refused: api.anthropic.com (bricks Claude sessions) and the
   *  auto-added manager IP (bricks REST MCP). */
  protected: boolean;
}

export interface EgressBlock {
  ip: string;
  port?: number;
  proto?: string;
  count: number;
  lastSeen?: string;
  /** Best-effort PTR lookup, resolved manager-side. */
  ptr?: string;
}

export interface EgressStatus {
  /** /usr/local/sbin/genie-firewall exists on the VM. */
  installed: boolean;
  /** The OUTPUT jump for the genie UID is currently in place. */
  enforced: boolean;
  allowedIps: number;
  allowlist: EgressAllowEntry[];
  blocks: EgressBlock[];
}

/** POSIX single-quote a string for safe embedding in a shell command. */
function shSingleQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

// Entries are restricted to a bare domain or IPv4 (no CIDR — the ipset is
// hash:ip and large ranges would explode it; private ranges are already open).
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function validEntry(entry: string): boolean {
  if (DOMAIN_RE.test(entry)) return true;
  const m = entry.match(IPV4_RE);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

// One combined probe per request. Key=value lines, then the allowlist file,
// then up to 24h of kernel-log block lines (ISO timestamps for parsing).
const PROBE_CMD = [
  `[ -x /usr/local/sbin/genie-firewall ] && echo "SCRIPT=yes" || echo "SCRIPT=no"`,
  `echo "STATE=$(sudo /usr/local/sbin/genie-firewall status 2>/dev/null | head -1)"`,
  `echo "==ALLOW=="`,
  `cat ${GENIE_FIREWALL_ALLOW_FILE} 2>/dev/null || true`,
  `echo "==BLOCKS=="`,
  `sudo journalctl -k -o short-iso --no-pager --since "24 hours ago" 2>/dev/null | grep 'genie-egress-block:' | tail -80 || true`,
].join("\n");

// Re-apply only when enforcement is currently on — a bare `genie-firewall`
// re-installs the OUTPUT jump, which would silently re-enable a firewall the
// user just toggled off.
const REAPPLY_IF_ENFORCED = `if sudo iptables -C OUTPUT -m owner --uid-owner "$(id -u genie)" -j GENIE_EGRESS 2>/dev/null; then sudo /usr/local/sbin/genie-firewall > /dev/null 2>&1 || true; fi`;

function parseAllowlist(section: string): EgressAllowEntry[] {
  const entries: EgressAllowEntry[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const hash = line.indexOf("#");
    const entry = (hash >= 0 ? line.slice(0, hash) : line).trim();
    const comment = hash >= 0 ? line.slice(hash + 1).trim() : undefined;
    if (!entry) continue;
    entries.push({
      entry,
      comment,
      protected: entry === "api.anthropic.com" || (comment?.includes("auto-added") ?? false),
    });
  }
  return entries;
}

function parseBlocks(section: string): EgressBlock[] {
  // journalctl -o short-iso kernel line, e.g.:
  // 2026-07-31T09:12:01+0000 host kernel: genie-egress-block: IN= OUT=eth0
  //   SRC=10.0.0.5 DST=1.2.3.4 ... PROTO=TCP SPT=51000 DPT=443 ...
  const byKey = new Map<string, EgressBlock>();
  for (const line of section.split("\n")) {
    const m = line.match(/^(\S+)\s.*genie-egress-block:.*?DST=([0-9.]+).*?PROTO=(\S+)(?:.*?DPT=(\d+))?/);
    if (!m) continue;
    const [, ts, ip, proto, dpt] = m;
    const port = dpt ? Number(dpt) : undefined;
    const key = `${ip}:${port ?? "-"}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.count += 1;
      prev.lastSeen = ts;
    } else {
      byKey.set(key, { ip, port, proto, count: 1, lastSeen: ts });
    }
  }
  // Most recent first; the card shows a short list.
  return [...byKey.values()].sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "")).slice(0, 20);
}

/** Best-effort PTR for blocked IPs so the user sees "which host was that". */
async function resolvePtrs(blocks: EgressBlock[]): Promise<void> {
  const unique = [...new Set(blocks.map((b) => b.ip))].slice(0, 15);
  const ptrs = new Map<string, string>();
  await Promise.all(
    unique.map(async (ip) => {
      try {
        const names = await Promise.race([
          reverse(ip),
          new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error("timeout")), 1500)),
        ]);
        if (names.length) ptrs.set(ip, names[0]);
      } catch {
        /* no PTR — show the bare IP */
      }
    }),
  );
  for (const b of blocks) {
    const ptr = ptrs.get(b.ip);
    if (ptr) b.ptr = ptr;
  }
}

async function probeStatus(conn: Awaited<ReturnType<typeof getVpsConnection>>): Promise<EgressStatus> {
  const out = await execCached(conn, PROBE_CMD, undefined, { timeoutMs: 25_000 });
  const [head, rest] = out.split("==ALLOW==");
  const [allowSection, blockSection] = (rest ?? "").split("==BLOCKS==");
  const kv: Record<string, string> = {};
  for (const line of (head ?? "").split("\n")) {
    const m = line.match(/^([A-Z]+)=(.*)$/);
    if (m) kv[m[1]] = m[2].trim();
  }
  // STATE looks like: "genie egress firewall: ON (57 allowed IPs)" / ": OFF".
  const stateLine = kv.STATE ?? "";
  const enforced = /:\s*ON\b/.test(stateLine);
  const allowedIps = Number(stateLine.match(/\((\d+) allowed IPs\)/)?.[1] ?? 0);
  const blocks = parseBlocks(blockSection ?? "");
  await resolvePtrs(blocks);
  return {
    installed: kv.SCRIPT === "yes",
    enforced,
    allowedIps,
    allowlist: parseAllowlist(allowSection ?? ""),
    blocks,
  };
}

export async function handleFirewallMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
): Promise<boolean> {
  if (!msg.type.startsWith("vps:firewall:")) return false;
  const { projectId, instanceId, reqId, entry, enabled } = (msg.payload ?? {}) as {
    projectId?: string;
    instanceId?: string;
    reqId?: string;
    entry?: string;
    enabled?: boolean;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reply = (payload: Record<string, any>) =>
    send(ws, { type: "vps:firewall:result", payload: { reqId, ...payload } });

  try {
    if (!projectId || !instanceId) {
      reply({ ok: false, error: "projectId and instanceId are required" });
      return true;
    }
    // Same membership gate as vps:code:* — the handler resolves a server
    // purely from projectId+instanceId and runs root iptables ops over SSH.
    if (!(await projectService.userCanSeeProject(userId, projectId))) {
      reply({ ok: false, error: "Not authorized for this project" });
      return true;
    }
    const conn = await getVpsConnection(projectId, instanceId);

    switch (msg.type) {
      case "vps:firewall:status": {
        reply({ ok: true, status: await probeStatus(conn) });
        return true;
      }

      case "vps:firewall:add": {
        const value = (entry ?? "").trim().toLowerCase();
        if (!validEntry(value)) {
          reply({ ok: false, error: "Enter a bare domain (example.com) or IPv4 address" });
          return true;
        }
        const stamp = new Date().toISOString().slice(0, 10);
        const cmd = [
          `if [ ! -f ${GENIE_FIREWALL_ALLOW_FILE} ]; then echo "RESULT=missing"; exit 0; fi`,
          `if awk '{print $1}' ${GENIE_FIREWALL_ALLOW_FILE} | grep -qxF ${shSingleQuote(value)}; then echo "RESULT=duplicate"; exit 0; fi`,
          `echo ${shSingleQuote(`${value}  # added via Genie ${stamp}`)} | sudo tee -a ${GENIE_FIREWALL_ALLOW_FILE} > /dev/null`,
          REAPPLY_IF_ENFORCED,
          `echo "RESULT=ok"`,
        ].join("\n");
        const out = await execCached(conn, cmd, undefined, { timeoutMs: 30_000 });
        if (out.includes("RESULT=missing")) {
          reply({ ok: false, error: "No allowlist on this VM yet — enable the firewall first" });
        } else if (out.includes("RESULT=duplicate")) {
          reply({ ok: false, error: `${value} is already allowed` });
        } else {
          reply({ ok: true, status: await probeStatus(conn) });
        }
        return true;
      }

      case "vps:firewall:remove": {
        const value = (entry ?? "").trim().toLowerCase();
        if (!validEntry(value)) {
          reply({ ok: false, error: "Invalid entry" });
          return true;
        }
        if (value === "api.anthropic.com") {
          reply({ ok: false, error: "api.anthropic.com is required for Claude sessions and can't be removed" });
          return true;
        }
        const cmd = [
          `LINE=$(awk -v e=${shSingleQuote(value)} '$1==e {print; exit}' ${GENIE_FIREWALL_ALLOW_FILE} 2>/dev/null)`,
          `if [ -z "$LINE" ]; then echo "RESULT=notfound"; exit 0; fi`,
          `if echo "$LINE" | grep -q 'auto-added'; then echo "RESULT=protected"; exit 0; fi`,
          `sudo awk -v e=${shSingleQuote(value)} '$1!=e' ${GENIE_FIREWALL_ALLOW_FILE} > /tmp/genie-fw-allow.$$`,
          `sudo mv /tmp/genie-fw-allow.$$ ${GENIE_FIREWALL_ALLOW_FILE}`,
          `sudo chown root:root ${GENIE_FIREWALL_ALLOW_FILE} && sudo chmod 644 ${GENIE_FIREWALL_ALLOW_FILE}`,
          REAPPLY_IF_ENFORCED,
          `echo "RESULT=ok"`,
        ].join("\n");
        const out = await execCached(conn, cmd, undefined, { timeoutMs: 30_000 });
        if (out.includes("RESULT=notfound")) {
          reply({ ok: false, error: `${value} is not in the allowlist` });
        } else if (out.includes("RESULT=protected")) {
          reply({ ok: false, error: "The manager's auto-added address can't be removed (REST MCP would break)" });
        } else {
          reply({ ok: true, status: await probeStatus(conn) });
        }
        return true;
      }

      case "vps:firewall:toggle": {
        if (enabled) {
          // Always run the full setup script — idempotent (allowlist is seeded
          // only if absent), and it rewrites /usr/local/sbin/genie-firewall +
          // units from the manager's current constants, so enabling also
          // self-heals script drift on VMs installed by older versions.
          await execCached(conn, GENIE_FIREWALL_SETUP_SCRIPT, undefined, { timeoutMs: 240_000 });
        } else {
          const cmd = [
            `[ -x /usr/local/sbin/genie-firewall ] && sudo /usr/local/sbin/genie-firewall off || true`,
            `sudo systemctl disable --now genie-firewall.timer genie-firewall.service 2>/dev/null || true`,
          ].join("\n");
          await execCached(conn, cmd, undefined, { timeoutMs: 30_000 });
        }
        reply({ ok: true, status: await probeStatus(conn) });
        return true;
      }

      default:
        reply({ ok: false, error: `Unknown message type ${msg.type}` });
        return true;
    }
  } catch (err: unknown) {
    reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}
