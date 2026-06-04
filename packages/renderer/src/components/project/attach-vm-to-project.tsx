"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { Link2, X, Loader2, Check, Pencil } from "lucide-react";
import { $attachVm, $projects } from "@/store/subjects";
import { attachExistingVmToProject, resetAttachVm } from "@/store/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type Provider = "digitalocean" | "tazcloud" | "hetzner";

/** Current project link of a VM (set when it's already attached). */
export interface VmProjectLink {
  projectId: string;
  projectName: string;
  instanceId: string;
}

/**
 * Project cell for a cloud VM card. Unlinked → a "Link →" button; linked → the
 * project name with a "change" affordance. Either opens a modal that picks a
 * project and streams the attach/move progress (bootstrap can take a minute).
 */
export function AttachVmToProject({
  provider,
  vmId,
  current = null,
}: {
  provider: Provider;
  vmId: string | number;
  current?: VmProjectLink | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {current ? (
        <span className="inline-flex items-center gap-1 min-w-0">
          <span className="text-blue truncate">{current.projectName}</span>
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 text-overlay0 hover:text-blue transition-colors"
            title="Change project"
          >
            <Pencil size={10} />
          </button>
        </span>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-overlay0/30 bg-surface0/50 text-md text-overlay1 hover:bg-surface0 hover:text-text transition-colors"
          title="Link this VM to a Genie project"
        >
          <Link2 size={11} />
          <span>Link →</span>
        </button>
      )}
      {open && <AttachVmModal provider={provider} vmId={vmId} current={current} onClose={() => setOpen(false)} />}
    </>
  );
}

function AttachVmModal({
  provider,
  vmId,
  current,
  onClose,
}: {
  provider: Provider;
  vmId: string | number;
  current: VmProjectLink | null;
  onClose: () => void;
}) {
  const [projects] = useSubject($projects);
  const [attach] = useSubject($attachVm);
  // When moving, default to the first project that isn't the current one.
  const [projectId, setProjectId] = useState(
    () => projects.find((p) => p.id !== current?.projectId)?.id ?? "",
  );

  useEffect(() => { resetAttachVm(); return () => resetAttachVm(); }, []);

  useEffect(() => {
    if (attach.status !== "ok") return;
    const t = setTimeout(onClose, 1200);
    return () => clearTimeout(t);
  }, [attach.status, onClose]);

  const running = attach.status === "running";
  const done = attach.status === "ok";
  const isMove = !!current;
  const sameAsCurrent = current?.projectId === projectId;

  function submit() {
    if (!projectId || sameAsCurrent) return;
    attachExistingVmToProject(
      projectId, provider, vmId, undefined,
      current ? { projectId: current.projectId, instanceId: current.instanceId } : undefined,
    );
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-[200]" onClick={running ? undefined : onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] max-w-[92vw] bg-mantle border border-surface0 rounded-lg shadow-xl z-[201] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0">
          <Link2 size={14} className="text-blue" />
          <span className="text-text font-medium text-md">{isMove ? "Change project" : "Attach to project"}</span>
          <div className="flex-1" />
          <button onClick={onClose} disabled={running} className="text-overlay1 hover:text-text transition-colors disabled:opacity-40"><X size={14} /></button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          {isMove && (
            <p className="text-xs text-overlay0">
              Currently attached to <span className="text-blue">{current!.projectName}</span>.
            </p>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-md text-overlay1">{isMove ? "Move to project" : "Project"}</label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={running || done} className="py-1.5 text-md font-sans">
              {projects.length === 0 && <option value="" disabled>No projects available</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === current?.projectId}>
                  {p.name}{p.teamName ? ` (${p.teamName})` : ""}{p.id === current?.projectId ? " — current" : ""}
                </option>
              ))}
            </Select>
            <p className="text-xs text-overlay0">
              {isMove
                ? "Moves the link to the chosen project (the VM keeps running)."
                : "Bootstraps the VM (genie user, SSH) and links it to the project. Takes up to a minute."}
            </p>
          </div>

          {attach.status !== "idle" && (
            <div className={
              attach.status === "error"
                ? "rounded-md bg-red/10 border border-red/30 px-3 py-2 max-h-44 overflow-auto"
                : "rounded-md bg-base/40 border border-overlay0/15 px-3 py-2 max-h-44 overflow-auto"
            }>
              {attach.progress.map((m, i) => (
                <div key={i} className="text-xs font-mono text-overlay1">{m}</div>
              ))}
              {attach.status === "error" && <div className="text-xs font-mono text-red mt-1">{attach.error}</div>}
              {done && <div className="text-xs font-mono text-green mt-1 flex items-center gap-1"><Check size={11} /> {isMove ? "Moved." : "Attached."}</div>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface0">
          <Button size="sm" onClick={onClose} disabled={running}>{done ? "Close" : "Cancel"}</Button>
          {!done && (
            <Button size="sm" variant="primary" onClick={submit} disabled={!projectId || sameAsCurrent || running}>
              {running ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
              {running ? (isMove ? "Moving…" : "Attaching…") : attach.status === "error" ? "Retry" : isMove ? "Move" : "Attach"}
            </Button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
