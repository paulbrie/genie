"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSubject } from "subjecto/react";
import {
  $apps,
  $projects,
  $activeNav,
  $selectedAppId,
  $showAddForm,
  $showAddProjectForm,
  $selectedProjectId,
  selectApp,
  selectProject,
  switchNav,
  setAdminTab,
  setDropletsSubTab,
  setAiSubTab,
  loadAdminDroplets,
  loadBaseImageConfigs,
  loadSshKey,
  loadAiCosts,
  loadBackups,
  loadAuditLogs,
  loadProdDeployments,
  openDoc,
  loadDocsList,
  showAddForm as openAddAppForm,
  showAddProjectForm as openAddProjectForm,
  type NavKey,
} from "@/store";
import { AppDetail } from "@/components/app-detail";
import { AddAppForm } from "@/components/add-app-form";
import { AddProjectForm } from "@/components/add-project-form";
import { ProjectDetail } from "@/components/project-detail";
import { Button } from "@/components/ui/button";
import { ProcessesPanel } from "@/components/processes-panel";
import { DockerPanel } from "@/components/docker-panel";
import { DocsPanel } from "@/components/docs-panel";
import { LogsPanel } from "@/components/logs-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { ChatView } from "@/components/chat-view";
import { ChatNotificationToasts } from "@/components/chat-notification-toasts";
import { TrackerPanel } from "@/components/tracker-panel";
import { AdminPanel } from "@/components/admin-panel";
import { TazCloudPanel } from "@/components/tazcloud-panel";
import { ArchitecturePanel } from "@/components/architecture-panel";
import { ConnectedUsersPanel } from "@/components/connected-users-panel";
import { SecurityPanel } from "@/components/security-panel";
import { ProjectsGrid } from "@/components/projects-grid";
import { parseRoute, type ProjectTab, type SettingsTab } from "@/lib/routes";
import { findBySlug } from "@/lib/utils";
import { buildNavPath } from "@/lib/routes";

function useRouteSync(): { activeTab?: ProjectTab; settingsTab: SettingsTab } {
  const params = useParams();
  const router = useRouter();
  const [apps] = useSubject($apps);
  const [projects] = useSubject($projects);
  const [activeTab, setActiveTab] = useState<ProjectTab | undefined>();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const syncedRef = useRef<string>("");

  const slugSegments = (params?.slug as string[] | undefined) ?? [];
  const urlKey = slugSegments.join("/");

  useEffect(() => {
    // Root "/" → redirect to last-used nav from localStorage
    if (slugSegments.length === 0) {
      const nav = $activeNav.getValue() || "apps";
      router.replace(buildNavPath(nav));
      return;
    }

    // Don't re-sync for the same URL
    if (syncedRef.current === urlKey) return;

    const parsed = parseRoute(slugSegments);
    if (!parsed) {
      router.replace(buildNavPath("apps"));
      return;
    }

    // Entity-level routes need data to be loaded
    if (parsed.entitySlug) {
      if (parsed.nav === "apps") {
        const app = findBySlug(apps, parsed.entitySlug);
        if (app) {
          selectApp(app.id);
          setActiveTab(undefined);
          syncedRef.current = urlKey;
        } else if (apps.length > 0) {
          // Data loaded but slug not found
          router.replace(buildNavPath("apps"));
        }
        // else: data not loaded yet, will retry when apps change
        return;
      }

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
          loadAdminDroplets();
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

    // Simple nav route
    switchNav(parsed.nav);
    setActiveTab(undefined);
    syncedRef.current = urlKey;
  }, [urlKey, apps, projects, router, slugSegments]);

  return { activeTab, settingsTab };
}

function MainPanel({ activeTab, settingsTab }: { activeTab?: ProjectTab; settingsTab: SettingsTab }) {
  const [activeNav] = useSubject($activeNav);
  const [selectedAppId] = useSubject($selectedAppId);
  const [showAddForm] = useSubject($showAddForm);
  const [apps] = useSubject($apps);
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

  if (activeNav === "tazcloud") {
    return <TazCloudPanel />;
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

  if (activeNav === "projects") {
    if (showAddProjectForm) return <AddProjectForm />;
    const selectedProject = selectedProjectId
      ? projects.find((p) => p.id === selectedProjectId)
      : null;
    if (selectedProject) return <ProjectDetail activeTab={activeTab} />;
    return <ProjectsGrid />;
  }

  if (showAddForm) {
    return <AddAppForm />;
  }

  const selectedApp = selectedAppId
    ? apps.find((a) => a.id === selectedAppId)
    : null;

  if (selectedApp) {
    return <AppDetail />;
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-overlay0 text-base">
      Select an app or create a new one
      <Button variant="primary" onClick={() => openAddAppForm()}>+ Add App</Button>
    </div>
  );
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
