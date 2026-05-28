// Registry of outbound SSH connections (ssh2 Clients) the manager currently
// holds open — VM exec/stat/forward connections (ssh-client.ts) and
// interactive terminal connections (pty-manager.ts). Surfaced in the sidebar
// gauge so operators can watch SSH load, and listed in /ssh with a Kill
// action so a leak can be triaged live.
//
// Each open is paired with exactly one close at the instrumented sites; the
// `end` thunk is what the /ssh kill action invokes — uses Client#destroy()
// so hung exec channels can't block teardown the way end() does.

import crypto from "node:crypto";

export interface SshConnectionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  /** "client" = programmatic connectSsh, "pty" = interactive terminal session. */
  kind: "client" | "pty";
  /** ms epoch when the underlying ssh2 client emitted `ready`. */
  openedAt: number;
  /** Short caller hint — first non-internal stack frame, useful when many
   *  call sites look alike (e.g. fs-handler vs vps-db-handler). */
  opener: string;
}

interface Entry extends SshConnectionInfo {
  end: () => void;
}

const active = new Map<string, Entry>();

/** Walk the current stack (or a pre-captured one) to find the first frame that
 *  isn't internal ssh plumbing. Best-effort; bundling may flatten frames. */
function captureOpener(preCapturedStack?: string): string {
  const stack = preCapturedStack ?? (new Error().stack ?? "");
  const lines = stack.split("\n").slice(1);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    if (line.includes("ssh-metrics")) continue;
    if (line.includes("ssh-client")) continue;
    if (line.includes("pty-manager")) continue;
    // Pull "fn (file:line)" or "file:line" out of the v8 stack format.
    const m = line.match(/at\s+(.+)/);
    return m ? m[1].slice(0, 160) : line.slice(0, 160);
  }
  return "unknown";
}

/** Capture a stack trace at the call site — meant to be invoked SYNCHRONOUSLY
 *  by connectSsh / spawnSshPty before they hand control to ssh2's Client. By
 *  the time the `ready` event fires the original caller has unwound, so a
 *  late capture inside sshConnRegister sees only `Client.emit (node:events…)`,
 *  which is useless for the /ssh panel's Opener column. */
export function captureSshOpenerStack(): string {
  return new Error().stack ?? "";
}

export function sshConnRegister(args: {
  host: string;
  port: number;
  username: string;
  kind: "client" | "pty";
  end: () => void;
  /** Stack captured at the connectSsh() call site (see captureSshOpenerStack);
   *  falls back to a register-time capture, which is what we used to do but
   *  loses the original caller because ssh2 fires `ready` asynchronously. */
  openerStack?: string;
}): string {
  const id = crypto.randomUUID();
  active.set(id, {
    id,
    host: args.host,
    port: args.port,
    username: args.username,
    kind: args.kind,
    openedAt: Date.now(),
    opener: captureOpener(args.openerStack),
    end: args.end,
  });
  return id;
}

export function sshConnUnregister(id: string): void {
  active.delete(id);
}

export function getActiveSshConnections(): number {
  return active.size;
}

export function listSshConnections(): SshConnectionInfo[] {
  const out: SshConnectionInfo[] = [];
  for (const e of active.values()) {
    out.push({
      id: e.id,
      host: e.host,
      port: e.port,
      username: e.username,
      kind: e.kind,
      openedAt: e.openedAt,
      opener: e.opener,
    });
  }
  return out.sort((a, b) => a.openedAt - b.openedAt);
}

export function getSshConnectionInfo(id: string): SshConnectionInfo | null {
  const entry = active.get(id);
  if (!entry) return null;
  return {
    id: entry.id,
    host: entry.host,
    port: entry.port,
    username: entry.username,
    kind: entry.kind,
    openedAt: entry.openedAt,
    opener: entry.opener,
  };
}

/** Force-close the underlying ssh2 client. Uses destroy() so hung exec channels
 *  can't block teardown the way conn.end() does. Drop from the registry
 *  immediately so /ssh reflects the kill even if the socket is slow to die. */
export function killSshConnection(id: string): boolean {
  const entry = active.get(id);
  if (!entry) return false;
  active.delete(id);
  try {
    entry.end();
  } catch {
    // ssh2 throws if the socket is already half-closed; swallow.
  }
  return true;
}

/** Kill every tracked connection to `host`. Returns how many were closed. */
export function killSshConnectionsForHost(host: string): number {
  const ids = [...active.values()]
    .filter((e) => e.host === host)
    .map((e) => e.id);
  let killed = 0;
  for (const id of ids) {
    if (killSshConnection(id)) killed++;
  }
  return killed;
}
