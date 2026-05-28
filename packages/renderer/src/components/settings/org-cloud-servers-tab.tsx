"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2, Plus, RefreshCw, Trash2, Lock, ExternalLink, Server, KeyRound } from "lucide-react";
import { $orgSettings } from "@/store/subjects/org-settings";
import {
  clearOrgTazCredentials,
  createOrgVm,
  deleteOrgVm,
  loadOrgVms,
  setOrgTazCredentials,
} from "@/store/actions/org-settings";
import { useDeepSubjectAll } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { ServerDeleteConfirm } from "@/components/ui/server-delete-confirm";
import { cn } from "@/lib/utils";

/** Org-pool servers: list / create / delete using the org's stored TazCloud
 *  token + SSH key. Mirrors /clouds/taz at a smaller scale (no ingress UI,
 *  no snapshots, no project linkage — the org pool feeds project deploys
 *  via the existing "Attach VM" flow once added). */
export function OrgCloudServersTab({ orgId }: { orgId: string }) {
  const state = useDeepSubjectAll($orgSettings);
  const credsReady = state.current.credentials["tazcloud-token"] && state.current.credentials["tazcloud-ssh-key"];

  if (!credsReady) {
    return <CredentialsForm orgId={orgId} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <ToolbarRow orgId={orgId} />
      <VmList orgId={orgId} />
    </div>
  );
}

// ─── Credentials form (shown when token + key not yet set) ────────────────────

function CredentialsForm({ orgId }: { orgId: string }) {
  const state = useDeepSubjectAll($orgSettings);
  const [token, setToken] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const hasToken = state.current.credentials["tazcloud-token"];
  const hasKey = state.current.credentials["tazcloud-ssh-key"];
  const partial = hasToken !== hasKey;

  const canSave = (!hasToken && token.trim().length > 0) || (!hasKey && sshKey.trim().length > 0);

  function save() {
    setOrgTazCredentials(
      orgId,
      !hasToken ? token.trim() : undefined,
      !hasKey ? sshKey.trim() : undefined,
    );
    setToken("");
    setSshKey("");
  }

  return (
    <div className="flex flex-col gap-3 max-w-xl">
      <div className="rounded-lg bg-mantle border border-surface0 p-4 flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <KeyRound size={16} className="text-mauve shrink-0 mt-0.5" />
          <div>
            <h3 className="text-text font-medium text-md">TazCloud credentials for this org</h3>
            <p className="text-xs text-overlay0 mt-0.5">
              Stored encrypted on the manager (AES-256-GCM, manager-secret keyed).
              These let org admins provision servers without sharing a personal API token.
            </p>
          </div>
        </div>

        {!hasToken ? (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-overlay1">TazCloud API token</label>
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your TazCloud API token"
                className="w-full bg-background border border-surface1 rounded-md pl-3 pr-9 py-1.5 text-md font-mono outline-none focus:border-mauve"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-overlay0 hover:text-text"
                title={showToken ? "Hide" : "Show"}
              >
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-green">✓ Token stored</div>
        )}

        {!hasKey ? (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-overlay1">SSH private key (Genie deploy key on Taz VMs)</label>
            <div className="relative">
              <textarea
                value={showKey ? sshKey : sshKey ? "••••••••" : ""}
                onChange={(e) => { setSshKey(e.target.value); if (!showKey) setShowKey(true); }}
                onFocus={() => { if (!showKey && sshKey) setShowKey(true); }}
                placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"}
                spellCheck={false}
                rows={5}
                className="w-full bg-background border border-surface1 rounded-md px-3 py-2 text-md font-mono outline-none focus:border-mauve resize-y"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-2 text-overlay0 hover:text-text"
                title={showKey ? "Hide" : "Show"}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-overlay0">
              Same key whose public half is registered on the Taz bastion as a Genie deploy key.
              Used for SSH-via-WireGuard from the manager.
            </p>
          </div>
        ) : (
          <div className="text-xs text-green">✓ SSH key stored</div>
        )}

        {state.credentialsError && (
          <div className="text-xs text-red bg-red/10 border border-red/30 rounded px-2 py-1.5">
            {state.credentialsError}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={save} disabled={!canSave || state.credentialsSaving}>
            {state.credentialsSaving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
            {partial ? "Save missing credential" : "Save credentials"}
          </Button>
          {(hasToken || hasKey) && (
            <Button size="sm" variant="danger" onClick={() => clearOrgTazCredentials(orgId)} disabled={state.credentialsSaving}>
              Clear all
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Toolbar (reload + create) ────────────────────────────────────────────────

function ToolbarRow({ orgId }: { orgId: string }) {
  const state = useDeepSubjectAll($orgSettings);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [size, setSize] = useState("small");

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    createOrgVm(orgId, { name: trimmed, size, image: "ubuntu-24" });
    setName("");
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button size="sm" onClick={() => loadOrgVms(orgId)} disabled={state.vms.loading}>
        {state.vms.loading ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <RefreshCw size={13} className="mr-1.5" />}
        Refresh
      </Button>
      <div className="flex-1" />
      <Button size="sm" variant="primary" onClick={() => setCreating((v) => !v)}>
        <Plus size={13} className="mr-1" /> New server
      </Button>

      {creating && (
        <div className="w-full mt-2 p-3 bg-mantle border border-surface0 rounded-lg flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1 min-w-[180px] flex-1">
            <label className="text-xs text-overlay1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="org-pool-vm-1"
              className="bg-background border border-surface1 rounded px-2 py-1 text-md font-mono outline-none focus:border-mauve"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-overlay1">Size</label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="bg-background border border-surface1 rounded px-2 py-1 text-md outline-none focus:border-mauve"
            >
              <option value="small">small</option>
              <option value="medium">medium</option>
              <option value="large">large</option>
              <option value="xlarge">xlarge</option>
            </select>
          </div>
          <Button size="sm" variant="primary" onClick={submit} disabled={!name.trim() || state.vms.creating}>
            {state.vms.creating ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
            Provision
          </Button>
          <Button size="sm" onClick={() => { setCreating(false); setName(""); }}>Cancel</Button>
          {state.vms.createError && (
            <div className="w-full text-xs text-red bg-red/10 border border-red/30 rounded px-2 py-1.5">
              {state.vms.createError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── VM list ──────────────────────────────────────────────────────────────────

function VmList({ orgId }: { orgId: string }) {
  const state = useDeepSubjectAll($orgSettings);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const vms = state.vms.list;

  if (state.vms.loading && vms.length === 0) {
    return (
      <div className="flex items-center gap-2 text-overlay0 text-md py-6">
        <Loader2 size={14} className="animate-spin" /> Loading servers…
      </div>
    );
  }

  if (state.vms.error) {
    return (
      <div className="text-md text-red bg-red/10 border border-red/30 rounded-md px-3 py-2">
        {state.vms.error}
      </div>
    );
  }

  if (vms.length === 0) {
    return (
      <div className="text-md text-overlay0 border border-dashed border-surface0 rounded-lg px-4 py-8 text-center">
        No servers in this org's pool yet. Click <span className="text-text">New server</span> to provision the first one.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
      {vms.map((vm) => {
        const isDeleting = state.vms.deleting[vm.id];
        const cardClass = cn(
          "bg-mantle rounded-lg px-3 py-2.5 border transition-colors flex flex-col gap-2",
          vm.locked ? "border-red/40" : "border-overlay0/10",
        );
        return (
          <div key={vm.id} className={cardClass}>
            <div className="flex items-start gap-2">
              <Server size={14} className="text-mauve shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-text truncate" title={vm.name}>{vm.name}</span>
                  {vm.locked && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red/15 text-red border border-red/30">
                      <Lock size={10} /> locked
                    </span>
                  )}
                </div>
                <div className="text-xs text-overlay1 font-mono truncate">{vm.ipv6 || "—"}</div>
              </div>
              <span className={cn(
                "shrink-0 px-1.5 py-0.5 rounded text-xs font-medium",
                vm.status === "ACTIVE" ? "bg-green/15 text-green border border-green/30" : "bg-overlay0/15 text-overlay1 border border-overlay0/20",
              )}>
                {vm.status.toLowerCase()}
              </span>
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
              {vm.image && (<><span className="text-overlay0">Image</span><span className="text-subtext0 truncate">{vm.image}</span></>)}
              {vm.size && (<><span className="text-overlay0">Size</span><span className="text-subtext0 truncate">{vm.size}</span></>)}
              {vm.ingress?.domain && (<><span className="text-overlay0">Domain</span><a className="text-blue truncate inline-flex items-center gap-1" href={vm.ingress.url} target="_blank" rel="noreferrer">{vm.ingress.domain} <ExternalLink size={10}/></a></>)}
            </div>
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <button
                onClick={() => setPendingDelete(vm.id)}
                disabled={isDeleting}
                className="px-1.5 py-1 text-red hover:bg-red/10 rounded transition-colors disabled:opacity-50"
                title="Delete this server"
              >
                {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            </div>
            {pendingDelete === vm.id && (
              <ServerDeleteConfirm
                name={vm.name}
                locked={vm.locked}
                canDeleteLocked={true} // org admins can delete locked servers in their pool
                onConfirm={() => { deleteOrgVm(orgId, vm.id); setPendingDelete(null); }}
                onCancel={() => setPendingDelete(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
