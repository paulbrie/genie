"use client";

import { useEffect, useMemo, useState } from "react";
import { useSubject } from "subjecto/react";
import { Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { $auth, $ssh } from "@/store/subjects";
import {
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

const REFRESH_MS = 3000;

export interface VmHostConnectionsPanelProps {
  host: string;
  provider: ManageVmProvider;
  sshUser: string;
  projectName?: string | null;
  isPrivateHost?: boolean;
  ingress?: { domain: string; url?: string } | null;
  connection?: { username: string; privateKeyPath: string };
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

/** SSH connection details, live manager sessions, and MCP tunnels for one VM host. */
export function VmHostConnectionsPanel({
  host,
  provider,
  sshUser,
  projectName,
  isPrivateHost,
  ingress,
  connection,
}: VmHostConnectionsPanelProps) {
  const [auth] = useSubject($auth);
  const [ssh] = useSubject($ssh);
  const [now, setNow] = useState(() => Date.now());
  const role = auth.user?.role ?? "user";
  const canViewRegistry = role === "admin" || role === "superadmin";
  const reconnecting = !!ssh.reconnectingHosts[host];

  useEffect(() => {
    if (!canViewRegistry) return;
    loadSshSessions();
    const tick = window.setInterval(() => {
      loadSshSessions();
      setNow(Date.now());
    }, REFRESH_MS);
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

  return (
    <div className="flex flex-col gap-4">
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
          <dd className="font-mono text-subtext0 truncate" title={sshKeyPathFor({ host, provider, sshUser, connection })}>
            {sshKeyPathFor({ host, provider, sshUser, connection })}
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

      {canViewRegistry ? (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-overlay0">
              <span className="font-mono text-overlay1">{sessions.length}</span> live SSH connection
              {sessions.length === 1 ? "" : "s"}
              {" · "}
              <span className="font-mono text-overlay1">{tunnels.length}</span> shared MCP tunnel
              {tunnels.length === 1 ? "" : "s"}
            </div>
            <div className="flex items-center gap-2">
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
              {sessions.length > 0 && (
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
          </div>

          <section>
            <h3 className="text-xs font-medium text-subtext0 uppercase tracking-wide mb-2">Live connections</h3>
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

          <section>
            <h3 className="text-xs font-medium text-subtext0 uppercase tracking-wide mb-2">MCP tunnels</h3>
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
        </>
      ) : (
        <p className="text-xs text-overlay0 italic">
          Live SSH registry and MCP tunnel controls are available to admin users on the SSH panel.
        </p>
      )}
    </div>
  );
}
