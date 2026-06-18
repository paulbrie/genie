/**
 * SSH handshake throttle — protects target VMs from our own connection bursts.
 *
 * OpenSSH `MaxStartups` (default `10:30:100`) drops *unauthenticated* connections
 * once too many are mid-handshake on a daemon at the same time — and it does so
 * WITHOUT sending a banner: the TCP socket just resets. When a VM popup opens,
 * several independent subsystems dial the SAME VM at once (interactive cache,
 * stats probe pool, the durable Claude stream tail, the assistant's ssh_exec,
 * agent rsync). On a busy sshd that trips MaxStartups and looks exactly like the
 * bastion throttling, when it's really the target VM protecting its daemon.
 *
 * `connectSsh` is the one chokepoint every dial funnels through, so we wrap it
 * here:
 *   - cap concurrent in-flight handshakes PER TARGET HOST well under the soft
 *     limit, queueing the rest (slot is transferred to the next waiter on
 *     release, so the active count never exceeds the cap);
 *   - stagger each queued wake with a little jitter so freed slots don't re-align
 *     into a fresh burst;
 *   - retry a banner-less reset a couple of times with exponential backoff + full
 *     jitter, instead of surfacing it instantly (which makes callers retry in a
 *     tight loop and amplify the problem).
 *
 * Pure (no SSH deps) so it's unit-testable in isolation; the jitter/backoff are
 * overridable via the __test hooks.
 */

/** Concurrent in-flight handshakes allowed per target host. The soft MaxStartups
 *  default is 10, so 3 leaves ample headroom for other clients hitting the VM. */
export const MAX_HANDSHAKES_PER_HOST = 3;
/** Extra attempts after the first on a reset-class drop. */
export const HANDSHAKE_RETRIES = 2;
/** Base backoff before the first retry; doubles per attempt (with full jitter). */
export const HANDSHAKE_RETRY_BASE_MS = 500;

const active = new Map<string, number>();
const queue = new Map<string, (() => void)[]>();

// Jitter bounds for waking a queued dial. Overridable in tests so timing is
// deterministic; production keeps a small spread.
let wakeJitterMinMs = 50;
let wakeJitterMaxMs = 200;
// Retry backoff is overridable too (tests zero it to avoid real waits).
let retryBackoffEnabled = true;

function wakeDelayMs(): number {
  return wakeJitterMinMs + Math.floor(Math.random() * Math.max(0, wakeJitterMaxMs - wakeJitterMinMs));
}

function acquire(key: string): Promise<void> {
  const n = active.get(key) ?? 0;
  if (n < MAX_HANDSHAKES_PER_HOST) {
    active.set(key, n + 1);
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const q = queue.get(key) ?? [];
    q.push(resolve);
    queue.set(key, q);
  });
}

function release(key: string): void {
  const q = queue.get(key);
  if (q && q.length > 0) {
    const next = q.shift()!;
    if (q.length === 0) queue.delete(key);
    // Slot is TRANSFERRED to the waiter (active count unchanged → never exceeds
    // the cap). Stagger the wake so freed slots don't re-align into a burst.
    setTimeout(next, wakeDelayMs());
    return;
  }
  const n = Math.max(0, (active.get(key) ?? 1) - 1);
  if (n === 0) active.delete(key);
  else active.set(key, n);
}

/** A MaxStartups refusal (or any transient transport reset) closes the TCP
 *  connection during the handshake with no banner. That's distinct from an auth
 *  failure ("All authentication methods failed" — wrong key/user, retry won't
 *  help), connection-refused (VM not up — the caller's boot loop owns that), or
 *  a command timeout. Only the reset class is worth an automatic retry. */
export function isHandshakeReset(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (m.includes("authentication")) return false; // wrong key/user — never retry
  if (m.includes("refused")) return false;         // VM down — caller's loop owns it
  return /econnreset|reset by peer|closed before|before handshake|handshake failed|epipe|socket hang ?up/.test(m);
}

function retryDelay(attempt: number): Promise<void> {
  if (!retryBackoffEnabled) return Promise.resolve();
  const ceiling = HANDSHAKE_RETRY_BASE_MS * Math.pow(2, attempt);
  const ms = Math.round(ceiling * (0.5 + Math.random() * 0.5)); // full jitter
  return new Promise((r) => setTimeout(r, ms));
}

export interface HandshakeGateOpts {
  /** Extra attempts on a reset-class drop. Defaults to HANDSHAKE_RETRIES; pass 0
   *  for fast-fail callers (e.g. probing which user/key works). */
  retries?: number;
}

/**
 * Run `dial` under the per-host handshake cap, retrying a banner-less reset with
 * backoff. `key` should identify the target sshd (host:port) — that's the scope
 * MaxStartups counts. The gate slot is held only for the duration of each dial
 * attempt and released during backoff, so a slow VM never starves the others.
 */
export async function withHandshakeGate<T>(
  key: string,
  dial: () => Promise<T>,
  opts?: HandshakeGateOpts,
): Promise<T> {
  const maxRetries = opts?.retries ?? HANDSHAKE_RETRIES;
  let attempt = 0;
  for (;;) {
    await acquire(key);
    try {
      const result = await dial();
      release(key);
      return result;
    } catch (err) {
      release(key);
      if (attempt < maxRetries && isHandshakeReset(err)) {
        await retryDelay(attempt);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

// --- test hooks (not used in production) -----------------------------------
export const __test = {
  stats(key: string) {
    return { active: active.get(key) ?? 0, queued: queue.get(key)?.length ?? 0 };
  },
  reset() {
    active.clear();
    queue.clear();
    wakeJitterMinMs = 50;
    wakeJitterMaxMs = 200;
    retryBackoffEnabled = true;
  },
  setWakeJitter(minMs: number, maxMs: number) {
    wakeJitterMinMs = minMs;
    wakeJitterMaxMs = maxMs;
  },
  setRetryBackoffEnabled(enabled: boolean) {
    retryBackoffEnabled = enabled;
  },
};
