# Genie

A development platform for managing projects, VPS droplets, and AI-assisted workflows.

## Architecture

- **Manager** (`packages/manager`) — Node.js WebSocket server that orchestrates everything: project management, SSH tunnels to droplets, PTY terminal sessions, PostgreSQL via Drizzle ORM, AI assistant integration.
- **Renderer** (`packages/renderer`) — Next.js web dashboard for project management, docs, tracker, terminal, admin panel, and DB explorer.
- **Chrome Extension** (`packages/chrome-extension`) — Browser extension for remote VPS control, AI chat, file editing, Docker view, and terminal access.
- **VPS Agent** (`packages/vps-agent`) — Agent that runs on droplets for AI-assisted operations.

## Local Development

```bash
npm install
npm run dev          # Starts manager + renderer concurrently
npm run dev:extension  # Builds Chrome extension in watch mode
```

## Building

```bash
npm run build              # Build all packages
npm run build:manager      # Build manager only
npm run build:renderer     # Build renderer only
npm run build:extension    # Build Chrome extension (production)
npm run build:vps-agent    # Build VPS agent
```

## Deployment (Railway)

The project is deployed on Railway with two services from this monorepo:

### Manager Service
- **Build command**: `npm run build:manager && npm run build:vps-agent`
- **Start command**: `node packages/manager/dist/index.js`
- **Required env vars**: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MANAGER_URL`, `ANTHROPIC_API_KEY`

### Renderer Service
- **Build command**: `npm run build:renderer`
- **Start command**: `node packages/renderer/.next/standalone/packages/renderer/server.js`
- **Note**: Uses `output: "standalone"` in next.config.ts for self-contained deployment

### railway.toml

The `railway.toml` configures Nixpacks build dependencies:
- **python3, gcc, gnumake** — Required for compiling `node-pty`, a native Node.js module used by the terminal feature. Without these, the terminal PTY functionality won't work in production (other features degrade gracefully).
- **nodejs_22** — Required by Next.js 16, Tailwind CSS, and other dependencies.

### Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `DATABASE_URL` | Manager | PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | Manager | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Manager | Google OAuth client secret |
| `MANAGER_URL` | Manager | Public URL (e.g. `https://api.genie.teleporthq.ai`) |
| `FRONTEND_URL` | Manager | Frontend URL for OAuth redirects (e.g. `https://genie.teleporthq.ai`) |
| `ANTHROPIC_API_KEY` | Manager | Anthropic API key for Claude integration |
| `PORT` | Both | Set automatically by Railway |
