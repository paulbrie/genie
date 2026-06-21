// View-model types for the mobile screens (populated from live data — see
// use-mobile-data.ts) plus a couple of UI constants. No fake data: the data
// screens (Home / Manager / Claude) are wired to the real store.

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
  /** ProjectDef.id of the live instance — used to fetch real stats/sessions. */
  projectId?: string;
  /** Live services from the instance. */
  services?: MockService[];
}

/** Servers grouped by their project. */
export interface MockProject {
  name: string;
  region: string;
  instances: MockServer[];
  health: ServerHealth; // worst instance health rolls up to the project
}

export interface MockService {
  name: string;
  status: "running" | "stopped" | "restarted";
  detail: string;
}

export type SessionKind = "ssh" | "claude" | "tmux";

export interface MockSession {
  id: string;
  kind: SessionKind;
  title: string;
  detail: string;
  running: boolean;
}

// --- Claude popup UI strings ---

/** Quick-reply chips shown above the input when a conversation is in progress. */
export const QUICK_REPLIES = ["Check health", "Show logs", "What changed?"];

/** Empty-state suggestions shown on a fresh chat. */
export const SUGGESTED_PROMPTS = [
  "What needs my attention right now?",
  "Summarize the recent deploys",
  "Tail the error log",
  "Check disk usage across my servers",
];

// --- Terminal screen (prototype — not yet wired to a live PTY) ---

export interface TermLine {
  text: string;
  tone?: "dim" | "green" | "blue" | "yellow" | "red" | "mauve";
}
