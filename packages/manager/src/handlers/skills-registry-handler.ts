// Skill discovery for the Skills tab. skills.sh's own API is gated behind a
// Vercel OIDC token (401 from a server), and the `skills` CLI has no search — so
// we discover via GitHub's public repo search instead. Either way the install
// target is `owner/repo`, exactly what `npx skills add <id>` takes. Read-only,
// request/response (correlated by reqId via the renderer's wsRequest).

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";

export interface RegistrySkill {
  id: string;       // "owner/repo" — the `npx skills add` argument
  name: string;
  source: string;   // owner
  stars: number;
  url: string;
  description: string;
}

/** A few well-known skill collections shown before the user types anything. */
const CURATED: RegistrySkill[] = [
  { id: "vercel-labs/agent-skills", name: "agent-skills", source: "vercel-labs", stars: 0, url: "https://github.com/vercel-labs/agent-skills", description: "Vercel's collection of agent skills." },
  { id: "obra/superpowers", name: "superpowers", source: "obra", stars: 0, url: "https://github.com/obra/superpowers", description: "Composable TDD/debug/plan skills." },
  { id: "wong2/diffx", name: "diffx", source: "wong2", stars: 0, url: "https://github.com/wong2/diffx", description: "Semantic diff skill." },
  { id: "anthropics/skills", name: "skills", source: "anthropics", stars: 0, url: "https://github.com/anthropics/skills", description: "Anthropic example skills." },
];

interface GitHubRepo {
  full_name?: string; name?: string; html_url?: string; description?: string | null;
  stargazers_count?: number; owner?: { login?: string };
}

export async function handleSkillsRegistryMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
): Promise<boolean> {
  if (msg.type !== "skills:registry:search") return false;
  const { q, reqId } = msg.payload as { q?: string; reqId?: string };
  const query = (q ?? "").trim();
  if (query.length < 2) {
    send(ws, { type: "skills:registry:result", payload: { reqId, skills: CURATED } });
    return true;
  }
  try {
    // GitHub repo search, biased toward agent/claude skills, busiest first.
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${query} skill agent`)}&sort=stars&order=desc&per_page=30`;
    const res = await fetch(url, {
      headers: { "Accept": "application/vnd.github+json", "User-Agent": "genie-manager" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 403) throw new Error("GitHub search rate-limited — try again shortly, or add owner/repo directly.");
    if (!res.ok) throw new Error(`GitHub search returned ${res.status}`);
    const json = await res.json() as { items?: GitHubRepo[] };
    const skills: RegistrySkill[] = (json.items ?? [])
      .filter((r) => r.full_name)
      .map((r) => ({
        id: String(r.full_name),
        name: String(r.name ?? r.full_name),
        source: String(r.owner?.login ?? ""),
        stars: Number(r.stargazers_count ?? 0),
        url: String(r.html_url ?? ""),
        description: String(r.description ?? ""),
      }));
    send(ws, { type: "skills:registry:result", payload: { reqId, skills } });
  } catch (err) {
    send(ws, { type: "skills:registry:result", payload: { reqId, skills: [], error: err instanceof Error ? err.message : String(err) } });
  }
  return true;
}
