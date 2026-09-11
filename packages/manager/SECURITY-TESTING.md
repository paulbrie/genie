# Security & access-control testing strategy

## The invariant we protect

> A non-superadmin **user** can read or mutate **only the resources they own or
> are a member of.** Privileged roles (`tazcloud` < `admin` < `superadmin`)
> widen this by design; nothing else does.

Everything below exists to keep that invariant true as handlers are added.

## How access control is enforced (two layers)

1. **WS ACL — role tier only** (`src/auth/ws-acl.ts`). Default-deny
   (`deny-unknown`); each message *type* has a minimum send/receive role. This
   answers *"may a `user` send this type at all"* — **not** *"may THIS user touch
   THIS resource."*
2. **Per-handler ownership** (`src/handlers/handler-auth.ts` +
   `src/projects/project-service.ts` + `chat-service.isConversationMember` +
   `assistant-log-service.sessionBelongsToUser`). Every handler that resolves a
   resource from a **client-supplied id** (projectId, conversationId, sessionId,
   vmId, instanceId, terminalId, …) MUST verify ownership against the
   **server-side identity** (`state.userId` / active role), never a client field.

The ACL alone is not enough: most user-facing namespaces are reachable by the
`user` tier precisely because ownership is meant to be enforced in the handler.
A handler that skips the ownership check is an IDOR even though the ACL "passed."

## Test layers

| Layer | File | Gate | What it proves |
|-------|------|------|----------------|
| 0 · ACL unit | `src/auth/ws-acl.test.ts` | none (pure) | role-tier gating + default-deny for every namespace/override |
| 0 · Auth unit | `src/auth/auth.test.ts` | none | token ver/role derivation is not forgeable |
| 1 · Ownership primitives | `src/handlers/authorization.security.test.ts` → "ownership primitives" | `DB_TEST` | the data-layer scoping funcs never return another user's resource |
| 2 · Handler wiring | `src/handlers/authorization.security.test.ts` → "handlers deny cross-tenant access" | `DB_TEST` | calling the **real** handler as user A against user B's resource is DENIED (no data, no mutation) |
| 3 · End-to-end (optional) | `src/test-helpers/ws.ts` harness | `DB_TEST` + `WS_INTEGRATION=1` | full dispatch: booted ws-server + real ACL + real handler over a real socket |

Layers 0–2 are the day-to-day suite (fast, no network). Layer 3 is the
belt-and-suspenders CI pass that exercises the ACL and handler *together*.

## Running the tests

Pure-logic layers run with no setup:

```bash
cd packages/manager && npx vitest run src/auth/ws-acl.test.ts
```

DB-backed layers (1 & 2) need a throwaway Postgres in `DB_TEST` (the harness
**truncates** it between tests and refuses to run if `DB_TEST === DB`):

```bash
# one-time: a local throwaway DB
sudo -u postgres psql -c "CREATE ROLE sectest LOGIN PASSWORD 'sectest' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE genie_sectest OWNER sectest;"

DB_TEST="postgresql://sectest:sectest@localhost:5432/genie_sectest" \
  npx vitest run src/handlers/authorization.security.test.ts
```

End-to-end (layer 3) additionally needs `WS_INTEGRATION=1` and
`GENIE_JWT_SECRET` (see `src/test-helpers/ws.ts`).

## Coverage today (cross-tenant denials verified)

- **Projects:** `project:update`, `project:dbUrl:set` blocked for non-owners;
  primitives `userCanSeeProject` / `userCanManageProject` /
  `getAccessibleProjectIds` never leak another user's project.
- **VMs:** `vps:teardown` blocked for non-owners (same guard now on
  `vps:hibernate` / `vps:wake` / `vps:reboot`).
- **Chat:** `chat:conversation:open` and `chat:message:send` blocked for
  non-members; `chat:session:load` blocked for non-owners; primitives
  `isConversationMember` / `sessionBelongsToUser`.
- **Privilege escalation:** `admin:users:update` cannot change `role` and
  `admin:users:delete` / `admin:teams:*` are refused for a non-superadmin
  `admin`; a `superadmin` can still change roles (positive case tested).

## Rule for adding a new handler (make this a review gate)

When a handler resolves a resource from a client-supplied id:

1. **Guard it** against `state.userId` / active role using the shared helpers —
   `canAccessProject` (read), `userCanManageProject` (destructive/config),
   `userCanAccessVm`, `isConversationMember`, `sessionBelongsToUser`. Do **not**
   trust a client-supplied `userId`/`ownerId`/`role`/`host`.
   - Beware the `canAccessProject` footgun: it returns `true` for a
     null/undefined `projectId` ("nothing to gate"). If your op keys on a
     non-project id, resolve the owning resource and check *that*.
2. **Add a denial test** to `authorization.security.test.ts` in the "handlers
   deny cross-tenant access" block: seed user B's resource, call the handler as
   user A, assert an error / empty result / no mutation. One test per new
   client-id-taking message type.
3. If the whole namespace is privileged, still re-check the role in-handler
   (`hasRole(role, "admin"|"superadmin")`) as defense in depth behind the ACL.

## CI recommendation

Run layers 0–2 on every PR (a Postgres service container provides `DB_TEST`).
Run layer 3 nightly / pre-release. Fail the build on any new
client-id-taking message type that lacks a corresponding denial test.
