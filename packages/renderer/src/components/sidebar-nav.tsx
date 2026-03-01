"use client";

import { useDeepSubject } from "subjecto/react";
import { LayoutGrid, Activity, Container, FileText, ScrollText, TerminalSquare } from "lucide-react";
import { store, switchNav, type DockerInfo, type NavKey } from "@/store";
import { cn } from "@/lib/utils";

const navItems = [
  { key: "apps" as const, label: "Apps", icon: LayoutGrid },
  { key: "processes" as const, label: "Processes", icon: Activity },
  { key: "docker" as const, label: "Docker", icon: Container },
  { key: "docs" as const, label: "Docs", icon: FileText },
  { key: "logs" as const, label: "Logs", icon: ScrollText },
  { key: "terminal" as const, label: "Terminal", icon: TerminalSquare },
];

export function SidebarNav() {
  const activeNav = useDeepSubject(store, "activeNav") as NavKey;
  const docker = useDeepSubject(store, "docker") as DockerInfo;

  return (
    <nav className="flex flex-col gap-0.5">
      {navItems.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => switchNav(key)}
          className={cn(
            "flex items-center gap-2 px-2.5 py-1.5 rounded-md border-none",
            "text-base font-medium cursor-pointer transition-colors duration-150",
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
