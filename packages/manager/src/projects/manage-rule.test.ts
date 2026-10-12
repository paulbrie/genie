import { describe, it, expect } from "vitest";
import { canManageProject, canRestartProject } from "./manage-rule.js";

describe("canManageProject (who sees a server card's ⋮ menu and Settings)", () => {
  const none = new Set<string>();
  it("a superadmin and the project's owner may manage", () => {
    expect(canManageProject({ superadmin: true, memberRole: null, teamId: null, adminTeamIds: none })).toBe(true);
    expect(canManageProject({ superadmin: false, memberRole: "owner", teamId: "t1", adminTeamIds: none })).toBe(true);
  });
  it("an owner or admin of the org whose team owns the project may manage, without being in that team", () => {
    expect(canManageProject({ superadmin: false, memberRole: null, teamId: "t1", adminTeamIds: new Set(["t1"]) })).toBe(true);
    expect(canManageProject({ superadmin: false, memberRole: "member", teamId: "t1", adminTeamIds: new Set(["t1"]) })).toBe(true);
  });
  it("a plain project member may not, nor an admin of another org's teams, nor anyone on a team-less project", () => {
    expect(canManageProject({ superadmin: false, memberRole: "member", teamId: "t1", adminTeamIds: none })).toBe(false);
    expect(canManageProject({ superadmin: false, memberRole: null, teamId: "t1", adminTeamIds: new Set(["t2"]) })).toBe(false);
    expect(canManageProject({ superadmin: false, memberRole: "member", teamId: null, adminTeamIds: new Set(["t1"]) })).toBe(false);
  });
});

describe("canRestartProject (the user's rule: project members may only restart, T219b)", () => {
  const none = new Set<string>();
  it("a manager may restart: the owner, an org admin of the project's team", () => {
    expect(canRestartProject({ superadmin: false, memberRole: "owner", teamId: "t1", adminTeamIds: none })).toBe(true);
    expect(canRestartProject({ superadmin: false, memberRole: null, teamId: "t1", adminTeamIds: new Set(["t1"]) })).toBe(true);
    expect(canRestartProject({ superadmin: true, memberRole: null, teamId: null, adminTeamIds: none })).toBe(true);
  });
  it("a plain project member may restart (but not manage)", () => {
    const member = { superadmin: false, memberRole: "member", teamId: "t1", adminTeamIds: none };
    expect(canRestartProject(member)).toBe(true);
    expect(canManageProject(member)).toBe(false);
  });
  it("someone who only sees it through a shared team, and an outsider, may not", () => {
    // (a shared-team viewer has no roster role, and no admin of the primary team's org)
    expect(canRestartProject({ superadmin: false, memberRole: null, teamId: "t1", adminTeamIds: new Set(["t2"]) })).toBe(false);
    expect(canRestartProject({ superadmin: false, memberRole: undefined, teamId: "t1", adminTeamIds: none })).toBe(false);
  });
});
