---
type: Architecture Concept
title: Agents
description: User-defined AI agents — a system prompt, model, tool allowlist, and sandbox — that Genie runs inside a Docker container on a project's VPS, streaming tokens and tool calls back to the UI.
resource: https://github.com/paulbrie/genie/blob/main/packages/manager/src/agents/runner.ts
tags: [agents, ai, sandbox, docker, vps, tools, streaming]
timestamp: 2026-06-14T00:00:00Z
---

An **Agent** is a saved AI persona — a system prompt, a model, an allowlist of
tools, and a sandbox target — that a user can run against a project's VPS. A run
executes the model loop **inside a Docker container on that VPS** (not in the
Manager), with the project directory mounted read-write, and streams its tokens
and tool calls back to the UI in real time. Think of it as a scriptable Claude
that can read/write files and run shell commands inside a project's container.

# Data model

Two DB tables (`packages/manager/src/db/schema.ts`):

* **`agents`** — the definition: `slug`, `label`, `systemPrompt`, `modelId`
  (e.g. `claude-sonnet` / `claude-opus`), `maxToolRounds`, `tools` (allowlist;
  empty = all built-in tools), `sandbox` (JSON config), `ownerUserId`,
  `isBuiltin`.
* **`agent_runs`** — one row per execution: `status`
  (`queued → running → succeeded | failed | timeout | cancelled`), `input` /
  `output`, `toolEvents`, `sandboxRef` (container name, for cleanup),
  `parentRunId` (reserved for sub-agents), and token/cost columns.

# Execution path

The Manager orchestrates; the [vps-agent](../) runtime does the model loop on the
VM:

1. `agents:run` arrives → `agents/runner.ts` loads the agent, checks the caller
   can see the project, and inserts an `agent_run` (status `queued`).
2. `agents/sandbox/project-docker.ts` opens an SSH session to the project's VPS,
   uploads the `@genie/vps-agent` bundle, and runs
   `docker run node /opt/agent` — the project dir mounted read-write, the bundle
   read-only, and `ANTHROPIC_API_KEY` passed via env (never logged).
3. Inside the container, `@genie/vps-agent` runs an Anthropic `streamText` loop
   with the agent's tools, capped at `maxToolRounds`.
4. The container emits newline-delimited JSON (`token` / `tool` / `done` /
   `error`); the runner relays each as `agents:run:event` and finishes with
   `agents:run:complete`, updating the `agent_run` row.

The only implemented sandbox is `project-docker` (a `firecracker` backend is
typed but not built).

# Tools

From `createTools()` in `@genie/vps-agent`, gated per-agent by the `tools`
allowlist: `shell_exec`, `read_file`, `write_file`, `list_files`,
`search_files`, plus browser `view_page` / `dom_action`.

# WebSocket surface

`packages/manager/src/handlers/agents-handler.ts`: `agents:list`, `agents:get`,
`agents:upsert`, `agents:delete`, `agents:run`. The namespace is `user`-level and
self-scoped in the WS ACL — users see their own agents plus built-ins; built-ins
are read-only and ownership is enforced in the handler. A CLI smoke-test exists
at `packages/manager/scripts/run-agent.ts`.

# Starter templates (example agents)

To avoid a blank form, the New-agent UI offers **templates** — opinionated
presets (`packages/renderer/src/components/agents/agent-templates.ts`). Picking
one prefills the prompt/model/tools/timeout; the user still chooses their own
project + VPS instance, so the result is a normal private agent. They are pure
UI presets (no DB seeding) — built-ins can't be globally runnable because the
sandbox is project-specific, so "clone a template" is the model.

Read-only investigators (no `write_file`, safe to try):

* **Codebase Guide** — answers "how does X work / where is Y" by grepping the
  live tree.
* **Build / Deploy Doctor** — diagnoses why a build or deploy failed from logs +
  config (no fixes).
* **Log Triager** — clusters and summarizes recent errors from service logs.
* **Dependency Auditor** — reports vulnerable / outdated dependencies; no changes.

Mutators (write + shell; powerful, opt-in):

* **Test Fixer** — runs the suite, fixes failures, re-runs until green.
* **Dependency Upgrader** — bumps deps and verifies the build/tests still pass.
* **Lint / Format Fixer** — runs the project's auto-fixers.
* **Docs Updater** — keeps README / docs in sync with the code.

Scoping tip: match the tool allowlist to the job — omit `write_file` for
investigators, and keep timeouts sane (300–600s) for mutators so a runaway loop
self-terminates (and the run can be cancelled with **Stop**).

# Current state

Working: full CRUD, sandboxed runs with live token/tool streaming, status
tracking, mid-run **cancellation** (`agents:cancel` → abort the sandbox → record
`cancelled`), starter templates, the project-docker backend, ACL + ownership. The
UI lives in `AgentsPanelImpl` (list, edit drawer, run drawer with streaming + a
Stop button).

Not yet built: no boot-time seeding of built-in agents; token/cost columns stay
`0` (not captured from the model response); no persistent run-history view;
sub-agents (`parentRunId`) and the firecracker sandbox are unimplemented.
