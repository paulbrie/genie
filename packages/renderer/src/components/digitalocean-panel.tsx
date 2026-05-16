"use client";

import { useEffect, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { Cloud, RefreshCw, Loader2, Settings as SettingsIcon, Pencil, Check, X, Moon, Sun, Plus } from "lucide-react";
import type { AdminDroplet } from "@/store/types";
import { $admin, $auth, $projects } from "@/store/subjects";
import { addSshTerminalTab, adminDropletExec, createAdminDroplet, loadAdminDropletStats, loadAdminDroplets, renameAdminDroplet, switchNav, wakeVps } from "@/store/actions";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ErrorMessage } from "@/components/ui/error-message";
import { DropletInstanceBar } from "@/components/droplet-instance-bar";
import { VpsFirewall } from "@/components/project-detail";
import { AdminRecipesPanel } from "@/components/admin-recipes-panel";
import { AdminSystemPanel } from "@/components/admin-system-panel";
import { AttachVmToProject } from "@/components/attach-vm-to-project";

// Confirmation type for the inline delete UI on each row.
type PendingDeleteId = number | null;

// Common DO option slugs. Static lists keep the form self-contained — the DO
// account is the source of truth at create-time and will reject anything invalid.
const REGIONS = ["nyc1", "nyc3", "sfo2", "sfo3", "ams3", "fra1", "lon1", "sgp1", "tor1", "blr1", "syd1"];
const SIZES = ["s-1vcpu-1gb", "s-1vcpu-2gb", "s-2vcpu-2gb", "s-2vcpu-4gb", "s-4vcpu-8gb"];
const IMAGES = ["ubuntu-22-04-x64", "ubuntu-24-04-x64", "debian-12-x64", "almalinux-9-x64"];

function defaultDropletName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
  const rand = Math.random().toString(36).slice(2, 5);
  return `do-${ts}-${rand}`;
}

/** Row shape for hibernated instances — flattened from project.vpsInstances[].hibernate. */
interface HibernatedRow {
  projectId: string;
  projectName: string;
  instanceId: string;
  label: string;
  snapshotId: number;
  snapshotName: string;
  region: string;
  size: string;
  hibernatedAt: string;
}

export function DigitalOceanPanel() {
  const admin = useDeepSubjectAll($admin);
  const [auth] = useSubject($auth);
  const [projects] = useSubject($projects);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteId>(null);
  const [manageExpanded, setManageExpanded] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deployOpen, setDeployOpen] = useState(false);
  const [dropletName, setDropletName] = useState(defaultDropletName());
  const [dropletRegion, setDropletRegion] = useState("nyc1");
  const [dropletSize, setDropletSize] = useState("s-1vcpu-1gb");
  const [dropletImage, setDropletImage] = useState("ubuntu-22-04-x64");

  // Walk projects to find DO instances that have been hibernated. These don't
  // appear in DO's droplet list (no live droplet) — only in our DB as a snapshot ref.
  const hibernated: HibernatedRow[] = projects.flatMap((p) =>
    p.vpsInstances
      .filter((i) => i.hibernate && !i.tazcloud)
      .map((i) => ({
        projectId: p.id,
        projectName: p.name,
        instanceId: i.id,
        label: i.label,
        snapshotId: i.hibernate!.snapshotId,
        snapshotName: i.hibernate!.snapshotName,
        region: i.hibernate!.region,
        size: i.hibernate!.size,
        hibernatedAt: i.hibernate!.hibernatedAt,
      })),
  );

  const isSuperAdmin = auth.user?.role === "superadmin";

  useEffect(() => {
    if (!isSuperAdmin) return;
    loadAdminDroplets();
    loadAdminDropletStats();
    // Poll stats so the CPU/MEM/DISK gauges stay live.
    const id = setInterval(loadAdminDropletStats, 10_000);
    return () => clearInterval(id);
  }, [isSuperAdmin]);

  // Auto-close the deploy form when create succeeds (creating: true → false, no error).
  const prevCreatingRef = useRef(false);
  useEffect(() => {
    if (prevCreatingRef.current && !admin.dropletsCreating && !admin.dropletsCreateError) {
      setDeployOpen(false);
    }
    prevCreatingRef.current = admin.dropletsCreating;
  }, [admin.dropletsCreating, admin.dropletsCreateError]);

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center text-overlay0">
        <div className="text-center">
          <p className="text-base">DigitalOcean admin is restricted to super admin users.</p>
          <button onClick={() => switchNav("projects")} className="mt-3 text-blue hover:underline text-md">
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  const { droplets, dropletsLoading: loading, dropletsError: error, dropletsCreating: creating, dropletsCreateError: createError, dropletStats } = admin;

  function toggleDeploy() {
    if (deployOpen) {
      setDeployOpen(false);
    } else {
      setDropletName(defaultDropletName());
      setDeployOpen(true);
    }
  }

  function submitCreate() {
    const trimmed = dropletName.trim();
    if (!trimmed) return;
    createAdminDroplet({ name: trimmed, region: dropletRegion, size: dropletSize, image: dropletImage });
  }

  function confirmDelete(id: number) {
    setPendingDelete(id);
  }

  function startRename(d: AdminDroplet) {
    setRenamingId(d.id);
    setRenameDraft(d.name);
  }

  function commitRename() {
    if (renamingId === null) return;
    const trimmed = renameDraft.trim();
    if (trimmed) renameAdminDroplet(renamingId, trimmed);
    setRenamingId(null);
    setRenameDraft("");
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Cloud size={16} className="text-blue" />
        <span className="text-md font-medium text-subtext0">Droplets</span>
        <span className="text-md text-overlay0 font-mono">{droplets.length}</span>
        {hibernated.length > 0 && (
          <span className="text-md text-blue font-mono">+ {hibernated.length} hibernated</span>
        )}
        <div className="flex-1" />
        <Button size="sm" variant={deployOpen ? "active" : "primary"} onClick={toggleDeploy}>
          <Plus size={14} className="mr-1" />
          {deployOpen ? "Cancel" : "Deploy Droplet"}
        </Button>
        <Button size="sm" onClick={() => { loadAdminDroplets(); loadAdminDropletStats(); }} disabled={loading}>
          <RefreshCw size={14} className={cn("mr-1", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {deployOpen && (
        <div className="mb-3 px-3 py-3 border border-overlay0/20 rounded-lg bg-mantle/60 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <label className="text-md text-overlay0">Name</label>
            <input
              type="text"
              value={dropletName}
              onChange={(e) => setDropletName(e.target.value)}
              spellCheck={false}
              disabled={creating}
              className="bg-background border border-surface0 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono focus:border-blue disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-md text-overlay0">Region</label>
            <Select value={dropletRegion} onChange={(e) => setDropletRegion(e.target.value)} disabled={creating} className="py-1.5 text-md font-sans">
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-md text-overlay0">Size</label>
            <Select value={dropletSize} onChange={(e) => setDropletSize(e.target.value)} disabled={creating} className="py-1.5 text-md font-sans">
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-md text-overlay0">Image</label>
            <Select value={dropletImage} onChange={(e) => setDropletImage(e.target.value)} disabled={creating} className="py-1.5 text-md font-sans">
              {IMAGES.map((img) => <option key={img} value={img}>{img}</option>)}
            </Select>
          </div>
          <Button variant="primary" size="sm" onClick={submitCreate} disabled={creating || !dropletName.trim()}>
            {creating ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
            {creating ? "Creating…" : "Create"}
          </Button>
          <p className="basis-full text-xs text-overlay0 italic">
            Creates a bare DigitalOcean droplet via the API — no Genie setup.sh run. The genie SSH key is uploaded and authorized.
          </p>
        </div>
      )}

      {createError && (
        <div className="mb-3">
          <ErrorMessage variant="banner">Create failed: {createError}</ErrorMessage>
        </div>
      )}

      {error && (
        <div className="mb-3">
          <ErrorMessage variant="banner">{error}</ErrorMessage>
        </div>
      )}

      <div>
        {loading && droplets.length === 0 ? (
          <div className="flex items-center justify-center text-overlay0 py-12">
            <Loader2 size={16} className="animate-spin mr-2" />
            Loading…
          </div>
        ) : droplets.length === 0 && !error ? (
          <div className="text-center text-overlay0 py-12">
            <p className="text-base">No DigitalOcean droplets.</p>
            <p className="text-md mt-1">Deploy a project with the DigitalOcean provider to see it here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {droplets.map((d) => {
              const isActive = d.status === "active";
              const isPending = pendingDelete === d.id;
              const isRenaming = renamingId === d.id;
              const stats = dropletStats[d.id];
              return (
                <div key={d.id} className="bg-mantle rounded-lg px-3 py-2 border border-overlay0/10">
                  {isRenaming ? (
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-md text-overlay0">Rename:</span>
                      <input
                        autoFocus
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          else if (e.key === "Escape") { setRenamingId(null); setRenameDraft(""); }
                        }}
                        className="bg-background border border-blue/40 rounded px-1.5 py-0.5 text-md font-mono outline-none"
                      />
                      <button onClick={commitRename} className="text-green hover:text-green/70 p-0.5" title="Save">
                        <Check size={12} />
                      </button>
                      <button onClick={() => { setRenamingId(null); setRenameDraft(""); }} className="text-overlay0 hover:text-text p-0.5" title="Cancel">
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <DropletInstanceBar
                      name={d.name}
                      status={d.status}
                      ip={d.ip}
                      region={d.region}
                      sizeSlug={d.size}
                      provider="digitalocean"
                      stats={stats ?? null}
                      statsLoading={isActive && !stats}
                      onRefresh={() => { loadAdminDroplets(); loadAdminDropletStats(); }}
                      onSshTerminal={isActive && d.ip ? () => addSshTerminalTab({ host: d.ip!, username: "genie", port: 22 }, `SSH genie@${d.name}`) : undefined}
                      onDelete={() => confirmDelete(d.id)}
                    />
                  )}
                  <div className="flex items-center gap-3 mt-1 text-md text-overlay0">
                    <span>
                      Project:{" "}
                      {d.projectName ? (
                        <span className="text-blue">{d.projectName}</span>
                      ) : (
                        <AttachVmToProject provider="digitalocean" vmId={d.id} />
                      )}
                    </span>
                    <span>ID: <span className="text-subtext0 font-mono">{String(d.id).slice(0, 8)}</span></span>
                    <div className="flex-1" />
                    {!isRenaming && (
                      <button
                        onClick={() => startRename(d)}
                        className="text-overlay0 hover:text-blue transition-colors p-1"
                        title="Rename droplet"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => setManageExpanded(manageExpanded === d.id ? null : d.id)}
                      disabled={!isActive}
                      className={cn(
                        "p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                        manageExpanded === d.id ? "text-blue" : "text-overlay0 hover:text-blue",
                      )}
                      title="Manage firewall & add-ons"
                    >
                      <SettingsIcon size={13} />
                    </button>
                  </div>
                  {isPending && (
                    <div className="flex items-center gap-1.5 mt-2 px-2 py-1.5 rounded bg-red/10">
                      <span className="text-md text-red">Delete this droplet?</span>
                      <Button size="sm" variant="danger" onClick={() => { wsDeleteDroplet(d.id); setPendingDelete(null); }}>
                        Confirm
                      </Button>
                      <Button size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
                    </div>
                  )}
                  {manageExpanded === d.id && isActive && (
                    <div className="mt-3 border-t border-overlay0/10 pt-3">
                      <ManageDropletInline droplet={d} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {hibernated.length > 0 && (
          <div className="mt-6">
            <h2 className="text-md font-medium text-subtext0 mb-2 flex items-center gap-1.5">
              <Moon size={12} className="text-blue" />
              Hibernated
              <span className="text-overlay0 font-mono">{hibernated.length}</span>
            </h2>
            <div className="overflow-x-auto rounded-lg border border-overlay0/20 bg-mantle">
              <table className="w-full text-md font-mono">
                <thead className="bg-surface0 text-overlay1 text-left">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Label</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Region</th>
                    <th className="px-3 py-2 font-semibold">Size</th>
                    <th className="px-3 py-2 font-semibold">Snapshot</th>
                    <th className="px-3 py-2 font-semibold">Project</th>
                    <th className="px-3 py-2 font-semibold">Hibernated</th>
                    <th className="px-3 py-2 font-semibold w-0">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {hibernated.map((h) => (
                    <tr key={h.instanceId} className="border-t border-overlay0/10 hover:bg-surface0/40">
                      <td className="px-3 py-2 text-text">{h.label}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-md bg-blue/15 text-blue">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue" />
                          hibernated
                        </span>
                      </td>
                      <td className="px-3 py-2 text-overlay1">{h.region || "—"}</td>
                      <td className="px-3 py-2 text-overlay1">{h.size || "—"}</td>
                      <td className="px-3 py-2 text-overlay1 select-text">{h.snapshotName}</td>
                      <td className="px-3 py-2 text-blue">{h.projectName}</td>
                      <td className="px-3 py-2 text-overlay0">
                        {new Date(h.hibernatedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => wakeVps(h.projectId, h.instanceId)}
                          className="inline-flex items-center gap-1 text-md text-blue hover:underline"
                          title="Restore: create a new droplet from this snapshot"
                        >
                          <Sun size={12} /> Wake
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ManageDropletInline({ droplet }: { droplet: AdminDroplet }) {
  const exec = (command: string, onChunk?: (chunk: string) => void) =>
    adminDropletExec(droplet.id, command, onChunk);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-overlay0">
        Operations run via SSH as <span className="font-mono text-overlay1">genie@{droplet.ip}</span>
      </p>
      <AdminSystemPanel exec={exec} />
      <AdminRecipesPanel exec={exec} />
      <VpsFirewall exec={exec} />
    </div>
  );
}

// Local helper to dispatch droplet deletion via the existing admin:droplets:delete handler.
function wsDeleteDroplet(dropletId: number) {
  // Use the renderer's wsSend directly to avoid coupling to a new store action.
  import("@/lib/ws").then(({ wsSend }) => wsSend("admin:droplets:delete", { dropletId }));
}
