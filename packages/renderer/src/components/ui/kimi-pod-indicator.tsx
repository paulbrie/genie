"use client";

import { useEffect, useState } from "react";
import { Cpu, Play, Square, Loader2 } from "lucide-react";
import { fetchRunpodStatus, startRunpodPod, stopRunpodPod, type RunpodPodState } from "@/store/actions";
import { cn } from "@/lib/utils";

const DOT: Record<RunpodPodState["status"], string> = {
  RUNNING: "bg-green",
  STARTING: "bg-yellow animate-pulse",
  EXITED: "bg-overlay0",
  TERMINATED: "bg-red",
  UNKNOWN: "bg-overlay0",
};

const LABEL: Record<RunpodPodState["status"], string> = {
  RUNNING: "Running",
  STARTING: "Starting…",
  EXITED: "Stopped",
  TERMINATED: "Terminated",
  UNKNOWN: "Unknown",
};

/** Live state + start/stop control for the self-hosted Kimi K2.7 RunPod GPU
 *  pod, shown in the admin/superadmin top bar. Hidden when the pod isn't
 *  configured. Polls runpod:status (admin-gated, server-side cached) every 10s. */
export function KimiPodIndicator() {
  const [state, setState] = useState<RunpodPodState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = await fetchRunpodStatus();
        if (!cancelled) setState(s);
      } catch {
        /* transient — keep last known */
      }
    }
    void tick();
    const timer = setInterval(tick, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (!state || !state.enabled) return null;

  const status = state.status;
  const idleMin = Math.max(1, Math.round(state.idleTimeoutSeconds / 60));
  const running = status === "RUNNING";
  const starting = status === "STARTING";
  // A background resume failure (e.g. no free GPUs) arrives via the polled
  // state; a failed manual click sets the local one. Show either.
  const shownError = error || state.error;

  async function handleStart(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true); setError(null);
    // Optimistic: reflect STARTING immediately; the poll will confirm.
    setState((s) => (s ? { ...s, status: "STARTING" } : s));
    try { setState(await startRunpodPod()); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function handleStop(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true); setError(null);
    try { setState(await stopRunpodPod()); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  const title = shownError
    ? `Kimi pod error: ${shownError}`
    : `Kimi K2.7 pod — ${LABEL[status]} · auto-stops after ${idleMin} min idle`;

  return (
    <div
      title={title}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm text-overlay0 shrink-0"
    >
      <Cpu size={14} className="shrink-0" />
      <span className="font-medium text-subtext0">Kimi</span>
      <span className={cn("w-2 h-2 rounded-full shrink-0", shownError && !running ? "bg-red" : DOT[status])} />
      <span className="tabular-nums">{shownError && !running ? "Error" : LABEL[status]}</span>

      {/* Start when stopped, Stop when running. Disabled while a transition is
          in flight (busy) or the pod is already starting. */}
      {running ? (
        <button
          type="button"
          onClick={handleStop}
          disabled={busy}
          title="Stop the Kimi pod"
          className="ml-0.5 flex items-center justify-center w-5 h-5 rounded text-overlay0 hover:text-red hover:bg-surface0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          disabled={busy || starting}
          title="Start the Kimi pod"
          className="ml-0.5 flex items-center justify-center w-5 h-5 rounded text-overlay0 hover:text-green hover:bg-surface0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy || starting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
        </button>
      )}
    </div>
  );
}
