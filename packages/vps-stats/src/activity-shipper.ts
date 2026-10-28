// Activity spool shipper: genie-local appends one JSON line per user-activity
// event to a spool (`activity.jsonl`); this loop ships them to the manager's
// POST /api/vps/activity. Contract (shared with the genie-local writer):
//
//   - The writer only appends whole lines, opening the file by path each time,
//     so renaming it out from under the writer is safe.
//   - When the spool is non-empty and no `*.shipping` file is pending, we
//     rename it to `activity-<epoch ms>.shipping`, wait ~2 s for in-flight
//     appends, then send it in batches (≤500 events, <60 KB body). Progress is
//     kept in `<file>.offset` (byte offset of the next unsent line), so a
//     restart resumes where it stopped. A fully accepted file is deleted with
//     its offset. Pending files go oldest first; anything older than 7 days is
//     dropped.
//   - The offset moves only after a 2xx. Network error / 5xx / 429 → back off
//     (5 s doubling to 5 min) and retry the same batch. Any other 4xx → log and
//     skip the batch (it will never succeed). Events the manager rejects
//     (failed validation) are counted in its reply and not retried.
//
// Runs as its own loop next to the stats loop and never throws into it: every
// tick is wrapped, all I/O is async. Node built-ins only (no deps).

import fsp from "node:fs/promises";
import path from "node:path";

export const ACTIVITY_MAX_EVENTS = 500;
/** Serialized request body must stay under this (contract: "under 60 KB"). */
export const ACTIVITY_MAX_BODY_BYTES = 60_000;
export const ACTIVITY_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const ACTIVITY_INTERVAL_MS = 15_000;
export const ACTIVITY_SETTLE_MS = 2_000;
export const ACTIVITY_BACKOFF_MIN_MS = 5_000;
export const ACTIVITY_BACKOFF_MAX_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Read window per batch. Larger than the body limit, so a line that fits in a
 *  batch always fits in the window it starts. */
const READ_WINDOW_BYTES = 128 * 1024;

const SHIPPING_RE = /^activity-(\d+)\.shipping$/;
const OFFSET_RE = /^(activity-\d+\.shipping)\.offset$/;

export interface ActivityShipperConfig {
  /** The spool the writer appends to (GENIE_ACTIVITY_FILE). */
  spoolPath: string;
  /** Full upload URL (`<manager>/api/vps/activity`). */
  url: string;
  token: string;
  projectId: string;
  instanceId: string;
  /** Injection points for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  settleMs?: number;
  intervalMs?: number;
}

/** Read the shipper config from the daemon's env. Opt-in: null unless
 *  GENIE_ACTIVITY_FILE and the whole postback env are set. */
export function readActivityConfig(env: NodeJS.ProcessEnv = process.env): ActivityShipperConfig | null {
  const spoolPath = env.GENIE_ACTIVITY_FILE?.trim();
  const base = env.GENIE_MANAGER_URL?.trim();
  const token = env.GENIE_STATS_TOKEN?.trim();
  const projectId = env.GENIE_PROJECT_ID?.trim();
  const instanceId = env.GENIE_INSTANCE_ID?.trim();
  if (!spoolPath || !base || !token || !projectId || !instanceId) return null;
  return { spoolPath, url: `${base.replace(/\/+$/, "")}/api/vps/activity`, token, projectId, instanceId };
}

interface Batch {
  events: unknown[];
  /** Offset just past the last line consumed (sent or dropped). */
  nextOffset: number;
}

type SendOutcome = "ok" | "retry" | "skip";

export interface ActivityShipper {
  /** One pass: drop stale files, rotate the spool if idle, ship pending files
   *  until done or a failure backs us off. Never throws. */
  tick(): Promise<void>;
  /** Start the background loop (setTimeout chain, unref'd). */
  start(): void;
  stop(): void;
  /** For tests: the earliest time the next send may happen. */
  readonly backoffUntil: number;
}

export function createActivityShipper(cfg: ActivityShipperConfig): ActivityShipper {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const now = cfg.now ?? Date.now;
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = cfg.log ?? ((line: string) => process.stderr.write(`[genie-stats-daemon] activity: ${line}\n`));
  const settleMs = cfg.settleMs ?? ACTIVITY_SETTLE_MS;
  const intervalMs = cfg.intervalMs ?? ACTIVITY_INTERVAL_MS;
  const dir = path.dirname(cfg.spoolPath);

  let backoffMs = 0;
  let backoffUntil = 0;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;
  /** Lines dropped as >7 days old while building the current batch. */
  let staleDropped = 0;

  function backOff(reason: string): void {
    backoffMs = backoffMs === 0 ? ACTIVITY_BACKOFF_MIN_MS : Math.min(backoffMs * 2, ACTIVITY_BACKOFF_MAX_MS);
    backoffUntil = now() + backoffMs;
    log(`${reason}; retrying in ${Math.round(backoffMs / 1000)}s`);
  }

  async function listDir(): Promise<string[]> {
    try {
      return await fsp.readdir(dir);
    } catch {
      return []; // no spool dir yet → nothing to do
    }
  }

  /** Pending shipping files, oldest first, after dropping the >7-day-old ones
   *  and any offset file whose shipping file is gone. */
  async function pendingFiles(): Promise<string[]> {
    const names = await listDir();
    const present = new Set(names);
    const pending: { name: string; ts: number }[] = [];
    for (const name of names) {
      const m = SHIPPING_RE.exec(name);
      if (m) {
        const ts = Number(m[1]);
        if (now() - ts > ACTIVITY_MAX_AGE_MS) {
          log(`dropping ${name}: older than 7 days`);
          await removeShipping(path.join(dir, name));
        } else {
          pending.push({ name, ts });
        }
        continue;
      }
      const o = OFFSET_RE.exec(name);
      if (o && !present.has(o[1])) await fsp.rm(path.join(dir, name), { force: true });
    }
    pending.sort((a, b) => a.ts - b.ts || a.name.localeCompare(b.name));
    return pending.map((p) => path.join(dir, p.name));
  }

  async function removeShipping(file: string): Promise<void> {
    await fsp.rm(file, { force: true });
    await fsp.rm(`${file}.offset`, { force: true });
    await fsp.rm(`${file}.offset.tmp`, { force: true });
  }

  /** Rename the live spool to a shipping file when it has data. */
  async function rotateSpool(): Promise<string | null> {
    let size = 0;
    try {
      size = (await fsp.stat(cfg.spoolPath)).size;
    } catch {
      return null;
    }
    if (size === 0) return null;
    let ts = now();
    let target = path.join(dir, `activity-${ts}.shipping`);
    // Never clobber an existing file (two rotations in the same ms).
    // eslint-disable-next-line no-await-in-loop
    while (await exists(target)) target = path.join(dir, `activity-${++ts}.shipping`);
    await fsp.rename(cfg.spoolPath, target);
    // Let an append that opened the old path just before the rename land.
    await sleep(settleMs);
    return target;
  }

  async function readOffset(file: string): Promise<number> {
    try {
      const n = Number((await fsp.readFile(`${file}.offset`, "utf-8")).trim());
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  }

  async function writeOffset(file: string, offset: number): Promise<void> {
    const tmp = `${file}.offset.tmp`;
    await fsp.writeFile(tmp, String(offset));
    await fsp.rename(tmp, `${file}.offset`);
  }

  /** Build the next batch starting at `offset`. Drops (with a note) lines that
   *  can't be sent: oversize, not JSON objects, or older than 7 days. */
  async function nextBatch(file: string, offset: number, fileSize: number): Promise<Batch> {
    const envelope = Buffer.byteLength(
      JSON.stringify({ projectId: cfg.projectId, instanceId: cfg.instanceId, events: [] }),
    );
    const events: unknown[] = [];
    let bodyBytes = envelope;
    let pos = offset;
    const fh = await fsp.open(file, "r");
    try {
      while (pos < fileSize && events.length < ACTIVITY_MAX_EVENTS) {
        const len = Math.min(READ_WINDOW_BYTES, fileSize - pos);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, pos);
        if (bytesRead === 0) break;
        const chunk = buf.subarray(0, bytesRead);
        let lineStart = 0;
        let full = false;
        while (lineStart < chunk.length && events.length < ACTIVITY_MAX_EVENTS) {
          const nl = chunk.indexOf(0x0a, lineStart);
          const atEof = pos + chunk.length >= fileSize;
          if (nl === -1 && !atEof) {
            // Line runs past the window. If it already can't fit, skip to its
            // end; otherwise re-read from its start next round.
            if (chunk.length - lineStart > ACTIVITY_MAX_BODY_BYTES) {
              const end = await findLineEnd(fh, pos + chunk.length, fileSize);
              log(`dropping an oversize line (${end - (pos + lineStart)} bytes) at offset ${pos + lineStart}`);
              pos = end;
            } else {
              pos += lineStart;
            }
            lineStart = -1;
            break;
          }
          const lineEnd = nl === -1 ? chunk.length : nl;
          const raw = chunk.subarray(lineStart, lineEnd).toString("utf-8").trim();
          const consumed = lineEnd + (nl === -1 ? 0 : 1);
          if (raw) {
            const parsed = parseLine(raw);
            if (parsed === "invalid") {
              log(`dropping a malformed line at offset ${pos + lineStart}`);
            } else if (parsed === "stale") {
              // Older than 7 days: dropped per contract, silently counted below.
              staleDropped++;
            } else {
              const bytes = Buffer.byteLength(JSON.stringify(parsed.event));
              const added = bytes + (events.length > 0 ? 1 : 0);
              if (envelope + bytes > ACTIVITY_MAX_BODY_BYTES) {
                log(`dropping an oversize line (${bytes} bytes) at offset ${pos + lineStart}`);
              } else if (bodyBytes + added >= ACTIVITY_MAX_BODY_BYTES) {
                full = true;
                break; // this line starts the next batch
              } else {
                events.push(parsed.event);
                bodyBytes += added;
              }
            }
          }
          lineStart = consumed;
        }
        if (lineStart >= 0) pos += lineStart;
        if (full) break;
      }
    } finally {
      await fh.close();
    }
    return { events, nextOffset: pos };
  }

  function parseLine(raw: string): { event: unknown } | "invalid" | "stale" {
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      return "invalid";
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "invalid";
    const ts = (obj as { ts?: unknown }).ts;
    if (typeof ts === "number" && now() - ts > ACTIVITY_MAX_AGE_MS) return "stale";
    return { event: obj };
  }

  async function send(events: unknown[]): Promise<SendOutcome> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}` },
        body: JSON.stringify({ projectId: cfg.projectId, instanceId: cfg.instanceId, events }),
        signal: controller.signal,
      });
      if (res.ok) {
        backoffMs = 0;
        backoffUntil = 0;
        try {
          const body = (await res.json()) as { rejected?: unknown };
          if (typeof body.rejected === "number" && body.rejected > 0) {
            log(`manager rejected ${body.rejected} of ${events.length} event(s) (not retried)`);
          }
        } catch {
          /* a 2xx without a JSON body still counts as accepted */
        }
        return "ok";
      }
      if (res.status === 429 || res.status >= 500) {
        backOff(`upload HTTP ${res.status}`);
        return "retry";
      }
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      log(`upload HTTP ${res.status}${detail ? ` (${detail})` : ""}: skipping a batch of ${events.length} event(s)`);
      return "skip";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      backOff(`upload failed: ${message}`);
      return "retry";
    } finally {
      clearTimeout(t);
    }
  }

  /** Ship one file to the end, or until a retryable failure. Returns true when
   *  the file was fully handled (and removed). */
  async function shipFile(file: string): Promise<boolean> {
    let offset = await readOffset(file);
    for (;;) {
      if (stopped) return false;
      let size: number;
      try {
        // Re-stat each round: a late append after the rename still gets sent.
        size = (await fsp.stat(file)).size;
      } catch {
        return true; // vanished
      }
      if (offset >= size) break;
      staleDropped = 0;
      const batch = await nextBatch(file, offset, size);
      if (staleDropped > 0) log(`dropped ${staleDropped} event(s) older than 7 days`);
      if (batch.nextOffset <= offset) {
        // Can't happen with a read window larger than the body limit; never spin.
        log(`no progress in ${path.basename(file)} at offset ${offset}; dropping the file`);
        break;
      }
      if (batch.events.length > 0) {
        const outcome = await send(batch.events);
        if (outcome === "retry") return false;
      }
      offset = batch.nextOffset;
      await writeOffset(file, offset);
    }
    await removeShipping(file);
    return true;
  }

  async function tickInner(): Promise<void> {
    if (now() < backoffUntil) return;
    let pending = await pendingFiles();
    if (pending.length === 0) {
      const rotated = await rotateSpool();
      if (!rotated) return;
      pending = [rotated];
    }
    for (const file of pending) {
      if (!(await shipFile(file))) return; // backing off
    }
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await tickInner();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log(`tick failed: ${message}`);
    } finally {
      running = false;
    }
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick().finally(schedule);
    }, intervalMs);
    timer.unref?.();
  }

  return {
    tick,
    start() {
      stopped = false;
      log(`shipping ${cfg.spoolPath} → ${cfg.url}`);
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    get backoffUntil() {
      return backoffUntil;
    },
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Offset just past the next newline at or after `from` (or EOF). */
async function findLineEnd(fh: fsp.FileHandle, from: number, fileSize: number): Promise<number> {
  let pos = from;
  const buf = Buffer.alloc(64 * 1024);
  while (pos < fileSize) {
    const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, fileSize - pos), pos);
    if (bytesRead === 0) break;
    const nl = buf.subarray(0, bytesRead).indexOf(0x0a);
    if (nl !== -1) return pos + nl + 1;
    pos += bytesRead;
  }
  return fileSize;
}
