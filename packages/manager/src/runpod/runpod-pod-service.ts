// On-demand lifecycle for the self-hosted Kimi K2.7 pod on RunPod.
//
// We hold a single persistent pod that serves Kimi via vLLM (OpenAI-compatible).
// To avoid paying for idle GPU time, the pod is STOPPED by default and resumed
// only when a chat request selects the self-hosted Kimi model. An idle watcher
// stops the pod again once no request has arrived for `idleTimeoutSeconds`.
//
// State is in-memory; the watcher reconciles the real status from RunPod on
// every tick, so a manager restart at worst delays an auto-stop by one interval.

import { createRunpodClient, type RunpodPod } from "./runpod-api-client.js";
import {
  getRunpodApiKey,
  getRunpodKimiPodId,
  getRunpodKimiEndpoint,
  getRunpodKimiApiKey,
  getRunpodKimiServedModel,
  getRunpodIdleTimeoutSeconds,
} from "../settings-service.js";

export interface KimiPodConfig {
  apiKey: string;
  podId: string;
  /** OpenAI-compatible base URL, e.g. https://<podId>-8000.proxy.runpod.net/v1 */
  endpoint: string;
  /** Optional bearer the vLLM server was launched with (--api-key). */
  vllmApiKey: string;
  /** Model name vLLM serves (the `model` field in requests). */
  servedModel: string;
  idleTimeoutSeconds: number;
}

/** Fully-configured + usable, or a reason why not. */
export async function getKimiConfig(): Promise<KimiPodConfig | null> {
  const [apiKey, podId, endpointSetting, vllmApiKey, servedModel, idleTimeoutSeconds] = await Promise.all([
    getRunpodApiKey(),
    getRunpodKimiPodId(),
    getRunpodKimiEndpoint(),
    getRunpodKimiApiKey(),
    getRunpodKimiServedModel(),
    getRunpodIdleTimeoutSeconds(),
  ]);
  if (!apiKey || !podId) return null;
  // RunPod exposes container ports at https://<podId>-<port>.proxy.runpod.net.
  // vLLM listens on 8000, so the OpenAI-compatible base is .../v1. An explicit
  // endpoint setting (e.g. a custom domain) overrides the derived URL.
  const endpoint = endpointSetting || `https://${podId}-8000.proxy.runpod.net/v1`;
  return { apiKey, podId, endpoint, vllmApiKey, servedModel, idleTimeoutSeconds };
}

// --- In-memory runtime state ---

// Seed to "now" so a watcher tick right after boot doesn't immediately stop a
// pod that may be mid-request or was started out-of-band.
let lastRequestAt = Date.now();
let lastKnownStatus: RunpodPod["desiredStatus"] | "STARTING" = "UNKNOWN";
// Last resume failure (e.g. RunPod "not enough free GPUs"), surfaced to the UI
// so a failed start from the top bar isn't silently swallowed. Cleared when a
// new resume begins or the pod is confirmed RUNNING.
let lastError: string | null = null;
// Coalesce live status reads — several admins may poll runpod:status at once.
let lastStatusFetchAt = 0;
const STATUS_CACHE_MS = 5000;
// One shared in-flight resume so concurrent chats don't double-start the pod.
let inFlightStart: Promise<void> | null = null;

export function recordActivity(): void {
  lastRequestAt = Date.now();
}

export interface KimiPodState {
  enabled: boolean;
  status: RunpodPod["desiredStatus"] | "STARTING";
  lastRequestAt: number;
  idleTimeoutSeconds: number;
  /** Last resume failure message, or null. */
  error: string | null;
}

export async function getPodState(): Promise<KimiPodState> {
  const config = await getKimiConfig();
  if (!config) {
    return { enabled: false, status: "UNKNOWN", lastRequestAt, idleTimeoutSeconds: 0, error: null };
  }
  // Skip the live read while a resume is in flight (status is STARTING anyway)
  // or when a recent read is still fresh — coalesces frequent UI polls.
  if (!inFlightStart && Date.now() - lastStatusFetchAt > STATUS_CACHE_MS) {
    try {
      const client = createRunpodClient(config.apiKey);
      const pod = await client.getPod(config.podId);
      lastKnownStatus = pod.desiredStatus;
      lastStatusFetchAt = Date.now();
      if (pod.desiredStatus === "RUNNING") lastError = null;
    } catch {
      // Surface whatever we last saw rather than throwing in the UI path.
    }
  }
  return {
    enabled: true,
    status: inFlightStart ? "STARTING" : lastKnownStatus,
    lastRequestAt,
    idleTimeoutSeconds: config.idleTimeoutSeconds,
    error: lastError,
  };
}

/** Wait until the vLLM endpoint answers (model list) or the deadline passes. */
async function waitForVllm(config: KimiPodConfig, deadline: number): Promise<boolean> {
  const url = `${config.endpoint.replace(/\/$/, "")}/models`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        headers: config.vllmApiKey ? { Authorization: `Bearer ${config.vllmApiKey}` } : {},
      });
      if (res.ok) return true;
    } catch {
      // pod/proxy not reachable yet
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

/**
 * Ensure the Kimi pod is running and vLLM is serving. Resumes a stopped pod and
 * blocks until it's ready (up to ~5 min for weights to load). Concurrency-safe:
 * simultaneous callers share one resume. Records activity so the idle watcher
 * won't immediately stop it. Throws if unconfigured or the pod never comes up.
 */
export async function ensurePodRunning(onProgress?: (message: string) => void): Promise<void> {
  const config = await getKimiConfig();
  if (!config) {
    throw new Error("Self-hosted Kimi pod is not configured (set the RunPod API key, pod ID and endpoint in Settings).");
  }
  recordActivity();

  if (inFlightStart) {
    onProgress?.("Starting Kimi pod…");
    return inFlightStart;
  }

  const client = createRunpodClient(config.apiKey);

  const run = (async () => {
    lastError = null;
    const pod = await client.getPod(config.podId);
    lastKnownStatus = pod.desiredStatus;

    // Already running and serving → fast path.
    if (pod.desiredStatus === "RUNNING") {
      const ready = await waitForVllm(config, Date.now() + 30_000);
      if (ready) return;
      // Running but vLLM not answering — fall through to the full wait below.
    } else {
      onProgress?.("Starting Kimi pod…");
      lastKnownStatus = "STARTING";
      // Resume can fail with "not enough free GPUs on the host machine": stopping
      // released this pod's GPUs and another tenant took them. They may free up,
      // so retry a few times before giving up.
      let started = false;
      for (let attempt = 1; attempt <= 4 && !started; attempt++) {
        try {
          await client.startPod(config.podId);
          started = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const capacity = /not enough free GPUs|no longer any free/i.test(msg);
          if (!capacity || attempt === 4) {
            throw new Error(
              capacity
                ? `RunPod has no free GPUs to resume this 8×H200 pod right now (the host filled up after it was stopped). Try again shortly. (${msg})`
                : msg,
            );
          }
          onProgress?.(`Waiting for GPUs to free up (attempt ${attempt}/3)…`);
          await new Promise((r) => setTimeout(r, 15_000));
        }
      }
    }

    onProgress?.("Waiting for Kimi to load…");
    // Poll desiredStatus to RUNNING, then wait for vLLM. 5 min budget overall.
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      const p = await client.getPod(config.podId);
      lastKnownStatus = p.desiredStatus === "RUNNING" ? "STARTING" : p.desiredStatus;
      if (p.desiredStatus === "RUNNING") break;
      await new Promise((r) => setTimeout(r, 5000));
    }

    const ready = await waitForVllm(config, deadline);
    if (!ready) {
      throw new Error("Kimi pod did not become ready in time. Check the pod and vLLM logs on RunPod.");
    }
    lastKnownStatus = "RUNNING";
    recordActivity();
  })();

  inFlightStart = run;
  try {
    await run;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    inFlightStart = null;
  }
}

export async function manualStart(): Promise<void> {
  await ensurePodRunning();
}

export async function manualStop(): Promise<void> {
  const config = await getKimiConfig();
  if (!config) throw new Error("Self-hosted Kimi pod is not configured.");
  const client = createRunpodClient(config.apiKey);
  await client.stopPod(config.podId);
  lastKnownStatus = "EXITED";
}

let watcherTimer: ReturnType<typeof setInterval> | null = null;

/** Start the idle watcher. Stops the pod after `idleTimeoutSeconds` of no
 *  activity. Safe to call once at boot; no-op if already running. */
export function startIdleWatcher(): void {
  if (watcherTimer) return;
  watcherTimer = setInterval(() => { void idleTick(); }, 30_000);
  // Don't keep the process alive solely for the watcher.
  if (typeof watcherTimer.unref === "function") watcherTimer.unref();
}

async function idleTick(): Promise<void> {
  try {
    const config = await getKimiConfig();
    if (!config) return;
    if (inFlightStart) return; // a resume is in progress; never stop mid-start
    const idleMs = Date.now() - lastRequestAt;
    if (idleMs < config.idleTimeoutSeconds * 1000) return;

    const client = createRunpodClient(config.apiKey);
    const pod = await client.getPod(config.podId);
    lastKnownStatus = pod.desiredStatus;
    if (pod.desiredStatus !== "RUNNING") return;

    console.log(`[runpod] Kimi pod idle for ${Math.round(idleMs / 1000)}s — stopping.`);
    await client.stopPod(config.podId);
    lastKnownStatus = "EXITED";
  } catch (err) {
    console.error("[runpod] idle watcher error:", err instanceof Error ? err.message : err);
  }
}
