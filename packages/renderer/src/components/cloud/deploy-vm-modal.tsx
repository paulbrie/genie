"use client";

import { useMemo, useState } from "react";
import { useSubject } from "subjecto/react";
import { X, Server, Loader2 } from "lucide-react";
import { $projects } from "@/store/subjects";
import { createAdminDroplet, createAdminHetznerServer, deployToProvider } from "@/store/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  HETZNER_LOCATIONS, DEFAULT_HETZNER_LOCATION,
  hetznerTypesForLocation, defaultHetznerTypeForLocation, HETZNER_IMAGES,
} from "@/lib/hetzner-options";

type CloudProvider = "digitalocean" | "hetzner";

// DigitalOcean static option lists (the account validates at create-time).
const DO_REGIONS = ["nyc1", "nyc3", "sfo2", "sfo3", "ams3", "fra1", "lon1", "sgp1", "tor1", "blr1", "syd1"];
const DO_SIZES = ["s-1vcpu-1gb", "s-1vcpu-2gb", "s-2vcpu-2gb", "s-2vcpu-4gb", "s-4vcpu-8gb"];
const DO_IMAGES = ["ubuntu-22-04-x64", "ubuntu-24-04-x64", "debian-12-x64", "almalinux-9-x64"];

function defaultName(provider: CloudProvider): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
  const rand = Math.random().toString(36).slice(2, 5);
  return `${provider === "hetzner" ? "hz" : "do"}-${ts}-${rand}`;
}

interface DeployVmModalProps {
  open: boolean;
  onClose: () => void;
  provider: CloudProvider;
  /** Privileged callers may also deploy a bare VM with no project. */
  canBare: boolean;
}

/** Deploy a new cloud VM. Attaching to a project provisions a ready-to-use VM
 *  (full deploy flow) and links it; only privileged users may deploy a bare VM
 *  with no project. */
export function DeployVmModal({ open, onClose, provider, canBare }: DeployVmModalProps) {
  const [projects] = useSubject($projects);
  // "" = no project (bare). Default to the first project, or bare if allowed.
  const [projectId, setProjectId] = useState<string>(() => projects[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [location, setLocation] = useState(provider === "hetzner" ? DEFAULT_HETZNER_LOCATION : "nyc1");
  const [size, setSize] = useState(
    provider === "hetzner" ? defaultHetznerTypeForLocation(DEFAULT_HETZNER_LOCATION) : "s-1vcpu-1gb",
  );
  const [image, setImage] = useState(provider === "hetzner" ? "ubuntu-22.04" : "ubuntu-22-04-x64");
  const [submitting, setSubmitting] = useState(false);

  const isHetzner = provider === "hetzner";
  const typeOptions = useMemo(
    () => (isHetzner
      ? hetznerTypesForLocation(location)
      : DO_SIZES.map((s) => ({ name: s, label: s }))),
    [isHetzner, location],
  );
  const locationOptions = isHetzner ? HETZNER_LOCATIONS : DO_REGIONS.map((r) => ({ name: r, label: r }));
  const imageOptions = isHetzner ? HETZNER_IMAGES : DO_IMAGES;

  function changeLocation(loc: string) {
    setLocation(loc);
    if (isHetzner) {
      const valid = hetznerTypesForLocation(loc);
      if (!valid.some((t) => t.name === size)) setSize(defaultHetznerTypeForLocation(loc));
    }
  }

  const canSubmit = (projectId !== "" || canBare) && !submitting;

  function handleDeploy() {
    if (!canSubmit) return;
    setSubmitting(true);
    if (projectId) {
      // Full provision + attach to the chosen project. DO provisions from its
      // base image, so only region/size are meaningful there.
      deployToProvider(
        projectId,
        provider,
        label.trim() || undefined,
        undefined,
        isHetzner ? { region: location, size, image } : { region: location, size },
      );
    } else {
      const name = label.trim() || defaultName(provider);
      if (isHetzner) createAdminHetznerServer({ name, region: location, size, image });
      else createAdminDroplet({ name, region: location, size, image });
    }
    onClose();
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[200]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] max-w-[92vw] bg-mantle border border-surface0 rounded-lg shadow-xl z-[201] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0">
          <Server size={14} className="text-blue" />
          <span className="text-text font-medium text-md">Deploy {isHetzner ? "Hetzner Server" : "Droplet"}</span>
          <div className="flex-1" />
          <button onClick={onClose} className="text-overlay1 hover:text-text transition-colors"><X size={14} /></button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-col gap-1">
            <label className="text-md text-overlay1">Project</label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="py-1.5 text-md font-sans">
              {canBare && <option value="">— No project (bare server) —</option>}
              {projects.length === 0 && !canBare && <option value="" disabled>No projects available</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.teamName ? ` (${p.teamName})` : ""}</option>
              ))}
            </Select>
            <p className="text-xs text-overlay0">
              {projectId
                ? "Provisions a ready-to-use VM and attaches it to this project (takes a few minutes)."
                : "Creates a bare VM with no Genie setup. You can link it to a project later."}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-md text-overlay1">{projectId ? "Label" : "Name"}</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={projectId ? "production" : "auto-generated"}
              spellCheck={false}
              className="bg-background border border-surface0 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono focus:border-blue"
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-md text-overlay1">{isHetzner ? "Location" : "Region"}</label>
              <Select value={location} onChange={(e) => changeLocation(e.target.value)} className="py-1.5 text-md font-sans">
                {locationOptions.map((l) => <option key={l.name} value={l.name}>{l.label}</option>)}
              </Select>
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-md text-overlay1">{isHetzner ? "Server Type" : "Size"}</label>
              <Select value={size} onChange={(e) => setSize(e.target.value)} className="py-1.5 text-md font-sans">
                {typeOptions.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
              </Select>
            </div>
          </div>

          {/* DO provisions from its base snapshot, so image only applies to bare DO + all Hetzner. */}
          {(isHetzner || !projectId) && (
            <div className="flex flex-col gap-1">
              <label className="text-md text-overlay1">Image</label>
              <Select value={image} onChange={(e) => setImage(e.target.value)} className="py-1.5 text-md font-sans">
                {imageOptions.map((img) => <option key={img} value={img}>{img}</option>)}
              </Select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface0">
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={handleDeploy} disabled={!canSubmit}>
            {submitting ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
            Deploy
          </Button>
        </div>
      </div>
    </>
  );
}
