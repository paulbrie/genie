import { batch } from "subjecto";
import { $orgSettings } from "../subjects/org-settings";
import { loadOrgDetail, loadOrgVms, loadMyOrgs } from "../actions/org-settings";
import type { AdminTazVm } from "../types/admin";
import type { HandlerMap } from "./types";

/** Server-returned TazVm row → renderer's AdminTazVm shape. Mirrors the
 *  admin:tazcloud:list handler so the existing VM-row components Just Work. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAdminTazVm(vm: any): AdminTazVm {
  return {
    id: vm.id,
    name: vm.name,
    status: vm.status,
    ipv6: vm.ipv6 || vm.ssh_host || "",
    isPrivateHost: typeof vm.ssh_host === "string" && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(vm.ssh_host),
    image: vm.image,
    size: vm.size,
    tazProjectId: vm.project_id ?? null,
    projectId: null,        // org-pool VMs aren't bound to a Genie project (yet).
    projectName: null,
    locked: vm.locked === true,
    ingress: vm.ingress ? {
      domain: vm.ingress.domain,
      url: vm.ingress.url,
      status: vm.ingress.status,
      ip: vm.ingress.ip,
      dnsAction: vm.ingress.dns_action ?? vm.ingress.dnsAction,
    } : null,
  };
}

export const handlers: HandlerMap = {
  "org:list-mine": (payload) => {
    // eslint-disable-next-line no-console
    console.log("[org-settings] received org:list-mine →", payload?.orgs?.length, "org(s)", payload?.teams?.length, "team(s)");
    batch(() => {
      const v = $orgSettings.getValue();
      v.mine = payload.orgs || [];
      v.myTeams = payload.teams || [];
      v.mineLoading = false;
      v.mineError = null;
      v.mineFetched = true;
    });
  },

  "org:get": (payload) => {
    batch(() => {
      const v = $orgSettings.getValue();
      v.current.loading = false;
      v.current.error = null;
      v.current.org = payload.org;
      v.current.members = payload.members || [];
      v.current.teams = payload.teams || [];
      v.current.teamMembers = payload.teamMembers || [];
      v.current.invites = payload.invites || [];
      v.current.credentials = payload.credentials || { "tazcloud-token": false, "tazcloud-ssh-key": false };
      v.teamsBusy = false;
      v.membersBusy = false;
    });
    // Auto-fetch the VM list when credentials are present, so the Cloud tab
    // doesn't show an empty list while the user wonders if it's still loading.
    if (payload.credentials?.["tazcloud-token"] && payload.org?.id) {
      loadOrgVms(payload.org.id);
    }
  },

  "org:error": (payload) => {
    batch(() => {
      const v = $orgSettings.getValue();
      const message = payload.message || "Unknown error";
      // Errors are scoped — list-mine errors vs current-org errors vs cred errors.
      // Server only includes orgId when the error is about the current org.
      if (payload.orgId && v.selectedOrgId === payload.orgId) {
        v.current.error = message;
        v.current.loading = false;
      } else if (!v.mine || v.mineLoading) {
        v.mineError = message;
        v.mineLoading = false;
        v.mineFetched = true;
      } else {
        // Most likely a credentials/VM op error — surface where the user is looking.
        v.credentialsError = message;
        v.credentialsSaving = false;
        v.teamsBusy = false;
        v.membersBusy = false;
        v.vms.createError = message;
        v.vms.creating = false;
        if (v.keyGen.generating) {
          v.keyGen.generating = false;
          v.keyGen.error = message;
        }
      }
    });
  },

  "org:ssh-key:generated": (payload) => {
    batch(() => {
      const v = $orgSettings.getValue();
      v.keyGen.generating = false;
      v.keyGen.error = null;
      if (v.selectedOrgId !== payload.orgId) return;
      v.keyGen.privateKey = payload.privateKey;
      v.keyGen.publicKey = payload.publicKey;
      v.keyGen.fingerprint = payload.fingerprint ?? null;
    });
  },

  "org:cloud:taz:credentials:status": (payload) => {
    batch(() => {
      const v = $orgSettings.getValue();
      v.credentialsSaving = false;
      v.credentialsError = null;
      if (v.selectedOrgId === payload.orgId) {
        v.current.credentials = payload.credentials;
      }
    });
    // After credentials change, re-fetch VMs (token might be new or just cleared).
    if (payload.credentials?.["tazcloud-token"]) {
      loadOrgVms(payload.orgId);
    } else {
      $orgSettings.getValue().vms.list = [];
      $orgSettings.getValue().vms.raw = [];
    }
  },

  "org:cloud:taz:vms:list": (payload) => {
    batch(() => {
      const v = $orgSettings.getValue();
      if (v.selectedOrgId !== payload.orgId) return;
      v.vms.loading = false;
      v.vms.error = payload.error || null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      v.vms.list = (payload.vms || []).map((vm: any) => toAdminTazVm(vm));
      v.vms.raw = payload.vms || [];
    });
  },

  "org:cloud:taz:vms:created": (payload) => {
    batch(() => {
      const v = $orgSettings.getValue();
      v.vms.creating = false;
      v.vms.createError = null;
    });
    loadOrgVms(payload.orgId);
  },

  "org:cloud:taz:vms:create:error": (payload) => {
    batch(() => {
      const v = $orgSettings.getValue();
      v.vms.creating = false;
      v.vms.createError = payload.message || "Failed to create VM";
    });
  },

  "org:cloud:taz:vms:deleted": (payload) => {
    batch(() => {
      const v = $orgSettings.getValue();
      delete v.vms.deleting[payload.vmId];
      v.vms.list = v.vms.list.filter((x) => x.id !== payload.vmId);
    });
  },

  // Server sends this dedicated error type (rather than a generic org:error)
  // so the per-row deleting flag can be cleared — otherwise the row's spinner
  // would hang forever after a failed delete.
  "org:cloud:taz:vms:delete:error": (payload) => {
    batch(() => {
      const v = $orgSettings.getValue();
      delete v.vms.deleting[payload.vmId];
      v.vms.error = payload.message || "Failed to delete VM";
    });
  },

  "org:teams:created": (payload) => {
    batch(() => { $orgSettings.getValue().teamsBusy = false; });
    loadOrgDetail(payload.orgId);
    loadMyOrgs();
  },

  "org:teams:updated": (payload) => {
    batch(() => { $orgSettings.getValue().teamsBusy = false; });
    loadOrgDetail(payload.orgId);
    loadMyOrgs();
  },

  "org:teams:deleted": (payload) => {
    batch(() => { $orgSettings.getValue().teamsBusy = false; });
    loadOrgDetail(payload.orgId);
    loadMyOrgs();
  },

  "org:teams:member-removed": (payload) => {
    batch(() => { $orgSettings.getValue().teamsBusy = false; });
    loadOrgDetail(payload.orgId);
  },

  "org:invite:created": (payload) => {
    batch(() => { $orgSettings.getValue().teamsBusy = false; });
    loadOrgDetail(payload.orgId);
  },

  "org:invite:revoked": (payload) => {
    batch(() => { $orgSettings.getValue().teamsBusy = false; });
    loadOrgDetail(payload.orgId);
  },

  "org:invite:accepted": (payload) => {
    batch(() => {
      const v = $orgSettings.getValue();
      v.inviteAcceptError = null;
      v.inviteAccepted = true;
    });
    loadMyOrgs();
    if (payload.orgId) loadOrgDetail(payload.orgId);
  },

  "org:invite:accept:error": (payload) => {
    $orgSettings.getValue().inviteAcceptError = payload.message || "Failed to accept invite";
  },

  "org:members:removed": (payload) => {
    batch(() => { $orgSettings.getValue().membersBusy = false; });
    loadOrgDetail(payload.orgId);
  },

  "org:members:role-updated": (payload) => {
    batch(() => { $orgSettings.getValue().membersBusy = false; });
    loadOrgDetail(payload.orgId);
  },
};
