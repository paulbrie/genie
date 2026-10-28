// genie-local activity: the per-event validation (pure) and, against the test
// DB, ingest + dedupe, retention pruning and the superadmin summary query.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { isTestDbAvailable, setupTestDb, truncateAllTables, getTestDb } from "../test-helpers/db.js";
import { makeProject } from "../test-helpers/fixtures.js";
import { vpsActivityEvents } from "../db/schema.js";
import {
  validateActivityEvent,
  ingestActivityBatch,
  pruneOldActivity,
  getActivitySummary,
} from "./vps-activity-service.js";

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

function ev(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    id: randomUUID(),
    ts: NOW - 1000,
    event: "page.view",
    session: "0123456789abcdef0123456789abcdef",
    ipHash: "0123456789abcdef",
    ua: "Chrome / macOS",
    props: { path: "/projects/[slug]/files", project: "genie-brand" },
    ...over,
  };
}

describe("validateActivityEvent", () => {
  it("accepts a contract-shaped line", () => {
    const r = validateActivityEvent(ev(), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.event).toBe("page.view");
      expect(r.row.props).toEqual({ path: "/projects/[slug]/files", project: "genie-brand" });
      expect(r.row.occurredAt.getTime()).toBe(NOW - 1000);
    }
  });

  it("accepts every allowlisted event with its props", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["action", { name: "POST /api/projects/[slug]/deploy", project: "x", ok: false }],
      ["terminal.attach", { terminal: "claude" }],
      ["terminal.detach", { terminal: "claude", seconds: 93.5 }],
      ["auth.login", {}],
      ["auth.logout", {}],
      ["auth.failed", { reason: "bad password" }],
    ];
    for (const [event, props] of cases) {
      expect(validateActivityEvent(ev({ event, props }), NOW)).toMatchObject({ ok: true, row: { event, props } });
    }
  });

  it("allows null session / ipHash / ua and missing props", () => {
    const r = validateActivityEvent(ev({ event: "auth.logout", session: null, ipHash: null, ua: null, props: undefined }), NOW);
    expect(r).toMatchObject({ ok: true, row: { sessionId: null, ipHash: null, ua: null, props: {} } });
  });

  it("rejects unknown events and bad shapes", () => {
    const bad: [Record<string, unknown> | unknown, string][] = [
      [ev({ event: "terminal.input" }), "unknown event"],
      [ev({ v: 2 }), "bad version"],
      [ev({ id: "not-a-uuid" }), "bad id"],
      [ev({ ts: "yesterday" }), "bad ts"],
      [ev({ ts: NOW + 2 * 86_400_000 }), "bad ts"],
      [ev({ ts: 1000 }), "bad ts"],
      [ev({ session: "short" }), "bad session"],
      [ev({ ipHash: "10.0.0.1" }), "bad ipHash"],
      [ev({ ua: "x".repeat(61) }), "bad ua"],
      [ev({ props: [1, 2] }), "bad props"],
      [ev({ props: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, i])) }), "too many props"],
      [ev({ props: { path: "/x", project: "y".repeat(201) } }), "bad prop value"],
      [ev({ props: { path: "/x", nested: { a: 1 } } }), "bad prop value"],
      [ev({ props: { path: 42 } }), "bad prop path"],
      [ev({ event: "action", props: { name: "x", ok: "yes" } }), "bad prop ok"],
      [ev({ props: { path: "/projects/genie?tab=files" } }), "bad path"],
      [ev({ props: { path: "projects" } }), "bad path"],
      [ev({ event: "terminal.detach", props: { terminal: "t", seconds: -1 } }), "bad seconds"],
      [[1], "not an object"],
      [null, "not an object"],
    ];
    for (const [raw, reason] of bad) {
      expect(validateActivityEvent(raw, NOW)).toEqual({ ok: false, reason });
    }
  });

  it("stores only the props the contract defines for the event", () => {
    const r = validateActivityEvent(ev({ event: "auth.failed", props: { reason: "bad password", username: "alice", sql: "select 1" } }), NOW);
    expect(r).toMatchObject({ ok: true, row: { props: { reason: "bad password" } } });
    if (r.ok) expect(Object.keys(r.row.props)).toEqual(["reason"]);
  });
});

describe.skipIf(!isTestDbAvailable())("vps-activity-service (DB)", () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAllTables(); });

  it("inserts valid events, counts rejects, and ignores ids it already has", async () => {
    const project = await makeProject();
    const a = ev({ ts: Date.now() - 1000 });
    const b = ev({ ts: Date.now() - 500, event: "auth.login", props: {} });
    const first = await ingestActivityBatch(project.id, "inst-1", [a, b, ev({ event: "nope" })]);
    expect(first).toMatchObject({ accepted: 2, duplicates: 0, rejected: 1, reasons: { "unknown event": 1 } });

    // Same batch again (a retried upload) plus one new event, and a dup within the batch.
    const c = ev({ ts: Date.now() - 100 });
    const second = await ingestActivityBatch(project.id, "inst-1", [a, b, c, c]);
    expect(second).toMatchObject({ accepted: 1, duplicates: 3, rejected: 0 });

    const rows = await getTestDb().select().from(vpsActivityEvents);
    expect(rows).toHaveLength(3);
    const row = rows.find((r) => r.id === a.id)!;
    expect(row).toMatchObject({ projectId: project.id, instanceId: "inst-1", event: "page.view", sessionId: a.session, ipHash: a.ipHash });
    expect(row.occurredAt.getTime()).toBe(a.ts);
  });

  it("prunes events older than the retention window", async () => {
    const project = await makeProject();
    await ingestActivityBatch(project.id, "i", [ev({ ts: Date.now() - 1000 }), ev({ ts: Date.now() - 1000 })]);
    const db = getTestDb();
    await db.insert(vpsActivityEvents).values({
      id: randomUUID(), projectId: project.id, instanceId: "i", event: "auth.login", props: {},
      occurredAt: new Date(Date.now() - 200 * 86_400_000),
    });
    expect(await pruneOldActivity(180)).toBe(1);
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM vps_activity_events`)) as unknown as { n: number }[];
    expect(n).toBe(2);
  });

  it("summarises per instance: sessions, days, pages, actions, terminal time, recent", async () => {
    const p1 = await makeProject({
      name: "brand",
      vps: [{ id: "inst-a", label: "production", connection: { host: "h", port: 22, username: "genie" }, services: [] }],
    });
    const p2 = await makeProject({ name: "other" });
    const now = Date.now();
    const s1 = "a".repeat(32);
    const s2 = "b".repeat(32);
    const s3 = "c".repeat(32);
    const at = (minsAgo: number) => now - minsAgo * 60_000;
    await ingestActivityBatch(p1.id, "inst-a", [
      ev({ session: s1, ts: at(2), props: { path: "/projects/[slug]/files", project: "brand" } }),
      ev({ session: s1, ts: at(3), props: { path: "/projects/[slug]/files" } }),
      ev({ session: s2, ts: at(5), props: { path: "/" } }),
      ev({ session: s1, ts: at(4), event: "action", props: { name: "saveFile", ok: true } }),
      ev({ session: s1, ts: at(4), event: "action", props: { name: "saveFile", ok: false } }),
      ev({ session: s2, ts: at(6), event: "action", props: { name: "DELETE /api/files/[id]" } }),
      ev({ session: s1, ts: at(10), event: "terminal.attach", props: { terminal: "claude" } }),
      ev({ session: s1, ts: at(1), event: "terminal.detach", props: { terminal: "claude", seconds: 540 } }),
      ev({ session: s2, ts: at(1), event: "terminal.detach", props: { terminal: "shell", seconds: 60 } }),
      // Older session: active "in range" but not in the last 15 minutes.
      ev({ session: s3, ts: now - 3 * 86_400_000, event: "auth.login", props: {} }),
    ]);
    await ingestActivityBatch(p2.id, "inst-b", [ev({ session: s3, ts: at(1), event: "auth.logout", props: {} })]);

    const s = await getActivitySummary(new Date(now - 7 * 86_400_000));
    expect(s.totals).toMatchObject({ events: 11, sessions: 3, activeSessions15m: 3, terminalSeconds: 600 });
    expect(s.instances.map((i) => [i.projectName, i.instanceId, i.instanceLabel, i.events])).toEqual([
      ["brand", "inst-a", "production", 10],
      ["other", "inst-b", null, 1],
    ]);
    const a = s.instances[0];
    expect(a).toMatchObject({ sessions: 3, activeSessions15m: 2, terminalSeconds: 600 });
    expect(a.lastEventAt).toBe(new Date(at(1)).toISOString());
    expect(s.topPages).toEqual([
      { path: "/projects/[slug]/files", count: 2, sessions: 1 },
      { path: "/", count: 1, sessions: 1 },
    ]);
    expect(s.topActions).toEqual([
      { name: "saveFile", count: 2, failed: 1 },
      { name: "DELETE /api/files/[id]", count: 1, failed: 0 },
    ]);
    expect(s.terminals).toEqual([
      { terminal: "claude", attaches: 1, seconds: 540 },
      { terminal: "shell", attaches: 0, seconds: 60 },
    ]);
    expect(s.daily.reduce((n, d) => n + d.events, 0)).toBe(11);
    // Zero-filled: one entry per UTC day from the range start to today.
    expect(s.daily).toHaveLength(8);
    expect(s.daily.filter((d) => d.events > 0)).toHaveLength(2);
    expect(s.daily[s.daily.length - 1].day).toBe(new Date().toISOString().slice(0, 10));
    expect(s.eventCounts.slice(0, 2)).toEqual([{ event: "action", count: 3 }, { event: "page.view", count: 3 }]);
    expect(s.recent).toHaveLength(11);
    expect(new Date(s.recent[0].occurredAt).getTime()).toBeGreaterThanOrEqual(new Date(s.recent[1].occurredAt).getTime());

    // Scoped to one instance, and to a shorter range.
    const scoped = await getActivitySummary(new Date(now - 86_400_000), { projectId: p1.id, instanceId: "inst-a" });
    expect(scoped.totals).toMatchObject({ events: 9, sessions: 2 });
    expect(scoped.instances).toHaveLength(1);
    expect(scoped.recent.every((r) => r.projectId === p1.id)).toBe(true);
  });

  it("is empty with no events", async () => {
    const s = await getActivitySummary(new Date(Date.now() - 86_400_000));
    expect(s.totals).toEqual({ events: 0, sessions: 0, activeSessions15m: 0, activeSessionsToday: 0, terminalSeconds: 0 });
    expect(s.instances).toEqual([]);
    expect(s.recent).toEqual([]);
  });
});
