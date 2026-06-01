"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSubject } from "subjecto/react";
import { $activeNav, $auth, $projects, $selectedProjectId, $showAddProjectForm } from "@/store/subjects";
import { loadAiCosts, loadAuditLogs, loadBackups, loadBaseImageConfigs, loadDocsList, loadEmailLogs, loadProdDeployments, loadSshKey, openDoc, selectProject, setAdminTab, setAiSubTab, setDropletsSubTab, switchNav } from "@/store/actions";
import { AddProjectForm } from "@/components/project/add-project-form";
import { ProjectDetail } from "@/components/project/project-detail";
import { ProcessesPanel } from "@/components/ui/processes-panel";
import { DockerPanel } from "@/components/project/docker-panel";
import { DocsPanel } from "@/components/project/docs-panel";
import { LogsPanel } from "@/components/ui/logs-panel";
import { SettingsPanel } from "@/components/ui/settings-panel";
import { ChatView } from "@/components/chat/chat-view";
import { ChatNotificationToasts } from "@/components/chat/chat-notification-toasts";
import { ManageVmWindows } from "@/components/tazcloud/manage-vm-popup";
import { ManageDropletWindows } from "@/components/admin/digitalocean-panel";
import { VmConnectionWindows } from "@/components/tazcloud/vm-connection-window";
import { TrackerPanel } from "@/components/project/tracker-panel";
import { AdminPanel } from "@/components/admin/admin-panel";
import { CloudsPanel } from "@/components/project/clouds-panel";
import { RecipesPanel } from "@/components/project/recipes-panel";
import { AgentsPanel } from "@/components/agents/agents-panel";
import { ArchitecturePanel } from "@/components/project/architecture-panel";
import { TopologyGraph3D } from "@/components/project/topology-graph-3d";
import { ConnectedUsersPanel } from "@/components/chat/connected-users-panel";
import { SecurityPanel } from "@/components/project/security-panel";
import { HelpPanel } from "@/components/ui/help-panel";
import { SshPanel } from "@/components/ui/ssh-panel";
import { HistoryPanel } from "@/components/ui/history-panel";
import { ProjectsGrid } from "@/components/project/projects-grid";
import { defaultNavForRole, navAllowedForRole, parseRoute, type ProjectTab, type SettingsTab } from "@/lib/routes";
import { findBySlug } from "@/lib/utils";
import { buildNavPath } from "@/lib/routes";

function useRouteSync(): { activeTab?: ProjectTab; settingsTab: SettingsTab; settingsOrgId?: string } {
  const params = useParams();
  const router = useRouter();
  const [projects] = useSubject($projects);
  const [activeTab, setActiveTab] = useState<ProjectTab | undefined>();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [settingsOrgId, setSettingsOrgId] = useState<string | undefined>();
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

    // Role gate. The sidebar already hides forbidden nav items, but a user
    // can still type /admin/users or /security into the address bar — without
    // this check the page would render the admin shell with empty data
    // (server ACL blocks the actual fetch). Bounce them to their landing nav.
    const role = $auth.getValue()?.user?.role as "user" | "tazcloud" | "admin" | "superadmin" | undefined;
    if (!navAllowedForRole(parsed.nav, role)) {
      router.replace(buildNavPath(defaultNavForRole(role)));
      return;
    }

    // Entity-level routes need data to be loaded
    if (parsed.entitySlug) {
      if (parsed.nav === "projects") {
        const project = findBySlug(projects, parsed.entitySlug);
        if (project) {
          selectProject(project.id);
          setActiveTab(parsed.tab ?? "deploy-history");
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
        if (parsed.adminTab === "communication") {
          loadEmailLogs();
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

    // Settings sub-routes: /settings/general, /settings/deploy, /settings/org/{orgId}
    if (parsed.nav === "settings" && parsed.settingsTab) {
      switchNav("settings");
      setSettingsTab(parsed.settingsTab);
      setSettingsOrgId(parsed.orgId);
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

  return { activeTab, settingsTab, settingsOrgId };
}

function MainPanel({ activeTab, settingsTab, settingsOrgId }: { activeTab?: ProjectTab; settingsTab: SettingsTab; settingsOrgId?: string }) {
  const [activeNav] = useSubject($activeNav);
  const [showAddProjectForm] = useSubject($showAddProjectForm);
  const [selectedProjectId] = useSubject($selectedProjectId);
  const [projects] = useSubject($projects);

  if (activeNav === "chat") {
    return <ChatView />;
  }

  if (activeNav === "history") {
    return <HistoryPanel />;
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
    return <SettingsPanel activeTab={settingsTab} orgId={settingsOrgId} />;
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

  if (activeNav === "topology") {
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="px-6 py-4 border-b border-surface0">
          <h1 className="text-xl font-semibold text-text">Topology</h1>
          <p className="text-md text-subtext0 mt-1">
            Live 3D view of Genie, your projects, their servers, and the users
            currently connected to the Manager. Drag to orbit, scroll to zoom.
          </p>
        </div>
        <div className="flex-1 relative" style={{ minHeight: 500 }}>
          <TopologyGraph3D />
        </div>
      </div>
    );
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

  if (activeNav === "ssh") {
    return <SshPanel />;
  }

  if (activeNav === "agents") {
    return <AgentsPanel />;
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
  const { activeTab, settingsTab, settingsOrgId } = useRouteSync();

  return (
    <>
      <MainPanel activeTab={activeTab} settingsTab={settingsTab} settingsOrgId={settingsOrgId} />
      <ChatNotificationToasts />
      {/* Global mounts so both Manage popups (TazCloud + DigitalOcean) can be
          opened from any page and survive navigation. Separate window-id
          prefixes keep them independent. */}
      <ManageVmWindows />
      <ManageDropletWindows />
      <VmConnectionWindows />
    </>
  );
}
