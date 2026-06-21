// Static mock data for the /mobile prototype. No WebSocket, no auth, no live
// store — everything the mobile screens render comes from here so the prototype
// runs standalone on a phone browser. Swap these out for the real $projects /
// $chat / $terminal subjects when we wire it up for real.

export type ServerHealth = "healthy" | "degraded" | "down";

export interface MockServer {
  id: string;
  label: string;
  project: string;
  host: string;
  provider: "digitalocean" | "tazcloud" | "hetzner" | "other";
  health: ServerHealth;
  note: string;
  cpu: number; // %
  mem: number; // %
  disk: number; // %
  uptime: string;
  /** Set on live instances (maps to ProjectDef.id). When present, the Manager
   *  view fetches real stats/sessions; absent ⇒ pure mock prototype data. */
  projectId?: string;
  /** Live services from the instance, when available; else getServices() mock. */
  services?: MockService[];
}

export const MOCK_USER = { name: "Paul Brie", initials: "PB", email: "paul.brie@teleporthq.io" };

export const MOCK_SERVERS: MockServer[] = [
  {
    id: "api-prod-01",
    label: "api-prod-01",
    project: "acme-store",
    host: "164.92.18.40",
    provider: "digitalocean",
    health: "down",
    note: "nginx unreachable · 4m",
    cpu: 0,
    mem: 0,
    disk: 61,
    uptime: "—",
  },
  {
    id: "web-staging",
    label: "web-staging",
    project: "teleport",
    host: "10.128.4.7",
    provider: "tazcloud",
    health: "degraded",
    note: "high CPU · 12m",
    cpu: 92,
    mem: 74,
    disk: 48,
    uptime: "6d 4h",
  },
  {
    id: "db-primary",
    label: "db-primary",
    project: "acme-store",
    host: "164.92.18.51",
    provider: "digitalocean",
    health: "healthy",
    note: "all green",
    cpu: 18,
    mem: 41,
    disk: 55,
    uptime: "23d 1h",
  },
  {
    id: "worker-eu",
    label: "worker-eu",
    project: "teleport",
    host: "5.75.142.9",
    provider: "hetzner",
    health: "healthy",
    note: "all green",
    cpu: 34,
    mem: 52,
    disk: 30,
    uptime: "11d 8h",
  },
  {
    id: "edge-cdn",
    label: "edge-cdn",
    project: "genie",
    host: "10.128.9.2",
    provider: "tazcloud",
    health: "healthy",
    note: "all green",
    cpu: 22,
    mem: 38,
    disk: 19,
    uptime: "2d 14h",
  },
];

export const HEALTH_COUNTS = {
  healthy: MOCK_SERVERS.filter((s) => s.health === "healthy").length,
  degraded: MOCK_SERVERS.filter((s) => s.health === "degraded").length,
  down: MOCK_SERVERS.filter((s) => s.health === "down").length,
};

// --- Projects (servers grouped by their project) ---

export interface MockProject {
  name: string;
  region: string;
  instances: MockServer[];
  health: ServerHealth; // worst instance health rolls up to the project
}

const PROJECT_REGION: Record<string, string> = {
  "acme-store": "nyc3 · fra1",
  teleport: "eu-central",
  genie: "taz-eu",
};

function rollupHealth(instances: MockServer[]): ServerHealth {
  if (instances.some((i) => i.health === "down")) return "down";
  if (instances.some((i) => i.health === "degraded")) return "degraded";
  return "healthy";
}

export const MOCK_PROJECTS: MockProject[] = Object.values(
  MOCK_SERVERS.reduce<Record<string, MockServer[]>>((acc, s) => {
    (acc[s.project] ??= []).push(s);
    return acc;
  }, {}),
).map((instances) => ({
  name: instances[0].project,
  region: PROJECT_REGION[instances[0].project] ?? "",
  instances,
  health: rollupHealth(instances),
}));

// --- Per-server services (shown in the mobile Manager view) ---

export interface MockService {
  name: string;
  status: "running" | "stopped" | "restarted";
  detail: string;
}

const SERVICES_BY_SERVER: Record<string, MockService[]> = {
  "api-prod-01": [
    { name: "nginx", status: "restarted", detail: "restarted 2m ago · 42 MB" },
    { name: "node-app", status: "running", detail: "pid 2841 · 318 MB" },
    { name: "redis", status: "running", detail: "pid 990 · 28 MB" },
  ],
  "web-staging": [
    { name: "next-dev", status: "running", detail: "pid 5120 · 1.2 GB · hot" },
    { name: "postgres", status: "running", detail: "pid 410 · 240 MB" },
  ],
  "db-primary": [
    { name: "postgres", status: "running", detail: "pid 388 · 1.8 GB" },
    { name: "pgbouncer", status: "running", detail: "pid 401 · 22 MB" },
  ],
};

const DEFAULT_SERVICES: MockService[] = [
  { name: "app", status: "running", detail: "pid 1024 · 210 MB" },
  { name: "caddy", status: "running", detail: "pid 880 · 36 MB" },
];

export function getServices(serverId: string): MockService[] {
  return SERVICES_BY_SERVER[serverId] ?? DEFAULT_SERVICES;
}

// --- Live sessions per server (SSH / Claude / tmux) shown in the Manager view ---

export type SessionKind = "ssh" | "claude" | "tmux";

export interface MockSession {
  id: string;
  kind: SessionKind;
  title: string;
  detail: string;
  running: boolean;
}

const SESSIONS_BY_SERVER: Record<string, MockSession[]> = {
  "api-prod-01": [
    { id: "s-claude", kind: "claude", title: "Claude Code", detail: "restarting nginx · 2m", running: true },
    { id: "s-ssh", kind: "ssh", title: "genie@api-prod-01", detail: "~ · zsh · attached", running: true },
    { id: "s-tmux", kind: "tmux", title: "tmux: deploy", detail: "npm run build · exited 0", running: false },
  ],
  "web-staging": [
    { id: "s-claude", kind: "claude", title: "Claude Code", detail: "idle · 14m", running: false },
    { id: "s-tmux", kind: "tmux", title: "tmux: dev", detail: "next dev · watching", running: true },
  ],
  "db-primary": [
    { id: "s-ssh", kind: "ssh", title: "genie@db-primary", detail: "psql · attached", running: true },
  ],
};

export function getSessions(serverId: string): MockSession[] {
  return SESSIONS_BY_SERVER[serverId] ?? [];
}

// --- Assistant conversation ---

export interface MockTool {
  name: string;
  detail: string;
  duration: string;
}

export type MockMsg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; tool?: MockTool };

export const MOCK_CHAT: MockMsg[] = [
  { role: "user", text: "api-prod-01 is down — what happened?" },
  {
    role: "assistant",
    text: "nginx crashed at **09:38** — the host ran out of memory and the OOM killer took it. The journal shows a runaway worker leaking ~40 MB/s. I can restart nginx and cap `worker_processes` so it can't happen again.",
  },
  {
    role: "assistant",
    text: "Restarting now.",
    tool: { name: "ssh_exec", detail: "systemctl restart nginx", duration: "2.1s" },
  },
  {
    role: "assistant",
    text: "✓ Back up — responding `200` on `:443`. Memory is at 31%. Want me to add an alert that pages you if it climbs past 85% again?",
  },
];

export const QUICK_REPLIES = ["Add the alert", "Show me the logs", "Cap worker_processes"];

// Streamed token-by-token by the Claude popup. Includes a fenced block so the
// prototype shows the "Run in terminal" affordance the real assistant attaches
// to shell code.
export const ASSISTANT_CANNED_REPLY =
  "On it — here's the alert I'll add on **api-prod-01**:\n\n```bash\ngenie alert add --vm api-prod-01 --metric mem --gt 85 --notify push\n```\n\nDone. You'll get a push the moment memory crosses `85%` — nothing else to do.";

// Empty-state suggestions shown after "New chat".
export const SUGGESTED_PROMPTS = [
  "What's eating memory on api-prod-01?",
  "Deploy the latest build to web-staging",
  "Tail the nginx error log",
  "Which servers need attention right now?",
];

// --- Terminal session ---

export interface TermLine {
  text: string;
  tone?: "dim" | "green" | "blue" | "yellow" | "red" | "mauve";
}

export const MOCK_TERM_LINES: TermLine[] = [
  { text: "genie@api-prod-01:~$ systemctl status nginx", tone: "green" },
  { text: "● nginx.service - A high performance web server", tone: "dim" },
  { text: "   Active: active (running) since 09:41:22 UTC", tone: "green" },
  { text: "   Memory: 42.1M (peak: 58.3M)", tone: "dim" },
  { text: "genie@api-prod-01:~$ tail -f /var/log/nginx/access.log", tone: "green" },
  { text: '164.92.18.51 "GET /api/health" 200 12ms', tone: "dim" },
  { text: '164.92.18.51 "GET /api/orders" 200 41ms', tone: "dim" },
  { text: '188.213.48.230 "POST /api/checkout" 200 88ms', tone: "dim" },
  { text: '164.92.18.51 "GET /api/health" 200 9ms', tone: "dim" },
  { text: "genie@api-prod-01:~$ claude", tone: "green" },
  { text: "✻ Claude Code session resumed — 3 files in context", tone: "mauve" },
];

export const MOCK_TERM_TABS = [
  { id: "t1", title: "ssh api-prod-01", running: true },
  { id: "t2", title: "ssh db-primary", running: false },
];

// --- Activity feed ---

export type ActivityKind = "mention" | "deploy" | "alert" | "message";

export interface MockActivity {
  id: string;
  kind: ActivityKind;
  who: string;
  initials: string;
  text: string;
  when: string;
  unread?: boolean;
}

export const MOCK_ACTIVITY: MockActivity[] = [
  {
    id: "a1",
    kind: "mention",
    who: "Dana Cho",
    initials: "DC",
    text: "@paul can you check api-prod before the demo? getting 502s",
    when: "2m",
    unread: true,
  },
  {
    id: "a2",
    kind: "alert",
    who: "Genie",
    initials: "G",
    text: "api-prod-01 went DOWN — nginx unreachable",
    when: "4m",
    unread: true,
  },
  {
    id: "a3",
    kind: "deploy",
    who: "CI",
    initials: "CI",
    text: "Deployed acme-store v2.14.0 to web-staging",
    when: "38m",
  },
  {
    id: "a4",
    kind: "message",
    who: "Marek L",
    initials: "ML",
    text: "merged the worker retry fix 🎉",
    when: "1h",
  },
  {
    id: "a5",
    kind: "deploy",
    who: "CI",
    initials: "CI",
    text: "Deployed genie v0.9.3 to edge-cdn",
    when: "3h",
  },
];
