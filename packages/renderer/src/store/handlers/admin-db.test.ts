// Admin database grid + SQL + drizzle:push + backups handlers.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../actions/admin", async () => {
  const actual = await vi.importActual<typeof import("../actions/admin")>("../actions/admin");
  return {
    ...actual,
    loadAdminTables: vi.fn(),
    loadAdminRows: vi.fn(),
  };
});

import { handlers } from "./admin";
import { $admin } from "../subjects/admin";
import { loadAdminTables, loadAdminRows } from "../actions/admin";

beforeEach(() => {
  const v = $admin.getValue();
  v.tables = []; v.selectedTable = null; v.columns = []; v.primaryKey = null;
  v.rows = []; v.totalCount = 0; v.page = 1; v.pageSize = 50;
  v.loading = false; v.drawerOpen = false; v.drawerRow = null;
  v.sqlQuery = ""; v.sqlResult = null; v.sqlError = null; v.sqlLoading = false; v.sqlOpen = false;
  v.drizzlePush = { running: false, output: "", open: false };
  v.backups = { files: [], loading: false, creating: false };
  vi.clearAllMocks();
});

describe("admin:tables / table:columns / table:rows", () => {
  it("admin:tables stores the list and clears loading", () => {
    $admin.getValue().loading = true;
    handlers["admin:tables"]({ tables: [{ name: "users", rowCount: 10 }] });

    expect($admin.getValue().tables).toEqual([{ name: "users", rowCount: 10 }]);
    expect($admin.getValue().loading).toBe(false);
  });

  it("admin:table:columns sets columns + primaryKey", () => {
    handlers["admin:table:columns"]({
      columns: [{ name: "id", type: "uuid" }, { name: "email", type: "text" }],
      primaryKey: "id",
    });
    expect($admin.getValue().columns).toHaveLength(2);
    expect($admin.getValue().primaryKey).toBe("id");
  });

  it("admin:table:rows sets the paged row data and clears loading", () => {
    $admin.getValue().loading = true;
    handlers["admin:table:rows"]({
      rows: [{ id: "u-1" }, { id: "u-2" }],
      totalCount: 142,
      page: 2,
      pageSize: 50,
    });

    const v = $admin.getValue();
    expect(v.rows).toHaveLength(2);
    expect(v.totalCount).toBe(142);
    expect(v.page).toBe(2);
    expect(v.pageSize).toBe(50);
    expect(v.loading).toBe(false);
  });
});

describe("admin:row drawer lifecycle", () => {
  it("admin:row:get populates the drawer when a row is returned", () => {
    handlers["admin:row:get"]({ row: { id: "u-1", email: "x@y" } });
    expect($admin.getValue().drawerRow).toEqual({ id: "u-1", email: "x@y" });
  });

  it("admin:row:get is a no-op when payload.row is missing (row not found)", () => {
    $admin.getValue().drawerRow = { id: "old" } as never;
    handlers["admin:row:get"]({});
    expect($admin.getValue().drawerRow).toEqual({ id: "old" });
  });

  it("admin:row:inserted closes drawer; reloads when on the matching table", () => {
    $admin.getValue().selectedTable = "users";
    $admin.getValue().drawerOpen = true;
    $admin.getValue().drawerRow = { id: "new" } as never;

    handlers["admin:row:inserted"]({ tableName: "users" });

    expect($admin.getValue().drawerOpen).toBe(false);
    expect($admin.getValue().drawerRow).toBeNull();
    expect(loadAdminRows).toHaveBeenCalledTimes(1);
    expect(loadAdminTables).toHaveBeenCalledTimes(1);
  });

  it("admin:row:inserted closes drawer but does NOT reload for a different table", () => {
    $admin.getValue().selectedTable = "users";
    handlers["admin:row:inserted"]({ tableName: "projects" });
    expect($admin.getValue().drawerOpen).toBe(false);
    expect(loadAdminRows).not.toHaveBeenCalled();
  });

  it("admin:row:updated closes drawer and reloads only rows (not tables)", () => {
    $admin.getValue().selectedTable = "users";
    handlers["admin:row:updated"]({ tableName: "users" });
    expect(loadAdminRows).toHaveBeenCalledTimes(1);
    expect(loadAdminTables).not.toHaveBeenCalled();
  });

  it("admin:row:deleted reloads rows + tables when on matching table", () => {
    $admin.getValue().selectedTable = "users";
    handlers["admin:row:deleted"]({ tableName: "users" });
    expect(loadAdminRows).toHaveBeenCalledTimes(1);
    expect(loadAdminTables).toHaveBeenCalledTimes(1);
  });
});

describe("admin:sql", () => {
  it("sql:result stores result and clears error/loading", () => {
    $admin.getValue().sqlLoading = true;
    $admin.getValue().sqlError = "earlier error" as never;

    handlers["admin:sql:result"]({ rows: [{ count: 42 }], columns: ["count"] });

    expect($admin.getValue().sqlResult).toEqual({ rows: [{ count: 42 }], columns: ["count"] });
    expect($admin.getValue().sqlError).toBeNull();
    expect($admin.getValue().sqlLoading).toBe(false);
  });

  it("sql:error stores message + clears result/loading", () => {
    $admin.getValue().sqlLoading = true;
    $admin.getValue().sqlResult = { rows: [], columns: [] } as never;

    handlers["admin:sql:error"]({ message: "syntax error near 'SELCT'" });

    expect($admin.getValue().sqlError).toBe("syntax error near 'SELCT'");
    expect($admin.getValue().sqlLoading).toBe(false);
    expect($admin.getValue().sqlResult).toBeNull();
  });
});

describe("admin:error", () => {
  it("logs + clears loading", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    $admin.getValue().loading = true;

    handlers["admin:error"]({ message: "table not found" });

    expect(warnSpy).toHaveBeenCalledWith("Admin error:", "table not found");
    expect($admin.getValue().loading).toBe(false);
    warnSpy.mockRestore();
  });
});

describe("admin:drizzle:push", () => {
  it("push:output appends to drizzlePush.output", () => {
    handlers["admin:drizzle:push:output"]({ data: "Generating migration…\n" });
    handlers["admin:drizzle:push:output"]({ data: "Applied 3 statements\n" });

    expect($admin.getValue().drizzlePush.output).toBe("Generating migration…\nApplied 3 statements\n");
  });

  it("push:done clears running flag and reloads tables", () => {
    $admin.getValue().drizzlePush.running = true;
    handlers["admin:drizzle:push:done"]({});
    expect($admin.getValue().drizzlePush.running).toBe(false);
    expect(loadAdminTables).toHaveBeenCalledTimes(1);
  });
});

describe("admin:backups", () => {
  it("backups:list replaces files and clears loading/creating", () => {
    $admin.getValue().backups.loading = true;
    $admin.getValue().backups.creating = true;

    handlers["admin:backups:list"]({ files: [{ name: "2026-05-18.sql", size: 1234 }] });

    expect($admin.getValue().backups.files).toEqual([{ name: "2026-05-18.sql", size: 1234 }]);
    expect($admin.getValue().backups.loading).toBe(false);
    expect($admin.getValue().backups.creating).toBe(false);
  });

  it("backups:created updates files and clears creating", () => {
    $admin.getValue().backups.creating = true;
    handlers["admin:backups:created"]({ files: [{ name: "fresh.sql", size: 99 }] });
    expect($admin.getValue().backups.files).toEqual([{ name: "fresh.sql", size: 99 }]);
    expect($admin.getValue().backups.creating).toBe(false);
  });

  it("backups:deleted replaces files (server sends current list back)", () => {
    $admin.getValue().backups.files = [
      { name: "old.sql", size: 1 } as never,
      { name: "newer.sql", size: 2 } as never,
    ];

    handlers["admin:backups:deleted"]({ files: [{ name: "newer.sql", size: 2 }] });

    expect($admin.getValue().backups.files).toEqual([{ name: "newer.sql", size: 2 }]);
  });
});
