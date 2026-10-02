// One-shot diagnostic: bucket recent ssh_events by cause + host, surface
// wireproxy lifecycle events, and flag 5-minute windows that correlate a burst
// of disconnects with a wireproxy exit. Run against any manager DB:
//
//   npx tsx packages/manager/src/scripts/ssh-events-report.ts          # last 24h
//   npx tsx packages/manager/src/scripts/ssh-events-report.ts --hours=6
//   npx tsx packages/manager/src/scripts/ssh-events-report.ts --host=10.128.2.92
//
// Reads DATABASE_URL from packages/manager/.env / .env.local (same as the
// manager). Read-only — no writes, safe against prod.

import "../load-env.js";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { closeDb, getDb } from "../db/index.js";
import { sshEvents } from "../db/schema.js";

function parseArgs(): { hours: number; host: string | null } {
  let hours = 24;
  let host: string | null = null;
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--(hours|host)=(.+)$/);
    if (!m) continue;
    if (m[1] === "hours") hours = Math.max(1, Number(m[2]) || 24);
    else host = m[2];
  }
  return { hours, host };
}

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function bar(n: number, max: number, width = 24): string {
  if (max === 0) return "";
  return "█".repeat(Math.max(1, Math.round((n / max) * width)));
}

const { hours, host } = parseArgs();
const since = new Date(Date.now() - hours * 3_600_000);
const db = getDb();
const whereClause = host
  ? and(gte(sshEvents.occurredAt, since), eq(sshEvents.host, host))
  : gte(sshEvents.occurredAt, since);

const all = await db
  .select()
  .from(sshEvents)
  .where(whereClause)
  .orderBy(desc(sshEvents.occurredAt));

const disconnects = all.filter((e) => e.event === "disconnect");
const wpEvents = all.filter((e) => e.event !== "disconnect");

console.log(`\n========== ssh_events (last ${hours}h${host ? `, host=${host}` : ""}) ==========`);
console.log(`Total events: ${all.length}  ·  disconnects: ${disconnects.length}  ·  wireproxy lifecycle: ${wpEvents.length}\n`);

// ── By cause (disconnects only) ──────────────────────────────────────────────
const byCause = new Map<string, { count: number; lifeSum: number; lifeN: number; idleSum: number; idleN: number }>();
for (const e of disconnects) {
  const c = e.cause ?? "unknown";
  const b = byCause.get(c) ?? { count: 0, lifeSum: 0, lifeN: 0, idleSum: 0, idleN: 0 };
  b.count++;
  if (e.lifetimeMs != null) { b.lifeSum += e.lifetimeMs; b.lifeN++; }
  if (e.lastDataAgeMs != null) { b.idleSum += e.lastDataAgeMs; b.idleN++; }
  byCause.set(c, b);
}
const byCauseSorted = [...byCause.entries()].sort((a, b) => b[1].count - a[1].count);
const maxCause = byCauseSorted[0]?.[1].count ?? 0;
console.log("By cause:");
for (const [cause, b] of byCauseSorted) {
  const avgLife = b.lifeN ? fmtMs(Math.round(b.lifeSum / b.lifeN)) : "—";
  const avgIdle = b.idleN ? fmtMs(Math.round(b.idleSum / b.idleN)) : "—";
  console.log(`  ${cause.padEnd(20)} ${String(b.count).padStart(5)} ${bar(b.count, maxCause).padEnd(24)}  avg life=${avgLife}  avg idle=${avgIdle}`);
}

// ── By host × cause (top 20) ─────────────────────────────────────────────────
const byHostCause = new Map<string, { count: number; last: Date }>();
for (const e of disconnects) {
  const k = `${e.host}\t${e.cause ?? "unknown"}`;
  const b = byHostCause.get(k) ?? { count: 0, last: new Date(0) };
  b.count++;
  if (e.occurredAt > b.last) b.last = e.occurredAt;
  byHostCause.set(k, b);
}
const rows = [...byHostCause.entries()]
  .map(([k, v]) => ({ host: k.split("\t")[0], cause: k.split("\t")[1], ...v }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 20);
if (rows.length) {
  console.log(`\nBy host × cause (top ${rows.length}):`);
  for (const r of rows) {
    console.log(`  ${r.host.padEnd(18)} ${r.cause.padEnd(20)} ${String(r.count).padStart(5)}  last: ${r.last.toISOString().replace("T", " ").slice(0, 19)}`);
  }
}

// ── Wireproxy lifecycle ──────────────────────────────────────────────────────
if (wpEvents.length) {
  console.log("\nWireproxy lifecycle:");
  for (const e of wpEvents.slice(0, 20)) {
    console.log(`  ${e.occurredAt.toISOString().replace("T", " ").slice(0, 19)}  ${e.event.padEnd(20)} ${e.detail ?? ""}`);
  }
  if (wpEvents.length > 20) console.log(`  … and ${wpEvents.length - 20} more`);
}

// ── Hot 5-min windows ────────────────────────────────────────────────────────
// Bucket disconnects into 5-minute windows, then list any with >= 10 drops.
// Cross-reference each hot window with wireproxy events in the same bucket so
// "all-hosts drop @ 11:42 lines up with wireproxy-exit @ 11:42" is one glance.
const buckets = new Map<number, { drops: number; wpEvents: typeof wpEvents }>();
const BUCKET_MS = 5 * 60_000;
for (const e of disconnects) {
  const k = Math.floor(e.occurredAt.getTime() / BUCKET_MS);
  const b = buckets.get(k) ?? { drops: 0, wpEvents: [] };
  b.drops++;
  buckets.set(k, b);
}
for (const e of wpEvents) {
  const k = Math.floor(e.occurredAt.getTime() / BUCKET_MS);
  const b = buckets.get(k) ?? { drops: 0, wpEvents: [] };
  b.wpEvents.push(e);
  buckets.set(k, b);
}
const hotWindows = [...buckets.entries()]
  .filter(([, v]) => v.drops >= 10)
  .sort((a, b) => b[1].drops - a[1].drops)
  .slice(0, 10);
if (hotWindows.length) {
  console.log("\nHot windows (5-min buckets with ≥10 disconnects):");
  for (const [k, v] of hotWindows) {
    const start = new Date(k * BUCKET_MS).toISOString().replace("T", " ").slice(0, 16);
    const tag = v.wpEvents.length
      ? ` ← correlates with: ${v.wpEvents.map((e) => e.event).join(", ")}`
      : "";
    console.log(`  ${start}  ${String(v.drops).padStart(4)} drops${tag}`);
  }
}

// ── Cause-classifier sanity check ────────────────────────────────────────────
// `unknown` is the "we couldn't attribute it" bucket — too many means the
// classifier in ssh-events.ts is missing a pattern.
const unknownCount = byCause.get("unknown")?.count ?? 0;
const totalDisc = disconnects.length;
if (totalDisc > 0 && unknownCount / totalDisc > 0.1) {
  console.log(`\nWARNING: ${unknownCount}/${totalDisc} (${Math.round(100 * unknownCount / totalDisc)}%) disconnects classified as "unknown" — check ssh-events.ts:classifySshDisconnect for missing patterns.`);
}

// Belt-and-braces: confirm row count matches the index (no filter mismatch).
const countRow = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(sshEvents)
  .where(whereClause);
console.log(`\n(DB count: ${countRow[0].n} rows in window — matches: ${countRow[0].n === all.length})`);

await closeDb();
