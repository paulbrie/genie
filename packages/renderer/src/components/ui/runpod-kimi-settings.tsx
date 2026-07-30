"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Play, Square, RefreshCw } from "lucide-react";
import { useSubject } from "subjecto/react";
import { $settings } from "@/store/subjects/common";
import {
  saveSettingsField,
  fetchRunpodStatus,
  startRunpodPod,
  stopRunpodPod,
  type RunpodPodState,
} from "@/store/actions";

const STATUS_LABEL: Record<RunpodPodState["status"], string> = {
  RUNNING: "Running",
  STARTING: "Starting…",
  EXITED: "Stopped",
  TERMINATED: "Terminated",
  UNKNOWN: "Unknown",
};

const STATUS_COLOR: Record<RunpodPodState["status"], string> = {
  RUNNING: "text-green",
  STARTING: "text-yellow",
  EXITED: "text-overlay1",
  TERMINATED: "text-red",
  UNKNOWN: "text-overlay0",
};

/** Superadmin/admin config + manual control for the self-hosted Kimi K2.7 pod
 *  on RunPod. Genie resumes the pod when the "Kimi K2.7 (self-hosted)" chat
 *  model is used and stops it after the idle window below. */
export function RunpodKimiSettings() {
  const [settings] = useSubject($settings);

  const [apiKey, setApiKey] = useState("");
  const [podId, setPodId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [vllmKey, setVllmKey] = useState("");
  const [servedModel, setServedModel] = useState("");
  const [idleMinutes, setIdleMinutes] = useState("5");
  const [dirty, setDirty] = useState(false);
  const [showKeys, setShowKeys] = useState(false);

  const [state, setState] = useState<RunpodPodState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate local inputs from saved settings.
  useEffect(() => {
    setApiKey(settings.runpodApiKey || "");
    setPodId(settings.runpodKimiPodId || "");
    setEndpoint(settings.runpodKimiEndpoint || "");
    setVllmKey(settings.runpodKimiApiKey || "");
    setServedModel(settings.runpodKimiServedModel || "");
    setIdleMinutes(String(Math.max(1, Math.round((settings.runpodIdleTimeoutSeconds || 300) / 60))));
    setDirty(false);
  }, [
    settings.runpodApiKey, settings.runpodKimiPodId, settings.runpodKimiEndpoint,
    settings.runpodKimiApiKey, settings.runpodKimiServedModel, settings.runpodIdleTimeoutSeconds,
  ]);

  // Poll status while a pod is configured. Faster cadence while it's starting.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = await fetchRunpodStatus();
        if (!cancelled) setState(s);
      } catch { /* transient */ }
    }
    void tick();
    pollRef.current = setInterval(tick, 5000);
    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function handleSave() {
    saveSettingsField("runpodApiKey", apiKey.trim());
    saveSettingsField("runpodKimiPodId", podId.trim());
    saveSettingsField("runpodKimiEndpoint", endpoint.trim());
    saveSettingsField("runpodKimiApiKey", vllmKey.trim());
    saveSettingsField("runpodKimiServedModel", servedModel.trim());
    const mins = Math.max(1, parseInt(idleMinutes, 10) || 5);
    saveSettingsField("runpodIdleTimeoutSeconds", mins * 60);
    setDirty(false);
  }

  async function handleStart() {
    setBusy(true); setError(null);
    try { setState(await startRunpodPod()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function handleStop() {
    setBusy(true); setError(null);
    try { setState(await stopRunpodPod()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const inputClass = "w-full bg-background text-text border border-surface0 rounded-md px-3 py-2 text-md outline-none focus:border-blue font-mono";
  const status = state?.status ?? "UNKNOWN";
  const running = status === "RUNNING";
  const starting = status === "STARTING";

  return (
    <div className="bg-mantle rounded-lg p-4 mt-4">
      <label className="block text-md font-medium text-subtext0 mb-2">
        Self-hosted Kimi K2.7 (RunPod)
        <span className="ml-2 text-md text-overlay0 font-normal">On-demand GPU pod — auto-stops when idle</span>
      </label>

      {/* Live status + manual control */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-md text-overlay1">Pod:</span>
        <span className={`text-md font-medium ${STATUS_COLOR[status]}`}>
          {state?.enabled ? STATUS_LABEL[status] : "Not configured"}
        </span>
        <button
          type="button"
          onClick={() => { void fetchRunpodStatus().then(setState).catch(() => {}); }}
          className="text-overlay0 hover:text-text transition-colors"
          title="Refresh status"
        >
          <RefreshCw size={14} />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          disabled={busy || running || starting || !state?.enabled}
          onClick={handleStart}
          className="flex items-center gap-1 px-3 py-1.5 bg-green text-background text-md rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play size={14} /> Start
        </button>
        <button
          type="button"
          disabled={busy || (!running && !starting) || !state?.enabled}
          onClick={handleStop}
          className="flex items-center gap-1 px-3 py-1.5 bg-red text-background text-md rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Square size={14} /> Stop
        </button>
      </div>
      {error && <p className="text-md text-red mb-2">{error}</p>}

      {/* Config fields */}
      <div className="flex flex-col gap-2 max-w-md">
        <div className="relative">
          <input
            type={showKeys ? "text" : "password"}
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setDirty(true); }}
            placeholder="RunPod API key"
            className={inputClass + " pr-9"}
          />
          <button
            type="button"
            onClick={() => setShowKeys((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-overlay0 hover:text-text transition-colors"
          >
            {showKeys ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <input
          type="text"
          value={podId}
          onChange={(e) => { setPodId(e.target.value); setDirty(true); }}
          placeholder="Pod ID (the persistent Kimi pod)"
          className={inputClass}
        />
        <input
          type="text"
          value={endpoint}
          onChange={(e) => { setEndpoint(e.target.value); setDirty(true); }}
          placeholder="vLLM endpoint, e.g. https://<podId>-8000.proxy.runpod.net/v1"
          className={inputClass}
        />
        <input
          type={showKeys ? "text" : "password"}
          value={vllmKey}
          onChange={(e) => { setVllmKey(e.target.value); setDirty(true); }}
          placeholder="vLLM API key (optional, the server's --api-key)"
          className={inputClass}
        />
        <input
          type="text"
          value={servedModel}
          onChange={(e) => { setServedModel(e.target.value); setDirty(true); }}
          placeholder="Served model name (default: kimi-k2.7-code)"
          className={inputClass}
        />
        <label className="flex items-center gap-2 text-md text-overlay1">
          Auto-stop after
          <input
            type="number"
            min={1}
            value={idleMinutes}
            onChange={(e) => { setIdleMinutes(e.target.value); setDirty(true); }}
            className="w-20 bg-background text-text border border-surface0 rounded-md px-2 py-1 text-md outline-none focus:border-blue"
          />
          minutes of inactivity
        </label>
        {dirty && (
          <button
            onClick={handleSave}
            className="mt-1 self-start px-3 py-2 bg-blue text-background text-md rounded-md hover:opacity-90 transition-opacity"
          >
            Save
          </button>
        )}
      </div>
      <p className="text-md text-overlay0 mt-2">
        When a chat selects <span className="font-mono text-subtext0">Kimi K2.7 (self-hosted)</span>, Genie resumes
        this pod and waits for vLLM before answering. It stops the pod again after the idle window above.
      </p>
    </div>
  );
}
