"use client";

import { useEffect, useState } from "react";
import { useSubject } from "subjecto/react";
import { Cloud, RefreshCw, Trash2, Loader2, Terminal } from "lucide-react";
import {
  $admin,
  $auth,
  loadAdminTazVms,
  deleteAdminTazVm,
  addSshTerminalTab,
  switchNav,
} from "@/store";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";

export function TazCloudPanel() {
  const admin = useDeepSubjectAll($admin);
  const [auth] = useSubject($auth);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const isSuperAdmin = auth.user?.role === "superadmin";

  useEffect(() => {
    if (isSuperAdmin) loadAdminTazVms();
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center text-overlay0">
        <div className="text-center">
          <p className="text-base">TazCloud admin is restricted to super admin users.</p>
          <button onClick={() => switchNav("apps")} className="mt-3 text-blue hover:underline text-md">
            Back to Apps
          </button>
        </div>
      </div>
    );
  }

  const { vms, loading, error } = admin.tazcloud;

  function confirmDelete(vmId: string) {
    setPendingDelete(vmId);
  }

  function openSshTerminal(vm: { id: string; name: string; ipv6: string; status: string }) {
    if (!vm.ipv6 || vm.status !== "ACTIVE") return;
    addSshTerminalTab(
      {
        host: vm.ipv6,
        port: 22,
        username: "genie",  // Genie-provisioned VMs use genie; image-default also OK if you edit per-tab
        privateKeyPath: "~/.genie/ssh/tazcloud_ed25519",
      },
      `SSH ${vm.name}`,
    );
  }

  function executeDelete(vmId: string) {
    setDeleting((prev) => new Set(prev).add(vmId));
    deleteAdminTazVm(vmId);
    setPendingDelete(null);
    // The server pushes admin:tazcloud:deleted which removes the row; clear the
    // local "deleting" flag after a short delay in case the response is fast.
    setTimeout(() => {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(vmId);
        return next;
      });
    }, 4000);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-surface0">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-overlay0/20 bg-mantle">
        <Cloud size={18} className="text-blue" />
        <h1 className="text-lg font-semibold text-text">TazCloud VMs</h1>
        <span className="text-md text-overlay0 font-mono">{vms.length}</span>
        <div className="flex-1" />
        <Button size="sm" onClick={loadAdminTazVms} disabled={loading}>
          <RefreshCw size={14} className={cn("mr-1", loading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {error && (
        <div className="px-4 py-2">
          <ErrorMessage variant="banner">{error}</ErrorMessage>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {loading && vms.length === 0 ? (
          <div className="flex items-center justify-center text-overlay0 py-12">
            <Loader2 size={16} className="animate-spin mr-2" />
            Loading…
          </div>
        ) : vms.length === 0 && !error ? (
          <div className="text-center text-overlay0 py-12">
            <p className="text-base">No TazCloud VMs.</p>
            <p className="text-md mt-1">Deploy a project with the TazCloud provider to see it here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-overlay0/20 bg-mantle">
            <table className="w-full text-md font-mono">
              <thead className="bg-surface0 text-overlay1 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Image</th>
                  <th className="px-3 py-2 font-semibold">Size</th>
                  <th className="px-3 py-2 font-semibold">IPv6</th>
                  <th className="px-3 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">ID</th>
                  <th className="px-3 py-2 font-semibold w-0">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vms.map((vm) => {
                  const isPending = pendingDelete === vm.id;
                  const isDeleting = deleting.has(vm.id);
                  return (
                    <tr key={vm.id} className="border-t border-overlay0/10 hover:bg-surface0/40">
                      <td className="px-3 py-2 text-text">{vm.name}</td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-md",
                          vm.status === "ACTIVE" ? "bg-green/15 text-green" : "bg-overlay0/15 text-overlay0",
                        )}>
                          <span className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            vm.status === "ACTIVE" ? "bg-green" : "bg-overlay0",
                          )} />
                          {vm.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-overlay1">{vm.image || "—"}</td>
                      <td className="px-3 py-2 text-overlay1">{vm.size || "—"}</td>
                      <td className="px-3 py-2 text-overlay1 select-text">{vm.ipv6}</td>
                      <td className="px-3 py-2 text-overlay1">
                        {vm.projectName ? (
                          <span className="text-blue">{vm.projectName}</span>
                        ) : (
                          <span className="text-overlay0 italic">unlinked</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-overlay0 select-text">{vm.id.slice(0, 8)}…</td>
                      <td className="px-3 py-2">
                        {isDeleting ? (
                          <span className="inline-flex items-center gap-1 text-overlay0">
                            <Loader2 size={12} className="animate-spin" />
                            Deleting…
                          </span>
                        ) : isPending ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => executeDelete(vm.id)}
                              className="px-2 py-0.5 rounded bg-red/20 text-red hover:bg-red/30 transition-colors text-md"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setPendingDelete(null)}
                              className="px-2 py-0.5 rounded bg-surface0 text-overlay1 hover:bg-surface1 transition-colors text-md"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openSshTerminal(vm)}
                              disabled={vm.status !== "ACTIVE" || !vm.ipv6}
                              className="text-overlay0 hover:text-blue transition-colors p-1 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={vm.status === "ACTIVE" ? `SSH to ${vm.ipv6}` : "VM is not active"}
                            >
                              <Terminal size={14} />
                            </button>
                            <button
                              onClick={() => confirmDelete(vm.id)}
                              className="text-overlay0 hover:text-red transition-colors p-1"
                              title="Delete VM"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
