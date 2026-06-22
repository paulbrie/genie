"use client";

// Real-data adapter for the mobile screens. Reads the live `$projectsPaged` /
// `$vpsDeploy` subjects and maps them onto the screens' display shapes
// (MockProject / MockServer / MockSession). When no live projects are present
// — e.g. running /mobile standalone with no manager — it falls back to the mock
// constants so the prototype still demos. Swap order is real-first, mock-fallback.

import { useEffect } from "react";
import { useSubject } from "subjecto/react";
import { $auth, $claudeStream, $projects, $projectsPaged, $vpsDeploy } from "@/store/subjects";
import { useDeepSubjectAll } from "@/lib/hooks";
import { useLivePoll } from "@/hooks/use-live-poll";
import {
  fetchVpsStats,
  loadProjectsPaged,
  refreshVmTmuxSessions,
  unwatchVpsStats,
  watchVpsStats,
} from "@/store/actions";
import type {
  ProjectDef,
  VpsInstance,
  VpsInstanceState,
  VmTmuxSession,
  VpsServiceInfo,
} from "@/store/types";
import type {
  MockProject,
  MockServer,
  MockService,
  MockSession,
  ServerHealth,
} from "@/components/mobile/mock-data";

function providerOf(inst: VpsInstance): MockServer["provider"] {
  if (inst.digitalocean) return "digitalocean";
  if (inst.tazcloud) return "tazcloud";
  if (inst.hetzner) return "hetzner";
  return "other";
}

function hostOf(inst: VpsInstance): string {
  return (
    inst.connection?.host ||
    inst.digitalocean?.ipAddress ||
    inst.tazcloud?.ipv6 ||
    inst.hetzner?.ipAddress ||
    "—"
  );
}

function deriveHealth(inst: VpsInstance, state: VpsInstanceState | undefined): ServerHealth {
  if (inst.deployFailed) return "down";
  if (!state) return "healthy";
  if (state.error || state.statsError) return "down";
  const s = state.stats;
  if (!s) return "healthy";
  if (s.cpuPercent >= 90 || s.memPercent >= 90 || s.diskPercent >= 90) return "degraded";
  return "healthy";
}

function noteFor(health: ServerHealth, state: VpsInstanceState | undefined): string {
  if (health === "down") return state?.error || state?.statsError || "unreachable";
  if (health === "degraded") return "high load";
  return "all green";
}

function mapServices(services: VpsServiceInfo[] | undefined): MockService[] | undefined {
  if (!services?.length) return undefined;
  return services.map((svc) => ({
    name: svc.name || svc.service,
    status: /run|active/i.test(svc.status) ? "running" : /stop|dead|fail/i.test(svc.status) ? "stopped" : "restarted",
    detail: [svc.state, svc.ports].filter(Boolean).join(" · ") || svc.status,
  }));
}

function toServer(
  project: ProjectDef,
  inst: VpsInstance,
  state: VpsInstanceState | undefined,
): MockServer {
  const health = deriveHealth(inst, state);
  const s = state?.stats;
  return {
    id: inst.id,
    label: inst.label,
    project: project.name,
    host: hostOf(inst),
    provider: providerOf(inst),
    health,
    note: noteFor(health, state),
    cpu: Math.round(s?.cpuPercent ?? 0),
    mem: Math.round(s?.memPercent ?? 0),
    disk: Math.round(s?.diskPercent ?? 0),
    uptime: "—",
    projectId: project.id,
    user: inst.connection?.username,
    services: mapServices(inst.services),
  };
}

function rollup(instances: MockServer[]): ServerHealth {
  if (instances.some((i) => i.health === "down")) return "down";
  if (instances.some((i) => i.health === "degraded")) return "degraded";
  return "healthy";
}

/** Live projects (with their instances) for the Home screen. */
export function useMobileProjects(): MockProject[] {
  const [auth] = useSubject($auth);
  const [projects] = useSubject($projects);
  const [paged] = useSubject($projectsPaged);
  const deploy = useDeepSubjectAll($vpsDeploy);

  // A mount-time request races auth and is dropped (wsSend no-ops before the
  // socket is open); re-request whenever we (re)authenticate.
  useEffect(() => {
    if (auth.status === "authenticated") loadProjectsPaged();
  }, [auth.status]);

  // Prefer the auto-broadcast full list; fall back to the paged reply.
  const real = projects.length ? projects : paged.list ?? [];

  return real
    .map((p) => {
      const instances = (p.vpsInstances ?? []).map((inst) =>
        toServer(p, inst, deploy.instances[inst.id]),
      );
      return {
        name: p.name,
        region: p.vpsRegion ?? "",
        instances,
        health: rollup(instances),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Live CPU/mem/disk for a server, falling back to the server's own (mock) numbers. */
export function useInstanceStats(server: MockServer): { cpu: number; mem: number; disk: number } {
  const deploy = useDeepSubjectAll($vpsDeploy);

  useEffect(() => {
    if (!server.projectId) return;
    fetchVpsStats(server.projectId, server.id);
    watchVpsStats(server.projectId, server.id);
    return () => unwatchVpsStats(server.projectId!, server.id);
  }, [server.projectId, server.id]);

  const stats = server.projectId ? deploy.instances[server.id]?.stats : null;
  if (!stats) return { cpu: server.cpu, mem: server.mem, disk: server.disk };
  return {
    cpu: Math.round(stats.cpuPercent),
    mem: Math.round(stats.memPercent),
    disk: Math.round(stats.diskPercent),
  };
}

function mapTmuxSession(s: VmTmuxSession, running: boolean): MockSession {
  const claude = s.name.startsWith("claude");
  return {
    id: s.name,
    kind: claude ? "claude" : "tmux",
    title: s.name, // the real tmux session name — same as the desktop badge
    detail: s.attached ? "attached" : `${s.windows ?? 0} window${s.windows === 1 ? "" : "s"}`,
    running,
  };
}

/** Live tmux/Claude sessions for a server. Mirrors the desktop's running signal
 *  (tmux-session-badges useRunningTmuxSessions): non-claude sessions glow when
 *  the probe reports a running command; claude-* sessions glow when a bound
 *  $claudeStream turn is in flight (their pane is always `node`, so the probe
 *  can't tell idle from busy). */
export function useInstanceSessions(server: MockServer): MockSession[] {
  const deploy = useDeepSubjectAll($vpsDeploy);
  const [claudeState] = useSubject($claudeStream);

  // Auto-probe like the desktop badges (8s) so the `running` flag stays fresh —
  // otherwise a row only reflects whatever the session was doing on mount.
  useLivePoll(
    () => {
      if (server.projectId) refreshVmTmuxSessions(server.projectId, server.id);
    },
    8000,
    { enabled: !!server.projectId },
  );

  const tmux = deploy.instances[server.id]?.tmuxSessions;
  if (!tmux) return [];

  const claudeRunning = new Set<string>();
  for (const cs of Object.values(claudeState.sessions)) {
    if (cs.projectId === server.projectId && cs.instanceId === server.id && cs.tmuxName && cs.loading) {
      claudeRunning.add(cs.tmuxName);
    }
  }

  return tmux.map((s) =>
    mapTmuxSession(s, s.name.startsWith("claude") ? claudeRunning.has(s.name) : !!s.running),
  );
}

/** Live services for a server. */
export function useInstanceServices(server: MockServer): MockService[] {
  return server.services ?? [];
}
