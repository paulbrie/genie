import type { NavKey, DropletsSubTab, AiSubTab } from "@/store";

export type ProjectTab = "files" | "commands" | "cloud" | "deploy-history" | "settings";
export type AdminTab = "database" | "droplets" | "ai" | "backup" | "users" | "teams" | "audit" | "prodlogs";
export type SettingsTab = "general" | "deploy";

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
  tracker: "tracker",
  settings: "settings",
  admin: "admin",
  architecture: "architecture",
  users: "users",
  security: "security",
};

const PATH_TO_NAV: Record<string, NavKey> = Object.fromEntries(
  Object.entries(NAV_TO_PATH).map(([k, v]) => [v, k as NavKey])
) as Record<string, NavKey>;

const VALID_PROJECT_TABS = new Set<ProjectTab>([
  "files",
  "commands",
  "cloud",
  "deploy-history",
  "settings",
]);

const VALID_ADMIN_TABS = new Set<AdminTab>(["database", "droplets", "ai", "backup", "users", "teams", "audit", "prodlogs"]);

const VALID_DROPLETS_SUBTABS = new Set<DropletsSubTab>([
  "instances",
  "snapshots",
  "templates",
  "configs",
  "sshkey",
]);

const VALID_AI_SUBTABS = new Set<AiSubTab>(["costs", "settings"]);
const VALID_SETTINGS_TABS = new Set<SettingsTab>(["general", "deploy"]);

// --- URL builders ---

export function buildNavPath(nav: NavKey): string {
  if (nav === "admin") return "/admin/database";
  if (nav === "settings") return "/settings/general";
  return `/${NAV_TO_PATH[nav]}`;
}

export function buildSettingsPath(tab: SettingsTab): string {
  return `/settings/${tab}`;
}

export function buildAppPath(slug: string): string {
  return `/apps/${slug}`;
}

export function buildProjectPath(slug: string, tab?: ProjectTab): string {
  const t = tab || "files";
  return `/projects/${slug}/${t}`;
}

export function buildDocPath(folderPath: string[], fileName: string, fileId: string): string {
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const segments = [...folderPath.map(slugify), slugify(fileName), fileId];
  return `/docs/${segments.join("/")}`;
}

export function buildAdminPath(adminTab: AdminTab, subTab?: DropletsSubTab | AiSubTab): string {
  if (adminTab === "droplets") {
    const sub = subTab ? `/${subTab}` : "/instances";
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
  docId?: string;
}

export function parseRoute(slugSegments: string[]): ParsedRoute | null {
  if (!slugSegments || slugSegments.length === 0) return null;

  const first = slugSegments[0].toLowerCase();
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
        dropletsSubTab: adminTab === "droplets" ? "instances" : undefined,
        aiSubTab: adminTab === "ai" ? "costs" : undefined,
      };
    }
    return { nav };
  }

  // Apps entity
  if (nav === "apps") {
    return { nav, entitySlug };
  }

  // Projects entity + optional tab (default to "files")
  if (nav === "projects") {
    const tab =
      slugSegments.length >= 3 && VALID_PROJECT_TABS.has(slugSegments[2] as ProjectTab)
        ? (slugSegments[2] as ProjectTab)
        : "files";
    return { nav, entitySlug, tab };
  }

  // Settings sub-routes: /settings/general, /settings/deploy
  if (nav === "settings") {
    const seg1 = slugSegments[1]?.toLowerCase();
    const settingsTab = seg1 && VALID_SETTINGS_TABS.has(seg1 as SettingsTab) ? (seg1 as SettingsTab) : "general";
    return { nav, settingsTab };
  }

  // Docs sub-routes: /docs/[...folders]/filename/docId — last segment is the doc ID
  if (nav === "docs" && slugSegments.length >= 2) {
    const docId = slugSegments[slugSegments.length - 1];
    return { nav, docId };
  }

  // Other navs don't have sub-routes
  return { nav };
}
