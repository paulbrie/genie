"use client";

import { useEffect, useState } from "react";
import { useSubject } from "subjecto/react";
import { RefreshCw, Trash2 } from "lucide-react";
import { $doSnapshots, $doSnapshotsLoading } from "@/store/subjects";
import { deleteDoSnapshot, loadDoSnapshots } from "@/store/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function SnapshotsSubTab() {
  const [snapshots] = useSubject($doSnapshots);
  const [loading] = useSubject($doSnapshotsLoading);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  useEffect(() => {
    loadDoSnapshots();
  }, []);

  return (
    <div className="flex-1 overflow-auto px-4 py-3">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-base font-medium text-text">Snapshots</span>
        <Button size="sm" onClick={loadDoSnapshots} disabled={loading}>
          <RefreshCw size={14} className={cn("mr-1", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading && snapshots.length === 0 ? (
        <div className="text-md text-overlay0">Loading snapshots...</div>
      ) : snapshots.length === 0 ? (
        <div className="text-md text-overlay0">No snapshots found. Snapshots are created when you hibernate a VPS instance.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {snapshots.map((snap) => (
            <div key={snap.id} className="bg-background rounded-lg px-3 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-md font-medium text-text truncate">{snap.name}</span>
                  <span className="text-md text-overlay0 font-mono shrink-0">#{snap.id}</span>
                </div>
                <div className="flex items-center gap-4 mt-0.5 text-md text-overlay0">
                  {snap.createdAt && (
                    <span>Created: <span className="text-subtext0">{new Date(snap.createdAt).toLocaleString()}</span></span>
                  )}
                  {snap.sizeGb != null && (
                    <span>Size: <span className="text-subtext0">{snap.sizeGb.toFixed(2)} GB</span></span>
                  )}
                  {snap.minDiskSize != null && (
                    <span>Min disk: <span className="text-subtext0">{snap.minDiskSize} GB</span></span>
                  )}
                  {snap.regions.length > 0 && (
                    <span>Regions: <span className="text-subtext0">{snap.regions.join(", ")}</span></span>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                {confirmDelete === snap.id ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-md text-red">Delete?</span>
                    <Button size="sm" variant="danger" onClick={() => { deleteDoSnapshot(snap.id); setConfirmDelete(null); }}>Confirm</Button>
                    <Button size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(snap.id)}
                    className="p-1.5 text-overlay0 hover:text-red transition-colors rounded"
                    title="Delete snapshot"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
