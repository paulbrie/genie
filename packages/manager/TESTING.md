# Testing the manager package

Three tiers, runnable independently. Each adds infrastructure on top of the last.

| Tier | What it covers | Infra needed |
|---|---|---|
| 1. Pure-logic units | Deterministic helpers — JWT, UUIDs, formatters, ring buffer, ACL | none |
| 2. DB-backed services | All `*-service.ts` files — soft-delete, visibility filters, member queries | `DB_TEST` |
| 3. WS server integration | End-to-end auth, ACL gate, handler routing | `DB_TEST` + `WS_INTEGRATION=1` |

## Running

```bash
# Tier 1 only — fast, always works
pnpm test

# Tiers 1 + 2 — adds DB-backed service tests
DB_TEST="postgres://user:pass@localhost:5432/genie_test" pnpm test

# All three — adds WS integration
DB_TEST=... WS_INTEGRATION=1 pnpm test
```

**Safety:** the harness refuses to run if `DB_TEST` equals `DB` (your dev URL).
The harness `TRUNCATE`s every data table before each test, so pointing it at
dev would wipe local data.

## Test DB setup (tier 2+)

Create a throwaway Postgres database, then pass its URL via `DB_TEST`. Anything
on `pg_tables` matching neither `drizzle_%` nor `_%` gets truncated before each
test, so the DB should be dedicated.

The harness (see `src/test-helpers/db.ts`):
1. Runs Drizzle migrations from `./drizzle` on first boot.
2. Runs the boot migrations from `src/db/migrate.ts`.
3. Exposes `truncateAllTables()` for use in `beforeEach`.
4. Exposes `getTestDb()` for fixture inserts.

## Writing a service test

Pattern in `src/projects/project-service.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { isTestDbAvailable, setupTestDb, truncateAllTables } from "../test-helpers/db.js";
import { makeUser, makeTeam } from "../test-helpers/fixtures.js";
import * as projectService from "./project-service.js";

describe.skipIf(!isTestDbAvailable())("project-service", () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAllTables(); });

  it("...", async () => {
    const user = await makeUser();
    // ...
  });
});
```

Fixtures live in `src/test-helpers/fixtures.ts`. Add a builder there when a
test needs a row type that doesn't exist yet — keep the defaults minimal.

## Writing a WS integration test

Pattern in `src/ws-server.test.ts`. Boot is heavyweight (~1s), so one
`bootTestWsServer()` per file in `beforeAll`, truncate per test, and use
`connectAuthenticated(port, jwt)` to skip the OAuth flow.

Caveats:
- `PORT` is captured at module-load in `ws-server.ts`. You can't re-boot on a
  different port within one vitest process.
- `shutdown()` stops the main background timers but not all of them; that's
  fine for the boot-once / teardown-once pattern.

## What's intentionally not tested

- SSH client and process-spawn code (`vps/ssh-client.ts`, `projects/project-manager.ts`
  spawn, `cloud/wireproxy-launcher.ts`) — these need real infrastructure to
  test meaningfully; not worth the maintenance cost as unit tests.
- External-provider API clients (DigitalOcean, Hetzner, Railway) — would need
  HTTP recording or a sandbox account.
- Boot-time side effects (`index.ts`, `db/seed.ts`) — covered by typecheck +
  manual smoke test.
