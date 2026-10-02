"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { NavKey, ProjectDef } from "@/store/types";
import { $projects, $selectedProjectId } from "@/store/subjects";
import { deselectProject, selectProject, switchNav } from "@/store/actions";
import { slugify } from "@/lib/utils";
import { buildNavPath, buildProjectPath, type ProjectTab } from "@/lib/routes";

export function useNavigate() {
  const router = useRouter();

  const navigateToNav = useCallback(
    (nav: NavKey) => {
      if (nav === "projects") deselectProject();
      switchNav(nav);
      router.push(buildNavPath(nav));
    },
    [router]
  );

  const navigateToProject = useCallback(
    (projectId: string, tab?: ProjectTab) => {
      const project = $projects.getValue().find((p: ProjectDef) => p.id === projectId);
      if (!project) return;
      selectProject(projectId);
      router.push(buildProjectPath(slugify(project.name), tab));
    },
    [router]
  );

  const navigateToProjectTab = useCallback(
    (tab: ProjectTab) => {
      const project = $projects.getValue().find(
        (p: ProjectDef) => p.id === $selectedProjectId.getValue()
      );
      if (!project) return;
      router.push(buildProjectPath(slugify(project.name), tab));
    },
    [router]
  );

  return { navigateToNav, navigateToProject, navigateToProjectTab };
}
