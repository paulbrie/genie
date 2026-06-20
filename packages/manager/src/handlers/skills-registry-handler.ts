// Proxy for the public skills.sh registry so the Skills tab can browse/search
// the community catalog without hitting CORS from the renderer. Read-only,
// request/response (correlated by reqId via the renderer's wsRequest). The
// returned `id` ("owner/slug") is exactly what `npx skills add <id>` takes.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";

export interface RegistrySkill {
  id: string;
  name: string;
  source: string;
  installs: number;
  url: string;
}

/** Pull the skills array out of skills.sh's response regardless of the wrapper
 *  key (the list endpoint paginates under one of these; search may return bare). */
function extractSkills(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  const o = json as Record<string, unknown>;
  for (const k of ["skills", "data", "results", "items"]) {
    if (Array.isArray(o?.[k])) return o[k] as unknown[];
  }
  return [];
}

export async function handleSkillsRegistryMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
): Promise<boolean> {
  if (msg.type !== "skills:registry:search") return false;
  const { q, reqId } = msg.payload as { q?: string; reqId?: string };
  try {
    const query = (q ?? "").trim();
    // ≥2 chars → search endpoint; otherwise show the trending catalog.
    const url = query.length >= 2
      ? `https://skills.sh/api/v1/skills/search?q=${encodeURIComponent(query)}&limit=50`
      : `https://skills.sh/api/v1/skills?view=trending&per_page=50`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`skills.sh returned ${res.status}`);
    const raw = extractSkills(await res.json());
    const skills: RegistrySkill[] = raw
      .map((s) => s as Record<string, unknown>)
      .filter((s) => !s.isDuplicate)
      .map((s) => ({
        id: String(s.id ?? (s.source && s.slug ? `${s.source}/${s.slug}` : s.slug ?? "")),
        name: String(s.name ?? s.slug ?? s.id ?? ""),
        source: String(s.source ?? s.sourceType ?? ""),
        installs: Number(s.installs ?? 0),
        url: String(s.url ?? ""),
      }))
      .filter((s) => s.id);
    send(ws, { type: "skills:registry:result", payload: { reqId, skills } });
  } catch (err) {
    send(ws, { type: "skills:registry:result", payload: { reqId, skills: [], error: err instanceof Error ? err.message : String(err) } });
  }
  return true;
}
