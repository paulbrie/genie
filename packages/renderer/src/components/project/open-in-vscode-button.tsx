"use client";

// "Open in VS Code" strip for the VPS file explorer (Files tab of the
// Manage-VM popup). Talks to the manager's vps:code:* handler
// (code-server-handler.ts): one status probe on mount, then an ensure +
// 3s status-polling loop while setup is in flight. The install itself runs
// detached on the VM, so closing the popup mid-install is safe — reopening
// resumes the polling. When running, "Open" copies the code-server password
// to the clipboard (the login page wants it once per browser) and opens the
// manager's /code/<projectId>/<instanceId>/ proxy route in a new tab — the
// manager tunnels the editor to the VM over SSH, so no per-VM domain is
// involved.

import { useState, useEffect, useRef, useCallback } from "react";
import { Code, Loader2, ExternalLink, KeyRound } from "lucide-react";
import { wsRequest, getManagerHttpUrl } from "@/lib/ws";

type CodeState =
  | "not_installed"
  | "installing"
  | "install_failed"
  | "stopped"
  | "running";

interface CodeStatus {
  ok: boolean;
  state?: CodeState;
  /** Tokenized manager-relative proxy path, present when running. */
  path?: string;
  password?: string;
  logTail?: string;
  error?: string;
}

function lastLogLine(logTail?: string): string | null {
  const lines = (logTail || "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

export function OpenInVsCode({ projectId, instanceId }: { projectId: string; instanceId: string }) {
  const [status, setStatus] = useState<CodeStatus | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const loopRef = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSetup = useCallback(async () => {
    if (loopRef.current) return;
    loopRef.current = true;
    setError(null);
    setSettingUp(true);
    try {
      // ensure advances the state machine one leg per call (install → start);
      // between legs we poll status while the detached install runs. Bounded
      // so a stuck VM can't loop forever.
      for (let round = 0; round < 20 && mountedRef.current; round++) {
        const res: CodeStatus = await wsRequest("vps:code:ensure", { projectId, instanceId }, 120_000);
        if (!mountedRef.current) return;
        setStatus(res);
        if (!res.ok) { setError(res.error || "Setup failed"); return; }
        if (res.state === "running") return;
        if (res.state === "install_failed") {
          setError(lastLogLine(res.logTail) || "Install failed — see /var/log/code-server-install.log on the VM");
          return;
        }
        while (mountedRef.current) {
          await new Promise((r) => setTimeout(r, 3000));
          if (!mountedRef.current) return;
          const st: CodeStatus = await wsRequest("vps:code:status", { projectId, instanceId }, 30_000);
          if (!mountedRef.current) return;
          setStatus(st);
          if (st.state !== "installing") {
            if (st.state === "install_failed") {
              setError(lastLogLine(st.logTail) || "Install failed — see /var/log/code-server-install.log on the VM");
              return;
            }
            break; // stopped/not_installed → loop back to ensure
          }
        }
      }
    } catch (err: unknown) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      loopRef.current = false;
      if (mountedRef.current) setSettingUp(false);
    }
  }, [projectId, instanceId]);

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      try {
        const st: CodeStatus = await wsRequest("vps:code:status", { projectId, instanceId }, 30_000);
        if (!mountedRef.current) return;
        setStatus(st);
        // Popup reopened mid-install → resume the polling loop.
        if (st.state === "installing") void runSetup();
      } catch {
        /* strip stays hidden when the probe fails (e.g. VM unreachable) */
      }
    })();
    return () => {
      mountedRef.current = false;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [projectId, instanceId, runSetup]);

  const flashNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  const copyPassword = useCallback(() => {
    if (!status?.password) return;
    navigator.clipboard?.writeText(status.password)
      .then(() => flashNotice("Password copied to clipboard"))
      .catch(() => flashNotice("Could not copy — use the recipe's 'Show password' command"));
  }, [status?.password, flashNotice]);

  const openVsCode = useCallback(() => {
    if (!status?.path) return;
    if (status.password) {
      navigator.clipboard?.writeText(status.password)
        .then(() => flashNotice("Password copied — paste it on the login page"))
        .catch(() => {});
    }
    window.open(getManagerHttpUrl() + status.path, "_blank", "noopener");
  }, [status?.path, status?.password, flashNotice]);

  if (!status) return null;

  const busy = settingUp || status.state === "installing";
  const installLine = busy ? lastLogLine(status.logTail) : null;

  return (
    <div className="shrink-0 border-b border-surface0 px-2 py-1.5 text-xs select-none">
      <div className="flex items-center gap-1.5">
        <Code size={12} className="text-mauve shrink-0" />
        <span className="text-overlay1 flex-1 truncate">VS Code</span>
        {status.state === "running" && status.path ? (
          <>
            <button
              onClick={copyPassword}
              className="text-overlay1 hover:text-text transition-colors p-0.5 shrink-0 bg-transparent border-none cursor-pointer"
              title="Copy code-server password"
              aria-label="Copy code-server password"
            >
              <KeyRound size={12} />
            </button>
            <button
              onClick={openVsCode}
              className="flex items-center gap-1 text-blue hover:text-sapphire transition-colors shrink-0 bg-transparent border-none cursor-pointer text-xs p-0"
              title="Open VS Code in a new tab (copies the password)"
            >
              <ExternalLink size={12} />
              Open
            </button>
          </>
        ) : busy ? (
          <span className="flex items-center gap-1 text-overlay0 shrink-0">
            <Loader2 size={12} className="animate-spin" />
            Setting up…
          </span>
        ) : (
          <button
            onClick={() => void runSetup()}
            className="text-blue hover:text-sapphire transition-colors shrink-0 bg-transparent border-none cursor-pointer text-xs p-0"
            title="Install code-server on this VM and open it through the manager"
          >
            {status.state === "install_failed" || error ? "Retry" : "Set up"}
          </button>
        )}
      </div>
      {installLine && (
        <div className="mt-1 font-mono text-overlay0 truncate" title={installLine}>{installLine}</div>
      )}
      {error && !busy && (
        <div className="mt-1 text-red truncate" title={error}>{error}</div>
      )}
      {notice && (
        <div className="mt-1 text-green truncate">{notice}</div>
      )}
    </div>
  );
}
