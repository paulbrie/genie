// Test-DB harness. Owns:
//   - one-time migration of a throwaway Postgres into the current schema
//     (Drizzle SQL migrations + the boot migrations in db/migrate.ts)
//   - between-test truncation of all data tables
//
// Reads DB_TEST. If unset, the harness is a no-op so that pure-logic test
// files keep running. Service tests should guard their suites with
// `describe.skipIf(!process.env.DB_TEST)` so they self-skip in that case.
//
// Safety: refuses to run if DB_TEST equals DB (your dev URL) — the harness
// truncates the connected database, so pointing it at dev would wipe local
// data on every test run.

import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "../db/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle");

let migrated = false;
let testClient: ReturnType<typeof postgres> | null = null;
let testDb: PostgresJsDatabase<typeof schema> | null = null;

export function getTestDbUrl(): string | null {
  return process.env.DB_TEST ?? null;
}

export function isTestDbAvailable(): boolean {
  return !!process.env.DB_TEST;
}

/** Apply migrations to the test DB (idempotent). Sets `process.env.DB` so that
 *  the production singleton in src/db/index.ts opens the test DB on first use. */
export async function setupTestDb(): Promise<void> {
  const url = process.env.DB_TEST;
  if (!url) return;
  if (process.env.DB && process.env.DB === url) {
    throw new Error(
      "DB_TEST must differ from DB — the harness truncates the connected database.",
    );
  }
  process.env.DB = url;

  if (!testClient) {
    testClient = postgres(url, { onnotice: () => {}, max: 4 });
    testDb = drizzle(testClient, { schema });
  }
  if (migrated) return;

  await migrate(testDb!, { migrationsFolder: MIGRATIONS_FOLDER });
  const { runBootMigrations } = await import("../db/migrate.js");
  await runBootMigrations();
  migrated = true;
}

/** TRUNCATE every data table (preserves Drizzle's migration ledger and the
 *  boot-migration ledger). Use in beforeEach for clean per-test state. */
export async function truncateAllTables(): Promise<void> {
  if (!testClient || !testDb) {
    throw new Error("truncateAllTables called before setupTestDb");
  }
  const rows = await testDb.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE 'drizzle_%'
      AND tablename NOT LIKE '\\_%' ESCAPE '\\'
  `);
  const names = (rows as unknown as { tablename: string }[]).map((r) => r.tablename);
  if (names.length === 0) return;
  const list = names.map((n) => `"${n}"`).join(", ");
  await testDb.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

/** Direct access to the test Drizzle instance for fixture inserts in tests. */
export function getTestDb(): PostgresJsDatabase<typeof schema> {
  if (!testDb) throw new Error("getTestDb called before setupTestDb");
  return testDb;
}

export async function closeTestDb(): Promise<void> {
  if (testClient) {
    await testClient.end();
    testClient = null;
    testDb = null;
    migrated = false;
  }
}
