import { describe, expect, it } from "vitest";
import { defaultNavForRole, navAllowedForRole } from "./routes";

// Guards what a typed-in URL can land on. The sidebar already filters its
// rendered items by role, but without this check a standard user could just
// type /admin/users or /security in the address bar and see the admin shell.

describe("navAllowedForRole", () => {
  it("standard user gets projects / tracker / chat / settings", () => {
    expect(navAllowedForRole("projects", "user")).toBe(true);
    expect(navAllowedForRole("tracker", "user")).toBe(true);
    expect(navAllowedForRole("chat", "user")).toBe(true);
    expect(navAllowedForRole("settings", "user")).toBe(true);

    expect(navAllowedForRole("admin", "user")).toBe(false);
    expect(navAllowedForRole("security", "user")).toBe(false);
    expect(navAllowedForRole("logs", "user")).toBe(false);
    expect(navAllowedForRole("clouds", "user")).toBe(false);
  });

  it("undefined / null role falls back to standard-user permissions", () => {
    expect(navAllowedForRole("projects", undefined)).toBe(true);
    expect(navAllowedForRole("admin", undefined)).toBe(false);
    expect(navAllowedForRole("projects", null)).toBe(true);
    expect(navAllowedForRole("admin", null)).toBe(false);
  });

  it("tazcloud adds recipes + clouds on top of standard set", () => {
    expect(navAllowedForRole("projects", "tazcloud")).toBe(true);
    expect(navAllowedForRole("recipes", "tazcloud")).toBe(true);
    expect(navAllowedForRole("clouds", "tazcloud")).toBe(true);

    // Still no admin pages.
    expect(navAllowedForRole("admin", "tazcloud")).toBe(false);
    expect(navAllowedForRole("security", "tazcloud")).toBe(false);
  });

  it("admin gets every base nav but NOT recipes / clouds (superadmin-only)", () => {
    expect(navAllowedForRole("admin", "admin")).toBe(true);
    expect(navAllowedForRole("security", "admin")).toBe(true);
    expect(navAllowedForRole("logs", "admin")).toBe(true);
    expect(navAllowedForRole("docker", "admin")).toBe(true);

    expect(navAllowedForRole("recipes", "admin")).toBe(false);
    expect(navAllowedForRole("clouds", "admin")).toBe(false);
  });

  it("superadmin gets everything, including recipes / clouds", () => {
    expect(navAllowedForRole("admin", "superadmin")).toBe(true);
    expect(navAllowedForRole("recipes", "superadmin")).toBe(true);
    expect(navAllowedForRole("clouds", "superadmin")).toBe(true);
    expect(navAllowedForRole("security", "superadmin")).toBe(true);
  });
});

describe("defaultNavForRole", () => {
  it("returns 'projects' for every role — that's the universal landing", () => {
    expect(defaultNavForRole("user")).toBe("projects");
    expect(defaultNavForRole("tazcloud")).toBe("projects");
    expect(defaultNavForRole("admin")).toBe("projects");
    expect(defaultNavForRole("superadmin")).toBe("projects");
    expect(defaultNavForRole(undefined)).toBe("projects");
  });
});
