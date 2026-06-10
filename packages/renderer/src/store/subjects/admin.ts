import { DeepSubject } from "subjecto";
import type { AdminState, SecurityState } from "../types/admin";

export const $admin = new DeepSubject<AdminState>({
  activeTab: "database", dropletsSubTab: "instances",
  tables: [], selectedTable: null, columns: [], primaryKey: null,
  rows: [], totalCount: 0, page: 1, pageSize: 50, orderBy: null, orderDir: "asc",
  loading: false, drawerOpen: false, drawerMode: "edit", drawerRow: null, drawerError: null,
  sqlQuery: "", sqlResult: null, sqlError: null, sqlLoading: false, sqlOpen: false,
  droplets: [], dropletsLoading: false, dropletsError: null, dropletsCreating: false, dropletsCreateError: null, dropletStats: {}, dropletResize: {}, dropletReboot: {},
  dropletDomainBusy: {}, dropletDomainError: null, dropletDomainProgress: {},
  hetzner: { servers: [], loading: false, error: null, creating: false, createError: null, stats: {}, reboot: {} },
  tazcloud: { vms: [], loading: false, error: null, creating: false, createError: null, projects: [], projectsLoading: false, projectsError: null, projectCreating: false, projectError: null, capabilityImages: [], capabilitiesLoading: false, capabilitiesError: null, vmStats: {}, vmStatsErrors: {}, vmStatsLoading: false, snapshots: [], snapshotsLoading: false, snapshotsError: null, snapshotCreating: {}, snapshotCreateError: null, ingressBusy: {}, ingressError: null },
  baseImage: { configs: {}, templates: {}, deletedTemplates: {}, buildingName: null, progress: [], error: null, failedDropletId: null, failedDropletIp: null, history: [] },
  sshKey: { exists: false, publicKey: null, fingerprint: null, createdAt: null, history: [], loading: false, regenerating: false },
  drizzlePush: { running: false, output: "", open: false },
  backups: { files: [], loading: false, creating: false },
  users: { list: [], loading: false, paged: { list: [], total: 0, page: 1, pageSize: 25, search: "", loading: false } },
  teams: { list: [], members: [], loading: false },
  orgs: { list: [], members: {}, loading: false, selectedOrgId: null },
  projectMembers: {},
  projectTeams: {},
  communication: { logs: [], loading: false, sending: false, error: null, lastResult: null },
  audit: { logs: [], loading: false, filterUserId: null, filterAction: null },
  analytics: { summary: null, days: 30, loading: false, filterUserId: null, filterProjectId: null },
  prodlogs: { deployments: [], logs: [], selectedDeploymentId: null, logType: "deploy", loading: false, logsLoading: false },
  ai: { subTab: "costs", costs: [], loading: false, error: null, settings: { defaultModel: "claude-sonnet", maxToolRounds: 10 }, settingsLoading: false },
});

export const $security = new DeepSubject<SecurityState>({ target: "", activeScanId: null, scans: [] });
