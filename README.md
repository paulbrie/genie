# Genie

Genie is a development platform for **projects that live on remote VMs**. It provisions
servers on several clouds (DigitalOcean, TazCloud, Hetzner, or any SSH box you bring),
installs a standard toolchain on them through **recipes**, and lets you work on them from a
browser: persistent tmux terminals, a durable **Claude Code** chat running on the VM, file
and DB explorers, git, firewall, VS Code (code-server), user-defined AI agents in a Docker
sandbox, an issue tracker, docs, team chat, and a large admin console.

It is an npm-workspaces monorepo with five packages. A Node **manager** process does all
the work and talks to everything else over a single WebSocket protocol.

![Genie dashboard: a project's TazCloud server with live CPU/MEM/DISK gauges, the Manage-VM window, a tmux-backed SSH terminal running Claude Code, and the durable Claude chat window](screenshot.png)

*A project's server in the dashboard. Shown: live VM stats, the Manage-VM window, a
persistent tmux SSH terminal, and the floating Claude Code chat streaming tool calls from
the VM.*

---

## Table of contents

1. [Architecture at a glance](#architecture-at-a-glance)
2. [Repository layout](#repository-layout)
3. [Packages](#packages)
   - [Manager](#manager-packagesmanager)
   - [Renderer](#renderer-packagesrenderer)
   - [Chrome extension](#chrome-extension-packageschrome-extension)
   - [VPS agent](#vps-agent-packagesvps-agent)
   - [VPS stats](#vps-stats-packagesvps-stats)
4. [Getting started (local development)](#getting-started-local-development)
5. [Scripts reference](#scripts-reference)
6. [Configuration (environment variables)](#configuration-environment-variables)
7. [Database](#database)
8. [Auth, roles and access control](#auth-roles-and-access-control)
9. [The WebSocket protocol](#the-websocket-protocol)
10. [HTTP endpoints](#http-endpoints)
11. [Feature tour](#feature-tour)
12. [How VMs are managed](#how-vms-are-managed)
13. [Testing](#testing)
14. [Deployment (Railway)](#deployment-railway)
15. [Running behind a reverse proxy (sub-path mount)](#running-behind-a-reverse-proxy-sub-path-mount)
16. [Conventions for contributors](#conventions-for-contributors)
17. [Further documentation](#further-documentation)
18. [Troubleshooting](#troubleshooting)

---

## Architecture at a glance

```
                ┌──────────────────────────┐        ┌───────────────────────────┐
  Browser ─────▶│ Renderer (Next.js 16)    │        │ Chrome extension (MV3)    │
  (desktop,     │ dashboard · /mobile ·    │        │ popup · side panel ·      │
   /mobile)     │ /extension iframe        │        │ DOM actions on any tab    │
                └────────────┬─────────────┘        └────────────┬──────────────┘
                             │  WebSocket {type, payload}        │
                             ▼                                   ▼
                ┌────────────────────────────────────────────────────────────────┐
                │ Manager (Node 22, ws + http, port 9876)                         │
                │ auth · ACL · ~35 handler modules · Drizzle/Postgres · AI SDK    │
                │ cloud APIs · SSH session cache · code-server proxy · MCP REST   │
                └───────┬───────────────────────┬───────────────────────┬────────┘
                        │ Postgres (DB)          │ SSH (ssh2, optional    │ HTTPS
                        ▼                        │ SOCKS5 via wireproxy)  ▼
                  ┌──────────┐                   ▼                 Anthropic, Fireworks,
                  │ Postgres │      ┌──────────────────────────┐   Gemini, RunPod, DO,
                  └──────────┘      │ Project VM               │   TazCloud, Hetzner,
                                    │ tmux · Claude Code CLI    │   SendGrid, Slack, S3…
                                    │ genie-stats daemon ───────┼──▶ POST /api/vps/stats
                                    │ code-server :13337        │
                                    │ Docker sandbox (agents)   │
                                    │ .mcp.json → /api/vps/mcp/*│
                                    └──────────────────────────┘
```

Key ideas:

- **One protocol.** The renderer, the mobile UI, the extension side panel and the extension
  service worker all speak the same JSON-over-WebSocket protocol to the manager.
- **The manager holds the SSH connections.** Browsers never SSH to a VM directly. The manager
  keeps a session cache (one ssh2 client per host/port/user, channels multiplexed), and
  everything — terminals, Claude, file I/O, git, stats probes, VS Code — rides on it.
- **Work survives disconnects.** Terminals and Claude sessions run inside detached **tmux**
  on the VM, so they outlive browser reloads and manager restarts.
- **VMs call back over HTTPS.** The on-VM stats daemon and the VM's Claude Code MCP servers
  call the manager's REST endpoints using per-instance bearer tokens.

---

## Repository layout

```
genie/
├── packages/
│   ├── manager/           Node WebSocket + HTTP server (the backend)
│   ├── renderer/          Next.js 16 dashboard (desktop, /mobile, /extension)
│   ├── chrome-extension/  Manifest V3 extension (webpack)
│   ├── vps-agent/         Tool-using LLM agent, runs in a Docker sandbox on the VM
│   └── vps-stats/         Metrics collector + systemd daemon that runs on the VM
├── knowledge/             "Concepts" docs (OKF bundle), synced with the knowledge_docs table
├── design-system/         UI handbook for the Genie look (tokens, primitives, patterns…)
├── docs/                  API & architecture docs (TazCloud API, MCP browser, status…)
├── scripts/               Repo-level helper scripts (free-port-9876.mjs)
├── .github/workflows/     CI (vitest for renderer + manager)
├── .claude/launch.json    Launch configs for the manager (9876) and renderer (3000)
├── CLAUDE.md              Project conventions (state management, chat surfaces, logs)
├── railway.toml           Railway build config (Nixpacks)
├── nixpacks.toml          Nixpacks phases (setup / install / build)
├── wireguard.md           WireGuard setup for reaching the TazCloud 10.128/16 network
└── docker-compose.yml     Small sample compose file (nginx + redis), not used by Genie itself
```

---

## Packages

### Manager (`packages/manager`)

The backend. ESM TypeScript (`"type": "module"`), run with `tsx` in dev and compiled with `tsc`
to `dist/` for production.

**Main dependencies:** `ws`, `ssh2`, `node-pty`, `drizzle-orm` + `postgres`, `ai` (Vercel AI
SDK v6) with `@ai-sdk/anthropic`, `@ai-sdk/fireworks` and `@ai-sdk/openai-compatible`,
`@google/generative-ai`, `google-auth-library`, `jsonwebtoken`, `@sendgrid/mail`,
`@slack/bolt`, `@aws-sdk/client-s3`, `socks`, `zod`.

**Boot sequence** (`src/index.ts`):

1. Load env from `packages/manager/.env.local`, then `.env` (`src/load-env.ts`; values loaded
   first win).
2. Probe the public egress IPv4/IPv6 (logged as `[egress]`). This tells you what to put into
   `MANAGER_PUBLIC_IP*`.
3. Start **wireproxy** if `WG_PRIVATE_KEY` is set (userspace WireGuard → local SOCKS5 for the
   TazCloud private network). A failure here is fatal.
4. Seed the built-in **Claude** agent user (`claude@genie.local`).
5. Run the idempotent **boot migrations** (`src/db/migrate.ts`).
6. Start the VPS-metric and SSH-event flushers.
7. Upsert the built-in **recipes** and **Claude plugins** by slug.
8. Strip embedded credentials (`user:token@`) out of stored git remote URLs.
9. Create the HTTP + WebSocket server (`src/ws-server.ts`), restore the Genie SSH key from
   the DB to disk, and start the background timers (see below).
10. Start the Slack bot (only if `SLACK_BOT_TOKEN` is set) and the RunPod idle watcher.
11. On SIGINT/SIGTERM: stop Slack and wireproxy, close sockets, flush metrics, exit.

**Background timers in the server:** DigitalOcean droplet status sync (60 s), presence
broadcast (3 s), WS ping/pong heartbeat (30 s; dead sockets are terminated), local
process/Docker monitoring, server metrics (1-hour per-second ring buffer plus per-minute
rollups), stdout/stderr log capture, the session janitor (first run after 30 s, then every
`GENIE_SESSION_PRUNE_INTERVAL_MIN`), daily retention janitors for analytics, audit and
connection logs, and the daily backup cron.

**Source map (`src/`):**

| Path | What lives there |
|---|---|
| `index.ts`, `ws-server.ts` | Boot, HTTP routing, WS upgrade, auth gate, ACL, handler chain |
| `handlers/` | ~35 WS handler modules (see [the protocol section](#the-websocket-protocol)) |
| `auth/` | Google OAuth, JWT, `ws-acl.ts` (role/namespace ACL) |
| `db/` | Drizzle schema (`schema.ts`, ~49 tables), client, boot migrations |
| `chat/` | AI chat models, Claude Code routing, durable chat turns, stream-json parser, team chat |
| `ssh/` | Terminal layer: one PTY channel per session, tmux builders, durable Claude stream session |
| `vps/` | SSH client/session cache/probe pool, handshake gate, file ops, firewall, code-server proxy, MCP servers, stats ingest, provisioning helpers |
| `cloud/` | DigitalOcean, TazCloud, Hetzner, Railway clients, wireproxy launcher, VM locks/aliases |
| `agents/` | Agent registry, runner, Docker sandbox |
| `projects/` | Project service (membership, visibility) |
| `security/` | Port scanner + web checks (headers, CORS, cookies, SSL, injection, …) |
| `notifications/` | SendGrid email service, Slack bot |
| `logging/` | Log ring buffers, monitor, server metrics, audit/analytics/connection logs |
| `runpod/` | On-demand Kimi GPU pod + idle watcher |
| `tools/` | Tools exposed to the floating AI assistant |
| `debug/` | Debug HTTP API, SSH breadcrumb logging, SOCKS probe |
| `default-recipes.ts` | Built-in recipes seeded on boot |
| `*-service.ts` | Admin, backup, docs, knowledge, org, recipes, settings, tracker services |
| `scripts/` | `export-knowledge.ts`, `import-knowledge.ts`, `ssh-events-report.ts` |
| `test-helpers/` | Test DB setup, fixtures, WS test harness |

Other folders in the package:

- `scripts/`: `inspect-ssh-events.mjs` (read-only `ssh_events` dump), `run-agent.ts` (an
  end-to-end agent smoke test that skips the WS layer), and `watch-prod-logs.mjs` (polls the
  debug logs endpoint).
- `migrations/`: hand-applied SQL files (see [Database](#database)).
- `drizzle/`: an old drizzle-kit baseline. It is stale and is not used by tests or boot.
- `TESTING.md`, `SECURITY-TESTING.md`: the testing strategy (see [Testing](#testing)).

### Renderer (`packages/renderer`)

The web UI. Next.js 16 (App Router), React 19, Tailwind CSS v4, `subjecto` for state.

**Notable libraries:** `@xterm/xterm` (+ fit/canvas addons) for terminals,
`@monaco-editor/react` for editors, `@xyflow/react` for the architecture diagram,
`three` / `@react-three/fiber` / `drei` for the 3D topology, `recharts` for charts,
`react-markdown` + `remark-gfm`, Radix Switch/Tooltip, `lucide-react`, `class-variance-authority`.

**`next.config.ts`:**

- `output: "standalone"`, so the build produces a self-contained server for deployment.
- `images.unoptimized`, `transpilePackages: ["react-markdown", "remark-gfm"]`.
- `allowedDevOrigins` and `experimental.serverActions.allowedOrigins` come from `PUBLIC_HOST`
  (comma-separated).
- `NEXT_PUBLIC_WS_URL` is baked into the build. The default is
  `wss://api.genie.teleporthq.ai` in production and `ws://localhost:9876` otherwise.
- `basePath` is only set for sub-path deployments (see
  [the reverse proxy section](#running-behind-a-reverse-proxy-sub-path-mount)).

**Real Next.js routes (`src/app`):**

| Route | Purpose |
|---|---|
| `/[[...slug]]` | The main app shell. A catch-all whose client-side router (`src/lib/routes.ts`) picks the panel. |
| `/mobile` | Phone UI: home, server detail, Claude, terminal. Requires login and uses live data. |
| `/extension` | The UI loaded inside the Chrome extension's side panel. Tabs: commands, db, docker, files, git, team-chat, terminal, tracker, plus a Claude mode. |
| `/doc/[key]` | Public read-only view of a shared doc |
| `/invite/[token]` | Org/team invite landing page (preview → Google login → accept) |
| `/presentation` | Pitch deck |
| `GET /api/doc/[key]`, `GET /api/invite/[token]` | Server-side proxies to the manager's public endpoints |

**Client-side panels** (inside the shell, URL → panel):

| URL | Panel | Minimum role |
|---|---|---|
| `/projects`, `/projects/:slug/{servers\|members\|settings}` | Project grid and project detail | user |
| `/agents` | AI agents | user |
| `/tracker` | Issue tracker (issues look like `PREFIX-n`) | user |
| `/chat` | Team chat (DMs and rooms) | user |
| `/history` | Past Claude sessions and saved terminals | user |
| `/settings/{general\|deploy\|genie-local\|org}`, `/settings/org/:orgId` | Settings; `deploy` and `genie-local` are admin only | user |
| `/clouds/{do\|taz\|hetzner}`, `/clouds/taz/{vms\|diagnostics}` | Cloud VM management | tazcloud |
| `/recipes` | Recipe catalog and editor | tazcloud |
| `/processes`, `/docker` | Local processes and Docker | admin |
| `/docs`, `/docs/…/file/:docId` | Docs with folders | admin |
| `/admin/:tab` | Admin console (see below) | admin |
| `/architecture` | xyflow architecture diagram | admin |
| `/topology` | 3D topology graph | admin |
| `/users` | Connected users (live presence) | admin |
| `/security` | Security scanner | admin |
| `/ssh` | SSH sessions | admin |
| `/help` | Help | admin |
| `/server` | Manager server metrics | superadmin |
| `/knowledge` | "Concepts" (the knowledge bundle) | superadmin |
| `/logs` | Live manager logs | superadmin |

Unknown or forbidden URLs redirect to `/projects`. The same rules (`navAllowedForRole`) also
control what the sidebar shows.

**Admin console tabs:** `database` (DB explorer with SQL runner and saved queries; outside
production it also has a Drizzle push button), `backup`, `droplets/{snapshots|templates|configs|sshkey}`
("DO Build"), `ai/{costs|settings}`, `users`, `teams`, `orgs`, `audit`, `prodlogs` (Railway),
`ssh-events`. Superadmins also get `communication` (email), `analytics`, `connections` and
`ssh-startups`.

**Always-mounted floating UI:** Claude stream windows, terminal windows, Manage-VM windows
(tabs: Manage, Firewall, Ports, Processes, Traffic, Claude Logs, Claude Memory, Claude
Plugins, Skills, Commands, Files, DB, Github, Agents), VM connection windows, a file explorer,
the WS log drawer, the floating Genie assistant, the review-changes (diff) panel, DM popups,
deploy/build-log windows, the ⌘K command palette, and a reconnecting toast.

**Source map (`src/`):**

| Path | Contents |
|---|---|
| `app/` | Next routes (above) and `globals.css` |
| `components/admin` | Admin panel, DB explorer, cloud panels, analytics, logs, users/orgs |
| `components/chat` | Claude chat (desktop window, shared `ClaudeChatSurface`, `ChatMessageList`, AskUserQuestion dialog, review-changes panel) and team chat |
| `components/project` | Projects, VPS cards, Docker, docs, tracker, recipes, security, clouds, architecture/topology, VS Code button, deploy windows |
| `components/tazcloud` | Manage-VM popup, VM connection (SSH terminal) windows, tmux session UI, snapshots |
| `components/terminal` | xterm windows (bridge in `lib/terminal-bridge.ts`) |
| `components/mobile` | Mobile app, screens, speech-to-text |
| `components/agents`, `knowledge`, `settings`, `file-explorer`, `cloud` | Their panels |
| `components/ui` | Primitives (button, card, select, menus, gauges, chart) and app chrome (sidebar, top bar, command palette, login) |
| `store/` | State: `types/`, `subjects/`, `actions/`, `handlers/` (see [Conventions](#conventions-for-contributors)) |
| `lib/` | `ws.ts` (WS client), `routes.ts`, `dev-login.ts`, `hooks.ts`, `utils.ts` (`cn()`), feature flags |

**Styling.** Tailwind v4 is configured in CSS only (there is no `tailwind.config.ts`). The
theme in `src/app/globals.css` is Catppuccin Mocha, with a compact type scale (`text-md` is
13 px body text), SF Pro/SF Mono font stacks, and a few animations (streaming border, Claude
thinking pulse, tmux glow) that respect `prefers-reduced-motion`. `components.json` is a
leftover shadcn config; components are hand-written. The full design rules are in
[`design-system/`](design-system/README.md).

### Chrome extension (`packages/chrome-extension`)

A Manifest V3 extension called **"Genie Assistant"**. It does two things:

1. It puts the Genie UI in Chrome's **side panel** (the renderer's `/extension` route in an
   iframe), already scoped to the project of the current tab.
2. It runs **DOM actions** on your tabs on behalf of the AI (the `genie-browser` MCP tools).

| Part | File(s) | Role |
|---|---|---|
| Service worker | `src/background/service-worker.ts` | Holds the extension's WS connection to the manager (production: `wss://api.genie.teleporthq.ai`; dev builds try `ws://127.0.0.1:9876` first). Backoff 1–30 s with jitter, 20 s keepalive ping. Identifies itself with `extension:identify`. Brokers `extension:dom_action` requests to the content script. |
| Project matcher | `src/background/project-matcher.ts` | Maps the active tab's hostname to a project by VPS host or IP |
| Content script | `src/content/content-script.ts`, `dom-actions.ts` | `get_snapshot`, `click`, `type`, `select`, `scroll`, `read_text`, `read_attr`, `navigate`, `wait_for` |
| Popup | `src/popup/Popup.tsx` | Connection status, detected project, Sign in with Google, open side panel |
| Side panel | `src/sidepanel/` | iframe of `http://localhost:3000/extension` (falling back to `https://genie.teleporthq.ai/extension`) plus a postMessage bridge that shares the auth token and WS URL |
| Widget | `src/widget/`, `src/content/floating-widget.ts` | Floating in-page widget. It is built but not currently injected. |

Permissions: `activeTab`, `sidePanel`, `scripting`, `storage`, `tabs`. Host permissions
cover `localhost:9876`, `127.0.0.1:9876` and `localhost:3000`.

**How the AI drives your browser:** the VM's Claude calls the `genie-browser` MCP tools
(`browser_get_snapshot`, `browser_click`, …). They go to the manager's MCP browser server,
which sends `extension:dom_action` to your extension socket and waits up to 15 s for
`extension:dom_action_result`. See [`docs/MCPD.md`](docs/MCPD.md).

**Build and load:**

```bash
npm run build:extension   # production build → packages/chrome-extension/dist
npm run dev:extension     # watch mode
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and
choose `packages/chrome-extension/dist`.

### VPS agent (`packages/vps-agent`)

A small tool-using LLM agent (`ai` v6 + `@ai-sdk/anthropic`) that speaks **newline-delimited
JSON over stdin/stdout**. Today it powers the user-defined **Agents** feature, running inside
a throwaway Docker container on the project VM.

- **Binary `genie-agent`** (`src/index.ts`):
  - Input messages: `init` (apiKey, projectDir, maxToolRounds = 40, modelId, systemPrompt,
    allowedTools), `chat` (messages, context, domSnapshot), `stop`, `browser:result`.
  - Output messages: `ready`, `token`, `tool`, `done`, `error`, `stopped`, `browser:request`.
- **Models:** `claude-sonnet` (the default) and `claude-opus`.
- **Tools** (`src/tools/`):
  - `shell_exec`: bash, 120 s default timeout and 600 s max; keeps 30 KB of output, the first
    8 KB and last 22 KB.
  - `read_file`: 1 MB cap; refuses paths outside the project directory.
  - `write_file`, `list_files` (depth 5, 500 entries), `search_files` (50 matches).
  - The browser tools `view_page` and `dom_action`.
  - An `allowedTools` allowlist can restrict the set.
- **Binary `genie-mcp`** (`src/mcp-cli.ts`): an older stdio↔unix-socket MCP relay. The VM's
  MCP servers now use HTTPS REST (`/api/vps/mcp/*`) instead, so it is legacy.
- **Deployment:** the manager hashes `dist/*.js` + `package.json` and compares that with
  `/usr/lib/node_modules/@genie/vps-agent/.version` on the VM. If they differ, it uploads the
  files over SSH and runs `npm install --omit=dev` (`src/vps/vps-agent-rsync.ts`). Agent runs
  then execute
  `docker run --rm -i node:20-slim` with the agent mounted read-only at `/opt/agent` and
  `/opt/project` mounted at `/workspace`. `ANTHROPIC_API_KEY` is injected so that it never
  appears in `ps`.

### VPS stats (`packages/vps-stats`)

A dependency-free metrics collector shared by the manager (types and parsers) and the VM (daemon).

- **`collect.ts`** gathers:
  - CPU % (two `/proc/stat` samples)
  - memory (`/proc/meminfo`)
  - disk (`df /`)
  - processes, plus listening and external ports (`ss`, `ps`)
  - SSH sessions (`who`) and established SSH connections
  - sshd `MaxStartups` / `ClientAlive*` settings
  - "past MaxStartups" drop events from the journal
- **`daemon.ts`** (`genie-stats-daemon`):
  - Flags: `--interval <sec>` (default 5) and `--output <path>`.
  - Writes JSON lines to stdout and to the output file.
  - If `GENIE_MANAGER_URL`, `GENIE_STATS_TOKEN`, `GENIE_PROJECT_ID` and `GENIE_INSTANCE_ID`
    are all set, it also POSTs each sample to `<manager>/api/vps/stats` with a Bearer token.
- **`parse-probe.ts`**: parses the output of the older SSH probe (manager polling), which is
  kept as a fallback.

On the VM it runs as the systemd unit `genie-stats.service`, installed by the
`genie-standard` recipe and writing to `/run/genie/stats.jsonl`. The manager installs a
drop-in (`10-genie-postback.conf`) with the postback env vars. It then ingests samples
(`vps/stats-stream.ts`), stores history in `vps_metric_samples`, and pushes live updates to
the UI as `vps:stats:update`.

---

## Getting started (local development)

### Prerequisites

- **Node.js ≥ 22** (`engines.node`) and npm.
- **PostgreSQL** (any recent version; TLS is supported through `DB_CERT`).
- **Build tools for `node-pty`**: python3, gcc and make. node-pty is used only by the
  manager-host terminal; the rest of the app works without it.
- A **Google OAuth client** if you want real sign-in. On localhost you can skip it and use
  the dev login (see step 5).
- Optional: an Anthropic API key (Claude), cloud provider tokens, SendGrid, Slack and so on.
  See [Configuration](#configuration-environment-variables).

### 1. Install

```bash
npm install
```

The manager's `postinstall` makes node-pty's `spawn-helper` prebuilds executable.

### 2. Configure the manager

Create `packages/manager/.env.local` (gitignored, like all `.env.*` files). Minimal example:

```bash
DB=postgres://user:pass@localhost:5432/genie
GENIE_JWT_SECRET=<long random string>
GENIE_SUPERADMIN_EMAILS=you@example.com
GENIE_SECRET=<long random string>       # encrypts stored SSH keys / tokens
GOOGLE_CLIENT_ID=...                    # optional on localhost (see dev login)
GOOGLE_CLIENT_SECRET=...
MANAGER_URL=http://localhost:9876       # OAuth redirect = $MANAGER_URL/auth/callback
FRONTEND_URL=http://localhost:3000
ANTHROPIC_API_KEY=sk-ant-...            # needed for Claude features
```

> ⚠ The Postgres variable is **`DB`**, not `DATABASE_URL`.

### 3. Configure the renderer (optional)

`packages/renderer/.env.local`:

```bash
NEXT_PUBLIC_WS_URL=ws://localhost:9876
```

If you don't set it, the default is `ws://localhost:9876` in dev, and the WS client falls
back to production (`wss://api.genie.teleporthq.ai`) whenever the page is not served from
`localhost`.

### 4. Create the schema and build the workspace dependencies

```bash
npm run db:push -w @genie/manager   # drizzle-kit push: schema.ts → DB
npm run build:vps-stats             # the manager imports @genie/vps-stats/dist
npm run build:vps-agent             # deployed to VMs by the manager
```

Skipping the `vps-stats` build makes the manager crash with `ERR_MODULE_NOT_FOUND`.

### 5. Run

```bash
npm run dev            # manager (tsx watch, :9876) + renderer (next dev, :3000)
```

- `dev:manager` first runs `scripts/free-port-9876.mjs`, which SIGTERMs whatever is still
  holding the port.
- Open `http://localhost:3000`. The first non-agent user to sign in becomes **admin**
  and is validated automatically.
- **Dev login without Google:** on `localhost` / `127.0.0.1`, open
  `http://localhost:3000/?login=you@example.com`. That redirects through the manager's
  loopback-only `/test-login` endpoint, which is disabled when `NODE_ENV=production`.

---

## Scripts reference

Root `package.json`:

| Script | What it does |
|---|---|
| `npm run dev` | Manager + renderer concurrently (`concurrently -k`) |
| `npm run dev:manager` | Free port 9876, then `PORT=9876 tsx watch packages/manager/src/index.ts` |
| `npm run dev:renderer` | `next dev` in `packages/renderer` |
| `npm run dev:extension` | Extension webpack in watch mode |
| `npm run build` | Full build: vps-stats → vps-agent → manager → renderer → extension |
| `npm run build:vps-stats` / `build:vps-agent` / `build:manager` | `tsc` per package |
| `npm run build:renderer` | `next build` |
| `npm run build:extension` | Production webpack build |
| `npm start` | `start:manager` + `start:renderer` |
| `npm run start:manager` | `node packages/manager/dist/index.js` |
| `npm run start:renderer` | `next start` |
| `npm run manager` | Run the manager once with tsx (no watch) |
| `npm run knowledge:export` | DB `knowledge_docs` → `knowledge/*.md` |
| `npm run knowledge:import` | `knowledge/*.md` → DB (upsert by path, non-destructive) |

Package-level scripts:

| Package | Script | What it does |
|---|---|---|
| manager | `test`, `test:watch` | vitest |
| manager | `db:push` | `drizzle-kit push` |
| renderer | `test`, `test:watch` | vitest (jsdom) |
| renderer | `test:e2e`, `test:e2e:ui` | Playwright |

---

## Configuration (environment variables)

The manager reads `packages/manager/.env.local`, then `.env`. Several provider settings
(DigitalOcean, Hetzner, Railway, RunPod, Namecheap, GitHub PAT) can also be stored in the DB
(`global_settings`, editable in the UI). **A DB value wins over the env var.** The
DigitalOcean token can only be set in the DB.

### Manager: core

| Variable | Default | Purpose |
|---|---|---|
| `DB` | **required** | Postgres connection string |
| `DB_CERT` | — | CA PEM for Postgres TLS |
| `PORT` | `9876` | HTTP/WS port |
| `NODE_ENV` | — | `production` disables `/test-login` |
| `MANAGER_URL` | `http://127.0.0.1:$PORT` | Public manager URL. The OAuth redirect URI is `$MANAGER_URL/auth/callback`. |
| `FRONTEND_URL` | `https://genie.teleporthq.ai` | Where the browser is sent after OAuth (`?token=`); also used for invite links |
| `RENDERER_URL` | `http://localhost:3000` | Redirect target for `/test-login` |
| `VPS_MANAGER_URL` | see note | URL that VMs use for stats postback and MCP REST. Falls back to a public `MANAGER_URL`, then `https://api.genie.teleporthq.ai`. |

### Manager: auth and secrets

| Variable | Purpose |
|---|---|
| `GENIE_JWT_SECRET` | JWT signing key (tokens last 30 days). Recommended in production. If it is unset, the manager generates a random secret once and stores it in `global_settings` (`jwtSecret`). |
| `GENIE_SECRET` | AES-256-GCM key (scrypt-derived) for stored SSH keys, git tokens and org credentials. Falls back to `GENIE_JWT_SECRET`. Pasting SSH keys is disabled if no real secret is set. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth (scopes `openid email profile`) |
| `GENIE_SUPERADMIN_EMAILS` | Comma-separated emails that get the `superadmin` role on first sign-in. They also receive new-signup notifications. |
| `GENIE_DEBUG_SECRET` | Key for `GET /api/debug/server-logs`. `packages/manager/scripts/watch-prod-logs.mjs` reads it from the environment too. |

### Manager: AI

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude models, the agent runner, and Claude on VMs |
| `FIREWORKS_API_KEY` | DeepSeek, Kimi and Qwen models through Fireworks |
| `GOOGLE_GENERATIVE_AI_API_KEY` | The `web_search` tool (Gemini with Google Search grounding) |
| `RUNPOD_API_KEY`, `RUNPOD_KIMI_POD_ID`, `RUNPOD_KIMI_ENDPOINT`, `KIMI_KEY`, `RUNPOD_KIMI_SERVED_MODEL` (default `kimi-k2.7-code`) | Self-hosted Kimi on a RunPod GPU pod (vLLM, OpenAI-compatible), started on demand and stopped when idle |

### Manager: clouds and infrastructure

| Variable | Purpose |
|---|---|
| `TAZCLOUD_API_TOKEN`, `TAZCLOUD_PROJECT_ID` | TazCloud API (`https://api.taz.ro`) |
| `TAZCLOUD_SSH_PRIVATE_KEY` | Written to disk at boot and used for SSH to Taz VMs |
| `HETZNER_API_TOKEN` | Hetzner Cloud |
| `RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID` | Railway GraphQL API, used by the admin "prod logs" viewer |
| `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_USERNAME`, `NAMECHEAP_DOMAIN` | DNS A records for custom subdomains on DigitalOcean droplets |
| `MANAGER_PUBLIC_IP`, `MANAGER_PUBLIC_IP_V6` (+ `_DEV` variants) | Added to the UFW allowlist on provisioned VMs, and used as the Namecheap ClientIp |
| `GENIE_LOCAL_GITHUB_PAT` | GitHub PAT used by the genie-local recipe |

### Manager: TazCloud private network (WireGuard over SOCKS5)

TazCloud v2 VMs live on private `10.128.N.0/24` networks. The manager reaches them through a
userspace WireGuard tunnel (`wireproxy`), which it can launch itself. See
[`wireguard.md`](wireguard.md) and [`docs/API-v2.md`](docs/API-v2.md).

| Variable | Default | Purpose |
|---|---|---|
| `WG_PRIVATE_KEY` | — | Turns on the built-in wireproxy launcher. Then `WG_PEER_PUBLIC_KEY`, `WG_ENDPOINT` and `WG_ADDRESS` are also required. Values can be inline or a file path. |
| `WG_ALLOWED_IPS` / `WG_KEEPALIVE` / `WG_MTU` | `10.128.0.0/16` / `25` / `1420` | Tunnel options |
| `WIREPROXY_BIN` | `wireproxy` | Path to the binary |
| `GENIE_TAZ_SOCKS_HOST` / `GENIE_TAZ_SOCKS_PORT` | `127.0.0.1` / `25344` | Local SOCKS listener |
| `GENIE_TAZ_SOCKS` | set by the launcher | `host:port`. Set it yourself to use an external proxy. |
| `GENIE_TAZ_SOCKS_USER` / `GENIE_TAZ_SOCKS_PASS` | — | SOCKS authentication |
| `GENIE_TAZ_SUBNET` | `10.128.0.0/16` | Destinations that are routed through SOCKS |
| `GENIE_TAZ_SOCKS_HEARTBEAT_MS` / `_TARGET` | `0` (off) / `10.128.0.1:22` | Optional tunnel heartbeat |

### Manager: stats, SSH and retention

| Variable | Default | Purpose |
|---|---|---|
| `GENIE_SSH_STATS_POSTBACK` | on (`0` turns it off) | VM daemon pushes stats to the manager |
| `GENIE_SSH_STATS_PROBE` (legacy `GENIE_SSH_STATS`) | off (`1` turns it on) | Fallback SSH polling probe |
| `GENIE_SSH_TMUX_PROBE` | on (`0` turns it off) | tmux session listing |
| `GENIE_STATS_DB_POLL` | auto | Poll stats from the DB; on automatically when `MANAGER_URL` is unset or localhost |
| `GENIE_STATS_FLUSH_MS` | `30000` | Metric batch flush interval |
| `GENIE_SSH_DEBUG` | off | Structured SSH breadcrumb logging |
| `GENIE_SESSION_RETENTION_DAYS` | `30` (`0` turns it off) | Prunes old sessions, including Claude JSONL transcripts on VMs |
| `GENIE_SESSION_PRUNE_INTERVAL_MIN` | `60` | How often the session janitor runs |
| `GENIE_ANALYTICS_RETENTION_DAYS` | `180` | |
| `GENIE_AUDIT_RETENTION_DAYS` | `30` | |
| `GENIE_CONNECTION_LOG_RETENTION_DAYS` | `30` | |

### Manager: notifications and storage

| Variable | Purpose |
|---|---|
| `SENDGRID_API_KEY` | All outgoing email (signup alerts, backups, feedback, broadcast emails, genie-notify MCP) |
| `BACKUP_EMAIL` | Recipient of the daily backup; also the default sender |
| `COMMUNICATION_FROM_EMAIL` | Sender for broadcast emails from the admin Communication tab |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` | Slack bot (Bolt, socket mode), `/genie` command |
| `BUCKET_NAME`, `BUCKET_REGION`, `BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY`, `BUCKET_ENDPOINT_URL` | S3-compatible storage behind the genie-storage MCP |

### Manager: testing

`DB_TEST` (a separate test database, never the same as `DB`) and `WS_INTEGRATION=1`. See
[Testing](#testing).

### Renderer

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_WS_URL` | Manager WebSocket URL (baked in at build time) |
| `PUBLIC_HOST` | Comma-separated public hosts, allowed for dev origins and server actions |
| `NEXT_PUBLIC_GENIE_SSH_STATS_POSTBACK` | Live VM stats UI (on unless `0`) |
| `NEXT_PUBLIC_GENIE_SSH_STATS_PROBE` / `NEXT_PUBLIC_GENIE_SSH_STATS` | Fallback probe UI (off unless `1`) |
| `NEXT_PUBLIC_GENIE_SSH_TMUX_PROBE` | tmux session listing (on unless `0`) |

---

## Database

**Stack:** PostgreSQL with drizzle-orm 0.44 on `postgres.js`. The schema is in
`packages/manager/src/db/schema.ts` (about 49 tables), and `getDb()` in `src/db/index.ts` is
a lazy singleton.

**Tables by area:**

| Area | Tables |
|---|---|
| Identity and orgs | `users`, `organizations`, `org_members`, `teams`, `team_members`, `team_invites`, `org_credentials` |
| Projects | `projects` (soft delete; holds the VPS instances), `project_members`, `project_teams`, `deploy_logs`, `file_templates`, `vps_git_repos` |
| Chat and AI | `conversations`, `conversation_members`, `messages`, `chat_session_meta`, `assistant_chat_logs`, `assistant_session_state` (maps to a Claude Code session id for `--resume`), `ai_usage` |
| Content | `docs`, `doc_folders`, `doc_shares`, `knowledge_docs`, `tracker_labels`, `tracker_issues`, `tracker_issue_labels`, `tracker_issue_comments`, `saved_queries` |
| Catalogs | `recipes`, `claude_plugins`, `agents`, `agent_runs`, `base_image_template_history`, `global_settings` (key/value: provider tokens, the Genie SSH keypair, …) |
| VMs and infra | `server_credentials`, `vps_stats_tokens`, `vps_metric_samples`, `ssh_maxstartups_events`, `ssh_events`, `pty_sessions`, `cloud_vm_aliases`, `cloud_vm_locks`, `security_scans` |
| Observability | `audit_log` (every WS message), `connection_log`, `analytics_events`, `email_logs`, `server_metric_samples` |

**How the schema gets applied.** There are three mechanisms, and it helps to know all of them:

1. **`drizzle-kit push`.** Run `npm run db:push -w @genie/manager`, which diffs `schema.ts`
   against the live DB. This is the normal way to set up a fresh DB. In the Admin →
   Database tab, a superadmin can trigger it remotely (`admin:drizzle:push`); that first
   writes a backup and then runs `push --force`.
2. **Boot migrations** (`src/db/migrate.ts`). About 20 idempotent raw-SQL steps, tracked in
   `_genie_boot_migrations`, that run on every start.
3. **`migrations/*.sql`**. Hand-written, dated `CREATE … IF NOT EXISTS` files. No code applies
   them, so run them with `psql` if you need them.

The `drizzle/0000_*.sql` baseline is stale. Tests build their schema straight from `schema.ts`.

**Backups** (`src/backup-service.ts`): a logical SQL dump (INSERT statements) produced in
Node, skipping the large telemetry tables, written to `~/.genie/backups/backup-<ts>.sql`.
You can list, create and delete backups from Admin → Backup. A daily midnight cron emails
the dump through SendGrid, but only when both `SENDGRID_API_KEY` and `BACKUP_EMAIL` are set.

---

## Auth, roles and access control

**Sign-in flow:**

1. When a socket connects, the manager sends `auth:required`.
2. The client replies with `auth:token {token}` if it has a stored token
   (`localStorage["genie-auth-token"]`). Otherwise it sends `auth:google:start`.
3. The manager answers with `auth:google:url`. The browser completes Google OAuth at
   `GET /auth/callback` and is redirected to `FRONTEND_URL?token=<jwt>`.
4. The client stores the token, cleans the URL and authenticates the socket. On
   `auth:success` it also resumes Claude streams and VM connections and accepts any pending
   invite.

**New users:**

- The first non-agent user becomes `admin` and is validated automatically.
- Emails listed in `GENIE_SUPERADMIN_EMAILS` become `superadmin` and are validated
  automatically. The role is only assigned when the account is created, so an existing
  user must be promoted in Admin → Users.
- Everyone else starts as `user` and **unvalidated**. The superadmin emails get a
  notification (SendGrid), and an admin validates the new user in Admin → Users.
- Signing up with an invite token accepts the invite automatically.
- Admins get a default organization.

**Roles** (ordered): `user` < `tazcloud` < `admin` < `superadmin`. Superadmins can
**impersonate** other users (`admin:impersonate:start/stop`); a banner shows while
impersonating, and the JWT carries `impersonatedBy`.

**Tenancy:** organizations → teams → projects. A user sees a project through
`project_members`, `project_teams`, or org owner/admin rights.

**Defense in depth.** A role-gated feature has four layers
([`knowledge/security/access-control.md`](knowledge/security/access-control.md)):

1. Sidebar visibility (client).
2. Route guard `navAllowedForRole` (client).
3. **WS ACL** `auth/ws-acl.ts` (server). It checks the exact type override first, then the
   longest namespace prefix, and **denies unknown types**. It applies to inbound messages
   (`canSend`) and outbound ones (`canReceive`).
4. **Ownership checks** in the handlers (`handlers/handler-auth.ts`: `canAccessProject`,
   `hasRole`). Every message that carries a client-supplied id must check ownership.

---

## The WebSocket protocol

Every frame is JSON: `{ "type": "namespace:action", "payload": { … } }`.

- **Request/response:** the client's `wsRequest()` adds a `reqId` and resolves when a reply
  with the same `reqId` arrives (10 s default timeout). Fire-and-forget messages use `wsSend()`.
- **Errors:** `{type: "error", payload: {message}}`, or `error:forbidden` from the ACL.
- **Heartbeat:** the client sends `ping` every 20 s and closes the socket if no `pong`
  arrives within 45 s. The server pings at the protocol level every 30 s.
- **Reconnect:** exponential backoff with jitter (1 s → 12 s in the renderer). It reconnects
  immediately when the browser comes back online or the tab regains focus. Close code 1013
  starts further along the backoff.
- **Server pipeline:**
  1. Audit log.
  2. `ping` → `pong`.
  3. `auth:*`.
  4. Auth gate.
  5. ACL.
  6. Inline presence/extension messages.
  7. The handler chain. The first handler that returns `true` wins; otherwise the client
     gets `Unknown message type`.

**Handler modules and their namespaces** (`packages/manager/src/handlers/`):

| Module | Message types | Role |
|---|---|---|
| `project-handler` | `project:list/add/update/remove/start/stop/command:*`, `project:members:*`, `project:teams:*` | user |
| `vps-lifecycle-handler` | `vps:deploy/connect/disconnect/test-connection/attach-existing/teardown/hibernate/wake/reboot` | user (`attach-existing`: admin) |
| `vps-runtime-handler` | `vps:exec/status/logs/docker:logs/process:kill`, `vps:stats:*`, `vps:recipe:*`, `vps:claude-plugin:*`, `vps:mcp:ensure`, `vps:traffic:get` | user |
| `terminal-handler` | `terminal:start/data/resize/close/inject/paste-image`, `ssh:list/kill/tunnel:reconnect` | user (`ssh:*`: admin) |
| `claude-stream-handler` | `claude:stream:start/input/answer/stop/close/resize/bash/gitdiff/paste-image/list-sessions` | user |
| `fs-handler` | `vps:fs:readDirectory/readFile/writeFile/rename/delete/upload/download` | user |
| `git-handler` | `git:status/diff/log/branches/checkout/commit/pull/push/stage/stash/…` | user |
| `vps-git-repos-handler` | `vps:git:repos:list/add/update/remove/clone/init/detect/set-auto-save` | user |
| `vps-db-handler` | `vps:db:detect/databases/tables/query`, `vps:db:backup:*` | user |
| `firewall-handler` | `vps:firewall:status/toggle/add/remove` (UFW and the egress allowlist) | user |
| `code-server-handler` | `vps:code:ensure/status` | user |
| `agents-handler` | `agents:list/get/upsert/delete/run/cancel` | user |
| `chat-handler` | Team chat `chat:conversation(s):*`, `chat:message:*`, `chat:reaction:toggle`; assistant `chat:send/stop/resume`, `chat:session(s):*` | user |
| `tracker-handler` | `tracker:list`, `tracker:issue:*`, `tracker:label:*`, `tracker:comment(s):*` | user |
| `docs-handler` | `docs:*`, `docs:folder:*`, `docs:download:*` (share, make public, ZIP) | user |
| `file-template-handler`, `project-file-handler` | `file-template:*`, `project-file:*` | user |
| `skills-registry-handler` | `skills:registry:search` | user |
| `mcp-handler` | `mcp:install` | user |
| `org-handler` | `org:*` (invites, members, teams, SSH key, Taz credentials and VMs) | user + org-admin check |
| `recipes-handler` | `recipes:list` (user), `recipes:create/update/delete` (superadmin) | — |
| `claude-plugins-handler` | `claude-plugins:list` (user), create/update/delete (superadmin) | — |
| `knowledge-handler` | `knowledge:list/create/update/delete/import/export` | superadmin |
| `do-handler` | `do:deploy/…`, `admin:droplets:*` | tazcloud |
| `tazcloud-handler` | `tazcloud:*`, `admin:tazcloud:*`, `admin:server:tunnel:*` | tazcloud |
| `hetzner-handler` | `hetzner:*`, `admin:hetzner:*` | tazcloud |
| `baseimage-handler` | `admin:baseimage:*` | admin |
| `db-handler` | `admin:tables`, `admin:table:*`, `admin:row:*`, `admin:sql:execute`, `admin:db:download`, `admin:drizzle:push` | admin |
| `backup-handler` | `admin:backups:list/create/delete` | admin |
| `admin-users-handler` | `admin:users:*`, `admin:teams:*`, `admin:orgs:*`, `admin:impersonate:*` | admin / superadmin |
| `admin-misc-handler` | `admin:ai:*`, `admin:audit:list`, `admin:connections:list`, `admin:email:*`, `admin:prodlogs:*`, `admin:sshkey:*`, … | admin / superadmin |
| `analytics-handler` | `analytics:track`, `admin:analytics:summary` | user / superadmin |
| `admin-server-metrics-handler` | `admin:server-metrics:*`, `admin:ssh-startups:list` | superadmin |
| `security-handler` | `security:scans:list`, `security:scan:start/stop/delete` | admin |
| `runpod-handler` | `runpod:start/stop/status` | admin |
| `local-pty-handler` | `manager-pty:*` (a shell on the manager host itself) | superadmin |
| `local-fs-handler` | `fs:*` (the manager host's filesystem) | user (ACL) |
| `misc-handler` | `settings:*`, `feedback:submit`, `logs:*`, `monitor:set-interval`, `process:kill`, `docker:*`, `compose:*`, `db:saved-queries:*` | mixed |

Among the messages the server pushes: `stats`, `project:list`, `project:log`, `logs:*`,
`chat:presence`, `presence:detail`, `vps:stats:update`, `terminal:output`, `claude:stream:*`
and `*:list:stale` (cache invalidation).

---

## HTTP endpoints

The manager also serves plain HTTP on the same port:

| Path | Method | Purpose and auth |
|---|---|---|
| `/` | GET | Health check: `{"status":"ok"}` |
| `/auth/callback` | GET | Google OAuth redirect target |
| `/test-login?email=&redirect=` | GET | Dev login. **Loopback only**, and returns 404 in production. |
| `/code/<projectId>/<instanceId>/…` | any + WS | Reverse proxy to code-server (`127.0.0.1:13337` on the VM) over SSH. An HMAC `?gtoken=` (valid 12 h) is exchanged for a path-scoped HttpOnly cookie. |
| `/api/vps/stats` | POST | Stats postback from the VM daemon (per-instance Bearer token) |
| `/api/vps/mcp/(tracker\|security\|notify\|storage)` | POST | JSON-RPC MCP over REST for the VM's Claude Code (per-instance Bearer token) |
| `/api/public/doc/:publicKey` | GET | Public doc JSON |
| `/api/public/invite/:token` | GET | Invite preview |
| `/api/debug/server-logs?source=errors\|manager\|all&tail=N` | GET | In-memory log buffers. Accepts a superadmin JWT, or `GENIE_DEBUG_SECRET` as a Bearer token or in the `X-Genie-Debug-Key` header. |

CORS is `*` for GET/OPTIONS.

---

## Feature tour

### Projects and servers

A **project** groups one or more VPS instances, members and teams, git repos, file
templates, a tracker prefix, docs and agents.

- Servers can be **deployed** on DigitalOcean (from base images built in Admin → DO Build),
  TazCloud or Hetzner, or **attached** as any SSH server you already have
  (`connect-server-form`, `vps-bootstrap.ts`).
- You can test-connect, hibernate/wake, reboot and tear down servers from the UI.
- The provisioning scripts restrict SSH (UFW) to the manager's public IPs.

### Recipes (add-ons)

A **recipe** is a row with `checkScript`, `installScript` and `uninstallScript` bash scripts,
run as root over SSH. Built-ins live in `src/default-recipes.ts` and are upserted on every
boot; you can add more in the UI (superadmin).

The baseline recipe, **`genie-standard`**, installs:

- the `genie` user (with passwordless sudo)
- Docker + compose
- Node
- Claude Code
- dtach
- `/opt/project`
- the `genie-stats` systemd unit

Other recipes include dev services such as Next.js (logs to `/var/log/nextjs-dev.log`) and
ASP.NET Core (`/var/log/dotnet-dev.log`), code-server, Claude hardening, and **genie-local**,
which installs and upgrades a local Genie in place. See
[`knowledge/recipes/`](knowledge/recipes/).

**Claude plugins** (skills, commands, MCPs) work the same way: a catalog in the
`claude_plugins` table that can be installed on VMs.

### Terminals

- Each terminal is an SSH PTY channel to the VM, wrapped in **tmux**, so sessions survive
  reloads and manager restarts.
- Sessions can be renamed, are listed with live "running" glows, and are kept in history.
- The browser side is xterm.js: output arrives as base64 `terminal:output`, and input goes
  out as `terminal:data` / `terminal:resize`.
- Superadmins also get a node-pty shell on the manager host (`manager-pty:*`).

### Claude Code on the VM (durable chat)

The Claude chat runs the **Claude Code CLI on the VM**:
`claude -p --input-format stream-json --output-format stream-json`, inside detached tmux, with
a FIFO for stdin.

- The manager `tail -F`s the output and parses it (`chat/stream-json-parser.ts`) into
  `claude:stream:*` messages.
- It supports queueing, stop, plan mode, `!cmd` bash mode, image paste, slash-command
  autocomplete, dictation, the **AskUserQuestion** dialog, a context footer, git diff review,
  and `--resume` across sessions (`assistant_session_state`).
- Desktop (floating windows) and mobile share one store and one `ClaudeChatSurface`.

### Floating Genie assistant (multi-model)

A separate in-dashboard assistant built on the Vercel AI SDK
(`packages/manager/src/chat/chat.ts`). The available models:

| Model id | Provider |
|---|---|
| `claude-opus`, `claude-sonnet` | Anthropic |
| `deepseek-v3`, `deepseek-v4-pro`, `kimi-k2.6`, `kimi-k2.7`, `qwen-3.6-plus` | Fireworks |
| `kimi-k2.7-runpod` | Self-hosted on RunPod (vLLM, OpenAI-compatible) |
| `claude-code` | Routed to the Claude Code CLI on the VM over SSH |

Its tools (`src/tools/`) include `web_search` (Gemini grounding), `browse_url`, project file
read/write/list, `ssh_exec`, project docs, `save_agent_memory` (AGENT.md) and
`tracker_create_issue`. Privileged roles also get TazCloud, DigitalOcean-domain and recipe
tools.

A turn keeps running if the socket drops and is replayed when the client reconnects
(`durable-chat-turn.ts`). Token usage and costs are recorded in `ai_usage` and shown in
Admin → AI → Costs.

### MCP servers for the VM's Claude

When a VM is set up, the manager merges entries into `/opt/project/.mcp.json` on the VM
(`vps/mcp-config-merge.ts`). Each entry is an HTTP MCP that points back at the manager with
a per-instance bearer token:

| MCP | What it gives Claude |
|---|---|
| `genie-tracker` | Read and update the project's issues and comments |
| `genie-security` | Run and read security scans |
| `genie-notify` | Send email and chat notifications |
| `genie-storage` | S3-compatible object storage (put/list/get/delete, presigned URLs) |
| `genie-browser` | Drive your Chrome tabs through the extension (see [`docs/MCPD.md`](docs/MCPD.md)) |

### Agents

User-defined AI agents (name, prompt, model, tool allowlist, timeout) are stored in `agents`,
and each run is recorded in `agent_runs` (`queued → running → succeeded | failed | timeout |
cancelled`).

- `agents:run` starts `runner.ts`, which opens the Docker sandbox on the project VM, runs the
  `vps-agent` inside it, and streams events back as `agents:run:event` / `agents:run:complete`.
- The UI ships starter templates such as Codebase Guide and Build/Deploy Doctor.
- A Firecracker sandbox is planned.

Details: [`knowledge/agents/architecture.md`](knowledge/agents/architecture.md).

### VS Code in the browser

"Open in VS Code" installs code-server on the VM if needed and opens
`<manager>/code/<projectId>/<instanceId>/`. The manager proxies HTTP and WebSocket traffic
over SSH `forwardOut`, so no per-VM domain or open port is needed. Access is gated by a
short-lived HMAC token that is exchanged for a cookie. Details:
[`knowledge/vps/code-server-proxy.md`](knowledge/vps/code-server-proxy.md).

### Claude hardening and the egress firewall

VM Claude sessions run with bypass permissions, so two layers bound what they can reach
([`knowledge/security/claude-hardening.md`](knowledge/security/claude-hardening.md)):

1. **Managed settings** in `/etc/claude-code/managed-settings.json` deny reading
   `~/.claude/**`, `.claude.json*` and `~/.ssh/**`, and turn off non-essential traffic.
2. An **egress allowlist firewall** for the `genie` UID (`/usr/local/sbin/genie-firewall`).
   A systemd timer re-applies it every 10 minutes, and it is managed from the UI
   (`vps:firewall:*`).

### Files, git and databases on the VM

- **Files:** a file explorer with a Monaco editor, upload and download (`vps:fs:*`).
- **Git:**
  - status, diff, log, branches, commit, pull/push, stash (`git:*`)
  - registering repos with encrypted tokens, plus optional auto-save
  - git remotes are stripped of embedded credentials at boot
- **Databases:** DB detection on the VM, a table browser, a query runner and backups
  (`vps:db:*`). The manager's own DB has a full explorer in Admin → Database.

### Monitoring

- **Live VM stats** come from the push-based daemon: CPU, memory, disk, processes,
  open/external ports, SSH sessions, and sshd MaxStartups health.
- History is kept in `vps_metric_samples` and drawn as sparklines.
- Also available:
  - a Traffic tab (SSH and VPS traffic)
  - an SSH events flight recorder (`ssh_events`, Admin → SSH Events) that classifies
    disconnect causes
  - SSH startup probes
- On the manager: server metrics, live logs, the WS log drawer, connected users and
  presence, audit log, connection log, and product analytics.

### Security scanner

A two-phase scan of a target:

1. A TCP scan of the top ports, in batches of 100, with banner detection.
2. Web checks: headers, CORS, cookies, SSL, host header, methods, redirects, directory
   listing and injection.

Results are stored in `security_scans`. Admins can also run it as the genie-security MCP.

### Collaboration

- **Team chat:** DMs and rooms, reactions, @Claude mentions with streaming replies, and
  notification toasts.
- **Tracker:** issues with per-project prefixes (e.g. `TER-12`), labels, comments, assignees
  and drag reordering.
- **Docs:** folders, sharing, public links (`/doc/<key>`) and ZIP export.
- **Orgs:** organizations, teams and reusable invite links (`/invite/<token>`); per-org
  TazCloud credentials and SSH keys.
- **Slack:** `/genie projects|stats|status|containers|processes|logs|exec|run|kill|firewall|ssh|teardown|help`.
- **Email:** broadcast emails from Admin → Communication, with logs in `email_logs`.

### Knowledge ("Concepts")

Architecture docs about Genie itself, written as an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle in `knowledge/`. They are stored in the `knowledge_docs` table and are viewable and
editable in the superadmin **Concepts** panel.

```bash
npm run knowledge:export   # DB → knowledge/*.md (read the current Concepts)
npm run knowledge:import   # knowledge/*.md → DB (upsert by path; deletions happen in the UI)
```

Nothing is seeded automatically on boot.

### Mobile

`/mobile` is a phone-first UI with its own viewport settings and a +2 px font scale. It has
home (projects, A–Z), server detail, a real terminal, and the Claude screen (with dictation
and AskUserQuestion). It uses the same store and protocol as the desktop UI and requires
login.

---

## How VMs are managed

- **SSH layer** (`packages/manager/src/vps/`):
  - `ssh-session-cache.ts` keeps one connection per host/port/user and multiplexes channels
    over it, serializing exec calls.
  - `ssh-probe-pool.ts` uses a **separate** connection for stats/tmux probes, so a failed
    probe never kills an interactive session.
  - `ssh-handshake-gate.ts` throttles handshakes to stay under sshd's `MaxStartups`.
  - `ssh-client.ts` has an **SSRF guard** that blocks loopback, link-local and metadata IPs.
- **Reaching private networks:** TazCloud `10.128/16` destinations are dialed through
  SOCKS5 (`socks-dial.ts`) over wireproxy.
- **Keys:**
  - Genie has its own SSH keypair, stored in `global_settings` and restored to disk at boot.
    It is managed in Admin → DO Build → SSH key.
  - Orgs can generate their own key.
  - Keys you bring for your own servers are encrypted with `GENIE_SECRET` in
    `server_credentials`.
- **On-VM conventions:**
  - The project lives in `/opt/project`, owned by `genie`.
  - The stats daemon writes `/run/genie/stats.jsonl`.
  - Dev-service logs go to `/var/log/<service>-dev.log`.
  - code-server listens on `127.0.0.1:13337`.

---

## Testing

### Unit and integration tests (vitest)

```bash
npm run build:vps-stats                     # required: the manager imports its dist/
npm test --workspace=packages/renderer      # jsdom; store actions/handlers + routes
npm test --workspace=packages/manager       # node; runs serially (shared test DB)
```

The manager has three test tiers ([`packages/manager/TESTING.md`](packages/manager/TESTING.md)):

| Tier | Needs | What it covers |
|---|---|---|
| 1. Pure logic | nothing | ACL, auth, parsers, crypto, formatters, … |
| 2. DB-backed services | `DB_TEST=<separate postgres url>` | Services against a real DB. The schema is generated from `schema.ts` and tables are truncated before each test. |
| 3. WS integration | `DB_TEST` + `WS_INTEGRATION=1` | A real WS server with authenticated clients |

Without `DB_TEST`, the DB suites are skipped rather than failing. The setup refuses to run if
`DB_TEST` equals `DB`.

**Security tests** ([`packages/manager/SECURITY-TESTING.md`](packages/manager/SECURITY-TESTING.md))
enforce the invariant that a non-superadmin can only touch resources they own or are a member
of. The tests are `ws-acl.test.ts`, `auth.test.ts` and `handlers/authorization.security.test.ts`
(cross-tenant denial). Rule: every handler message that takes a client-supplied id needs an
ownership guard **and** a denial test. Note that `canAccessProject` returns true when
`projectId` is null.

### End-to-end tests (Playwright)

```bash
cd packages/renderer
npm run test:e2e        # or test:e2e:ui
```

Set `E2E_TEST_USER` to the email of a validated superadmin in your dev DB. The tests that
log in are skipped without it. Playwright runs Chromium against `http://localhost:3000`. It starts or reuses the manager
(port 9876) and the renderer (port 3000). The specs are:

- `e2e/login.spec.ts`: the login screen and Google button.
- `e2e/golden-path.spec.ts`: logs in through `/test-login`, then covers recipes and
  navigation.

### CI

`.github/workflows/test.yml` runs on pushes and PRs to `main`, with Node 22:
`npm ci` → `build:vps-stats` → renderer vitest → manager vitest. DB tiers are skipped in CI.

---

## Deployment (Railway)

Production runs on Railway as two services from this monorepo, built with **Nixpacks**
(`railway.toml`, `nixpacks.toml`).

### Manager service

- **Build command:** `npm run build:manager && npm run build:vps-agent`. Also build
  `vps-stats`, because the manager imports its `dist/`. The root `npm run build` builds everything.
- **Start command:** `node packages/manager/dist/index.js`
- **Public URL:** e.g. `https://api.genie.teleporthq.ai`
- **Required env vars:**
  - `DB`
  - `GENIE_JWT_SECRET` and `GENIE_SECRET`
  - `GENIE_SUPERADMIN_EMAILS`
  - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
  - `MANAGER_URL` and `FRONTEND_URL`
  - `ANTHROPIC_API_KEY`
  - plus whichever provider and notification vars you use.

### Renderer service

- **Build command:** `npm run build:renderer`. `NEXT_PUBLIC_WS_URL` must be set at build
  time if you are not using the default `wss://api.genie.teleporthq.ai`.
- **Start command:** `node packages/renderer/.next/standalone/packages/renderer/server.js`
- **Public URL:** e.g. `https://genie.teleporthq.ai`
- **Note:** this relies on `output: "standalone"` in `next.config.ts`.

### Build dependencies (`railway.toml` / `nixpacks.toml`)

- **python3, gcc, gnumake** are needed to compile `node-pty`, which the manager-host terminal
  uses. Without them that feature is unavailable in production, but everything else still
  works.
- **nodejs_22** is needed by Next.js 16, Tailwind v4 and the rest of the stack.

`PORT` is injected by Railway for both services.

### Google OAuth setup

Register `${MANAGER_URL}/auth/callback` as an authorized redirect URI, and the frontend
origin as an authorized JavaScript origin. A mismatch produces `redirect_uri_mismatch`.

---

## Running behind a reverse proxy (sub-path mount)

Genie normally runs at the root of its own host (renderer and manager on separate
origins). It can also be served under a **sub-path** of a shared host — e.g.
`https://$HOST/$MOUNT` for the renderer and a sibling path for the manager —
behind a single reverse proxy. That setup has a few requirements that differ from
the root-host deployment; miss any and the app silently hangs on the
**"Connecting…"** splash. Replace `$HOST`, `$MOUNT` (renderer mount, e.g.
`app`), `$MGR_MOUNT` (manager mount) and the ports with your own values.

### Renderer (`packages/renderer`)
- **`basePath: "/$MOUNT"`** in `next.config.ts` so `_next/*`, assets and routes
  resolve under the mount path (the proxy only forwards that prefix).
- **`allowedDevOrigins` + `experimental.serverActions.allowedOrigins`** must
  include the public host. In **dev**, Next runs on a different origin than the
  browser sees, so **Next 16 blocks cross-origin dev requests (RSC/flight, HMR,
  server actions) unless the host is allowlisted** — without it the client never
  finishes hydrating and hangs on "Connecting…". (Both are derived from the
  `PUBLIC_HOST` env var.)
- **`NEXT_PUBLIC_WS_URL=wss://$HOST/$MGR_MOUNT/`** so the browser reaches the
  manager through the proxy. The client resolves the WS URL in `src/lib/ws.ts`;
  unset, it falls back to the compiled-in production manager.
- Known gap: `/doc/[key]` and `/invite/[token]` call `fetch("/api/…")` without the
  basePath prefix, so those two pages need the prefix added when mounted under a sub-path.

### Manager (`packages/manager`)
- **Env** loads from `packages/manager/.env.local` / `.env` (see
  `src/load-env.ts`). The DB var is **`DB`** (not `DATABASE_URL`).
- **Build the workspace packages first** — the manager imports
  `@genie/vps-stats/dist/…`, so run `npm run build:vps-stats` (and
  `build:vps-agent`) before `dev:manager`, or it crashes with
  `ERR_MODULE_NOT_FOUND`.
- **Port** — the manager listens on `process.env.PORT || 9876`. If both apps are
  launched under one process that injects a single `PORT`, pin the manager so it
  doesn't take the renderer's port (`dev:manager` already does
  `PORT=9876 npx tsx watch …`).
- **OAuth (Google)** — the redirect URI is `MANAGER_URL + /auth/callback`
  (`src/auth/auth.ts`); the post-login redirect goes to `FRONTEND_URL?token=`.
  Behind a sub-path proxy, point these at the public URLs:
  - `MANAGER_URL=https://$HOST/$MGR_MOUNT`
  - `FRONTEND_URL=https://$HOST/$MOUNT`
  Then register the exact redirect URI `https://$HOST/$MGR_MOUNT/auth/callback`
  (and origin `https://$HOST`) with the OAuth provider, or it returns
  `redirect_uri_mismatch`.

### Reverse proxy
- Route `/$MGR_MOUNT/` → the manager, **forwarding the WebSocket upgrade**
  (`Upgrade`/`Connection` headers) and stripping the prefix so the manager sees
  `/…` (this path carries the app WebSocket, the OAuth callback, `/code/*` for
  VS Code, and the `/api/vps/*` callbacks from VMs).
- Route `/$MOUNT/` → the renderer.
- In **dev**, Next devtools requests fonts at the **root** `/__nextjs_font/`
  (not basePath-prefixed); route that to the renderer too, or those requests 404.

> Any change to a manager/renderer `.env*` file or a `next.config.ts` requires
> **restarting the dev servers** to take effect.

---

## Conventions for contributors

The full list is in [`CLAUDE.md`](CLAUDE.md). The most important rules:

**State management (renderer, `subjecto`):**
- Use `Subject` (from `subjecto/core`) for flat values and `DeepSubject` (from `subjecto`) for
  nested objects. Use `batch()` for updates that touch several fields.
- Name state objects with a `$` prefix: `$auth`, `$apps`, `$admin`, `$claudeStream`.
- In components, read state with `useSubject`, `useDeepSubject($s, 'path')` or the
  `useDeepSubjectAll` helper.
- The store is split into `types/` → `subjects/` → `handlers/` (incoming WS message maps,
  merged in `handlers/index.ts`) → `actions/` (what the UI calls, via `wsSend`/`wsRequest`).

**Claude chat:**
- **Store first:** new `claude:stream:*` features go into the store (types → handlers →
  actions) before any component work.
- **No surface-only features:** composer and interaction changes belong in the shared
  `ClaudeChatSurface`. Keep desktop (`claude-stream-window.tsx`) and mobile
  (`claude-screen.tsx`) in sync.

**Adding a WS message:**
1. Add a handler branch (or a new module in the handler chain).
2. Add an ACL entry: unknown types are denied by default.
3. Add an ownership check plus a denial test for any client-supplied id.
4. Add the store handler and action on the client.

**UI:** follow the [design system](design-system/README.md):
- dark only
- tokens from the `@theme` block in `globals.css`, never raw hex values
- `border-surface0` as the default border
- color meanings: peach = Claude, green = healthy, red = error

**VM services:** a recipe that installs a dev service must point its systemd unit's
`StandardOutput`/`StandardError` at `/var/log/<service>-dev.log`.

**Concepts:** when you change architecture, update `knowledge/*.md` and run
`npm run knowledge:import`.

---

## Further documentation

| Document | Contents |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project conventions |
| [`knowledge/index.md`](knowledge/index.md) | Concepts: recipes, agents, access control, Claude hardening, VS Code proxy |
| [`design-system/README.md`](design-system/README.md) | UI handbook (tokens, color semantics, primitives, patterns, layout, motion, mobile, anti-patterns) |
| [`docs/GENIE.md`](docs/GENIE.md) | Older architecture overview of the deploy flow and VPS agent (partly outdated) |
| [`docs/MCPD.md`](docs/MCPD.md) | The genie-browser MCP: VM → reverse tunnel → manager → Chrome extension |
| [`docs/API.md`](docs/API.md) / [`docs/API-v2.md`](docs/API-v2.md) | TazCloud VM API v1 / v2 (projects, private networks, bastion) |
| [`docs/STATUS.md`](docs/STATUS.md), [`docs/MAIN.md`](docs/MAIN.md) | Feature checklist and product vision |
| [`wireguard.md`](wireguard.md) | WireGuard access to the TazCloud private network |
| [`packages/manager/TESTING.md`](packages/manager/TESTING.md), [`SECURITY-TESTING.md`](packages/manager/SECURITY-TESTING.md) | Testing strategy |

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| The UI hangs on **"Connecting…"** | The WS URL is wrong or unreachable (`NEXT_PUBLIC_WS_URL`). In dev behind a proxy, the public host is missing from `PUBLIC_HOST`. Under a sub-path, `basePath` is missing. |
| The manager crashes with `ERR_MODULE_NOT_FOUND` for `@genie/vps-stats` | Run `npm run build:vps-stats` first |
| `EADDRINUSE :9876` | A stale manager is still running. `npm run dev:manager` frees the port automatically; otherwise kill it with `lsof -t -iTCP:9876`. |
| The manager can't connect to the DB | The var is `DB`, not `DATABASE_URL`. For TLS, set `DB_CERT`. |
| Google returns `redirect_uri_mismatch` | Register exactly `${MANAGER_URL}/auth/callback` |
| A new user signs in but sees nothing | They are unvalidated. An admin must validate them in Admin → Users. |
| The terminal doesn't work in production | node-pty failed to compile. Check that python3, gcc and make are in the build image. |
| Taz VMs (10.128.x) are unreachable | wireproxy isn't configured or running. Check the `WG_*` / `GENIE_TAZ_SOCKS*` vars and the `[wireproxy]` boot logs. Admins can restart it from the UI. |
| Live VM stats are missing | The `genie-stats` unit isn't installed or can't reach the manager. Check `VPS_MANAGER_URL` and `systemctl status genie-stats` on the VM. |
| `.env` / `next.config.ts` changes have no effect | Restart the dev servers |
