"use client";

import { useSubject } from "subjecto/react";
import { $projects, showAddProjectForm as openAddProjectForm, type ProjectDef } from "@/store";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/view-header";
import { useNavigate } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function ProjectsGrid() {
  const [projects] = useSubject($projects);
  const { navigateToProject } = useNavigate();

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      <ViewHeader
        title="Projects"
        actions={
          <Button size="sm" variant="primary" onClick={() => openAddProjectForm()}>
            + Add Project
          </Button>
        }
      />

      {projects.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-overlay0 text-base">
          No projects configured
          <Button variant="primary" onClick={() => openAddProjectForm()}>+ Add Project</Button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pt-4 scrollbar-thin">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => navigateToProject(project.id)}
                className={cn(
                  "flex flex-col gap-2 p-4 rounded-lg text-left transition-colors cursor-pointer",
                  "bg-mantle border border-surface0 hover:border-blue/50 hover:bg-surface0/50"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-base font-semibold text-text truncate">
                    {project.name}
                  </span>
                </div>

                <span className="text-md text-overlay0 font-mono truncate">
                  {project.vpsInstances?.length ? `${project.vpsInstances.length} instance(s)` : "No VPS"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
