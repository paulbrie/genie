import { execCached } from "./ssh-session-cache.js";
import type { SshConnectionConfig } from "./ssh-client.js";

// dtach is the persistence wrapper that keeps remote PTYs alive across SSH
// disconnects. genie-standard now installs it during VM bootstrap, but VMs
// deployed before that change won't have it — we lazy-install on first use per
// host and cache the result for 24h so subsequent opens are zero-cost.

const CACHE_TTL_MS = 24 * 60 * 60_000;
const INSTALL_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

type CacheEntry =
  | { kind: "ok"; at: number }
  | { kind: "missing"; at: number; reason: string };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DtachStatus>>();

export type DtachStatus =
  | { available: true }
  | { available: false; reason: string };

function keyOf(cfg: SshConnectionConfig): string {
  return `${cfg.host}:${cfg.port}:${cfg.username}`;
}

function fresh(entry: CacheEntry | undefined): boolean {
  return !!entry && Date.now() - entry.at < CACHE_TTL_MS;
}

/**
 * Ensure `dtach` is available on the target VM. Caches success per host for
 * 24h. On miss, attempts `apt-get install` then `dnf install` over the cached
 * SSH session. Returns the outcome — callers fall back to a non-persistent
 * launch if `available` is false.
 *
 * Safe to call concurrently; concurrent callers share one probe/install.
 */
export async function ensureDtach(cfg: SshConnectionConfig): Promise<DtachStatus> {
  const key = keyOf(cfg);
  const cached = cache.get(key);
  if (fresh(cached)) {
    return cached!.kind === "ok"
      ? { available: true }
      : { available: false, reason: cached!.reason };
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const run = (async (): Promise<DtachStatus> => {
    try {
      const probe = await execCached(
        cfg,
        // We deliberately probe with `command -v` not `which`: busybox/dash compatible
        // and returns nothing (exit 1) on miss without spamming stderr.
        "command -v dtach >/dev/null 2>&1 && echo OK || echo MISSING",
        undefined,
        { timeoutMs: PROBE_TIMEOUT_MS },
      );
      if (probe.includes("OK")) {
        cache.set(key, { kind: "ok", at: Date.now() });
        return { available: true };
      }

      // Try apt then dnf. Both use `sudo -n` so we never block on a password
      // prompt — genie-standard guarantees NOPASSWD for the genie user, and
      // for non-genie image users we'd rather fail fast than hang.
      const install = await execCached(
        cfg,
        [
          "if command -v apt-get >/dev/null 2>&1; then",
          "  sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dtach >/dev/null 2>&1",
          "elif command -v dnf >/dev/null 2>&1; then",
          "  sudo -n dnf install -y -q dtach >/dev/null 2>&1",
          "else",
          "  echo NO_PKG_MGR; exit 1",
          "fi",
          "command -v dtach >/dev/null 2>&1 && echo OK || echo FAIL",
        ].join("\n"),
        undefined,
        { timeoutMs: INSTALL_TIMEOUT_MS },
      );

      if (install.includes("OK")) {
        cache.set(key, { kind: "ok", at: Date.now() });
        return { available: true };
      }

      const reason = install.includes("NO_PKG_MGR")
        ? "no supported package manager (need apt-get or dnf)"
        : "install failed (likely missing passwordless sudo)";
      cache.set(key, { kind: "missing", at: Date.now(), reason });
      return { available: false, reason };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Don't cache transient SSH/network errors as "missing" — leave the
      // entry untouched so the next attempt re-probes.
      return { available: false, reason };
    }
  })();

  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

/** For tests / restart-after-recipe-rerun: drop the cached verdict for a host. */
export function forgetDtachCache(cfg: SshConnectionConfig): void {
  cache.delete(keyOf(cfg));
}
