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
import postgres from "postgres";
import * as schema from "../db/schema.js";

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
/** Refuse to point at a DB equal to .env-loaded `DB`. The harness truncates
 *  whatever it connects to; targeting the dev URL would wipe local data.
 *  Called by globalSetup BEFORE setupTestDb mutates process.env.DB. */
export function assertSafeTestDb(): void {
  const url = process.env.DB_TEST;
  if (!url) return;
  if (process.env.DB && process.env.DB === url) {
    throw new Error(
      "DB_TEST must differ from DB — the harness truncates the connected database.",
    );
  }
}

export async function setupTestDb(): Promise<void> {
  if (migrated) return;
  const url = process.env.DB_TEST;
  if (!url) return;
  process.env.DB = url;

  testClient = postgres(url, { onnotice: () => {}, max: 4 });
  testDb = drizzle(testClient, { schema });

  // The committed drizzle/ baseline migration is stale (predates teams/orgs),
  // and `pushSchema` hits an introspection bug on empty databases. Instead
  // we diff the CURRENT schema.ts against an empty snapshot via
  // generateMigration, then execute the resulting SQL. Boot migrations then
  // bring along the post-schema DDL (backfills, additional ALTERs).
  // Skipped if the schema is already present — the migration runs once per
  // process, but globalSetup and worker each see a fresh module state.
  const usersExists = await testDb!.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS exists
  `);
  const alreadyMigrated = Boolean((usersExists as unknown as { exists: boolean }[])[0]?.exists);
  if (!alreadyMigrated) {
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const empty = generateDrizzleJson({});
    const target = generateDrizzleJson(schema);
    const statements = await generateMigration(empty, target);
    for (const stmt of statements) {
      if (stmt.trim()) await testDb!.execute(sql.raw(stmt));
    }
    const { runBootMigrations } = await import("../db/migrate.js");
    await runBootMigrations();
  }
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
