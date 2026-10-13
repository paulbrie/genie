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
  it("an org admin of a shared team's org, and an outsider, may not", () => {
    // (no roster role, not admin of the primary team's org, and not a member of the project's teams)
    expect(canRestartProject({ superadmin: false, memberRole: null, teamId: "t1", adminTeamIds: new Set(["t2"]) })).toBe(false);
    expect(canRestartProject({ superadmin: false, memberRole: undefined, teamId: "t1", adminTeamIds: none })).toBe(false);
  });
});

describe("team owners manage, team members restart (T219c, T219d)", () => {
  const none = new Set<string>();
  const base = { superadmin: false, memberRole: null, teamId: "t1", sharedTeamIds: ["t2"], adminTeamIds: none };
  it("the owner (or superadmin) of the project's own team manages it, and so may restart", () => {
    const owner = { ...base, ownedTeamIds: new Set(["t1"]), memberTeamIds: new Set(["t1"]) };
    expect(canManageProject(owner)).toBe(true);
    expect(canRestartProject(owner)).toBe(true);
  });
  it("the owner of a team the project is only shared with doesn't manage it, but may restart", () => {
    const sharedOwner = { ...base, ownedTeamIds: new Set(["t2"]), memberTeamIds: new Set(["t2"]) };
    expect(canManageProject(sharedOwner)).toBe(false);
    expect(canRestartProject(sharedOwner)).toBe(true);
  });
  it("a plain member of the project's team, or of a team it is shared with, may restart but not manage", () => {
    for (const team of ["t1", "t2"]) {
      const member = { ...base, memberTeamIds: new Set([team]) };
      expect(canRestartProject(member)).toBe(true);
      expect(canManageProject(member)).toBe(false);
    }
  });
  it("a member of an unrelated team, and an outsider, may do neither", () => {
    expect(canRestartProject({ ...base, memberTeamIds: new Set(["t9"]), ownedTeamIds: new Set(["t9"]) })).toBe(false);
    expect(canManageProject({ ...base, memberTeamIds: new Set(["t9"]), ownedTeamIds: new Set(["t9"]) })).toBe(false);
    expect(canRestartProject(base)).toBe(false);
  });
});
