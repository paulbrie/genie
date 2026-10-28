// POST /api/vps/activity over real HTTP against the test DB: bearer auth, the
// token/instance check, envelope validation, and { accepted, duplicates,
// rejected } including a resent batch.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { isTestDbAvailable, setupTestDb, truncateAllTables, getTestDb } from "../test-helpers/db.js";
import { makeProject } from "../test-helpers/fixtures.js";
import { vpsActivityEvents } from "../db/schema.js";
import { ensureStatsToken } from "./stats-token-service.js";
import { handleVpsActivityPostback } from "./vps-activity-route.js";

describe.skipIf(!isTestDbAvailable())("POST /api/vps/activity", () => {
  let server: http.Server;
  let url: string;
  let projectId: string;
  let token: string;

  beforeAll(async () => {
    await setupTestDb();
    server = http.createServer((req, res) => void handleVpsActivityPostback(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/vps/activity`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  beforeEach(async () => {
    await truncateAllTables();
    projectId = (await makeProject()).id;
    token = await ensureStatsToken(projectId, "inst-1");
  });

  const post = (body: unknown, auth: string | null = `Bearer ${token}`) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  const ev = (over: Record<string, unknown> = {}) => ({
    v: 1, id: randomUUID(), ts: Date.now() - 1000, event: "page.view",
    session: "f".repeat(32), ipHash: "e".repeat(16), ua: "Firefox / Linux",
    props: { path: "/projects/[slug]", project: "p" }, ...over,
  });

  it("401 without a bearer token or with an unknown one", async () => {
    expect((await post({ projectId, instanceId: "inst-1", events: [] }, null)).status).toBe(401);
    expect((await post({ projectId, instanceId: "inst-1", events: [] }, "Bearer nope")).status).toBe(401);
  });

  it("403 when the body names another project or instance", async () => {
    expect((await post({ projectId: randomUUID(), instanceId: "inst-1", events: [ev()] })).status).toBe(403);
    expect((await post({ projectId, instanceId: "inst-2", events: [ev()] })).status).toBe(403);
  });

  it("400 for a bad envelope, 413 for an oversize body", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ projectId, instanceId: "inst-1" })).status).toBe(400);
    expect((await post({ projectId, instanceId: "inst-1", events: Array.from({ length: 501 }, () => ev()) })).status).toBe(400);
    const big = { projectId, instanceId: "inst-1", events: [ev({ props: { path: "/" + "x".repeat(300_000) } })] };
    expect((await post(big)).status).toBe(413);
  });

  it("stores valid events, rejects the rest, and dedupes a resent batch", async () => {
    const good = [ev(), ev({ event: "terminal.detach", props: { terminal: "claude", seconds: 12 } })];
    const batch = { projectId, instanceId: "inst-1", events: [...good, ev({ event: "terminal.output" }), ev({ props: { path: "/a?b=c" } })] };
    const r1 = await post(batch);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ accepted: 2, duplicates: 0, rejected: 2 });

    const r2 = await post(batch);
    expect(await r2.json()).toEqual({ accepted: 0, duplicates: 2, rejected: 2 });

    const rows = await getTestDb().select().from(vpsActivityEvents);
    expect(rows.map((r) => r.id).sort()).toEqual(good.map((g) => g.id).sort());
    expect(rows.every((r) => r.projectId === projectId && r.instanceId === "inst-1")).toBe(true);
  });

  it("takes the owner from the token when the body omits ids, and an empty batch is fine", async () => {
    const r = await post({ events: [ev()] });
    expect(await r.json()).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    const e = await post({ projectId, instanceId: "inst-1", events: [] });
    expect(await e.json()).toEqual({ accepted: 0, duplicates: 0, rejected: 0 });
  });
});
