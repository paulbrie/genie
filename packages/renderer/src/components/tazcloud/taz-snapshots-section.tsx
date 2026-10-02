"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, Rocket, Trash2 } from "lucide-react";
import type { AdminTazVm } from "@/store/types";
import { $admin } from "@/store/subjects";
import { createAdminTazVm, deleteTazSnapshot, loadTazSnapshots } from "@/store/actions";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ErrorMessage } from "@/components/ui/error-message";
import { defaultVmName, validateTazVmName, SIZES } from "./helpers";

export function TazSnapshotsSection({ vms }: { vms: AdminTazVm[] }) {
  const admin = useDeepSubjectAll($admin);
  const { snapshots, snapshotsLoading, snapshotsError, snapshotCreateError, creating, createError } = admin.tazcloud;
  const vmNameById = new Map(vms.map((v) => [v.id, v.name]));

  // Per-row "boot from snapshot" form state.
  const [bootFormFor, setBootFormFor] = useState<string | null>(null);
  const [bootVmName, setBootVmName] = useState("");
  const [bootVmSize, setBootVmSize] = useState("small");
  const submittingRef = useRef(false);

  // Auto-close the boot form when the create completes successfully.
  // `creating` is shared with the deploy form at the top of the page, so we
  // gate on `submittingRef` to only react when *this* form initiated it.
  const prevCreatingRef = useRef(false);
  useEffect(() => {
    if (prevCreatingRef.current && !creating && submittingRef.current) {
      submittingRef.current = false;
      if (!createError) {
        setBootFormFor(null);
      }
    }
    prevCreatingRef.current = creating;
  }, [creating, createError]);

  function openBootForm(snapshotId: string) {
    setBootVmName(defaultVmName());
    setBootVmSize("small");
    setBootFormFor(snapshotId);
  }

  function submitBoot(snapshotId: string) {
    const trimmed = bootVmName.trim();
    if (validateTazVmName(trimmed)) return;
    submittingRef.current = true;
    createAdminTazVm({ name: trimmed, size: bootVmSize, snapshot_id: snapshotId });
  }

  if (snapshots.length === 0 && !snapshotsLoading && !snapshotsError && !snapshotCreateError) {
    return null;  // nothing to show — keep the page clean until the user creates one
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <Camera size={16} className="text-teal" />
        <span className="text-md font-medium text-subtext0">Snapshots</span>
        <span className="text-md text-overlay0 font-mono">{snapshots.length}</span>
        <div className="flex-1" />
        <Button size="sm" onClick={loadTazSnapshots} disabled={snapshotsLoading}>
          <RefreshCw size={14} className={cn("mr-1", snapshotsLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>
      {snapshotCreateError && (
        <ErrorMessage className="mb-2">{snapshotCreateError}</ErrorMessage>
      )}
      {snapshotsError && (
        <ErrorMessage className="mb-2">{snapshotsError}</ErrorMessage>
      )}
      {snapshots.length > 0 && (
        <div className="border border-overlay0/20 rounded-lg overflow-hidden">
          <table className="w-full text-md">
            <thead className="bg-surface0/40 text-overlay1 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Source VM</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium w-0"></th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => {
                const sourceName = vmNameById.get(s.sourceVmId);
                const bootOpen = bootFormFor === s.id;
                const bootNameErr = validateTazVmName(bootVmName.trim());
                return (
                  <Fragment key={s.id}>
                    <tr className="border-t border-overlay0/10">
                      <td className="px-3 py-2 font-mono text-text">{s.name}</td>
                      <td className="px-3 py-2 text-overlay1 font-mono text-xs">
                        {sourceName ? <span>{sourceName}</span> : s.sourceVmId ? <span title={s.sourceVmId} className="text-overlay0">(deleted: {s.sourceVmId.slice(0, 8)}…)</span> : <span className="text-overlay0">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium",
                          s.status === "active" && "bg-green/15 text-green",
                          s.status === "pending" && "bg-yellow/15 text-yellow",
                          s.status === "error" && "bg-red/15 text-red",
                        )}>
                          {s.status === "pending" && <Loader2 size={10} className="animate-spin" />}
                          {s.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-overlay1">{s.sizeGb} GB</td>
                      <td className="px-3 py-2 text-overlay1 text-xs">{new Date(s.created).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => bootOpen ? setBootFormFor(null) : openBootForm(s.id)}
                            disabled={s.status !== "active"}
                            className={cn(
                              "p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                              bootOpen ? "text-blue" : "text-overlay0 hover:text-blue",
                            )}
                            title={s.status !== "active" ? "Snapshot must be active to boot a VM" : "Boot a new VM from this snapshot"}
                          >
                            <Rocket size={13} />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete snapshot "${s.name}"? VMs already booted from it are unaffected.`)) deleteTazSnapshot(s.id); }}
                            disabled={s.status === "pending"}
                            className="p-1 text-overlay0 hover:text-red transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title={s.status === "pending" ? "Cannot delete a pending snapshot" : "Delete snapshot"}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {bootOpen && (
                      <tr className="border-t border-overlay0/10 bg-surface0/20">
                        <td colSpan={6} className="px-3 py-3">
                          <div className="flex items-end gap-2 flex-wrap">
                            <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
                              <label className="text-md text-overlay0">New VM name</label>
                              <input
                                type="text"
                                value={bootVmName}
                                onChange={(e) => setBootVmName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") submitBoot(s.id); if (e.key === "Escape") setBootFormFor(null); }}
                                spellCheck={false}
                                autoFocus
                                disabled={creating}
                                className="bg-background border border-surface0 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono focus:border-blue disabled:opacity-50"
                              />
                              {bootNameErr && <span className="text-xs text-red italic">{bootNameErr}</span>}
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-md text-overlay0">Size</label>
                              <Select value={bootVmSize} onChange={(e) => setBootVmSize(e.target.value)} disabled={creating} className="py-1.5 text-md font-sans">
                                {SIZES.map((sz) => <option key={sz} value={sz}>{sz}</option>)}
                              </Select>
                            </div>
                            <Button size="sm" variant="primary" onClick={() => submitBoot(s.id)} disabled={creating || bootNameErr !== null}>
                              {creating && submittingRef.current ? <Loader2 size={14} className="animate-spin mr-1" /> : <Rocket size={14} className="mr-1" />}
                              {creating && submittingRef.current ? "Booting…" : "Boot VM"}
                            </Button>
                            <Button size="sm" onClick={() => setBootFormFor(null)} disabled={creating && submittingRef.current}>
                              Cancel
                            </Button>
                            <p className="basis-full text-xs text-overlay0 italic">
                              Boots a new VM from snapshot <span className="font-mono">{s.name}</span>. SSH user matches the snapshot's source image. Firewall preset is not applied — the snapshot keeps its existing rules.
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
