// Analytics WS surface:
//   client → server   analytics:track       record a UI event (allowlisted)
//   client → server   admin:analytics:summary  superadmin dashboard query
//
// Server-authoritative events (auth.login, terminal.*, project.created, …) are
// recorded directly where they happen, NOT via analytics:track — so the client
// can only emit a small set of UI-only events it's the source of truth for.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as analyticsService from "../analytics-service.js";
import type { ClientState } from "../ws-server.js";

/** UI-only events the browser is allowed to report. Anything else is dropped —
 *  a client can't forge server-tracked events (logins, terminal opens) or spam
 *  arbitrary event names into the table. */
const CLIENT_EVENTS = new Set([
  "app.focus",
  "app.blur",
  "app.visibility",
  "nav.view",
  "manager.open",
]);

/** Keep only primitive prop values, cap the number of keys. Defense against a
 *  client stuffing large/nested junk (the service also caps total size). */
function sanitizeProps(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 12) break;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      out[k] = typeof v === "string" ? v.slice(0, 200) : v;
      n++;
    }
  }
  return n > 0 ? out : null;
}

export async function handleAnalyticsMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  state: ClientState,
): Promise<boolean> {
  switch (msg.type) {
    case "analytics:track": {
      const { event, props } = (msg.payload ?? {}) as { event?: string; props?: unknown };
      if (!event || !CLIENT_EVENTS.has(event) || !state.userId) return true;
      await analyticsService.recordEvent({
        userId: state.userId,
        userName: state.user?.name ?? null,
        event,
        props: sanitizeProps(props),
        ip: state.ip,
      });
      return true;
    }

    case "admin:analytics:summary": {
      // Superadmin-only — the dashboard can surface cross-tenant activity.
      if (state.role !== "superadmin") {
        send(ws, { type: "admin:error", payload: { message: "Superadmin access required" } });
        return true;
      }
      const p = (msg.payload ?? {}) as { days?: number; userId?: string | null; projectId?: string | null };
      const rawDays = Number(p.days);
      const days = Number.isFinite(rawDays) ? Math.min(365, Math.max(1, Math.floor(rawDays))) : 30;
      const from = new Date(Date.now() - days * 86_400_000);
      try {
        const summary = await analyticsService.getAnalyticsSummary(from, {
          userId: p.userId || null,
          projectId: p.projectId || null,
        });
        send(ws, { type: "admin:analytics:summary", payload: { summary, days, userId: p.userId || null, projectId: p.projectId || null } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: err instanceof Error ? err.message : String(err) } });
      }
      return true;
    }

    default:
      return false;
  }
}
