"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, Check, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ExecFn = (command: string) => Promise<{ output: string; error?: boolean }>;

type Status = "unknown" | "checking" | "absent" | "present" | "installing" | "error";

/** Shared install script — usable from both the inline card and per-row quick-action. */
export const GENIE_USER_INSTALL_SCRIPT = [
  "set -e",
  "sudo useradd -m -s /bin/bash genie 2>/dev/null || true",
  "echo 'genie ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/genie > /dev/null",
  "sudo chmod 440 /etc/sudoers.d/genie",
  "sudo mkdir -p /home/genie/.ssh",
  "sudo cp ~/.ssh/authorized_keys /home/genie/.ssh/authorized_keys",
  "sudo chown -R genie:genie /home/genie/.ssh",
  "sudo chmod 700 /home/genie/.ssh",
  "sudo chmod 600 /home/genie/.ssh/authorized_keys",
  "sudo usermod -aG sudo genie 2>/dev/null || sudo usermod -aG wheel genie 2>/dev/null || true",
  "sudo usermod -aG docker genie 2>/dev/null || true",
  "echo OK",
].join(" && ");

/** Module-scoped cache of "we already confirmed the genie user exists on this VM"
 *  — survives Manage-panel open/close cycles within a session so we don't re-SSH
 *  every time. Only true values are cached; absent/error are rechecked on remount
 *  (since the install could happen any time and we want fresh signal). */
const genieUserPresent = new Map<string, boolean>();

/** Inline status row that checks whether a sudo-capable `genie` user exists on
 *  the VM and, if not, offers a one-click install. Single-row layout for every
 *  state (no layout shift between checking/present/absent/installing). */
export function GenieUserSetup({ vmId, exec }: { vmId?: string; exec: ExecFn }) {
  const cached = vmId ? genieUserPresent.get(vmId) : undefined;
  const [status, setStatus] = useState<Status>(cached === true ? "present" : "unknown");
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setStatus("checking");
    setError(null);
    const res = await exec("id genie >/dev/null 2>&1 && echo PRESENT || echo ABSENT");
    if (res.error) {
      setStatus("error");
      setError(res.output.slice(0, 200));
      return;
    }
    const isPresent = res.output.includes("PRESENT");
    if (isPresent && vmId) genieUserPresent.set(vmId, true);
    setStatus(isPresent ? "present" : "absent");
  }, [exec, vmId]);

  useEffect(() => {
    // Skip if we already know it's present for this VM.
    if (cached === true) return;
    check();
  }, [check, cached]);

  const install = useCallback(async () => {
    setStatus("installing");
    setError(null);
    const res = await exec(GENIE_USER_INSTALL_SCRIPT);
    if (res.error || !res.output.trim().endsWith("OK")) {
      setStatus("error");
      setError((res.output || "Install failed").slice(0, 400));
      return;
    }
    if (vmId) genieUserPresent.set(vmId, true);
    setStatus("present");
  }, [exec, vmId]);

  // Single-row layout: icon + message + optional action. Same vertical footprint
  // across every state so transitions don't reflow the surrounding panel.
  return (
    <div className="flex items-center gap-2 text-md h-7 mb-1">
      {(() => {
        switch (status) {
          case "present":
            return (
              <>
                <Check size={12} className="text-green shrink-0" />
                <span className="text-green">
                  Genie user installed (you can SSH as <span className="font-mono">genie</span>)
                </span>
              </>
            );
          case "checking":
          case "unknown":
            return (
              <>
                <Loader2 size={12} className="animate-spin text-overlay0 shrink-0" />
                <span className="text-overlay1">Checking for <span className="font-mono">genie</span> user…</span>
              </>
            );
          case "absent":
            return (
              <>
                <UserPlus size={12} className="text-blue shrink-0" />
                <span className="text-overlay1">No <span className="font-mono">genie</span> user on this VM.</span>
                <button
                  onClick={install}
                  className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue/30 text-md text-blue hover:bg-blue/10 transition-colors"
                >
                  <UserPlus size={11} />
                  Add genie user
                </button>
              </>
            );
          case "installing":
            return (
              <>
                <Loader2 size={12} className="animate-spin text-blue shrink-0" />
                <span className="text-overlay1">Creating <span className="font-mono">genie</span> user…</span>
              </>
            );
          case "error":
            return (
              <>
                <AlertCircle size={12} className="text-red shrink-0" />
                <span className={cn("text-red truncate")} title={error || "Failed"}>
                  {error || "Genie user check failed"}
                </span>
                <button onClick={check} className="ml-auto text-overlay1 hover:text-text underline text-xs">retry</button>
              </>
            );
        }
      })()}
    </div>
  );
}
