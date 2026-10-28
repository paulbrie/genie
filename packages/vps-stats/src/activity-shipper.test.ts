// The activity shipper against a real local HTTP server (node:http) and a
// scratch spool dir: rename-based rotation, offsets + resume after a restart,
// batch limits, oversize/malformed/stale line drops, and the 2xx / 4xx / 429 /
// 5xx / network-error rules from the activity contract.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import {
  createActivityShipper,
  readActivityConfig,
  ACTIVITY_MAX_BODY_BYTES,
  ACTIVITY_BACKOFF_MAX_MS,
  type ActivityShipperConfig,
} from "./activity-shipper.js";

interface Received {
  auth: string | undefined;
  bytes: number;
  body: { projectId: string; instanceId: string; events: { id: string; ts: number; event: string; props?: Record<string, unknown> }[] };
}

/** Programmable fake manager: `respond` decides each reply (status + body). */
class FakeManager {
  received: Received[] = [];
  respond: (r: Received, n: number) => { status: number; body?: unknown } = (r) => ({
    status: 200,
    body: { accepted: r.body.events.length, duplicates: 0, rejected: 0 },
  });
  private server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const r: Received = { auth: req.headers.authorization, bytes: raw.length, body: JSON.parse(raw.toString("utf-8")) };
      this.received.push(r);
      const out = this.respond(r, this.received.length);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.body ?? {}));
    });
  });
  url = "";
  async listen(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/api/vps/activity`;
  }
  async close(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }
  get events() {
    return this.received.flatMap((r) => r.body.events);
  }
}

const PROJECT = "11111111-1111-4111-8111-111111111111";
const INSTANCE = "inst-1";
let dir: string;
let spool: string;
let mgr: FakeManager;
let clock: number;
let logs: string[];

function line(i: number, extra: Partial<{ ts: number; props: Record<string, unknown> }> = {}): string {
  const hex = i.toString(16).padStart(12, "0");
  return JSON.stringify({
    v: 1,
    id: `00000000-0000-4000-8000-${hex}`,
    ts: extra.ts ?? clock - 1000,
    event: "page.view",
    session: "a".repeat(32),
    ipHash: "b".repeat(16),
    ua: "Chrome / macOS",
    props: extra.props ?? { path: "/projects/[slug]/files", project: "genie-brand" },
  }) + "\n";
}

/** A minimal (~85-byte) event (nullable fields left out), so 500 of them fit under the body limit. */
function tiny(i: number): string {
  const hex = i.toString(16).padStart(12, "0");
  return JSON.stringify({ v: 1, id: `00000000-0000-4000-8000-${hex}`, ts: clock - 1000, event: "auth.logout" }) + "\n";
}

function shipper(over: Partial<ActivityShipperConfig> = {}) {
  return createActivityShipper({
    spoolPath: spool,
    url: mgr.url,
    token: "tok",
    projectId: PROJECT,
    instanceId: INSTANCE,
    now: () => clock,
    sleep: async () => {},
    log: (l) => logs.push(l),
    ...over,
  });
}

const files = () => fs.readdirSync(dir).sort();

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "activity-test-"));
  spool = path.join(dir, "activity.jsonl");
  clock = Date.UTC(2026, 9, 28, 12, 0, 0);
  logs = [];
  mgr = new FakeManager();
  await mgr.listen();
});

afterEach(async () => {
  await mgr.close();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("readActivityConfig", () => {
  const base = { GENIE_MANAGER_URL: "https://m.example/", GENIE_STATS_TOKEN: "t", GENIE_PROJECT_ID: "p", GENIE_INSTANCE_ID: "i" };
  it("is opt-in on GENIE_ACTIVITY_FILE", () => {
    expect(readActivityConfig(base)).toBeNull();
  });
  it("needs the postback env too", () => {
    expect(readActivityConfig({ GENIE_ACTIVITY_FILE: "/x/activity.jsonl", GENIE_MANAGER_URL: "https://m" })).toBeNull();
  });
  it("builds the upload URL from the manager base", () => {
    expect(readActivityConfig({ ...base, GENIE_ACTIVITY_FILE: "/x/activity.jsonl" })).toMatchObject({
      spoolPath: "/x/activity.jsonl",
      url: "https://m.example/api/vps/activity",
    });
  });
});

describe("activity shipper", () => {
  it("does nothing without a spool (or with an empty one)", async () => {
    await shipper().tick();
    fs.writeFileSync(spool, "");
    await shipper().tick();
    expect(mgr.received).toHaveLength(0);
    expect(files()).toEqual(["activity.jsonl"]);
  });

  it("renames the spool, ships it with the bearer token, then deletes it", async () => {
    fs.writeFileSync(spool, line(1) + line(2) + line(3));
    await shipper().tick();
    expect(mgr.received).toHaveLength(1);
    const [r] = mgr.received;
    expect(r.auth).toBe("Bearer tok");
    expect(r.body.projectId).toBe(PROJECT);
    expect(r.body.instanceId).toBe(INSTANCE);
    expect(r.body.events.map((e) => e.id.slice(-1))).toEqual(["1", "2", "3"]);
    expect(files()).toEqual([]); // spool renamed away, shipping + offset deleted
  });

  it("an append after the rename goes to a fresh spool and ships next tick", async () => {
    fs.writeFileSync(spool, line(1));
    const s = shipper({
      // Simulate the writer appending (by path) during the settle wait.
      sleep: async () => { fs.appendFileSync(spool, line(2)); },
    });
    await s.tick();
    expect(mgr.events.map((e) => e.id.slice(-1))).toEqual(["1"]);
    expect(files()).toEqual(["activity.jsonl"]);
    await s.tick();
    expect(mgr.events.map((e) => e.id.slice(-1))).toEqual(["1", "2"]);
  });

  it("splits into batches of at most 500 events", async () => {
    let body = "";
    for (let i = 0; i < 1200; i++) body += tiny(i);
    fs.writeFileSync(spool, body);
    await shipper().tick();
    expect(mgr.received.map((r) => r.body.events.length)).toEqual([500, 500, 200]);
    expect(new Set(mgr.events.map((e) => e.id)).size).toBe(1200);
  });

  it("keeps every request body under 60 KB", async () => {
    const big = { path: "/p", project: "x".repeat(190), a: "y".repeat(200), b: "z".repeat(200), c: "w".repeat(200) };
    let body = "";
    for (let i = 0; i < 400; i++) body += line(i, { props: big });
    fs.writeFileSync(spool, body);
    await shipper().tick();
    expect(mgr.received.length).toBeGreaterThan(1);
    for (const r of mgr.received) {
      expect(r.bytes).toBeLessThan(ACTIVITY_MAX_BODY_BYTES);
      expect(r.body.events.length).toBeLessThanOrEqual(500);
    }
    // In order, none lost, none twice.
    expect(mgr.events.map((e) => e.id)).toEqual(Array.from({ length: 400 }, (_, i) => JSON.parse(line(i)).id));
  });

  it("drops an oversize line (and a malformed one) with a note, ships the rest", async () => {
    const huge = line(2, { props: { path: "/p", junk: "q".repeat(70_000) } });
    fs.writeFileSync(spool, line(1) + huge + "not json\n" + line(3));
    await shipper().tick();
    expect(mgr.events.map((e) => e.id.slice(-1))).toEqual(["1", "3"]);
    expect(logs.some((l) => l.includes("oversize line"))).toBe(true);
    expect(logs.some((l) => l.includes("malformed line"))).toBe(true);
    expect(files()).toEqual([]);
  });

  it("drops an oversize line longer than the read window", async () => {
    const huge = line(2, { props: { path: "/p", junk: "q".repeat(300_000) } });
    fs.writeFileSync(spool, line(1) + huge + line(3));
    await shipper().tick();
    expect(mgr.events.map((e) => e.id.slice(-1))).toEqual(["1", "3"]);
  });

  it("5xx backs off (5 s doubling, capped at 5 min) and retries the same batch", async () => {
    fs.writeFileSync(spool, line(1) + line(2));
    mgr.respond = () => ({ status: 503 });
    const s = shipper();
    await s.tick();
    expect(mgr.received).toHaveLength(1);
    expect(s.backoffUntil).toBe(clock + 5_000);

    await s.tick(); // still backing off: no request
    expect(mgr.received).toHaveLength(1);

    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      clock = s.backoffUntil;
      const before = clock;
      await s.tick();
      waits.push(s.backoffUntil - before);
    }
    expect(waits).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, ACTIVITY_BACKOFF_MAX_MS, ACTIVITY_BACKOFF_MAX_MS, ACTIVITY_BACKOFF_MAX_MS]);
    // Every attempt resent the same two events.
    expect(mgr.received.every((r) => r.body.events.length === 2 && r.body.events[0].id === mgr.received[0].body.events[0].id)).toBe(true);

    mgr.respond = (r) => ({ status: 200, body: { accepted: r.body.events.length, duplicates: 0, rejected: 0 } });
    clock = s.backoffUntil;
    await s.tick();
    expect(s.backoffUntil).toBe(0); // reset after success
    expect(files()).toEqual([]);
  });

  it("429 backs off and retries", async () => {
    fs.writeFileSync(spool, line(1));
    mgr.respond = (_r, n) => (n === 1 ? { status: 429 } : { status: 200, body: { accepted: 1, duplicates: 0, rejected: 0 } });
    const s = shipper();
    await s.tick();
    expect(s.backoffUntil).toBe(clock + 5_000);
    clock += 5_000;
    await s.tick();
    expect(mgr.received).toHaveLength(2);
    expect(files()).toEqual([]);
  });

  it("401 and 403 back off and retry: a rotated token doesn't lose events", async () => {
    fs.writeFileSync(spool, line(1));
    mgr.respond = (_r, n) => (n === 1 ? { status: 401 } : n === 2 ? { status: 403 } : { status: 200, body: { accepted: 1, duplicates: 0, rejected: 0 } });
    const s = shipper();
    await s.tick();
    expect(s.backoffUntil).toBe(clock + 5_000);
    clock += 5_000;
    await s.tick();
    expect(s.backoffUntil).toBe(clock + 10_000);
    clock += 10_000;
    await s.tick();
    expect(mgr.received).toHaveLength(3);
    expect(files()).toEqual([]);
  });

  it("a network error backs off and keeps the file", async () => {
    fs.writeFileSync(spool, line(1));
    const s = shipper({ url: "http://127.0.0.1:1/api/vps/activity" });
    await s.tick();
    expect(s.backoffUntil).toBe(clock + 5_000);
    expect(logs.some((l) => l.startsWith("upload failed"))).toBe(true);
    expect(files().filter((f) => f.endsWith(".shipping"))).toHaveLength(1);
  });

  it("4xx (not 429) logs and skips that batch, then carries on", async () => {
    let body = "";
    for (let i = 0; i < 600; i++) body += tiny(i);
    fs.writeFileSync(spool, body);
    mgr.respond = (r, n) => (n === 1 ? { status: 400, body: { error: "Invalid body" } } : { status: 200, body: { accepted: r.body.events.length, duplicates: 0, rejected: 0 } });
    const s = shipper();
    await s.tick();
    expect(mgr.received.map((r) => r.body.events.length)).toEqual([500, 100]);
    expect(s.backoffUntil).toBe(0);
    expect(logs.some((l) => l.includes("HTTP 400") && l.includes("skipping"))).toBe(true);
    expect(files()).toEqual([]);
  });

  it("rejected events in a 2xx are logged, not retried", async () => {
    fs.writeFileSync(spool, line(1) + line(2));
    mgr.respond = () => ({ status: 200, body: { accepted: 1, duplicates: 0, rejected: 1 } });
    await shipper().tick();
    expect(mgr.received).toHaveLength(1);
    expect(logs.some((l) => l.includes("rejected 1 of 2"))).toBe(true);
    expect(files()).toEqual([]);
  });

  it("persists the offset and resumes after a restart without resending", async () => {
    let body = "";
    for (let i = 0; i < 1200; i++) body += tiny(i);
    fs.writeFileSync(spool, body);
    mgr.respond = (r, n) => (n === 1 ? { status: 200, body: { accepted: 500, duplicates: 0, rejected: 0 } } : { status: 502 });
    await shipper().tick(); // first batch ok, second fails → stops

    const shipping = files().find((f) => f.endsWith(".shipping"))!;
    expect(files()).toEqual([shipping, `${shipping}.offset`]);
    const offset = Number(fs.readFileSync(path.join(dir, `${shipping}.offset`), "utf-8"));
    expect(offset).toBe(Buffer.byteLength(body.split("\n").slice(0, 500).join("\n") + "\n"));

    // "Restart": a brand-new shipper (no in-memory backoff) picks up the file.
    mgr.respond = (r) => ({ status: 200, body: { accepted: r.body.events.length, duplicates: 0, rejected: 0 } });
    await shipper().tick();
    const ids = mgr.received.filter((_, i) => i !== 1).flatMap((r) => r.body.events.map((e) => e.id));
    expect(ids).toHaveLength(1200);
    expect(new Set(ids).size).toBe(1200);
    expect(files()).toEqual([]);
  });

  it("ships pending files oldest first and doesn't rotate while one is pending", async () => {
    fs.writeFileSync(path.join(dir, `activity-${clock - 2000}.shipping`), line(2));
    fs.writeFileSync(path.join(dir, `activity-${clock - 5000}.shipping`), line(1));
    fs.writeFileSync(spool, line(3));
    mgr.respond = (r, n) => (n === 2 ? { status: 500 } : { status: 200, body: { accepted: r.body.events.length, duplicates: 0, rejected: 0 } });
    const s = shipper();
    await s.tick();
    // Oldest went first; the second failed so the live spool stayed put.
    expect(mgr.received.map((r) => r.body.events[0].id.slice(-1))).toEqual(["1", "2"]);
    expect(files()).toEqual([`activity-${clock - 2000}.shipping`, "activity.jsonl"]);
    clock = s.backoffUntil;
    await s.tick(); // finishes the pending file; still no rotation this tick
    expect(files()).toEqual(["activity.jsonl"]);
    await s.tick();
    expect(mgr.events.map((e) => e.id.slice(-1))).toEqual(["1", "2", "2", "3"]);
    expect(files()).toEqual([]);
  });

  it("drops shipping files and events older than 7 days", async () => {
    const old = `activity-${clock - 8 * 86_400_000}.shipping`;
    fs.writeFileSync(path.join(dir, old), line(1));
    fs.writeFileSync(path.join(dir, `${old}.offset`), "0");
    fs.writeFileSync(path.join(dir, "activity-123.shipping.offset"), "5"); // orphan
    fs.writeFileSync(spool, line(2, { ts: clock - 8 * 86_400_000 }) + line(3));
    await shipper().tick();
    expect(mgr.events.map((e) => e.id.slice(-1))).toEqual(["3"]);
    expect(logs.some((l) => l.includes("older than 7 days"))).toBe(true);
    expect(files()).toEqual([]);
  });

  it("a file of only dropped lines is cleaned up without a request", async () => {
    fs.writeFileSync(spool, "garbage\n" + line(1, { ts: clock - 10 * 86_400_000 }));
    await shipper().tick();
    expect(mgr.received).toHaveLength(0);
    expect(files()).toEqual([]);
  });

  it("never throws out of tick", async () => {
    fs.writeFileSync(spool, line(1));
    const s = shipper({ fetchImpl: (() => { throw new Error("boom"); }) as unknown as typeof fetch });
    await expect(s.tick()).resolves.toBeUndefined();
  });
});
