"use client";

import { useSubject } from "subjecto/react";
import { Cloud, ChefHat, ScrollText, Clock, Users, Boxes } from "lucide-react";
import type { NavKey } from "@/store/types";
import { $activeNav, $auth, $presenceSessions } from "@/store/subjects";
import { cn } from "@/lib/utils";
import { useNavigate } from "@/lib/navigation";

type BarNavItem = { key: NavKey; label: string; icon: typeof ChefHat };

/** Moved out of the left sidebar for admin + superadmin. */
const ADMIN_BAR_SHARED_ITEMS: BarNavItem[] = [
  { key: "users", label: "Connected Users", icon: Users },
  { key: "logs", label: "Logs", icon: ScrollText },
  { key: "history", label: "History", icon: Clock },
  { key: "topology", label: "Topology", icon: Boxes },
];

/** Extra top-bar items for superadmin only (not in ADMIN_NAVS). */
const SUPERADMIN_BAR_EXTRA_ITEMS: BarNavItem[] = [
  { key: "recipes", label: "Recipes", icon: ChefHat },
  { key: "clouds", label: "Clouds", icon: Cloud },
];

export function adminBarItemsForRole(
  role: string | undefined,
): BarNavItem[] {
  if (role === "superadmin") {
    return [...SUPERADMIN_BAR_EXTRA_ITEMS, ...ADMIN_BAR_SHARED_ITEMS];
  }
  if (role === "admin") return ADMIN_BAR_SHARED_ITEMS;
  return [];
}

export function adminBarNavKeysForRole(role: string | undefined): Set<NavKey> {
  return new Set(adminBarItemsForRole(role).map((item) => item.key));
}

export function SuperadminTopBar() {
  const [activeNav] = useSubject($activeNav);
  const [auth] = useSubject($auth);
  const [sessions] = useSubject($presenceSessions);
  const { navigateToNav } = useNavigate();
  const uniqueUserCount = new Set(sessions.map((s) => s.id)).size;

  const role = auth.user?.role;
  const items = adminBarItemsForRole(role);
  if (items.length === 0) return null;

  const label = role === "superadmin" ? "Superadmin" : "Admin";
  const labelClass =
    role === "superadmin" ? "text-mauve" : "text-blue";

  return (
    <div
      className="flex items-center gap-1 px-3 py-1 border-b border-surface0 bg-black shrink-0"
      role="navigation"
      aria-label={label}
    >
      <span
        className={cn(
          "text-xs font-semibold uppercase tracking-wide mr-2 shrink-0",
          labelClass,
        )}
      >
        {label}
      </span>
      {items.map(({ key, label: itemLabel, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => navigateToNav(key)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md border-none text-sm font-medium cursor-pointer transition-colors duration-150",
            key === activeNav
              ? "bg-surface0 text-text"
              : "bg-transparent text-overlay0 hover:bg-surface0/60 hover:text-subtext0",
          )}
        >
          <Icon size={14} className="shrink-0" />
          {itemLabel}
          {key === "users" && uniqueUserCount > 0 && (
            <span className="text-[11px] text-subtext0 bg-surface1 px-1.5 py-0.5 rounded-full tabular-nums">
              {uniqueUserCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
