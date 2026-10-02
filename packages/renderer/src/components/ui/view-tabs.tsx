import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ViewTabsProps<T extends string> {
  tabs: { key: T; label: ReactNode }[];
  activeTab: T;
  onTabChange: (tab: T) => void;
}

export function ViewTabs<T extends string>({ tabs, activeTab, onTabChange }: ViewTabsProps<T>) {
  return (
    <div className="flex gap-0 border-b border-surface0 shrink-0">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onTabChange(key)}
          className={cn(
            "px-3 py-2 text-md font-medium border-b-2 transition-colors cursor-pointer",
            "bg-transparent",
            activeTab === key
              ? "border-blue text-text"
              : "border-transparent text-overlay0 hover:text-subtext0"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
