---
type: Domain Concept
title: Recipe
description: A declarative descriptor for checking, installing, and uninstalling a piece of software on a VPS over SSH.
resource: https://github.com/paulbrie/genie/blob/main/packages/manager/src/db/schema.ts#L135-L161
tags: [vps, recipe, add-ons, ssh, provisioning]
timestamp: 2026-06-14T00:00:00Z
---

A **Recipe** is how Genie's "Add-ons" panel knows how to detect, install, and
remove a piece of software on a remote VPS. Each recipe bundles three bash
scripts — `checkScript`, `installScript`, `uninstallScript` — that the Manager
runs **as root over SSH** against the target VM, plus the metadata the UI needs
to render a button and prompt for any required input.

Recipes are the *single source of truth* at runtime: the renderer reads only
from the `recipes:list` WebSocket reply. Built-in recipes are seeded into the
`recipes` table on Manager boot (upsert by `slug`) from
[`default-recipes.ts`](https://github.com/paulbrie/genie/blob/main/packages/manager/src/default-recipes.ts);
user-authored recipes are inserted via the UI. Both kinds live in the same
table — the panel no longer distinguishes between them.

# Schema

One row of the `recipes` table. (TypeScript input shape: `RecipeInput` in
[`recipes-service.ts`](https://github.com/paulbrie/genie/blob/main/packages/manager/src/recipes-service.ts).)

| Field             | Type                       | Description                                                                                  |
|-------------------|----------------------------|----------------------------------------------------------------------------------------------|
| `id`              | UUID, PK                   | Generated primary key.                                                                        |
| `slug`            | STRING, UNIQUE             | URL-safe stable id, also the seed/upsert key (e.g. `genie-standard`, `redis`).               |
| `label`           | STRING                     | Display name (e.g. `Redis 7`).                                                                |
| `description`     | STRING                     | One-line summary shown in the panel.                                                          |
| `icon`            | STRING                     | Lucide icon name. Defaults to `Package`.                                                      |
| `port`            | INTEGER, nullable          | Service port surfaced in the UI; `null` for recipes that expose no network port.             |
| `checkScript`     | STRING (bash)              | Detects install state. **Must print exactly `INSTALLED` or `NOT_INSTALLED`.**                |
| `installScript`   | STRING (bash)              | Run as root over SSH to install. Must be **idempotent** — "Re-apply" re-runs it.             |
| `uninstallScript` | STRING (bash)              | Run as root over SSH to remove the software.                                                  |
| `setupShSnippet`  | STRING (bash)              | Folded into the project's bootstrap `setup.sh` so fresh VMs get the software unattended.      |
| `commands`        | JSONB → `RecipeCommand[]`  | Named one-off commands the panel offers as buttons.                                           |
| `options`         | JSONB → `RecipeOption[]`   | Pre-install choices, surfaced as a form; each becomes an env var in the install script.       |
| `secrets`         | JSONB → `RecipeSecret[]`   | Per-apply prompted secrets (e.g. a PAT). Only the *schema* is stored — never the values.      |
| `createdBy`       | UUID, FK → users, nullable | Author. `null` for built-in recipes.                                                          |
| `createdAt`       | TIMESTAMP                  | Row creation time.                                                                            |
| `updatedAt`       | TIMESTAMP                  | Last edit (bumped by the seed upsert and by UI edits).                                        |

## Embedded shapes

`RecipeCommand` — a named shell command shown as a button:

| Field     | Type   | Description                          |
|-----------|--------|--------------------------------------|
| `name`    | STRING | Button label.                        |
| `command` | STRING | Shell command run on the VM.         |

`RecipeOption` — a pre-install choice that becomes an env var passed to `installScript`:

| Field          | Type                              | Description                                  |
|----------------|-----------------------------------|----------------------------------------------|
| `name`         | STRING                            | Env var name (e.g. `PG_VERSION`).            |
| `label`        | STRING                            | Field label.                                 |
| `choices`      | `{ value, label }[]`              | Allowed values.                              |
| `defaultValue` | STRING                            | Pre-selected value.                          |

`RecipeSecret` — a sensitive value prompted **on every Install / Re-apply** and
never persisted to the DB, settings, or local storage:

| Field         | Type    | Description                                                |
|---------------|---------|-----------------------------------------------------------|
| `name`        | STRING  | Env var name set for the install script (e.g. `GIT_TOKEN`).|
| `label`       | STRING  | Field label.                                              |
| `placeholder` | STRING? | Input placeholder.                                        |
| `description` | STRING? | Hint text under the field (may contain links).           |
| `required`    | BOOL?   | When true, install is refused if the field is empty.     |

# Lifecycle

A recipe moves through four operations, all driven from the Add-ons panel and
executed by the Manager over SSH:

1. **Check** — run `checkScript`. Its stdout must be `INSTALLED` or
   `NOT_INSTALLED`; that single token drives the green/grey state of the recipe's
   button. Because a fresh SSH session can carry a stale group list, checks should
   test for durable artifacts (files, units, binaries) rather than transient
   session state.
2. **Install / Re-apply** — run `installScript` as root. `options` are exported as
   env vars; `secrets` are prompted via a modal each time and exported for the
   duration of the run only. The script **must be idempotent** so Re-apply is safe.
3. **Uninstall** — run `uninstallScript` as root.
4. **Bootstrap** — `setupShSnippet` is concatenated into the project's `setup.sh`,
   so a newly-provisioned VM installs the software without a manual apply.

## Shared bash helpers

Install/uninstall/setup scripts may reference the `${BASH_HELPERS}` placeholder,
which is inlined **at TypeScript-template time** in `default-recipes.ts` — what
lands in the DB is fully-resolved bash. The helpers are:

* `log` — timestamped progress lines.
* `force_ipv4_dns` — patches `/etc/gai.conf` to prefer IPv4, working around
  TazCloud VMs' broken IPv6 routing to Cloudflare/Fastly-fronted CDNs
  (`registry.npmjs.org`, `deb.nodesource.com`, …).
* `wait_apt` — blocks until the `apt`/`dpkg` locks are free, logging which PID
  holds them.

# Provenance & sync

* Built-in recipes are declared in `default-recipes.ts` and seeded on boot via
  `seedDefaultRecipes()`, which upserts by `slug` — editing a recipe there and
  redeploying refreshes the DB row in place.
* CRUD flows over WebSocket verbs `recipes:list` / `recipes:create` /
  `recipes:update` / `recipes:delete`; a `recipes:list:stale` broadcast tells
  every connected client to refresh.
* Services that log should follow the project convention — e.g. the `nextjs`
  recipe writes its systemd unit's output to `/var/log/nextjs-dev.log`.

# Examples

* [Genie Standard Setup](./genie-standard.md) — the baseline recipe applied to
  every VPS (the `genie` deploy user, Docker, Node 20, Claude Code, and the
  `genie-stats` service).

# Citations

[1] [recipes table — db/schema.ts](https://github.com/paulbrie/genie/blob/main/packages/manager/src/db/schema.ts#L135-L161)
[2] [RecipeInput + seedDefaultRecipes — recipes-service.ts](https://github.com/paulbrie/genie/blob/main/packages/manager/src/recipes-service.ts)
[3] [Built-in recipes + BASH_HELPERS — default-recipes.ts](https://github.com/paulbrie/genie/blob/main/packages/manager/src/default-recipes.ts)
[4] [RecipeCommand / RecipeOption / RecipeSecret — vps-recipes.tsx](https://github.com/paulbrie/genie/blob/main/packages/renderer/src/components/project/vps-recipes.tsx)
