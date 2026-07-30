import { wsRequest } from "@/lib/ws";

export interface RunpodPodState {
  enabled: boolean;
  status: "RUNNING" | "EXITED" | "TERMINATED" | "UNKNOWN" | "STARTING";
  lastRequestAt: number;
  idleTimeoutSeconds: number;
  /** Last resume failure message (e.g. no free GPUs), or null. */
  error: string | null;
}

export async function fetchRunpodStatus(): Promise<RunpodPodState> {
  const res = await wsRequest<{ state: RunpodPodState }>("runpod:status");
  return res.state;
}

export async function startRunpodPod(): Promise<RunpodPodState> {
  const res = await wsRequest<{ state: RunpodPodState }>("runpod:start", {}, 20_000);
  return res.state;
}

export async function stopRunpodPod(): Promise<RunpodPodState> {
  const res = await wsRequest<{ state: RunpodPodState; ok: boolean; error?: string }>("runpod:stop", {}, 20_000);
  if (res.ok === false) throw new Error(res.error || "Failed to stop pod");
  return res.state;
}
