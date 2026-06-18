import { describe, it, expect } from "vitest";
import {
  ROLE_LEVEL,
  POLICY,
  canSend,
  canReceive,
  getEntry,
  type Role,
} from "./ws-acl.js";

const ROLES: Role[] = ["user", "tazcloud", "admin", "superadmin"];

describe("ws-acl", () => {
  describe("role hierarchy", () => {
    it("orders roles user < tazcloud < admin < superadmin", () => {
      expect(ROLE_LEVEL.user).toBeLessThan(ROLE_LEVEL.tazcloud);
      expect(ROLE_LEVEL.tazcloud).toBeLessThan(ROLE_LEVEL.admin);
      expect(ROLE_LEVEL.admin).toBeLessThan(ROLE_LEVEL.superadmin);
    });

    it("higher roles inherit lower-role permissions for canSend", () => {
      // Anything a `user` can send, every higher role can also send.
      const userSendable = ["project:list", "chat:send", "ping"];
      for (const t of userSendable) {
        for (const r of ROLES) {
          expect(canSend(r, t)).toBe(true);
        }
      }
    });

    it("higher roles inherit lower-role permissions for canReceive", () => {
      const userReceivable = ["project:list", "chat:send", "ping"];
      for (const t of userReceivable) {
        for (const r of ROLES) {
          expect(canReceive(r, t)).toBe(true);
        }
      }
    });
  });

  describe("default-deny policy", () => {
    it("POLICY constant is deny-unknown", () => {
      expect(POLICY).toBe("deny-unknown");
    });

    it("getEntry returns null for an unlisted top-level namespace", () => {
      expect(getEntry("totally-made-up:foo:bar")).toBeNull();
    });

    it("canSend returns false for an unlisted type, regardless of role", () => {
      for (const r of ROLES) {
        expect(canSend(r, "totally-made-up:foo")).toBe(false);
      }
    });

    it("canReceive returns false for an unlisted type, regardless of role", () => {
      for (const r of ROLES) {
        expect(canReceive(r, "totally-made-up:foo")).toBe(false);
      }
    });

    it("canSend/canReceive return false for a null role (unauthenticated)", () => {
      expect(canSend(null, "ping")).toBe(false);
      expect(canReceive(null, "ping")).toBe(false);
    });
  });

  describe("namespace defaults", () => {
    it("claude:stream:* is user-sendable (distinct from superadmin claude-plugins)", () => {
      for (const t of ["claude:stream:start", "claude:stream:input", "claude:stream:close"]) {
        expect(canSend("user", t)).toBe(true);
        expect(canReceive("user", t)).toBe(true);
      }
      // The unrelated claude-plugins namespace stays superadmin-only for mutations.
      expect(canSend("user", "claude-plugins:create")).toBe(false);
    });

    it("admin namespace requires admin role to send", () => {
      expect(canSend("user", "admin:db:list-tables")).toBe(false);
      expect(canSend("tazcloud", "admin:db:list-tables")).toBe(false);
      expect(canSend("admin", "admin:db:list-tables")).toBe(true);
      expect(canSend("superadmin", "admin:db:list-tables")).toBe(true);
    });

    it("admin namespace requires admin role to receive", () => {
      expect(canReceive("user", "admin:db:rows")).toBe(false);
      expect(canReceive("tazcloud", "admin:db:rows")).toBe(false);
      expect(canReceive("admin", "admin:db:rows")).toBe(true);
    });

    it("admin:droplets sub-namespace is tazcloud-accessible (clouds panel)", () => {
      // Read endpoints are lowered to "user" so org owners / plain users can see
      // the VMs they have access to (handlers scope by accessible projects).
      expect(canSend("user", "admin:droplets:list")).toBe(true);
      expect(canSend("user", "admin:droplets:stats")).toBe(true);
      expect(canSend("user", "admin:droplets:resolve-ssh-user")).toBe(true);
      expect(canSend("tazcloud", "admin:droplets:list")).toBe(true);
      expect(canSend("admin", "admin:droplets:list")).toBe(true);
      expect(canReceive("user", "admin:droplets:list:stale")).toBe(true);
      // Deploy (create) is open to users too (handler requires org-admin/privileged).
      expect(canSend("user", "admin:droplets:create")).toBe(true);
      // Other mutations stay tazcloud+ via the namespace default.
      expect(canSend("user", "admin:droplets:delete")).toBe(false);
      expect(canSend("user", "admin:droplets:rename")).toBe(false);
    });

    it("admin:tazcloud sub-namespace is tazcloud-accessible", () => {
      expect(canSend("tazcloud", "admin:tazcloud:list")).toBe(true);
      expect(canSend("user", "admin:tazcloud:list")).toBe(false);
    });

    it("longer namespace prefix wins over shorter (admin:droplets beats admin)", () => {
      // admin:droplets:delete has no per-type override, so it resolves to the
      // admin:droplets namespace default (tazcloud), not the broader admin one.
      const entry = getEntry("admin:droplets:delete");
      expect(entry?.receive).toBe("tazcloud");
    });

    it("logs:* is superadmin-only and the errors stream is server→client only", () => {
      // The whole logs surface (manager stdout + stderr error stream) is locked
      // to superadmin; admins can neither subscribe nor receive log frames, and
      // the error stream must never be sendable from a client.
      expect(canReceive("admin", "logs:data")).toBe(false);
      expect(canReceive("superadmin", "logs:data")).toBe(true);
      expect(canReceive("admin", "logs:errors:data")).toBe(false);
      expect(canReceive("superadmin", "logs:errors:data")).toBe(true);
      expect(canReceive("superadmin", "logs:errors:backlog")).toBe(true);
      expect(canSend("superadmin", "logs:errors:data")).toBe(false);
      // Subscribing/clearing rides the logs:* gate — superadmin-only now.
      expect(canSend("admin", "logs:subscribe")).toBe(false);
      expect(canSend("superadmin", "logs:subscribe")).toBe(true);
    });

    it("user-facing namespaces are accessible to all roles", () => {
      expect(canSend("user", "chat:send")).toBe(true);
      expect(canReceive("user", "chat:message")).toBe(true);
      expect(canSend("user", "terminal:write")).toBe(true);
      expect(canSend("user", "vps:deploy")).toBe(true);
      expect(canSend("user", "vps:stats:refresh")).toBe(true);
      expect(canReceive("user", "vm:conn:stats")).toBe(true);
    });

    it("stats and monitor are admin-only (audit MEDIUM)", () => {
      expect(canReceive("user", "stats")).toBe(false);
      expect(canReceive("admin", "stats")).toBe(true);
      expect(canReceive("user", "monitor:interval")).toBe(false);
      expect(canReceive("admin", "monitor:interval")).toBe(true);
    });
  });

  describe("per-type overrides (HIGH audit fixes)", () => {
    it("presence:detail: any user may request, only admins may receive", () => {
      expect(canSend("user", "presence:detail")).toBe(true);
      expect(canReceive("user", "presence:detail")).toBe(false);
      expect(canReceive("admin", "presence:detail")).toBe(true);
    });

    it("presence:nav remains user-level (override does not cascade)", () => {
      expect(canSend("user", "presence:nav")).toBe(true);
      expect(canReceive("user", "presence:nav")).toBe(true);
    });

    it("recipes:list is readable by any authenticated user (Add-ons catalog)", () => {
      expect(canSend("user", "recipes:list")).toBe(true);
      expect(canReceive("user", "recipes:list")).toBe(true);
      // Cache-invalidation broadcast reaches users so they refetch.
      expect(canReceive("user", "recipes:list:stale")).toBe(true);
    });

    it("recipe mutations remain superadmin-only", () => {
      for (const type of ["recipes:create", "recipes:update", "recipes:delete"]) {
        expect(canSend("admin", type)).toBe(false);
        expect(canSend("superadmin", type)).toBe(true);
      }
    });

    it("per-VM exec is user-sendable (handler enforces ownership); results are user-receivable", () => {
      expect(canSend("user", "admin:droplets:exec")).toBe(true);
      expect(canSend("user", "admin:tazcloud:exec")).toBe(true);
      expect(canSend("user", "admin:exec:cancel")).toBe(true);
      expect(canReceive("user", "admin:droplets:exec:result")).toBe(true);
      expect(canReceive("user", "admin:droplets:exec:progress")).toBe(true);
      expect(canReceive("user", "admin:tazcloud:exec:result")).toBe(true);
      expect(canReceive("user", "admin:tazcloud:exec:progress")).toBe(true);
    });

    it("other admin:droplets / admin:tazcloud ops stay tazcloud+ (exec/create overrides don't cascade)", () => {
      expect(canSend("user", "admin:droplets:delete")).toBe(false);
      expect(canSend("user", "admin:droplets:rename")).toBe(false);
      expect(canSend("user", "admin:tazcloud:create")).toBe(false);
      expect(canSend("tazcloud", "admin:droplets:delete")).toBe(true);
    });

    it("admin:impersonate:start requires superadmin", () => {
      expect(canSend("admin", "admin:impersonate:start")).toBe(false);
      expect(canSend("superadmin", "admin:impersonate:start")).toBe(true);
    });

    it("admin:impersonate:stop is sendable by any role (handler verifies impersonation state)", () => {
      // While impersonating, the active state.role is the *impersonated* user's role.
      // Often "user". The ACL must allow the stop message through so the user can exit.
      expect(canSend("user", "admin:impersonate:stop")).toBe(true);
      expect(canSend("tazcloud", "admin:impersonate:stop")).toBe(true);
      expect(canSend("admin", "admin:impersonate:stop")).toBe(true);
      expect(canSend("superadmin", "admin:impersonate:stop")).toBe(true);
    });

    it("lock can be set by tazcloud+; unlock requires superadmin", () => {
      // SET lock — tazcloud and above (namespace default)
      expect(canSend("user", "admin:droplets:lock")).toBe(false);
      expect(canSend("tazcloud", "admin:droplets:lock")).toBe(true);
      expect(canSend("tazcloud", "admin:tazcloud:lock")).toBe(true);
      // CLEAR lock — superadmin only
      expect(canSend("tazcloud", "admin:droplets:unlock")).toBe(false);
      expect(canSend("admin", "admin:droplets:unlock")).toBe(false);
      expect(canSend("superadmin", "admin:droplets:unlock")).toBe(true);
      expect(canSend("tazcloud", "admin:tazcloud:unlock")).toBe(false);
      expect(canSend("superadmin", "admin:tazcloud:unlock")).toBe(true);
      // Lock-state broadcasts still reach the tazcloud-role recipients that see the panels
      expect(canReceive("tazcloud", "admin:droplets:locked")).toBe(true);
      expect(canReceive("tazcloud", "admin:tazcloud:locked")).toBe(true);
    });
  });

  describe("manager-pty namespace (local shell on the manager host)", () => {
    // Every frame in this namespace is the sidebar Terminal — a real shell on
    // the prod box. Must stay locked to superadmin on BOTH send and receive,
    // and the gate has to survive *any* future sub-namespace expansion.
    const FRAMES = [
      // client → server
      "manager-pty:start",
      "manager-pty:data",
      "manager-pty:resize",
      "manager-pty:close",
      // server → client
      "manager-pty:output",
      "manager-pty:ready",
      "manager-pty:closed",
      "manager-pty:error",
    ];

    it("rejects send from every role below superadmin", () => {
      for (const t of FRAMES) {
        expect(canSend("user", t)).toBe(false);
        expect(canSend("tazcloud", t)).toBe(false);
        expect(canSend("admin", t)).toBe(false);
      }
    });

    it("allows send only for superadmin", () => {
      for (const t of FRAMES) {
        expect(canSend("superadmin", t)).toBe(true);
      }
    });

    it("rejects receive from every role below superadmin", () => {
      for (const t of FRAMES) {
        expect(canReceive("user", t)).toBe(false);
        expect(canReceive("tazcloud", t)).toBe(false);
        expect(canReceive("admin", t)).toBe(false);
      }
    });

    it("allows receive only for superadmin", () => {
      for (const t of FRAMES) {
        expect(canReceive("superadmin", t)).toBe(true);
      }
    });

    it("rejects unauthenticated (null role) on every frame", () => {
      for (const t of FRAMES) {
        expect(canSend(null, t)).toBe(false);
        expect(canReceive(null, t)).toBe(false);
      }
    });

    it("namespace prefix lookup resolves correctly for hypothetical sub-frames", () => {
      // A future "manager-pty:status" or "manager-pty:exec" frame must inherit
      // the superadmin gate by prefix — no silent escalation possible.
      const future = getEntry("manager-pty:status");
      expect(future?.send).toBe("superadmin");
      expect(future?.receive).toBe("superadmin");
    });

    it("does not bleed permissions into the unrelated terminal:* namespace", () => {
      // terminal:* is user-level (VM SSH connections). The two must not overlap.
      expect(canSend("user", "terminal:data")).toBe(true);
      expect(canSend("user", "terminal:start")).toBe(true);
      // And manager-pty:* must not be reachable by a user via the terminal default.
      expect(canSend("user", "manager-pty:start")).toBe(false);
    });
  });

  describe("knowledge namespace (Concepts bundle — superadmin-only)", () => {
    // The "Concepts" panel exposes conceptual docs about Genie's internals. The
    // whole namespace is superadmin-only on BOTH send and receive, and must stay
    // that way for every existing and future sub-frame (read, mutate, sync).
    const FRAMES = [
      "knowledge:list",
      "knowledge:create",
      "knowledge:update",
      "knowledge:delete",
      "knowledge:export",
      "knowledge:import",
      "knowledge:upserted",
      "knowledge:deleted",
      "knowledge:error",
      "knowledge:list:stale",
    ];

    it("rejects send from every role below superadmin", () => {
      for (const t of FRAMES) {
        expect(canSend("user", t)).toBe(false);
        expect(canSend("tazcloud", t)).toBe(false);
        expect(canSend("admin", t)).toBe(false);
      }
    });

    it("allows send only for superadmin", () => {
      for (const t of FRAMES) {
        expect(canSend("superadmin", t)).toBe(true);
      }
    });

    it("rejects receive from every role below superadmin", () => {
      for (const t of FRAMES) {
        expect(canReceive("user", t)).toBe(false);
        expect(canReceive("tazcloud", t)).toBe(false);
        expect(canReceive("admin", t)).toBe(false);
      }
    });

    it("allows receive only for superadmin", () => {
      for (const t of FRAMES) {
        expect(canReceive("superadmin", t)).toBe(true);
      }
    });

    it("rejects unauthenticated (null role) on every frame", () => {
      for (const t of FRAMES) {
        expect(canSend(null, t)).toBe(false);
        expect(canReceive(null, t)).toBe(false);
      }
    });

    it("a future knowledge:* sub-frame inherits the superadmin gate by prefix", () => {
      const future = getEntry("knowledge:something-new");
      expect(future?.send).toBe("superadmin");
      expect(future?.receive).toBe("superadmin");
    });
  });

  describe("orgs + per-project members", () => {
    it("admin:orgs:* requires admin role to send and receive", () => {
      expect(canSend("user", "admin:orgs:list")).toBe(false);
      expect(canSend("tazcloud", "admin:orgs:list")).toBe(false);
      expect(canSend("admin", "admin:orgs:list")).toBe(true);
      expect(canSend("admin", "admin:orgs:create")).toBe(true);
      expect(canSend("admin", "admin:orgs:members:add")).toBe(true);
      expect(canReceive("admin", "admin:orgs:created")).toBe(true);
      expect(canReceive("user", "admin:orgs:created")).toBe(false);
    });

    it("admin:users:invite requires admin role", () => {
      expect(canSend("user", "admin:users:invite")).toBe(false);
      expect(canSend("admin", "admin:users:invite")).toBe(true);
    });

    it("project:members:* lets users in (handler enforces scope)", () => {
      // The ACL layer just routes the message to the handler; the handler
      // calls userCanManageProject/userCanSeeProject for real authorization.
      expect(canSend("user", "project:members:list")).toBe(true);
      expect(canSend("user", "project:members:add")).toBe(true);
      expect(canSend("user", "project:members:remove")).toBe(true);
      expect(canSend("user", "project:members:set-role")).toBe(true);
      expect(canReceive("user", "project:members:list")).toBe(true);
      expect(canReceive("user", "project:members:updated")).toBe(true);
    });

    it("agents:* is reachable by plain users (handler scopes by userId)", () => {
      // Regression: the /agents page hung on "Loading agents…" when agents:*
      // was missing from the ACL — the list request was deny-unknown and the
      // reply never came back.
      expect(canSend("user", "agents:list")).toBe(true);
      expect(canSend("user", "agents:upsert")).toBe(true);
      expect(canSend("user", "agents:run")).toBe(true);
      expect(canReceive("user", "agents:list")).toBe(true);
      expect(canReceive("user", "agents:run:event")).toBe(true);
      expect(canReceive("user", "agents:run:complete")).toBe(true);
    });
  });

  describe("filterRecipients-like usage", () => {
    // The send wrappers will iterate clients and apply canReceive per recipient.
    // Validate the conceptual filter works.
    it("filters a mixed roster of recipients for presence:detail", () => {
      const recipients: { role: Role | null }[] = [
        { role: "user" },
        { role: "tazcloud" },
        { role: "admin" },
        { role: "superadmin" },
        { role: null },
      ];
      const survivors = recipients.filter((r) =>
        canReceive(r.role, "presence:detail"),
      );
      expect(survivors.map((r) => r.role)).toEqual(["admin", "superadmin"]);
    });

    it("filters a mixed roster for a user-level type (everyone keeps it)", () => {
      const recipients: { role: Role | null }[] = [
        { role: "user" },
        { role: "admin" },
        { role: null },
      ];
      const survivors = recipients.filter((r) => canReceive(r.role, "chat:message:received"));
      expect(survivors.map((r) => r.role)).toEqual(["user", "admin"]);
    });
  });
});
