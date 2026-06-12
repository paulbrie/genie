// vitest globalSetup — runs once before any test file. Migrates the test DB
// if DB_TEST is set; otherwise no-ops so pure-logic tests still run.

import { setupTestDb, closeTestDb, isTestDbAvailable, assertSafeTestDb } from "./src/test-helpers/db.js";

export async function setup() {
  if (!isTestDbAvailable()) {
    console.log("[vitest] DB_TEST not set — DB-backed test suites will skip.");
    return;
  }
  assertSafeTestDb();
  await setupTestDb();
  console.log("[vitest] Test DB migrated.");
}

export async function teardown() {
  await closeTestDb();
}
