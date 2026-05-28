import { batch } from "subjecto";
import { wsSend } from "@/lib/ws";
import { $orgSettings } from "../subjects/org-settings";

/** Fetch orgs the active user can manage (owner|admin role).
 *  Empty result → the Org tab stays hidden in the Settings panel. */
export function loadMyOrgs(): void {
  batch(() => {
    const v = $orgSettings.getValue();
    v.mineLoading = true;
    v.mineError = null;
  });
  // eslint-disable-next-line no-console
  console.log("[org-settings] sending org:list-mine");
  wsSend("org:list-mine", {});
}

/** Fetch one org's detail (members + teams + credential status). Called when
 *  the URL changes to /settings/org/{orgId}. */
export function loadOrgDetail(orgId: string): void {
  batch(() => {
    const v = $orgSettings.getValue();
    v.selectedOrgId = orgId;
    v.current.loading = true;
    v.current.error = null;
    // Reset stale data while the new org loads.
    v.current.org = null;
    v.current.members = [];
    v.current.teams = [];
    v.vms.list = [];
    v.vms.raw = [];
  });
  wsSend("org:get", { orgId });
}

export function setActiveOrgSubTab(tab: "cloud" | "members" | "teams"): void {
  $orgSettings.getValue().activeSubTab = tab;
}

// ── Cloud credentials ────────────────────────────────────────────────────────

export function setOrgTazCredentials(orgId: string, token?: string, sshPrivateKey?: string): void {
  batch(() => {
    const v = $orgSettings.getValue();
    v.credentialsSaving = true;
    v.credentialsError = null;
  });
  wsSend("org:cloud:taz:credentials:set", { orgId, token, sshPrivateKey });
}

export function clearOrgTazCredentials(orgId: string): void {
  batch(() => {
    const v = $orgSettings.getValue();
    v.credentialsSaving = true;
    v.credentialsError = null;
  });
  wsSend("org:cloud:taz:credentials:clear", { orgId });
}

// ── Org-pool VMs ─────────────────────────────────────────────────────────────

export function loadOrgVms(orgId: string): void {
  batch(() => {
    const v = $orgSettings.getValue();
    v.vms.loading = true;
    v.vms.error = null;
  });
  wsSend("org:cloud:taz:vms:list", { orgId });
}

export function createOrgVm(orgId: string, opts: { name: string; image?: string; size?: string; snapshot_id?: string; project_id?: string }): void {
  batch(() => {
    const v = $orgSettings.getValue();
    v.vms.creating = true;
    v.vms.createError = null;
  });
  wsSend("org:cloud:taz:vms:create", { orgId, ...opts });
}

export function deleteOrgVm(orgId: string, vmId: string): void {
  $orgSettings.getValue().vms.deleting[vmId] = true;
  wsSend("org:cloud:taz:vms:delete", { orgId, vmId });
}
