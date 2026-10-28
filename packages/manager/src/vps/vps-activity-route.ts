// POST /api/vps/activity: the on-VM genie-stats daemon uploads genie-local's
// user-activity spool here in batches (≤500 events, <60 KB). Same auth as
// /api/vps/stats: the per-instance bearer token, and a token may only post for
// its own project/instance. Valid events are stored ON CONFLICT (id) DO
// NOTHING; the reply counts { accepted, duplicates, rejected }. The daemon
// retries on 5xx / 429 / network errors, skips the batch on any other 4xx, and
// never retries rejected events, so the status codes here matter.

import type http from "node:http";
import { resolveStatsToken } from "./stats-token-service.js";
import { ingestActivityBatch, MAX_ACTIVITY_BATCH } from "./vps-activity-service.js";

/** Body cap: batches are under 60 KB; leave room without inviting abuse. */
const MAX_BODY_BYTES = 256 * 1024;
const REJECT_LOG_THROTTLE_MS = 60_000;
const lastRejectLogAt = new Map<string, number>();

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        reject(new HttpError(413, "Body too large"));
        req.resume(); // drain so the 413 can still be written
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new HttpError(400, "Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export async function handleVpsActivityPostback(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const sendJson = (status: number, body: Record<string, unknown>) => {
    if (res.headersSent) return;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    const authHeader = req.headers.authorization ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      sendJson(401, { error: "Missing bearer token" });
      return;
    }
    const owner = await resolveStatsToken(authHeader.slice(7).trim());
    if (!owner) {
      sendJson(401, { error: "Invalid token" });
      return;
    }
    const body = (await readBody(req)) as { projectId?: string; instanceId?: string; events?: unknown } | null;
    if (!body || typeof body !== "object") {
      sendJson(400, { error: "Invalid body" });
      return;
    }
    // A token may only post for its own instance (same rule as /api/vps/stats).
    if (
      (body.projectId && body.projectId !== owner.projectId) ||
      (body.instanceId && body.instanceId !== owner.instanceId)
    ) {
      sendJson(403, { error: "Token/instance mismatch" });
      return;
    }
    if (!Array.isArray(body.events)) {
      sendJson(400, { error: "events must be an array" });
      return;
    }
    if (body.events.length > MAX_ACTIVITY_BATCH) {
      sendJson(400, { error: `At most ${MAX_ACTIVITY_BATCH} events per batch` });
      return;
    }
    const result = await ingestActivityBatch(owner.projectId, owner.instanceId, body.events);
    if (result.rejected > 0) {
      const key = `${owner.projectId}:${owner.instanceId}`;
      const nowMs = Date.now();
      if (nowMs - (lastRejectLogAt.get(key) ?? 0) >= REJECT_LOG_THROTTLE_MS) {
        lastRejectLogAt.set(key, nowMs);
        const why = Object.entries(result.reasons).map(([r, n]) => `${r}×${n}`).join(", ");
        console.warn(`[vps-activity] rejected ${result.rejected} of ${body.events.length} event(s) from ${key}: ${why}`);
      }
    }
    sendJson(200, { accepted: result.accepted, duplicates: result.duplicates, rejected: result.rejected });
  } catch (err: unknown) {
    if (err instanceof HttpError) {
      sendJson(err.status, { error: err.message });
      return;
    }
    // DB trouble etc.: a 5xx makes the daemon back off and resend the batch.
    console.error("[vps-activity] ingest failed:", err instanceof Error ? err.message : String(err));
    sendJson(500, { error: "Ingest failed" });
  }
}
