"use client";

import { useSubject } from "subjecto/react";
import type { ProjectDef } from "@/store/types";
import { $projects, $selectedProjectId } from "@/store/subjects";
import { cn } from "@/lib/utils";
import { useNavigate } from "@/lib/navigation";

export function ProjectsList() {
  const [projects] = useSubject($projects);
  const [selectedProjectId] = useSubject($selectedProjectId);
  const { navigateToProject } = useNavigate();

  return (
    <>
      <div className="flex justify-between items-center">
        <h2 className="text-md font-semibold uppercase tracking-wide text-subtext0">
          Projects
        </h2>
      </div>
      {projects.length === 0 ? (
        <div className="text-center text-overlay0 text-base py-5">
          No projects configured
        </div>
      ) : (
        <nav className="flex-1 overflow-y-auto flex flex-col gap-0.5 scrollbar-thin">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => navigateToProject(project.id)}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors duration-150",
                "border-none bg-transparent text-left w-full",
                project.id === selectedProjectId
                  ? "bg-background"
                  : "hover:bg-background"
              )}
            >
              <span className="font-medium text-lg whitespace-nowrap overflow-hidden text-ellipsis">
                {project.name}
              </span>
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
