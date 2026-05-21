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
      expect(canSend("user", "admin:droplets:list")).toBe(false);
      expect(canSend("tazcloud", "admin:droplets:list")).toBe(true);
      expect(canSend("admin", "admin:droplets:list")).toBe(true);
      expect(canReceive("tazcloud", "admin:droplets:list:stale")).toBe(true);
    });

    it("admin:tazcloud sub-namespace is tazcloud-accessible", () => {
      expect(canSend("tazcloud", "admin:tazcloud:list")).toBe(true);
      expect(canSend("user", "admin:tazcloud:list")).toBe(false);
    });

    it("longer namespace prefix wins over shorter (admin:droplets beats admin)", () => {
      const entry = getEntry("admin:droplets:create");
      expect(entry?.receive).toBe("tazcloud");
    });

    it("user-facing namespaces are accessible to all roles", () => {
      expect(canSend("user", "chat:send")).toBe(true);
      expect(canReceive("user", "chat:message")).toBe(true);
      expect(canSend("user", "terminal:write")).toBe(true);
      expect(canSend("user", "vps:deploy")).toBe(true);
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

    it("recipes namespace is superadmin-only", () => {
      expect(canSend("admin", "recipes:list")).toBe(false);
      expect(canSend("superadmin", "recipes:list")).toBe(true);
      expect(canReceive("admin", "recipes:list")).toBe(false);
      expect(canReceive("superadmin", "recipes:list")).toBe(true);
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
