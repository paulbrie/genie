// Admin users + teams handlers.

import { describe, it, expect, beforeEach } from "vitest";
import { handlers } from "./admin";
import { $admin } from "../subjects/admin";

beforeEach(() => {
  const v = $admin.getValue();
  v.users = { list: [], loading: false, paged: { list: [], total: 0, page: 1, pageSize: 25, search: "", loading: false } };
  v.teams = { list: [], members: [], loading: false };
  v.audit = { logs: [], loading: false, filterUserId: null, filterAction: null };
});

describe("admin:users", () => {
  it("users:list replaces the list and clears loading", () => {
    $admin.getValue().users.loading = true;
    handlers["admin:users:list"]({
      users: [{ id: "u-1", email: "a@b", role: "admin" }],
    });

    expect($admin.getValue().users.list).toEqual([{ id: "u-1", email: "a@b", role: "admin" }]);
    expect($admin.getValue().users.loading).toBe(false);
  });

  it("users:updated patches the matching user in place", () => {
    $admin.getValue().users.list = [
      { id: "u-1", email: "a@b", role: "user" } as never,
      { id: "u-2", email: "c@d", role: "user" } as never,
    ];

    handlers["admin:users:updated"]({ user: { id: "u-1", email: "a@b", role: "admin" } });

    expect($admin.getValue().users.list[0]).toEqual({ id: "u-1", email: "a@b", role: "admin" });
    expect($admin.getValue().users.list[1]).toEqual({ id: "u-2", email: "c@d", role: "user" });
  });

  it("users:updated is a no-op when the user is not in the loaded list", () => {
    $admin.getValue().users.list = [{ id: "u-1", email: "a@b", role: "user" } as never];

    handlers["admin:users:updated"]({ user: { id: "u-999", email: "ghost@x", role: "user" } });

    expect($admin.getValue().users.list).toHaveLength(1);
    expect($admin.getValue().users.list[0].email).toBe("a@b");
  });

  it("users:deleted filters out the matching id", () => {
    $admin.getValue().users.list = [
      { id: "u-1" } as never,
      { id: "u-2" } as never,
    ];
    handlers["admin:users:deleted"]({ userId: "u-1" });
    expect($admin.getValue().users.list.map((u: { id: string }) => u.id)).toEqual(["u-2"]);
  });
});

describe("admin:teams lifecycle", () => {
  it("teams:list replaces lists + clears loading", () => {
    $admin.getValue().teams.loading = true;
    handlers["admin:teams:list"]({
      teams: [{ id: "t-1", name: "Eng" }],
      members: [{ id: "m-1", teamId: "t-1", userId: "u-1", role: "owner" }],
    });

    expect($admin.getValue().teams.list).toHaveLength(1);
    expect($admin.getValue().teams.members).toHaveLength(1);
    expect($admin.getValue().teams.loading).toBe(false);
  });

  it("teams:created pushes the new team", () => {
    $admin.getValue().teams.list = [{ id: "t-1", name: "Eng" } as never];
    handlers["admin:teams:created"]({ team: { id: "t-2", name: "Design" } });
    expect($admin.getValue().teams.list.map((t: { id: string }) => t.id)).toEqual(["t-1", "t-2"]);
  });

  it("teams:updated patches in place", () => {
    $admin.getValue().teams.list = [
      { id: "t-1", name: "Eng" } as never,
      { id: "t-2", name: "Design" } as never,
    ];

    handlers["admin:teams:updated"]({ team: { id: "t-1", name: "Engineering" } });

    expect($admin.getValue().teams.list[0]).toEqual({ id: "t-1", name: "Engineering" });
    expect($admin.getValue().teams.list[1].name).toBe("Design");
  });

  it("teams:deleted removes the team AND drops orphaned members", () => {
    $admin.getValue().teams.list = [
      { id: "t-1", name: "A" } as never,
      { id: "t-2", name: "B" } as never,
    ];
    $admin.getValue().teams.members = [
      { id: "m-1", teamId: "t-1", userId: "u-1", role: "owner" } as never,
      { id: "m-2", teamId: "t-1", userId: "u-2", role: "member" } as never,
      { id: "m-3", teamId: "t-2", userId: "u-3", role: "owner" } as never,
    ];

    handlers["admin:teams:deleted"]({ teamId: "t-1" });

    expect($admin.getValue().teams.list.map((t: { id: string }) => t.id)).toEqual(["t-2"]);
    expect($admin.getValue().teams.members.map((m: { id: string }) => m.id)).toEqual(["m-3"]);
  });

  it("teams:member-added pushes a member", () => {
    handlers["admin:teams:member-added"]({
      member: { id: "m-new", teamId: "t-1", userId: "u-5", role: "member" },
    });
    expect($admin.getValue().teams.members).toEqual([{ id: "m-new", teamId: "t-1", userId: "u-5", role: "member" }]);
  });

  it("teams:member-removed filters by member id", () => {
    $admin.getValue().teams.members = [
      { id: "m-1", teamId: "t-1", userId: "u-1", role: "owner" } as never,
      { id: "m-2", teamId: "t-1", userId: "u-2", role: "member" } as never,
    ];
    handlers["admin:teams:member-removed"]({ memberId: "m-1" });
    expect($admin.getValue().teams.members.map((m: { id: string }) => m.id)).toEqual(["m-2"]);
  });

  it("teams:role-updated patches the member in place", () => {
    $admin.getValue().teams.members = [
      { id: "m-1", teamId: "t-1", userId: "u-1", role: "member" } as never,
    ];

    handlers["admin:teams:role-updated"]({
      member: { id: "m-1", teamId: "t-1", userId: "u-1", role: "owner" },
    });

    expect($admin.getValue().teams.members[0].role).toBe("owner");
  });
});

describe("admin:audit:list", () => {
  it("populates logs and clears loading", () => {
    $admin.getValue().audit.loading = true;
    handlers["admin:audit:list"]({
      logs: [{ id: "a-1", action: "user.delete", actorId: "u-1" }],
    });

    expect($admin.getValue().audit.logs).toEqual([{ id: "a-1", action: "user.delete", actorId: "u-1" }]);
    expect($admin.getValue().audit.loading).toBe(false);
  });
});
