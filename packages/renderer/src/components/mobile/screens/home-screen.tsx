"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_USER, type MockProject, type MockServer } from "@/components/mobile/mock-data";
import { useMobileProjects } from "@/components/mobile/use-mobile-data";

const HEALTH_DOT: Record<MockServer["health"], string> = {
  healthy: "bg-green",
  degraded: "bg-yellow",
  down: "bg-red",
};

const HEALTH_TEXT: Record<MockServer["health"], string> = {
  healthy: "text-green",
  degraded: "text-yellow",
  down: "text-red",
};

export function HomeScreen({ onOpenServer }: { onOpenServer: (server: MockServer) => void }) {
  const projects = useMobileProjects();
  const servers = projects.flatMap((p) => p.instances);
  const counts = {
    healthy: servers.filter((s) => s.health === "healthy").length,
    degraded: servers.filter((s) => s.health === "degraded").length,
    down: servers.filter((s) => s.health === "down").length,
  };

  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-6">
      {/* Greeting */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Good morning, Paul</h1>
          <p className="text-sm text-overlay0 mt-0.5">
            {projects.length} projects · {servers.length} servers
          </p>
        </div>
        <div className="w-9 h-9 rounded-full bg-mauve text-background grid place-items-center text-md font-semibold">
          {MOCK_USER.initials}
        </div>
      </div>

      {/* Health summary */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label="Healthy" value={counts.healthy} className="text-green" />
        <SummaryCard label="Degraded" value={counts.degraded} className="text-yellow" />
        <SummaryCard label="Down" value={counts.down} className="text-red" />
      </div>

      {/* Projects with their instances */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-wide text-overlay0 px-0.5">
          Projects · {projects.length}
        </h2>
        <div className="flex flex-col gap-2">
          {projects.length === 0 ? (
            <div className="bg-mantle rounded-xl px-3.5 py-6 text-center text-sm text-overlay0">
              No projects yet.
            </div>
          ) : (
            projects.map((p) => (
              <ProjectGroup key={p.name} project={p} onOpenServer={onOpenServer} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="bg-mantle rounded-xl px-3 py-2.5">
      <p className="text-xs text-overlay0">{label}</p>
      <p className={cn("text-3xl font-semibold mt-0.5", className)}>{value}</p>
    </div>
  );
}

function ProjectGroup({
  project,
  onOpenServer,
}: {
  project: MockProject;
  onOpenServer: (server: MockServer) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-mantle rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3.5 py-3 active:bg-surface0/40 transition-colors"
      >
        <span className={cn("w-2 h-2 rounded-full shrink-0", HEALTH_DOT[project.health])} />
        <div className="min-w-0 flex-1 text-left">
          <p className="text-md font-semibold text-text truncate">{project.name}</p>
          <p className="text-xs text-overlay0 truncate">
            {project.instances.length} {project.instances.length === 1 ? "instance" : "instances"}
            {project.region ? ` · ${project.region}` : ""}
          </p>
        </div>
        <HealthSummary instances={project.instances} />
        <ChevronDown
          size={16}
          className={cn("text-overlay0 shrink-0 transition-transform", !open && "-rotate-90")}
        />
      </button>

      {open && (
        <div className="border-t border-surface0/60 divide-y divide-surface0/40">
          {project.instances.map((s) => (
            <InstanceRow key={s.id} server={s} onOpen={() => onOpenServer(s)} />
          ))}
        </div>
      )}
    </div>
  );
}

function InstanceRow({ server: s, onOpen }: { server: MockServer; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-3 px-3.5 py-2.5 pl-5 text-left active:bg-surface0/40 transition-colors"
    >
      <Server size={14} className="text-overlay0 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-md text-text truncate">{s.label}</p>
        <p className="text-xs text-overlay0 truncate font-mono">
          {s.host} · {s.provider}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={cn("text-sm font-mono tabular-nums", HEALTH_TEXT[s.health])}>
          {s.health === "down" ? "offline" : `${s.cpu}%`}
        </p>
        <p className="text-2xs text-overlay0">{s.uptime}</p>
      </div>
      <ChevronRight size={15} className="text-overlay0 shrink-0" />
    </button>
  );
}

/** Compact rollup: a pill per non-healthy state, or "All ok" when the whole
 *  project is healthy. Keeps the collapsed header glanceable. */
function HealthSummary({ instances }: { instances: MockServer[] }) {
  const down = instances.filter((i) => i.health === "down").length;
  const degraded = instances.filter((i) => i.health === "degraded").length;
  if (!down && !degraded) {
    return <span className="text-2xs font-medium text-green px-2 py-0.5 rounded-full bg-green/10">All ok</span>;
  }
  return (
    <div className="flex items-center gap-1 shrink-0">
      {down > 0 && (
        <span className="text-2xs font-semibold text-red px-2 py-0.5 rounded-full bg-red/15">{down} down</span>
      )}
      {degraded > 0 && (
        <span className="text-2xs font-semibold text-yellow px-2 py-0.5 rounded-full bg-yellow/15">
          {degraded} warn
        </span>
      )}
    </div>
  );
}
