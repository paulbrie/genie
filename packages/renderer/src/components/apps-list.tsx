"use client";

import { useDeepSubject } from "subjecto/react";
import { store, selectApp, showAddForm, type AppDef } from "@/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AppsList() {
  const apps = useDeepSubject(store, "apps") as AppDef[];
  const selectedAppId = useDeepSubject(
    store,
    "selectedAppId"
  ) as string | null;

  return (
    <>
      <div className="flex justify-between items-center">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtext0">
          Apps
        </h2>
        <Button size="sm" onClick={() => showAddForm()}>
          + Add
        </Button>
      </div>
      {apps.length === 0 ? (
        <div className="text-center text-overlay0 text-base py-5">
          No apps configured
        </div>
      ) : (
        <nav className="flex-1 overflow-y-auto flex flex-col gap-0.5 scrollbar-thin">
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => selectApp(app.id)}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors duration-150",
                "border-none bg-transparent text-left w-full",
                app.id === selectedAppId
                  ? "bg-background"
                  : "hover:bg-background"
              )}
            >
              <StatusDot status={app.status} />
              <span className="font-medium text-base whitespace-nowrap overflow-hidden text-ellipsis">
                {app.name}
              </span>
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

function StatusDot({ status }: { status: AppDef["status"] }) {
  return (
    <span
      className={cn(
        "w-2 h-2 rounded-full shrink-0",
        status === "running" && "bg-green shadow-[0_0_4px_var(--color-green)]",
        status === "stopped" && "bg-overlay0",
        status === "crashed" && "bg-red shadow-[0_0_4px_var(--color-red)]"
      )}
    />
  );
}
