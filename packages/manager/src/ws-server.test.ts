// WS server integration test — boots the full server and exercises one
// representative round trip end-to-end. Opt-in via WS_INTEGRATION=1 in
// addition to DB_TEST.
//
// Pattern: one bootTestWsServer() per test process (in beforeAll). Per test,
// truncate the DB and create a fresh user + JWT. This costs ~1s of boot but
// each subsequent test is fast.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb, truncateAllTables } from "./test-helpers/db.js";
import {
  bootTestWsServer,
  teardownTestWsServer,
  connectAuthenticated,
  mintTestJwt,
  isWsIntegrationEnabled,
} from "./test-helpers/ws.js";
import { makeUser, makeTeam, makeProject } from "./test-helpers/fixtures.js";
import { addUserToTeam } from "./test-helpers/fixtures.js";

describe.skipIf(!isWsIntegrationEnabled())("ws-server (integration)", () => {
  let port = 0;

  beforeAll(async () => {
    await setupTestDb();
    const booted = await bootTestWsServer();
    port = booted.port;
  }, 30_000);

  afterAll(() => {
    teardownTestWsServer();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  it("rejects an invalid JWT with auth:failed", async () => {
    // No DB user inserted — verifyToken returns null, server replies auth:failed.
    const { ws, send, waitFor } = await (async () => {
      const w = new (await import("ws")).default(`ws://127.0.0.1:${port}`);
      const inbox: { type: string }[] = [];
      w.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
      await new Promise<void>((res, rej) => {
        w.once("open", () => res());
        w.once("error", rej);
      });
      const send = (type: string, payload?: unknown) =>
        w.send(JSON.stringify({ type, payload }));
      const waitFor = (pred: (m: { type: string }) => boolean, timeoutMs = 3000) =>
        new Promise<{ type: string }>((res, rej) => {
          const hit = inbox.find(pred);
          if (hit) return res(hit);
          const t = setInterval(() => {
            const h = inbox.find(pred);
            if (h) {
              clearInterval(t);
              res(h);
            }
          }, 25);
          setTimeout(() => {
            clearInterval(t);
            rej(new Error("timeout"));
          }, timeoutMs);
        });
      return { ws: w, send, waitFor };
    })();

    await waitFor((m) => m.type === "auth:required");
    send("auth:token", { token: "not-a-real-jwt" });
    const failed = await waitFor((m) => m.type === "auth:failed");
    expect(failed.type).toBe("auth:failed");
    ws.close();
  });

  it("authenticates with a valid JWT and returns the user's projects on project:list", async () => {
    const user = await makeUser({ validated: true, role: "user" });
    const team = await makeTeam();
    await addUserToTeam(team.id, user.id);
    const proj = await makeProject({ teamId: team.id });
    // A second project on an unrelated team must NOT leak.
    const otherTeam = await makeTeam();
    await makeProject({ teamId: otherTeam.id, name: "hidden" });

    const jwt = await mintTestJwt(user.id);
    const client = await connectAuthenticated(port, jwt);

    client.send("project:list");
    const reply = (await client.waitFor((m) => m.type === "project:list")) as {
      type: string;
      payload: { projects: Array<{ id: string; name: string }> };
    };
    const ids = new Set(reply.payload.projects.map((p) => p.id));
    expect(ids.has(proj.id)).toBe(true);
    expect(reply.payload.projects.some((p) => p.name === "hidden")).toBe(false);

    client.close();
  });

  it("rejects an out-of-ACL message with error:forbidden", async () => {
    // A normal user is not allowed to send admin:* messages — the ACL gate
    // should reply with error:forbidden rather than routing to a handler.
    const user = await makeUser({ validated: true, role: "user" });
    const jwt = await mintTestJwt(user.id);
    const client = await connectAuthenticated(port, jwt);

    client.send("admin:users:list");
    const reply = await client.waitFor((m) => m.type === "error:forbidden");
    expect(reply.type).toBe("error:forbidden");

    client.close();
  });
});
