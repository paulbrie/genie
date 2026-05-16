"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSubject } from "subjecto/react";
import { $activeNav, $projects, $selectedProjectId, $showAddProjectForm } from "@/store/subjects";
import { loadAiCosts, loadAuditLogs, loadBackups, loadBaseImageConfigs, loadDocsList, loadProdDeployments, loadSshKey, openDoc, selectProject, setAdminTab, setAiSubTab, setDropletsSubTab, switchNav } from "@/store/actions";
import { AddProjectForm } from "@/components/add-project-form";
import { ProjectDetail } from "@/components/project-detail";
import { ProcessesPanel } from "@/components/processes-panel";
import { DockerPanel } from "@/components/docker-panel";
import { DocsPanel } from "@/components/docs-panel";
import { LogsPanel } from "@/components/logs-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { ChatView } from "@/components/chat-view";
import { ChatNotificationToasts } from "@/components/chat-notification-toasts";
import { TrackerPanel } from "@/components/tracker-panel";
import { AdminPanel } from "@/components/admin-panel";
import { CloudsPanel } from "@/components/clouds-panel";
import { RecipesPanel } from "@/components/recipes-panel";
import { ArchitecturePanel } from "@/components/architecture-panel";
import { ConnectedUsersPanel } from "@/components/connected-users-panel";
import { SecurityPanel } from "@/components/security-panel";
import { HelpPanel } from "@/components/help-panel";
import { ProjectsGrid } from "@/components/projects-grid";
import { parseRoute, type ProjectTab, type SettingsTab } from "@/lib/routes";
import { findBySlug } from "@/lib/utils";
import { buildNavPath } from "@/lib/routes";

function useRouteSync(): { activeTab?: ProjectTab; settingsTab: SettingsTab } {
  const params = useParams();
  const router = useRouter();
  const [projects] = useSubject($projects);
  const [activeTab, setActiveTab] = useState<ProjectTab | undefined>();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const syncedRef = useRef<string>("");

  const slugSegments = (params?.slug as string[] | undefined) ?? [];
  const urlKey = slugSegments.join("/");

  useEffect(() => {
    // Root "/" → redirect to last-used nav from localStorage
    if (slugSegments.length === 0) {
      const nav = $activeNav.getValue() || "projects";
      router.replace(buildNavPath(nav));
      return;
    }

    // Don't re-sync for the same URL
    if (syncedRef.current === urlKey) return;

    const parsed = parseRoute(slugSegments);
    if (!parsed) {
      router.replace(buildNavPath("projects"));
      return;
    }

    // Entity-level routes need data to be loaded
    if (parsed.entitySlug) {
      if (parsed.nav === "projects") {
        const project = findBySlug(projects, parsed.entitySlug);
        if (project) {
          selectProject(project.id);
          setActiveTab(parsed.tab ?? "files");
          syncedRef.current = urlKey;
        } else if (projects.length > 0) {
          router.replace(buildNavPath("projects"));
        }
        return;
      }
    }

    // Admin sub-routes
    if (parsed.nav === "admin") {
      switchNav("admin");
      if (!parsed.adminTab) {
        router.replace("/admin/database");
        return;
      }
      if (parsed.adminTab) {
        setAdminTab(parsed.adminTab);
        if (parsed.adminTab === "droplets") {
          loadBaseImageConfigs();
          if (parsed.dropletsSubTab) {
            setDropletsSubTab(parsed.dropletsSubTab);
            if (parsed.dropletsSubTab === "sshkey") loadSshKey();
          }
        }
        if (parsed.adminTab === "backup") {
          loadBackups();
        }
        if (parsed.adminTab === "ai") {
          loadAiCosts();
          if (parsed.aiSubTab) setAiSubTab(parsed.aiSubTab);
        }
        if (parsed.adminTab === "audit") {
          loadAuditLogs();
        }
        if (parsed.adminTab === "prodlogs") {
          loadProdDeployments();
        }
      }
      syncedRef.current = urlKey;
      return;
    }

    // Docs deep-link: /docs/.../docId
    if (parsed.nav === "docs" && parsed.docId) {
      switchNav("docs");
      loadDocsList();
      openDoc(parsed.docId);
      syncedRef.current = urlKey;
      return;
    }

    // Settings sub-routes: /settings/general, /settings/deploy
    if (parsed.nav === "settings" && parsed.settingsTab) {
      switchNav("settings");
      setSettingsTab(parsed.settingsTab);
      syncedRef.current = urlKey;
      return;
    }

    // Clouds: /clouds/digitalocean, /clouds/tazcloud
    if (parsed.nav === "clouds") {
      switchNav("clouds");
      syncedRef.current = urlKey;
      return;
    }

    // Simple nav route
    switchNav(parsed.nav);
    setActiveTab(undefined);
    syncedRef.current = urlKey;
  }, [urlKey, projects, router, slugSegments]);

  return { activeTab, settingsTab };
}

function MainPanel({ activeTab, settingsTab }: { activeTab?: ProjectTab; settingsTab: SettingsTab }) {
  const [activeNav] = useSubject($activeNav);
  const [showAddProjectForm] = useSubject($showAddProjectForm);
  const [selectedProjectId] = useSubject($selectedProjectId);
  const [projects] = useSubject($projects);

  if (activeNav === "chat") {
    return <ChatView />;
  }

  if (activeNav === "processes") {
    return <ProcessesPanel />;
  }

  if (activeNav === "docker") {
    return <DockerPanel />;
  }

  if (activeNav === "docs") {
    return <DocsPanel />;
  }

  if (activeNav === "logs") {
    return <LogsPanel />;
  }

  if (activeNav === "tracker") {
    return <TrackerPanel />;
  }

  if (activeNav === "settings") {
    return <SettingsPanel activeTab={settingsTab} />;
  }

  if (activeNav === "admin") {
    return <AdminPanel />;
  }

  if (activeNav === "clouds") {
    return <CloudsPanel />;
  }

  if (activeNav === "recipes") {
    return <RecipesPanel />;
  }

  if (activeNav === "architecture") {
    return <ArchitecturePanel />;
  }

  if (activeNav === "users") {
    return <ConnectedUsersPanel />;
  }

  if (activeNav === "security") {
    return <SecurityPanel />;
  }

  if (activeNav === "help") {
    return <HelpPanel />;
  }

  // Default: projects
  if (showAddProjectForm) return <AddProjectForm />;
  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : null;
  if (selectedProject) return <ProjectDetail activeTab={activeTab} />;
  return <ProjectsGrid />;
}

export default function Home() {
  const { activeTab, settingsTab } = useRouteSync();

  return (
    <>
      <MainPanel activeTab={activeTab} settingsTab={settingsTab} />
      <ChatNotificationToasts />
    </>
  );
}
