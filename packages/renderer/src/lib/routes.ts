import type { AiSubTab, CloudSubTab, DropletsSubTab, NavKey } from "@/store/types";
export type ProjectTab = "settings" | "members";
export type AdminTab = "database" | "droplets" | "ai" | "backup" | "users" | "teams" | "orgs" | "communication" | "audit" | "prodlogs";
export type SettingsTab = "general" | "deploy" | "org";

// --- Nav-level role gate ---
//
// Mirrors the sidebar's `baseNavItems` filtering in sidebar-nav.tsx. Kept here
// so the URL router (app/[[...slug]]/page.tsx) and the sidebar agree on who
// gets to see what — otherwise typing /admin/users into the address bar lands
// a regular user on the admin shell with empty data, instead of bouncing them.
type NavRole = "user" | "tazcloud" | "admin" | "superadmin" | undefined | null;

const STANDARD_USER_NAVS = new Set<NavKey>(["projects", "tracker", "chat", "history", "settings", "agents"]);
const TAZCLOUD_EXTRA_NAVS = new Set<NavKey>(["recipes", "clouds"]);
const ADMIN_NAVS = new Set<NavKey>([
  "projects", "processes", "docker", "docs", "logs", "chat", "history", "tracker",
  "settings", "admin", "architecture", "topology", "users", "security", "help", "ssh",
  "agents",
]);

export function navAllowedForRole(nav: NavKey, role: NavRole): boolean {
  if (role === "superadmin") return true;
  if (role === "admin") return ADMIN_NAVS.has(nav);
  if (role === "tazcloud") return STANDARD_USER_NAVS.has(nav) || TAZCLOUD_EXTRA_NAVS.has(nav);
  // null/undefined/"user" → standard
  return STANDARD_USER_NAVS.has(nav);
}

/** Landing route the router should redirect to when a user hits a forbidden URL. */
export function defaultNavForRole(_role: NavRole): NavKey {
  return "projects";
}

// Bidirectional NavKey ↔ URL segment maps (all lowercase)
const NAV_TO_PATH: Record<NavKey, string> = {
  apps: "apps",
  projects: "projects",
  processes: "processes",

  docker: "docker",
  docs: "docs",
  logs: "logs",
  terminal: "terminal",
  chat: "chat",
  history: "history",
  tracker: "tracker",
  settings: "settings",
  admin: "admin",
  architecture: "architecture",
  topology: "topology",
  users: "users",
  security: "security",
  // tazcloud kept as a legacy alias for the standalone TazCloud admin panel.
  // The unified `clouds` route is preferred — see CloudsPanel — but the type
  // still allows tazcloud so `$activeNav` defaults survive without surgery.
  tazcloud: "tazcloud",
  clouds: "clouds",
  recipes: "recipes",
  help: "help",
  ssh: "ssh",
  agents: "agents",
};

const VALID_CLOUD_SUBTABS = new Set<CloudSubTab>(["do", "taz", "hetzner"]);

const PATH_TO_NAV: Record<string, NavKey> = Object.fromEntries(
  Object.entries(NAV_TO_PATH).map(([k, v]) => [v, k as NavKey])
) as Record<string, NavKey>;

const VALID_PROJECT_TABS = new Set<ProjectTab>([
  "settings",
  "members",
]);

const VALID_ADMIN_TABS = new Set<AdminTab>(["database", "droplets", "ai", "backup", "users", "teams", "orgs", "communication", "audit", "prodlogs"]);

const VALID_DROPLETS_SUBTABS = new Set<DropletsSubTab>([
  "snapshots",
  "templates",
  "configs",
  "sshkey",
]);

const VALID_AI_SUBTABS = new Set<AiSubTab>(["costs", "settings"]);
const VALID_SETTINGS_TABS = new Set<SettingsTab>(["general", "deploy", "org"]);

// --- URL builders ---

export function buildNavPath(nav: NavKey): string {
  if (nav === "admin") return "/admin/database";
  if (nav === "settings") return "/settings/general";
  if (nav === "clouds") return "/clouds/do";
  return `/${NAV_TO_PATH[nav]}`;
}

export function buildCloudPath(sub: CloudSubTab): string {
  return `/clouds/${sub}`;
}

export function buildSettingsPath(tab: SettingsTab, orgId?: string): string {
  if (tab === "org" && orgId) return `/settings/org/${orgId}`;
  return `/settings/${tab}`;
}

export function buildProjectPath(slug: string, tab?: ProjectTab): string {
  const t = tab || "members";
  return `/projects/${slug}/${t}`;
}

export function buildDocPath(folderPath: string[], fileName: string, fileId: string): string {
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const segments = [...folderPath.map(slugify), slugify(fileName), fileId];
  return `/docs/${segments.join("/")}`;
}

export function buildAdminPath(adminTab: AdminTab, subTab?: DropletsSubTab | AiSubTab): string {
  if (adminTab === "droplets") {
    const sub = subTab ? `/${subTab}` : "/snapshots";
    return `/admin/droplets${sub}`;
  }
  if (adminTab === "ai") {
    const sub = subTab ? `/${subTab}` : "/costs";
    return `/admin/ai${sub}`;
  }
  return `/admin/${adminTab}`;
}

// --- URL parser ---

export interface ParsedRoute {
  nav: NavKey;
  entitySlug?: string;
  tab?: ProjectTab;
  adminTab?: AdminTab;
  dropletsSubTab?: DropletsSubTab;
  aiSubTab?: AiSubTab;
  settingsTab?: SettingsTab;
  /** For settingsTab === "org": which org's settings to render. */
  orgId?: string;
  cloudSubTab?: CloudSubTab;
  docId?: string;
}

export function parseRoute(slugSegments: string[]): ParsedRoute | null {
  if (!slugSegments || slugSegments.length === 0) return null;

  const first = slugSegments[0].toLowerCase();
  // Legacy /monitor → unified clouds cards view.
  if (first === "monitor") {
    return { nav: "clouds", cloudSubTab: "do" };
  }
  const nav = PATH_TO_NAV[first];
  if (!nav) return null;

  // No entity slug
  if (slugSegments.length === 1) {
    return { nav };
  }

  const entitySlug = slugSegments[1];

  // Admin sub-routes: /admin/database, /admin/droplets/..., /admin/ai/...
  if (nav === "admin") {
    const seg1 = slugSegments[1]?.toLowerCase();
    if (seg1 && VALID_ADMIN_TABS.has(seg1 as AdminTab)) {
      const adminTab = seg1 as AdminTab;
      if (adminTab === "droplets" && slugSegments.length >= 3) {
        const seg2 = slugSegments[2]?.toLowerCase();
        if (VALID_DROPLETS_SUBTABS.has(seg2 as DropletsSubTab)) {
          return { nav, adminTab, dropletsSubTab: seg2 as DropletsSubTab };
        }
      }
      if (adminTab === "ai" && slugSegments.length >= 3) {
        const seg2 = slugSegments[2]?.toLowerCase();
        if (VALID_AI_SUBTABS.has(seg2 as AiSubTab)) {
          return { nav, adminTab, aiSubTab: seg2 as AiSubTab };
        }
      }
      return {
        nav,
        adminTab,
        dropletsSubTab: adminTab === "droplets" ? "snapshots" : undefined,
        aiSubTab: adminTab === "ai" ? "costs" : undefined,
      };
    }
    return { nav };
  }

  // Projects entity + optional tab (default to "members")
  if (nav === "projects") {
    const tab =
      slugSegments.length >= 3 && VALID_PROJECT_TABS.has(slugSegments[2] as ProjectTab)
        ? (slugSegments[2] as ProjectTab)
        : "members";
    return { nav, entitySlug, tab };
  }

  // Settings sub-routes: /settings/general, /settings/deploy, /settings/org/{orgId}
  if (nav === "settings") {
    const seg1 = slugSegments[1]?.toLowerCase();
    const settingsTab = seg1 && VALID_SETTINGS_TABS.has(seg1 as SettingsTab) ? (seg1 as SettingsTab) : "general";
    if (settingsTab === "org" && slugSegments.length >= 3) {
      return { nav, settingsTab, orgId: slugSegments[2] };
    }
    return { nav, settingsTab };
  }

  // Clouds sub-routes: /clouds/do, /clouds/taz
  if (nav === "clouds") {
    const seg1 = slugSegments[1]?.toLowerCase();
    const cloudSubTab = seg1 && VALID_CLOUD_SUBTABS.has(seg1 as CloudSubTab) ? (seg1 as CloudSubTab) : "do";
    return { nav, cloudSubTab };
  }

  // Docs sub-routes: /docs/[...folders]/filename/docId — last segment is the doc ID
  if (nav === "docs" && slugSegments.length >= 2) {
    const docId = slugSegments[slugSegments.length - 1];
    return { nav, docId };
  }

  // Other navs don't have sub-routes
  return { nav };
}
