// Integration tests for project-service. Skips entirely when DB_TEST is not
// set (see src/test-helpers/db.ts). Truncates all data tables before each
// test so cases are independent.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  isTestDbAvailable,
  setupTestDb,
  truncateAllTables,
} from "../test-helpers/db.js";
import {
  addUserToOrg,
  addUserToTeam,
  makeOrg,
  makeProject,
  makeTeam,
  makeUser,
} from "../test-helpers/fixtures.js";
import * as projectService from "./project-service.js";

describe.skipIf(!isTestDbAvailable())("project-service (integration)", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  describe("soft delete", () => {
    it("remove() makes the project invisible to getById and getAll", async () => {
      const team = await makeTeam();
      const proj = await projectService.add({ name: "demo", teamId: team.id });
      expect(await projectService.getById(proj.id)).not.toBeNull();

      const ok = await projectService.remove(proj.id);
      expect(ok).toBe(true);

      expect(await projectService.getById(proj.id)).toBeNull();
      const all = await projectService.getAll();
      expect(all.some((p) => p.id === proj.id)).toBe(false);
    });

    it("remove() on an already-deleted project returns false", async () => {
      const proj = await projectService.add({ name: "demo" });
      expect(await projectService.remove(proj.id)).toBe(true);
      expect(await projectService.remove(proj.id)).toBe(false);
    });

    it("update() on a deleted project returns null", async () => {
      const proj = await projectService.add({ name: "demo" });
      await projectService.remove(proj.id);
      const result = await projectService.update(proj.id, { name: "renamed" });
      expect(result).toBeNull();
    });

    it("addProjectMember on creation gives the creator owner access regardless of team", async () => {
      const creator = await makeUser();
      const proj = await projectService.add({
        name: "owned",
        createdByUserId: creator.id,
      });
      const members = await projectService.getProjectMembers(proj.id);
      const me = members.find((m) => m.userId === creator.id);
      expect(me?.role).toBe("owner");
    });
  });

  describe("getAllForUser visibility", () => {
    it("null userId returns an empty list", async () => {
      await projectService.add({ name: "a" });
      expect(await projectService.getAllForUser(null)).toEqual([]);
    });

    it("user with no memberships sees nothing", async () => {
      const user = await makeUser();
      const team = await makeTeam();
      await projectService.add({ name: "hidden", teamId: team.id });
      expect(await projectService.getAllForUser(user.id)).toEqual([]);
    });

    it("team member sees projects belonging to their team", async () => {
      const user = await makeUser();
      const team = await makeTeam();
      await addUserToTeam(team.id, user.id);
      const proj = await projectService.add({ name: "mine", teamId: team.id });
      // A project on a different team must not appear.
      const otherTeam = await makeTeam();
      await projectService.add({ name: "other", teamId: otherTeam.id });

      const visible = await projectService.getAllForUser(user.id);
      expect(visible.map((p) => p.id)).toEqual([proj.id]);
    });

    it("org owner sees projects in any team within their org", async () => {
      const owner = await makeUser();
      const org = await makeOrg();
      await addUserToOrg(org.id, owner.id, "owner");
      const team = await makeTeam({ orgId: org.id });
      const proj = await projectService.add({ name: "inorg", teamId: team.id });

      // Project in an unrelated org/team must not appear.
      const otherOrg = await makeOrg();
      const otherTeam = await makeTeam({ orgId: otherOrg.id });
      await projectService.add({ name: "outside", teamId: otherTeam.id });

      const visible = await projectService.getAllForUser(owner.id);
      expect(visible.map((p) => p.id)).toEqual([proj.id]);
    });

    it("superadmin sees every (non-deleted) project, even outside any org", async () => {
      const root = await makeUser({ role: "superadmin" });
      const t1 = await makeTeam();
      const t2 = await makeTeam();
      const p1 = await projectService.add({ name: "p1", teamId: t1.id });
      const p2 = await projectService.add({ name: "p2", teamId: t2.id });
      const dead = await projectService.add({ name: "dead", teamId: t1.id });
      await projectService.remove(dead.id);

      const visible = await projectService.getAllForUser(root.id);
      const ids = new Set(visible.map((p) => p.id));
      expect(ids.has(p1.id)).toBe(true);
      expect(ids.has(p2.id)).toBe(true);
      expect(ids.has(dead.id)).toBe(false);
    });

    it("global admin role without an org membership sees nothing", async () => {
      // Documented intent: the "admin" role is global but the auth flow
      // auto-creates a default org for admins on first login; if they somehow
      // lack one, visibility is empty. Confirms the doc invariant.
      const orphanAdmin = await makeUser({ role: "admin" });
      const t = await makeTeam();
      await projectService.add({ name: "p", teamId: t.id });
      expect(await projectService.getAllForUser(orphanAdmin.id)).toEqual([]);
    });
  });

  describe("usersShareTeam", () => {
    it("returns true for the same user", async () => {
      const u = await makeUser();
      expect(await projectService.usersShareTeam(u.id, u.id)).toBe(true);
    });

    it("returns true when both users are on the same team", async () => {
      const a = await makeUser();
      const b = await makeUser();
      const team = await makeTeam();
      await addUserToTeam(team.id, a.id);
      await addUserToTeam(team.id, b.id);
      expect(await projectService.usersShareTeam(a.id, b.id)).toBe(true);
    });

    it("returns false when users share no teams", async () => {
      const a = await makeUser();
      const b = await makeUser();
      const t1 = await makeTeam();
      const t2 = await makeTeam();
      await addUserToTeam(t1.id, a.id);
      await addUserToTeam(t2.id, b.id);
      expect(await projectService.usersShareTeam(a.id, b.id)).toBe(false);
    });

    it("returns false when one user has no team memberships", async () => {
      const a = await makeUser();
      const b = await makeUser();
      const team = await makeTeam();
      await addUserToTeam(team.id, a.id);
      expect(await projectService.usersShareTeam(a.id, b.id)).toBe(false);
    });
  });

  describe("getPagedForUser", () => {
    it("paginates name-sorted results and reports the unfiltered total", async () => {
      const user = await makeUser({ role: "superadmin" });
      for (const name of ["banana", "Apple", "cherry"]) {
        await projectService.add({ name });
      }
      const page = await projectService.getPagedForUser(user.id, {
        page: 1,
        pageSize: 2,
        search: "",
      });
      expect(page.total).toBe(3);
      expect(page.projects.map((p) => p.name)).toEqual(["Apple", "banana"]);
    });

    it("filters by case-insensitive substring on name", async () => {
      const user = await makeUser({ role: "superadmin" });
      await projectService.add({ name: "Orange Pi" });
      await projectService.add({ name: "blueberry" });
      const page = await projectService.getPagedForUser(user.id, {
        page: 1,
        pageSize: 10,
        search: "PI",
      });
      expect(page.projects.map((p) => p.name)).toEqual(["Orange Pi"]);
    });
  });
});
