"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { $apps, $projects, $selectedProjectId, selectApp, selectProject, deselectProject, switchNav, saveUiState, type NavKey, type AppDef, type ProjectDef } from "@/store";
import { slugify } from "@/lib/utils";
import { buildNavPath, buildAppPath, buildProjectPath, type ProjectTab } from "@/lib/routes";

export function useNavigate() {
  const router = useRouter();

  const navigateToNav = useCallback(
    (nav: NavKey) => {
      switchNav(nav);
      router.push(buildNavPath(nav));
    },
    [router]
  );

  const navigateToApp = useCallback(
    (appId: string) => {
      const app = $apps.getValue().find((a: AppDef) => a.id === appId);
      if (!app) return;
      selectApp(appId);
      router.push(buildAppPath(slugify(app.name)));
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

  return { navigateToNav, navigateToApp, navigateToProject, navigateToProjectTab };
}
