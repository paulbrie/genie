"use client";

import { useEffect, useMemo, useState } from "react";
import { useSubject } from "subjecto/react";
import { Loader2, Plug, RefreshCw, RotateCcw, X } from "lucide-react";
import { $auth, $ssh } from "@/store/subjects";
import {
  ensureMcpForHost,
  killSshSession,
  killSshSessionsForHost,
  loadSshSessions,
  reconnectSshTunnelForHost,
} from "@/store/actions/ssh";
import { Button } from "@/components/ui/button";
import { CopyableIp } from "@/components/ui/copyable-ip";
import { formatSshAge, mcpTunnelServices } from "@/lib/ssh-format";
import { cn } from "@/lib/utils";
import type { ManageVmProvider } from "./manage-vm-popup";

export const VM_HOST_SSH_REFRESH_MS = 3000;

export interface VmHostConnectionsPanelProps {
  host: string;
  provider: ManageVmProvider;
  sshUser: string;
  projectName?: string | null;
  isPrivateHost?: boolean;
  ingress?: { domain: string; url?: string } | null;
  connection?: { username: string; privateKeyPath: string };
  /** Which slice of the panel to render. Defaults to all sections stacked. */
  view?: "all" | "connection" | "ssh" | "tunnels";
}

function sshKeyPathFor(props: VmHostConnectionsPanelProps): string {
  if (props.provider === "ssh") return props.connection?.privateKeyPath || "~/.genie/ssh/genie_ed25519";
  return props.provider === "tazcloud" ? "~/.genie/ssh/tazcloud_ed25519" : "~/.genie/ssh/genie_ed25519";
}

function providerLabel(provider: ManageVmProvider): string {
  return provider === "do" ? "DigitalOcean" : provider === "ssh" ? "SSH" : "TazCloud";
}

function routeLabel(provider: ManageVmProvider, isPrivateHost?: boolean): string {
  if (isPrivateHost) return "WireGuard → private 10.128/24";
  if (provider === "tazcloud") return "Direct (public IPv6 or resolved ssh_host)";
  return "Direct";
}

/** Live SSH sessions + MCP tunnels for one VM host (admin registry). */
export function useVmHostSshRegistry(host: string) {
  const [auth] = useSubject($auth);
  const [ssh] = useSubject($ssh);
  const [now, setNow] = useState(() => Date.now());
  const role = auth.user?.role ?? "user";
  const canViewRegistry = role === "admin" || role === "superadmin";
  const reconnecting = !!ssh.reconnectingHosts[host];

  useEffect(() => {
    if (!canViewRegistry || !host) return;
    loadSshSessions();
    const tick = window.setInterval(() => {
      loadSshSessions({ silent: true });
      setNow(Date.now());
    }, VM_HOST_SSH_REFRESH_MS);
    return () => window.clearInterval(tick);
  }, [canViewRegistry, host]);

  const sessions = useMemo(
    () => ssh.sessions.filter((s) => s.host === host),
    [ssh.sessions, host],
  );
  const tunnels = useMemo(
    () => ssh.tunnels.filter((t) => t.host === host),
    [ssh.tunnels, host],
  );

  return { ssh, sessions, tunnels, now, canViewRegistry, reconnecting };
}

function ConnectionDetailsCard(props: VmHostConnectionsPanelProps) {
  const { host, provider, sshUser, projectName, isPrivateHost, ingress, connection } = props;
  return (
    <div className="rounded-lg border border-surface0 bg-surface0/20 px-3 py-3">
      <div className="text-xs font-medium text-subtext0 uppercase tracking-wide mb-2">Connection</div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-md">
        <dt className="text-overlay0">Host</dt>
        <dd className="font-mono text-text min-w-0 truncate">
          <CopyableIp ip={host} />
        </dd>
        <dt className="text-overlay0">Port</dt>
        <dd className="font-mono text-subtext0">22</dd>
        <dt className="text-overlay0">SSH user</dt>
        <dd className="font-mono text-subtext0">{sshUser}</dd>
        <dt className="text-overlay0">Key</dt>
        <dd className="font-mono text-subtext0 truncate" title={sshKeyPathFor(props)}>
          {sshKeyPathFor(props)}
        </dd>
        <dt className="text-overlay0">Provider</dt>
        <dd className="text-subtext0">{providerLabel(provider)}</dd>
        <dt className="text-overlay0">Route</dt>
        <dd className="text-subtext0">{routeLabel(provider, isPrivateHost)}</dd>
        {projectName && (
          <>
            <dt className="text-overlay0">Project</dt>
            <dd className="text-blue truncate">{projectName}</dd>
          </>
        )}
        {ingress?.domain && (
          <>
            <dt className="text-overlay0">Ingress</dt>
            <dd className="font-mono text-subtext0 truncate">{ingress.domain}</dd>
          </>
        )}
      </dl>
      {isPrivateHost && (
        <p className="mt-2 text-xs text-overlay0 border-t border-surface0/80 pt-2">
          Private-network VM — the manager dials <span className="font-mono text-overlay1">{host}</span> through
          the WireGuard tunnel. If SSH fails, verify the tunnel on the manager (
          <span className="font-mono">sudo wg show</span> or wireproxy on Railway).
        </p>
      )}
    </div>
  );
}

function RegistryToolbar({
  host,
  sessionCount,
  showReconnect,
  showKillAll,
  ssh,
}: {
  host: string;
  sessionCount: number;
  showReconnect: boolean;
  showKillAll: boolean;
  ssh: ReturnType<typeof useVmHostSshRegistry>["ssh"];
}) {
  const reconnecting = !!ssh.reconnectingHosts[host];
  return (
    <div className="flex items-center justify-end gap-2 flex-wrap">
      {showReconnect && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => reconnectSshTunnelForHost(host)}
          disabled={reconnecting}
          title="Reconnect shared MCP tunnel for this host"
        >
          {reconnecting ? <Loader2 size={13} className="animate-spin mr-1" /> : <RotateCcw size={13} className="mr-1" />}
          Reconnect tunnel
        </Button>
      )}
      {showKillAll && sessionCount > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="text-red hover:text-red"
          onClick={() => killSshSessionsForHost(host)}
          title="Kill all SSH sessions and tunnels for this host"
        >
          <X size={13} className="mr-1" />
          Kill all
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => loadSshSessions()} disabled={ssh.loading} title="Refresh">
        <RefreshCw size={13} className={cn(ssh.loading && "animate-spin")} />
      </Button>
    </div>
  );
}

/** SSH connection details, live manager sessions, and MCP tunnels for one VM host. */
export function VmHostConnectionsPanel({
  host,
  provider,
  sshUser,
  projectName,
  isPrivateHost,
  ingress,
  connection,
  view = "all",
}: VmHostConnectionsPanelProps) {
  const props = { host, provider, sshUser, projectName, isPrivateHost, ingress, connection };
  const { ssh, sessions, tunnels, now, canViewRegistry, reconnecting } = useVmHostSshRegistry(host);

  const showConnection = view === "all" || view === "connection" || view === "ssh";
  const showSsh = view === "all" || view === "ssh";
  const showTunnels = view === "all" || view === "tunnels";

  return (
    <div className="flex flex-col gap-4">
      {showConnection && (
        <ConnectionDetailsCard {...props} />
      )}

      {canViewRegistry ? (
        <>
          {(showSsh || showTunnels) && (
            <RegistryToolbar
              host={host}
              sessionCount={sessions.length}
              showReconnect={showTunnels}
              showKillAll={showSsh || showTunnels}
              ssh={ssh}
            />
          )}

          {showSsh && (
            <section>
              {view === "all" && (
                <h3 className="text-xs font-medium text-subtext0 uppercase tracking-wide mb-2">Live connections</h3>
              )}
              {sessions.length === 0 ? (
                <div className="text-overlay0 text-md py-4 text-center border border-surface0 rounded">
                  No active SSH connections to this host.
                </div>
              ) : (
                <div className="overflow-x-auto rounded border border-surface0">
                  <table className="w-full text-md font-mono">
                    <thead className="text-subtext0 text-left bg-surface0/40">
                      <tr className="border-b border-surface0">
                        <th className="py-1.5 px-2 font-normal">User</th>
                        <th className="py-1.5 px-2 font-normal">Kind</th>
                        <th className="py-1.5 px-2 font-normal">Age</th>
                        <th className="py-1.5 px-2 font-normal">Opener</th>
                        <th className="py-1.5 px-2 font-normal w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => {
                        const killing = ssh.killing[s.id];
                        return (
                          <tr key={s.id} className="border-b border-surface0/50 hover:bg-surface0/30">
                            <td className="py-1.5 px-2 text-subtext1">{s.username}</td>
                            <td className="py-1.5 px-2">
                              <span
                                className={cn(
                                  "px-1.5 py-0.5 rounded text-xs",
                                  s.kind === "pty" ? "bg-mauve/20 text-mauve" : "bg-teal/20 text-teal",
                                )}
                              >
                                {s.kind}
                              </span>
                            </td>
                            <td className="py-1.5 px-2 text-subtext1 tabular-nums">{formatSshAge(s.openedAt, now)}</td>
                            <td className="py-1.5 px-2 text-subtext0 truncate max-w-[200px]" title={s.opener}>{s.opener}</td>
                            <td className="py-1.5 px-2">
                              <button
                                className="px-1.5 py-0.5 rounded text-xs bg-red/10 hover:bg-red/20 text-red disabled:opacity-50"
                                disabled={killing}
                                onClick={() => killSshSession(s.id)}
                                title="Close this SSH connection"
                              >
                                {killing ? "…" : <X size={11} />}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {showTunnels && (
            <section>
              {view === "all" && (
                <h3 className="text-xs font-medium text-subtext0 uppercase tracking-wide mb-2">MCP tunnels</h3>
              )}
              {tunnels.length === 0 ? (
                <div className="text-overlay0 text-md py-4 text-center border border-surface0 rounded">
                  No shared MCP tunnels for this host. Tunnels are created when MCP browser/stream tools run against this VM.
                </div>
              ) : (
                <div className="overflow-x-auto rounded border border-surface0">
                  <table className="w-full text-md font-mono">
                    <thead className="text-subtext0 text-left bg-surface0/40">
                      <tr className="border-b border-surface0">
                        <th className="py-1.5 px-2 font-normal">Project</th>
                        <th className="py-1.5 px-2 font-normal">Age</th>
                        <th className="py-1.5 px-2 font-normal">Services</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tunnels.map((t) => (
                        <tr key={`${t.host}:${t.openedAt}`} className="border-b border-surface0/50 hover:bg-surface0/30">
                          <td className="py-1.5 px-2 text-subtext1">{t.projectName}</td>
                          <td className="py-1.5 px-2 text-subtext1 tabular-nums">{formatSshAge(t.openedAt, now)}</td>
                          <td className="py-1.5 px-2 text-subtext0">{mcpTunnelServices(t) || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          {showTunnels && (
            <section className="rounded-lg border border-surface0 bg-surface0/20 px-3 py-3">
              <div className="text-xs font-medium text-subtext0 uppercase tracking-wide mb-1">MCP servers</div>
              <p className="text-md text-overlay1 mb-3">
                Genie tools (browser, tracker, security, notify, storage) reach this VM over secure tunnels. If a
                Claude session shows them as <span className="text-red">failed</span>, reconnect them here, then reopen
                the Claude session.
              </p>
              <Button size="sm" onClick={() => ensureMcpForHost(host)} disabled={reconnecting}>
                {reconnecting ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Plug size={13} className="mr-1.5" />}
                {reconnecting ? "Reconnecting…" : "Reconnect MCP servers"}
              </Button>
            </section>
          )}
          {showSsh && !showTunnels && (
            <p className="text-xs text-overlay0 italic">
              Live SSH registry is available to admin users on the SSH panel.
            </p>
          )}
        </>
      )}
    </div>
  );
}
