"use client";

import { useDeepSubject } from "subjecto/react";
import { LayoutGrid, Activity, Container } from "lucide-react";
import { store, switchNav, type DockerInfo } from "@/store";
import { cn } from "@/lib/utils";

const navItems = [
  { key: "apps" as const, label: "Apps", icon: LayoutGrid },
  { key: "processes" as const, label: "Processes", icon: Activity },
  { key: "docker" as const, label: "Docker", icon: Container },
];

export function SidebarNav() {
  const activeNav = useDeepSubject(store, "activeNav") as
    | "apps"
    | "processes"
    | "docker";
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
