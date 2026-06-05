"use client";

import { useSubject, useDeepSubject } from "subjecto/react";
import { Users } from "lucide-react";
import { $auth, $projects } from "@/store/subjects";
import { $orgSettings } from "@/store/subjects/org-settings";
import { showAddProjectForm as openAddProjectForm } from "@/store/actions";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { useNavigate } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function ProjectsGrid() {
  const [projects] = useSubject($projects);
  const [auth] = useSubject($auth);
  const [orgMine] = useDeepSubject($orgSettings, "mine");
  const { navigateToProject } = useNavigate();

  // Creating a project is owner-level: system admins/superadmins, or anyone who
  // owns/admins an org (the project lands in one of their teams). Plain members
  // can't — server enforces this too (project:add).
  const isAdmin = auth.user?.role === "admin" || auth.user?.role === "superadmin";
  const canCreate = isAdmin || orgMine.length > 0;

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      <ViewHeader
        title="Projects"
        actions={
          canCreate ? (
            <Button size="sm" variant="primary" onClick={() => openAddProjectForm()}>
              + Add Project
            </Button>
          ) : undefined
        }
      />

      {projects.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-overlay0 text-base">
          No projects configured
          {canCreate && (
            <Button variant="primary" onClick={() => openAddProjectForm()}>+ Add Project</Button>
          )}
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

                <div className="flex items-center gap-2 flex-wrap">
                  {project.teamName ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-mauve/15 text-mauve text-md">
                      <Users size={12} />
                      {project.teamName}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-surface0 text-overlay0 text-md italic">
                      No team
                    </span>
                  )}
                  <span className="text-md text-overlay0 font-mono truncate">
                    {project.vpsInstances?.length ? `${project.vpsInstances.length} instance(s)` : "No VPS"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
