"use client";

import { useSubject } from "subjecto/react";
import { LayoutGrid, FolderKanban, Activity, Container, FileText, ScrollText, MessageCircle, SquareKanban, Settings, Database, Network, Users, Shield, Cloud, ChefHat, HelpCircle } from "lucide-react";
import type { DockerInfo, NavKey } from "@/store/types";
import { $activeNav, $auth, $docker, $presenceSessions } from "@/store/subjects";
import { cn } from "@/lib/utils";
import { useNavigate } from "@/lib/navigation";

const baseNavItems: { key: NavKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "processes", label: "Processes", icon: Activity },

  { key: "docker", label: "Docker", icon: Container },
  { key: "docs", label: "Docs", icon: FileText },
  { key: "logs", label: "Logs", icon: ScrollText },
  { key: "chat", label: "Chat", icon: MessageCircle },
  { key: "tracker", label: "Tracker", icon: SquareKanban },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "admin", label: "Admin", icon: Database },
  { key: "architecture", label: "Architecture", icon: Network },
  { key: "users", label: "Connected Users", icon: Users },
  { key: "security", label: "Security", icon: Shield },
  { key: "help", label: "Help", icon: HelpCircle },
];

export function SidebarNav() {
  const [activeNav] = useSubject($activeNav);
  const [auth] = useSubject($auth);
  const [docker] = useSubject($docker);
  const [sessions] = useSubject($presenceSessions);
  const { navigateToNav } = useNavigate();
  const uniqueUserCount = new Set(sessions.map(s => s.id)).size;
  const isSuperAdmin = auth.user?.role === "superadmin";

  const items = isSuperAdmin
    ? [
        ...baseNavItems,
        { key: "recipes" as NavKey, label: "Recipes", icon: ChefHat },
        { key: "clouds" as NavKey, label: "Clouds", icon: Cloud },
      ]
    : baseNavItems;

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => navigateToNav(key)}
          className={cn(
            "flex items-center gap-2 px-2.5 py-1.5 rounded-md border-none",
            "text-lg font-medium cursor-pointer transition-colors duration-150",
            key === activeNav
              ? "bg-background text-text"
              : "bg-transparent text-overlay0 hover:bg-background hover:text-subtext0"
          )}
        >
          <Icon
            size={16}
            className={cn(
              "shrink-0",
              key === activeNav ? "text-text" : "text-overlay0"
            )}
          />
          {label}
          {key === "docker" && docker.daemonRunning && (
            <span className="w-2 h-2 rounded-full bg-green shrink-0" />
          )}
          {key === "users" && uniqueUserCount > 0 && (
            <span className="ml-auto text-[11px] text-overlay0 bg-surface0 px-1.5 py-0.5 rounded-full tabular-nums">{uniqueUserCount}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
