"use client";

import { useSubject } from "subjecto/react";
import { LayoutGrid, FolderKanban, Activity, Container, FileText, ScrollText, MessageCircle, SquareKanban, Settings, Database, Network } from "lucide-react";
import { $activeNav, $docker, type DockerInfo, type NavKey } from "@/store";
import { cn } from "@/lib/utils";
import { useNavigate } from "@/lib/navigation";

const navItems = [
  { key: "apps" as const, label: "Apps", icon: LayoutGrid },
  { key: "projects" as const, label: "Projects", icon: FolderKanban },
  { key: "processes" as const, label: "Processes", icon: Activity },

  { key: "docker" as const, label: "Docker", icon: Container },
  { key: "docs" as const, label: "Docs", icon: FileText },
  { key: "logs" as const, label: "Logs", icon: ScrollText },
  { key: "chat" as const, label: "Chat", icon: MessageCircle },
  { key: "tracker" as const, label: "Tracker", icon: SquareKanban },
  { key: "settings" as const, label: "Settings", icon: Settings },
  { key: "admin" as const, label: "Admin", icon: Database },
  { key: "architecture" as const, label: "Architecture", icon: Network },
];

export function SidebarNav() {
  const [activeNav] = useSubject($activeNav);
  const [docker] = useSubject($docker);
  const { navigateToNav } = useNavigate();

  return (
    <nav className="flex flex-col gap-0.5">
      {navItems.map(({ key, label, icon: Icon }) => (
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
        </button>
      ))}
    </nav>
  );
}
