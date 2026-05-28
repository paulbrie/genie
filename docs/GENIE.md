# Genie — Deployment & VPS Agent

## Architecture Overview

```
                        ┌─────────────────────────────────────────────┐
                        │              Manager (localhost:9876)        │
User (Chrome Ext) ─WS──▶  WS Server  ─────SSH────▶  VPS (DigitalOcean)
User (Web UI)     ─WS──▶  Chat Engine                    │
                        │  Project Mgr                genie-agent
                        │  Deploy Svc                 (Claude API + local tools)
                        │  Admin Svc                      │
                        └──────┬──────────────────────────┘
                               │
                            Railway DB (PostgreSQL)
```

Genie is a monorepo with three main packages:

- **`packages/manager`** — Node.js WebSocket server running locally. Orchestrates deployments, proxies chat, manages projects, serves admin tools.
- **`packages/renderer`** — Next.js web UI with URL-based routing (`/admin/droplets/templates`, `/projects/<slug>/cloud`, etc.).
- **`packages/vps-agent`** — Lightweight Claude agent that runs directly on the VPS. Communicates with the manager over SSH stdin/stdout using newline-delimited JSON.

---

## URL Routing

The app uses a catch-all Next.js route (`[[...slug]]/page.tsx`) with bidirectional URL ↔ state sync.

| URL Pattern | View |
|-------------|------|
| `/apps` | App list |
| `/apps/<slug>` | App detail |
| `/projects` | Project grid |
| `/projects/<slug>` | Project detail (files tab) |
| `/projects/<slug>/cloud` | Project cloud/deploy tab |
| `/admin/database` | Admin database browser |
| `/admin/droplets` | Admin droplet list |
| `/admin/droplets/templates` | Base image templates |
| `/admin/droplets/configs` | Base image configs |
| `/admin/droplets/sshkey` | SSH key management |
| `/chat`, `/terminal`, `/logs`, etc. | Other nav views |

---

## How a Project Is Deployed

### 1. Base Image (one-time setup, optional)

A reusable DigitalOcean snapshot pre-loaded with Docker, Node.js, and the Genie agent. Created via **Admin → Droplets → Templates**.

1. Spin up a temp droplet from `docker-20-04`.
2. Wait for SSH + Docker to be ready.
3. Run provision commands over SSH:
   ```
   ufw allow 80/tcp && ufw allow 443/tcp && ufw reload
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
   npm install -g @anthropic-ai/claude-code @genie/vps-agent
   ```
4. Shut down the droplet, snapshot it, then destroy the temp droplet.
5. The snapshot ID is stored in the DB for future deploys.

### 2. Provisioning a New Droplet

When you deploy a project to DigitalOcean (`do:deploy`):

1. **SSH key** — Ensures a dedicated passphrase-free ed25519 key pair exists. The DB is the source of truth (`globalSettings.geniePrivateKey` / `geniePublicKey`); the files at `~/.genie/ssh/genie_ed25519` are a filesystem cache. Admins can view and regenerate the key via **Admin → Droplets → SSH Key**. The public key is registered with DigitalOcean if not already present.
2. **Create droplet** — Named `genie-<project>-<timestamp>`. Uses the base image snapshot if available, otherwise `docker-20-04`. Tagged with `genie`. Default size `s-2vcpu-4gb`, region `nyc1`.
3. **Wait for active** — Polls every 5s until the droplet has a public IP (120s timeout).
4. **Wait for SSH + Docker** — Polls SSH as root until `docker --version` succeeds (180s timeout).
5. **Wait for cloud-init** — Skipped if using a base image. Otherwise polls `cloud-init status` until `done`.
6. **GitLab deploy key** (optional) — Writes the private key to `~/.ssh/id_gitlab` and configures SSH for `gitlab.com`.
7. **VPS agent install** — Runs `command -v genie-agent || npm install -g @genie/vps-agent` (idempotent, already present on base images).
8. **Deploy** — Hands off to `vpsDeploy()` (see below).

### 3. Deployment (`vpsDeploy`)

Remote project directory: `/opt/genie-deploys/<project-name>/` (name is sanitized to lowercase alphanumeric + hyphens via `remoteDir()`).

There is no rsync or nginx — all project source is retrieved from GitLab via the setup files (e.g. `git clone` in the Dockerfile). Services are accessed directly on their respective ports.

1. `mkdir -p` the remote directory.
2. **Inject env vars** into `.env` (from project secrets).
3. **Write setup files** stored in the DB (Dockerfile, docker-compose.yml, etc.).
4. **Run `setup-project.sh`** if present in setup files — e.g. clone web source to host for volume-mount hot-reload.
5. `docker compose build` (with BuildKit).
6. `docker compose up -d`.

### 4. Hot-Reload for Agent-Edited Files

For Next.js web apps, the setup enables real-time hot-reload when the VPS agent edits files:

1. `setup-project.sh` clones the web source repo to `./web-src/` on the VPS host.
2. `docker-compose.yml` mounts `./web-src/_nextjs:/app` into the web container with anonymous volumes for `node_modules` and `.next`.
3. `WATCHPACK_POLLING: "true"` enables file-watching inside Docker.
4. Agent edits files in `/opt/genie-deploys/<project>/web-src/` → Next.js detects changes → hot-reload in browser.

### 5. VPS Management

After deployment, the manager can:
- `vps:status` — `docker compose ps`
- `vps:stats:watch` / `vps:stats:unwatch` — persistent SSH stream to `@genie/vps-stats` daemon (NDJSON every 5s); pushes `vps:stats:update`
- `vps:stats` — one-shot read (cache from stream, else SSH probe fallback)
- `vps:logs` — `docker compose logs`
- `vps:teardown` — `docker compose down` + `rm -rf`
- `vps:disconnect` — Remove VPS from project without destroying

Droplet sync runs every 60s — if a droplet tagged `genie` no longer exists on DigitalOcean, it's automatically removed from the project.

---

## How the VPS Agent Works

### The Problem It Solves

Without the agent, every Claude tool call (read file, run command, edit file) requires a separate SSH connection to the VPS. Each SSH handshake adds latency, and the tool round limit is 10.

With the agent, Claude runs **directly on the VPS** with instant local filesystem and shell access. One SSH connection, 40 tool rounds.

### Transport: SSH + stdio

The manager opens a single SSH session to the VPS and starts the agent process:

```
node /usr/lib/node_modules/@genie/vps-agent/dist/index.js
```

All communication flows as **newline-delimited JSON** over stdin (manager → agent) and stdout (agent → manager). No extra ports, no firewall changes.

### Protocol

**Inbound (manager → agent):**

| Message | Fields | Purpose |
|---------|--------|---------|
| `init` | `apiKey`, `projectDir`, `maxToolRounds` | Configure the agent (sent once) |
| `chat` | `messages[]`, `context?`, `domSnapshot?` | Start a chat turn |
| `stop` | — | Abort current chat |
| `browser:result` | `requestId`, `success`, `result` | Return browser action result |

**Outbound (agent → manager):**

| Message | Fields | Purpose |
|---------|--------|---------|
| `ready` | — | Agent initialized successfully |
| `token` | `token` | Streaming text delta from Claude |
| `tool` | `name`, `input`, `result` | Tool call completed |
| `done` | `fullContent` | Chat turn complete |
| `error` | `message` | Error occurred |
| `browser:request` | `requestId`, `action`, `params` | Agent needs browser interaction |

### Local Tools

The agent has these tools available to Claude, all scoped to the project directory:

| Tool | What it does |
|------|-------------|
| `shell_exec` | Run bash commands locally (timeout 120s default, 600s max) |
| `read_file` | Read a file (1MB limit) |
| `write_file` | Create/overwrite a file (auto-creates parent dirs) |
| `list_files` | Recursive directory listing (depth 5, skips node_modules/.git/.next) |
| `search_files` | Grep with regex, file glob filter, max 50 matches |
| `view_page` | See what the user sees in their browser |
| `dom_action` | Click, type, scroll, navigate in the user's browser |

### Browser Tool Proxy

When Claude needs to see or interact with the user's browser page:

```
Agent stdout → browser:request → Manager → Chrome Extension WS → DOM action
Chrome Extension → extension:dom_action_result → Manager → browser:result → Agent stdin
```

The manager finds the user's connected Chrome extension WebSocket and proxies the action. 15-second timeout per action.

### Chat Routing

When a `chat:send` message arrives at the manager:

1. Send `chat:status` ("Connecting to VPS agent...") to client for feedback.
2. Parse `Project ID: <uuid>` from the context string.
3. Look up the project — does it have VPS instances?
4. **Yes** → Start (or reuse cached) VPS agent session → forward chat → stream responses back to client. The `projectDir` uses `remoteDir()` to ensure the path matches the deploy directory (lowercase, sanitized).
5. **No / agent unavailable (8s timeout)** → Clear status, fall back to local `handleChat()` with SSH-based tools.

The `chat:status` message updates the UI loading indicator so the user sees what's happening instead of a silent wait.

### Session Lifecycle

- Sessions are cached by `projectId:instanceId` and reused across chat messages.
- **5-minute idle timeout** — cleaned up every 60s.
- **8-second ready timeout** — if the agent doesn't respond with `ready` after init, the session is destroyed and chat falls back to local mode.
- If the agent process crashes, stdout closes, and the manager synthesizes an error to any pending handler. The broken session is removed from the cache.
- On manager shutdown, all agent sessions are stopped.

---

## Project Config in Database

All project configuration files are stored in the PostgreSQL database (`projects.setup_files` JSONB column), **not on the local filesystem**. This includes:

- `docker-compose.yml` — Service definitions, ports, volumes, environment
- `Dockerfile.*` — Per-service Dockerfiles (each clones source from GitLab)
- `setup-project.sh` — Pre-build setup script (e.g. clone web source for hot-reload)
- `.env` template values

The setup files are written to the VPS during deployment via SSH. To modify them, use the Admin database browser or the `read_project_file` / `write_project_file` chat tools.

### Service Architecture (Medical project example)

Services are accessed directly on their ports (no nginx reverse proxy):

| Service | Port | Description |
|---------|------|-------------|
| `web` | 3000 | Next.js frontend (volume-mounted for hot-reload) |
| `server-platform` | 3901 | Core NestJS API server |
| `server-admin` | 4001 | Admin API server |
| `zebra-print-server` | 3200 | Zebra label printer service |
| `document-extraction` | 3100 | Python/FastAPI doc extraction |
| `postgres` | 5432 (localhost only) | PostgreSQL database |
| `redis` | 6379 (localhost only) | Redis cache |
| `rabbitmq` | 5672/15672 | Message broker + management UI |

Infrastructure services (postgres, redis) are bound to `127.0.0.1` to prevent external access.

---

## Project Structure on VPS

```
/opt/genie-deploys/
└── <project-name>/          ← sanitized lowercase name
    ├── docker-compose.yml
    ├── Dockerfile.*          ← per-service Dockerfiles
    ├── setup-project.sh      ← pre-build setup script
    ├── .env                  ← injected secrets
    └── web-src/              ← cloned web source (for hot-reload volume mount)
        └── _nextjs/
```

The agent binary lives at `/usr/lib/node_modules/@genie/vps-agent/dist/index.js` (installed globally via npm).

---

## Admin Panel

### Database Tab
- Browse all PostgreSQL tables with pagination, sorting, filtering
- Inline row editor with create/edit/delete
- SQL console with `Cmd+Enter` execution

### Droplets Tab
- **Droplets** — List all DigitalOcean droplets tagged `genie`, with SSH terminal access and delete
- **Templates** — Base image templates referencing configs, with build/rebuild
- **Configs** — Build recipes defining region, size, and provision commands
- **SSH Key** — View current public key + fingerprint, copy for DigitalOcean, regenerate with confirmation

---

## Multi-Model Support

The chat engine supports multiple LLM providers. The user selects a model from the dropdown in the Genie Assistant window header; the choice is sent with each `chat:send` message as `modelId`.

### Available Models

| Model ID | Label | Provider | Model |
|----------|-------|----------|-------|
| `claude-sonnet` | Claude Sonnet | Anthropic | `claude-sonnet-4-20250514` |
| `deepseek-v3` | DeepSeek V3 | Fireworks | `accounts/fireworks/models/deepseek-v3p2` |
| `kimi-k2` | Kimi K2.5 | Fireworks | `accounts/fireworks/models/kimi-k2p5` |

### Environment Variables

| Variable | Required For |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude models |
| `FIREWORKS_API_KEY` | DeepSeek, Kimi models (via Fireworks) |

### Adding a New Model

1. Add entry to `CHAT_MODELS` in `packages/manager/src/chat.ts` (provider config + model ID).
2. Add the model ID to the `ChatModelId` type in the same file.
3. Mirror the model ID and label in `CHAT_MODELS` / `ChatModelId` in `packages/renderer/src/store/index.ts`.
4. If using a new provider, add the `@ai-sdk/<provider>` dependency and a new branch in `getModel()`.

---

## Building

```bash
npm run build                  # Build everything (manager, vps-agent, renderer)
npm run build:manager          # Just the manager
npm run build:vps-agent        # Just the VPS agent
npm run dev                    # Dev mode (manager + renderer with hot reload)
```
