"use client";

import { useEffect, useState } from "react";
import { useSubject, useDeepSubject } from "subjecto/react";
import { LayoutGrid, List, Search, Users } from "lucide-react";
import { $auth, $projects } from "@/store/subjects";
import { $projectsPaged } from "@/store/subjects/vps";
import { $orgSettings } from "@/store/subjects/org-settings";
import {
  loadProjectsPaged,
  setProjectsPage,
  setProjectsPageSize,
  setProjectsSearch,
  showAddProjectForm as openAddProjectForm,
} from "@/store/actions";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { useNavigate } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type ProjectsViewMode = "cards" | "list";
const VIEW_STORAGE_KEY = "projects-view-mode";

export function ProjectsGrid() {
  const [projects] = useSubject($projects);
  const [paged] = useSubject($projectsPaged);
  const [auth] = useSubject($auth);
  const [orgMine] = useDeepSubject($orgSettings, "mine");
  const { navigateToProject } = useNavigate();

  const [view, setView] = useState<ProjectsViewMode>(() => {
    if (typeof window === "undefined") return "cards";
    return localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "cards";
  });
  const switchView = (next: ProjectsViewMode) => {
    setView(next);
    if (typeof window !== "undefined") localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  // Creating a project is owner-level: system admins/superadmins, or anyone who
  // owns/admins an org (the project lands in one of their teams). Plain members
  // can't — server enforces this too (project:add).
  const isAdmin = auth.user?.role === "admin" || auth.user?.role === "superadmin";
  const canCreate = isAdmin || orgMine.length > 0;

  useEffect(() => {
    loadProjectsPaged();
  }, []);

  const totalPages = Math.max(1, Math.ceil(paged.total / paged.pageSize));
  const from = paged.total === 0 ? 0 : (paged.page - 1) * paged.pageSize + 1;
  const to = Math.min(paged.total, paged.page * paged.pageSize);
  // First-load: the broadcast `project:list` arrives before the paged reply,
  // so `$projects` may already have data while `paged.loaded` is still false.
  // Show the empty state only when both sources agree there's nothing to show.
  const hasNothing = paged.loaded && paged.total === 0 && projects.length === 0;

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      <ViewHeader
        title="Projects"
        actions={
          <>
            <div className="inline-flex rounded-md border border-surface1 overflow-hidden">
              <button
                type="button"
                title="Card view"
                aria-pressed={view === "cards"}
                onClick={() => switchView("cards")}
                className={cn(
                  "flex items-center justify-center px-2 py-1 text-md cursor-pointer transition-colors",
                  view === "cards"
                    ? "bg-mauve text-background"
                    : "bg-surface0 text-overlay0 hover:bg-surface1"
                )}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                title="List view"
                aria-pressed={view === "list"}
                onClick={() => switchView("list")}
                className={cn(
                  "flex items-center justify-center px-2 py-1 text-md cursor-pointer transition-colors border-l border-surface1",
                  view === "list"
                    ? "bg-mauve text-background"
                    : "bg-surface0 text-overlay0 hover:bg-surface1"
                )}
              >
                <List size={14} />
              </button>
            </div>
            {canCreate && (
              <Button size="sm" variant="primary" onClick={() => openAddProjectForm()}>
                + Add Project
              </Button>
            )}
          </>
        }
      />

      {hasNothing ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-overlay0 text-base">
          No projects configured
          {canCreate && (
            <Button variant="primary" onClick={() => openAddProjectForm()}>+ Add Project</Button>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden pt-4 gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative max-w-sm flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-overlay0 pointer-events-none" />
              <input
                className="w-full bg-surface0 border border-surface1 rounded pl-8 pr-3 py-1.5 text-md text-text"
                placeholder="Filter projects by name…"
                value={paged.search}
                onChange={(e) => setProjectsSearch(e.target.value)}
              />
            </div>
            <div className="text-md text-overlay0">
              {paged.loading && !paged.loaded
                ? "Loading…"
                : `${paged.total.toLocaleString()} ${paged.total === 1 ? "project" : "projects"}`}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {paged.loaded && paged.list.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-overlay0 text-base gap-2">
                No projects match your filter.
              </div>
            ) : view === "cards" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                {paged.list.map((project) => (
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
            ) : (
              <div className="flex flex-col rounded-lg border border-surface0 overflow-hidden">
                {paged.list.map((project, idx) => (
                  <button
                    key={project.id}
                    onClick={() => navigateToProject(project.id)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer",
                      "bg-mantle hover:bg-surface0/50",
                      idx > 0 && "border-t border-surface0"
                    )}
                  >
                    <span className="text-base font-semibold text-text truncate flex-1 min-w-0">
                      {project.name}
                    </span>
                    {project.teamName ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-mauve/15 text-mauve text-md shrink-0">
                        <Users size={12} />
                        {project.teamName}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface0 text-overlay0 text-md italic shrink-0">
                        No team
                      </span>
                    )}
                    <span className="text-md text-overlay0 font-mono shrink-0 w-28 text-right">
                      {project.vpsInstances?.length ? `${project.vpsInstances.length} instance(s)` : "No VPS"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {paged.total > 0 && (
            <div className="flex items-center justify-between text-md text-subtext0 shrink-0">
              <div>{from}–{to} of {paged.total.toLocaleString()}</div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5">
                  Per page
                  <select
                    className="bg-surface0 border border-surface1 rounded px-2 py-1 text-md text-text"
                    value={paged.pageSize}
                    onChange={(e) => setProjectsPageSize(Number(e.target.value))}
                  >
                    {[12, 24, 48, 96].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={paged.page <= 1} onClick={() => setProjectsPage(paged.page - 1)}>
                    Prev
                  </Button>
                  <span className="px-2 text-text font-mono">{paged.page} / {totalPages}</span>
                  <Button size="sm" variant="ghost" disabled={paged.page >= totalPages} onClick={() => setProjectsPage(paged.page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
