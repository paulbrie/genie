// Thin typed wrapper over RunPod's REST API (https://rest.runpod.io/v1).
// We only need the start/stop/get lifecycle ops for a single persistent pod —
// Genie resumes a stopped pod on demand and stops it again after an idle
// window. Mirrors the shape of vps/tazcloud-api-client.ts.

const RUNPOD_API = "https://rest.runpod.io/v1";

interface RunpodRequestInit {
  method?: string;
  body?: unknown;
}

function formatRunpodDetail(json: Record<string, unknown> | null, rawBody: string): string {
  if (json) {
    // RunPod returns { error: "..." } or { message: "..." } on failures.
    const err = json.error ?? json.message ?? json.detail;
    if (typeof err === "string") return err;
    if (Object.keys(json).length > 0) return JSON.stringify(json);
  }
  return rawBody || "no detail returned";
}

async function runpodFetch(
  apiKey: string,
  path: string,
  init?: RunpodRequestInit,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${RUNPOD_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });

  if (res.status === 204) return null;

  const rawBody = await res.text();
  let json: Record<string, unknown> | null = null;
  if (rawBody) {
    try { json = JSON.parse(rawBody) as Record<string, unknown>; } catch { /* non-JSON */ }
  }

  if (!res.ok) {
    throw new Error(`RunPod API error (${res.status}): ${formatRunpodDetail(json, rawBody)}`);
  }

  return json;
}

/** Pod lifecycle status. RunPod reports `desiredStatus` as RUNNING / EXITED /
 *  TERMINATED; a freshly-resumed pod may briefly report no runtime yet. */
export type RunpodPodStatus = "RUNNING" | "EXITED" | "TERMINATED" | "UNKNOWN";

export interface RunpodPod {
  id: string;
  /** What state the pod is being driven toward. We treat RUNNING as "up". */
  desiredStatus: RunpodPodStatus;
  /** Present once the pod is actually running (ports, uptime, etc.). */
  runtime: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

function normalizePod(json: Record<string, unknown>): RunpodPod {
  const desired = String(json.desiredStatus ?? json.status ?? "UNKNOWN").toUpperCase();
  const desiredStatus: RunpodPodStatus =
    desired === "RUNNING" || desired === "EXITED" || desired === "TERMINATED"
      ? (desired as RunpodPodStatus)
      : "UNKNOWN";
  return {
    id: String(json.id ?? ""),
    desiredStatus,
    runtime: (json.runtime as Record<string, unknown> | null) ?? null,
    raw: json,
  };
}

export interface RunpodApiClient {
  getPod(podId: string): Promise<RunpodPod>;
  /** Resume a stopped pod. */
  startPod(podId: string): Promise<void>;
  /** Stop a running pod (disk persists, GPU is released). */
  stopPod(podId: string): Promise<void>;
}

export function createRunpodClient(apiKey: string): RunpodApiClient {
  return {
    async getPod(podId) {
      const json = await runpodFetch(apiKey, `/pods/${podId}`);
      return normalizePod(json ?? {});
    },
    async startPod(podId) {
      await runpodFetch(apiKey, `/pods/${podId}/start`, { method: "POST" });
    },
    async stopPod(podId) {
      await runpodFetch(apiKey, `/pods/${podId}/stop`, { method: "POST" });
    },
  };
}
