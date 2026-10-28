// vps:sso-origin:set — the per-instance "Sign in with Genie" origin decides
// where server sign-in may post an assertion, so only the project's managers
// may set it. DB-gated; the identity-file refresh over SSH is mocked.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { WebSocket } from "ws";
import { isTestDbAvailable, setupTestDb, truncateAllTables } from "../test-helpers/db.js";
import { makeUser, makeProject, addProjectMember } from "../test-helpers/fixtures.js";
import type { ClientState } from "../ws-server.js";

const synced = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../vps/ensure-vps-stats.js", async (orig) => ({
  ...(await orig<typeof import("../vps/ensure-vps-stats.js")>()),
  writeInstanceIdentityFile: async (_c: unknown, projectId: string, instanceId: string) => { synced.calls.push(`${projectId}:${instanceId}`); },
}));
vi.mock("../vps/connection-resolver.js", () => ({ getVpsConnection: async () => ({ host: "x", port: 22, username: "genie", privateKeyPath: "" }) }));

const { handleVpsLifecycleMessage } = await import("./vps-lifecycle-handler.js");
const projectService = await import("../projects/project-service.js");

const fakeWs = {} as unknown as WebSocket;
function capture() {
  const sent: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  return { sent, send: (_ws: WebSocket, m: { type: string; payload?: Record<string, unknown> }) => { sent.push(m); }, types: () => sent.map((m) => m.type) };
}
const stateFor = (userId: string, role = "user") => ({ userId, role, impersonatedBy: null, user: { id: userId }, ip: null }) as unknown as ClientState;
const inst = { id: "inst-1", label: "prod", connection: { host: "10.1.2.3", port: 22, username: "genie", privateKeyPath: "" }, services: [] };

describe.skipIf(!isTestDbAvailable())("vps:sso-origin:set (security)", () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAllTables(); synced.calls = []; });

  const set = async (userId: string, projectId: string, origin: string | null, instanceId = "inst-1") => {
    const cap = capture();
    await handleVpsLifecycleMessage(fakeWs, { type: "vps:sso-origin:set", payload: { projectId, instanceId, origin } } as never,
      cap.send, () => {}, stateFor(userId));
    return cap;
  };

  it("a plain member or an outsider can't set it; the owner can, normalised, and the identity file is refreshed", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const outsider = await makeUser();
    const proj = await makeProject({ vps: [inst] });
    await addProjectMember(proj.id, owner.id, "owner");
    await addProjectMember(proj.id, member.id, "member");

    for (const u of [member, outsider]) {
      const cap = await set(u.id, proj.id, "https://evil.example");
      expect(cap.types()).toContain("error");
      expect(cap.types()).not.toContain("vps:sso-origin:set:done");
    }
    expect((await projectService.getById(proj.id))!.vpsInstances[0].ssoOrigin).toBeUndefined();

    const ok = await set(owner.id, proj.id, "Box.Example.org/");
    expect(ok.sent.find((m) => m.type === "vps:sso-origin:set:done")?.payload?.origin).toBe("https://box.example.org");
    expect((await projectService.getById(proj.id))!.vpsInstances[0].ssoOrigin).toBe("https://box.example.org");
    await vi.waitFor(() => expect(synced.calls).toEqual([`${proj.id}:inst-1`]));

    const cleared = await set(owner.id, proj.id, null);
    expect(cleared.types()).toContain("vps:sso-origin:set:done");
    expect((await projectService.getById(proj.id))!.vpsInstances[0].ssoOrigin).toBeUndefined();
  });

  it("a superadmin can set it; bad origins and unknown instances are refused", async () => {
    const root = await makeUser({ role: "superadmin" });
    const proj = await makeProject({ vps: [inst] });
    expect((await set(root.id, proj.id, "https://ok.example")).types()).toContain("vps:sso-origin:set:done");
    for (const bad of ["http://plain.example", "https://x.example/admin", "https://u:p@x.example"]) {
      const cap = await set(root.id, proj.id, bad);
      expect(cap.types(), bad).toContain("vps:sso-origin:set:error");
    }
    expect((await set(root.id, proj.id, "https://ok.example", "nope")).sent.find((m) => m.type === "vps:sso-origin:set:error")?.payload?.message)
      .toBe("Server not found on this project");
    expect((await projectService.getById(proj.id))!.vpsInstances[0].ssoOrigin).toBe("https://ok.example");
  });
});
