import type { AdminTazVm } from "./admin";

export type OrgManagerRole = "owner" | "admin";

export interface ManageableOrg {
  id: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
  role?: OrgManagerRole | null;
}

export interface OrgCredentialStatus {
  "tazcloud-token": boolean;
  "tazcloud-ssh-key": boolean;
}

export interface OrgMember {
  id: string;
  orgId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string | null;
}

export interface OrgTeam {
  id: string;
  name: string;
  orgId: string | null;
  createdAt: string;
}

export interface OrgTeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: string;
  joinedAt: string;
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string | null;
}

export interface OrgTeamInvite {
  id: string;
  orgId: string;
  teamId: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  url: string;
}

/** Flattened team row for the project Settings team picker — comes back as
 *  part of org:list-mine so a non-admin org-admin can assign a project to one
 *  of their orgs' teams without us needing admin-only `admin:teams:list`. */
export interface ManageableTeam {
  id: string;
  name: string;
  orgId: string;
  orgName: string;
}

export interface OrgSettingsState {
  /** Orgs the active user is owner|admin of. Empty array → hide the Org tab. */
  mine: ManageableOrg[];
  /** Teams in those orgs — flat list. Populated by the same org:list-mine call. */
  myTeams: ManageableTeam[];
  mineLoading: boolean;
  mineError: string | null;
  /** True once the first org:list-mine response (success or error) has arrived.
   *  Used to distinguish "fetched and genuinely empty" from "not fetched yet"
   *  so the Settings empty-state doesn't flash "no organizations" pre-load. */
  mineFetched: boolean;

  /** URL-driven org id; null until /settings/org/{orgId} is opened. */
  selectedOrgId: string | null;
  /** Which sub-tab inside the org settings panel is active. */
  activeSubTab: "cloud" | "members" | "teams";

  /** Detail of the selected org. Reset when selectedOrgId changes. */
  current: {
    org: { id: string; name: string } | null;
    members: OrgMember[];
    teams: OrgTeam[];
    teamMembers: OrgTeamMember[];
    invites: OrgTeamInvite[];
    credentials: OrgCredentialStatus;
    loading: boolean;
    error: string | null;
  };

  teamsBusy: boolean;
  membersBusy: boolean;
  inviteAcceptError: string | null;
  inviteAccepted: boolean;

  /** Cloud servers in this org's pool — fetched via the org's own Taz token. */
  vms: {
    list: AdminTazVm[];   // reuse the same shape the admin panel uses
    raw: unknown[];        // server-returned raw VMs (for ad-hoc fields)
    loading: boolean;
    error: string | null;
    creating: boolean;
    createError: string | null;
    /** Per-vmId "deleting" flags so we can disable the row while in-flight. */
    deleting: Record<string, boolean>;
  };

  /** Form state for the "set credentials" panel. */
  credentialsSaving: boolean;
  credentialsError: string | null;

  /** Ephemeral SSH key generation for the credentials form. */
  keyGen: {
    generating: boolean;
    error: string | null;
    privateKey: string | null;
    publicKey: string | null;
    fingerprint: string | null;
  };
}

export const INITIAL_ORG_SETTINGS_STATE: OrgSettingsState = {
  mine: [],
  myTeams: [],
  mineLoading: false,
  mineError: null,
  mineFetched: false,
  selectedOrgId: null,
  activeSubTab: "cloud",
  current: {
    org: null,
    members: [],
    teams: [],
    teamMembers: [],
    invites: [],
    credentials: { "tazcloud-token": false, "tazcloud-ssh-key": false },
    loading: false,
    error: null,
  },
  teamsBusy: false,
  membersBusy: false,
  inviteAcceptError: null,
  inviteAccepted: false,
  vms: { list: [], raw: [], loading: false, error: null, creating: false, createError: null, deleting: {} },
  credentialsSaving: false,
  credentialsError: null,
  keyGen: { generating: false, error: null, privateKey: null, publicKey: null, fingerprint: null },
};
