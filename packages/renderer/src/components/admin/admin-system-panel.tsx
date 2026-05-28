"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, Network, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ExecFn = (command: string) => Promise<{ output: string; error?: boolean }>;

type Exposure = "public" | "lan" | "loopback";

interface ListeningPort {
  proto: string;
  addr: string;
  port: string;
  process: string;
  exposure: Exposure;
}

/** Classify a bind address as publicly exposed, LAN-only, or loopback. */
function classifyAddr(addr: string): Exposure {
  // Strip zone suffix (e.g. "127.0.0.53%lo" → "127.0.0.53", "[::]%lo" → "[::]").
  const a = addr.split("%")[0].replace(/^\[|\]$/g, "");
  // Loopback
  if (a === "::1" || a.startsWith("127.")) return "loopback";
  // Public — anywhere / any-v6 / wildcard
  if (a === "0.0.0.0" || a === "::" || a === "*") return "public";
  // Private RFC1918 v4
  if (a.startsWith("10.")) return "lan";
  if (a.startsWith("192.168.")) return "lan";
  const m = a.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return "lan";
  // ULA v6 (fc00::/7)
  if (a.toLowerCase().startsWith("fc") || a.toLowerCase().startsWith("fd")) return "lan";
  // Link-local
  if (a.toLowerCase().startsWith("fe80")) return "lan";
  // Otherwise assume globally routable
  return "public";
}

interface SystemdService {
  name: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

function parsePorts(output: string): ListeningPort[] {
  // `ss -tulnH` output, no header. Columns: Netid State Recv-Q Send-Q Local Peer Process
  // We grab Netid (proto), Local address, Process info.
  const ports: ListeningPort[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Tokenize loosely; the last field is the process info, may contain spaces inside users:((...)).
    const m = line.match(/^(\S+)\s+\S+\s+\d+\s+\d+\s+(\S+)\s+\S+\s*(.*)$/);
    if (!m) continue;
    const [, proto, local, procRaw] = m;
    // Split host/port at the last ":" (works for both IPv4 and "[::]:8080" / "*:8080" forms).
    const lastColon = local.lastIndexOf(":");
    const addr = lastColon >= 0 ? local.slice(0, lastColon) : local;
    const port = lastColon >= 0 ? local.slice(lastColon + 1) : "";
    // Extract process name from users:(("name",pid=...,fd=...))
    let processName = "";
    const pm = procRaw.match(/users:\(\("([^"]+)"/);
    if (pm) processName = pm[1];
    ports.push({ proto, addr, port, process: processName || procRaw.slice(0, 40), exposure: classifyAddr(addr) });
  }
  // Sort: public first (highest attention), then by numeric port asc.
  const order: Record<Exposure, number> = { public: 0, lan: 1, loopback: 2 };
  ports.sort((a, b) => order[a.exposure] - order[b.exposure] || (parseInt(a.port) || 0) - (parseInt(b.port) || 0));
  return ports;
}

function parseServices(output: string): SystemdService[] {
  const services: SystemdService[] = [];
  for (const raw of output.split("\n")) {
    // With `--all`, systemd prefixes inactive/failed unit rows with "●  unitname …".
    // Strip the bullet so the column parser sees a normal row.
    const line = raw.replace(/^●\s+/, "").trim();
    if (!line || line.startsWith("UNIT") || line.startsWith("LOAD")) continue;
    // Columns: UNIT  LOAD  ACTIVE  SUB  DESCRIPTION
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const [name, load, active, sub, ...desc] = parts;
    if (!name.endsWith(".service")) continue;
    services.push({ name, load, active, sub, description: desc.join(" ") });
  }
  services.sort((a, b) => a.name.localeCompare(b.name));
  return services;
}

export function AdminSystemPanel({
  exec,
  view = "both",
  deferRefreshMs = 0,
}: {
  exec: ExecFn;
  view?: "both" | "services" | "ports";
  /** Delay the mount refresh so interactive terminals can connect first. */
  deferRefreshMs?: number;
}) {
  const [ports, setPorts] = useState<ListeningPort[] | null>(null);
  const [services, setServices] = useState<SystemdService[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [svcFilter, setSvcFilter] = useState("");
  const [showAll, setShowAll] = useState(false);

  const filteredServices = services?.filter((s) => {
    if (!showAll && s.sub !== "running") return false;
    if (!svcFilter.trim()) return true;
    const q = svcFilter.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
  });

  const totalForMode = services?.filter((s) => showAll || s.sub === "running").length ?? 0;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const needPorts = view === "both" || view === "ports";
      const needServices = view === "both" || view === "services";
      const [portsRes, svcRes] = await Promise.all([
        needPorts
          ? exec("sudo ss -tulnH 2>/dev/null || ss -tulnH")
          : Promise.resolve({ output: "", error: false }),
        needServices
          ? exec("sudo systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null")
          : Promise.resolve({ output: "", error: false }),
      ]);
      if (needPorts) {
        if (portsRes.error) setError(`ports: ${portsRes.output.slice(0, 200)}`);
        else setPorts(parsePorts(portsRes.output));
      }
      if (needServices) {
        if (svcRes.error) setError((prev) => (prev ? `${prev}; ` : "") + `services: ${svcRes.output.slice(0, 200)}`);
        else setServices(parseServices(svcRes.output));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [exec, view]);

  useEffect(() => {
    if (deferRefreshMs <= 0) {
      refresh();
      return;
    }
    const t = window.setTimeout(() => refresh(), deferRefreshMs);
    return () => window.clearTimeout(t);
  }, [refresh, deferRefreshMs]);

  // Toggle full-width when only one half is rendered so the chosen card uses
  // the available space instead of squishing into the half-width grid column.
  const showServices = view === "both" || view === "services";
  const showPorts = view === "both" || view === "ports";
  const gridCols = view === "both" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1";

  return (
    <div className={cn("grid gap-3", gridCols)}>
      {showServices && (
      /* Services */
      <div className="bg-mantle rounded-lg p-3 border border-overlay0/20">
        <div className="flex items-center gap-2 mb-2">
          <Activity size={12} className="text-green" />
          <span className="text-md font-medium text-subtext0">System Services</span>
          {services && (
            <span className="text-md text-overlay0 font-mono">
              {svcFilter.trim() && filteredServices ? `${filteredServices.length} / ${totalForMode}` : totalForMode}
            </span>
          )}
          <div className="flex-1" />
          {/* Running / All toggle */}
          {services && (
            <div className="inline-flex rounded border border-overlay0/30 overflow-hidden text-xs">
              <button
                onClick={() => setShowAll(false)}
                className={cn(
                  "px-1.5 py-0.5 transition-colors",
                  !showAll ? "bg-green/20 text-green" : "text-overlay0 hover:text-text",
                )}
              >
                Running
              </button>
              <button
                onClick={() => setShowAll(true)}
                className={cn(
                  "px-1.5 py-0.5 transition-colors border-l border-overlay0/30",
                  showAll ? "bg-blue/20 text-blue" : "text-overlay0 hover:text-text",
                )}
              >
                All
              </button>
            </div>
          )}
          <button onClick={refresh} disabled={loading} className="text-overlay0 hover:text-blue transition-colors disabled:opacity-50">
            <RefreshCw size={11} className={cn(loading && "animate-spin")} />
          </button>
        </div>
        {/* Filter input */}
        {services && services.length > 0 && (
          <div className="relative mb-2">
            <input
              type="text"
              value={svcFilter}
              onChange={(e) => setSvcFilter(e.target.value)}
              placeholder="Filter by name or description…"
              spellCheck={false}
              className="w-full bg-background border border-surface0 rounded px-2 py-1 pr-6 text-xs text-text outline-none font-mono focus:border-blue placeholder:text-overlay0"
            />
            {svcFilter && (
              <button
                onClick={() => setSvcFilter("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-overlay0 hover:text-text"
                title="Clear filter"
              >
                <X size={11} />
              </button>
            )}
          </div>
        )}
        {loading && !services ? (
          <div className="flex items-center gap-2 text-overlay0 text-md py-2">
            <Loader2 size={11} className="animate-spin" /> Loading…
          </div>
        ) : filteredServices && filteredServices.length > 0 ? (
          <div className="max-h-72 overflow-auto pr-1">
            <table className="w-full text-xs font-mono">
              <thead className="text-overlay0 sticky top-0 bg-mantle">
                <tr>
                  <th className="text-left font-normal py-0.5">Name</th>
                  <th className="text-left font-normal py-0.5">State</th>
                  <th className="text-left font-normal py-0.5">Description</th>
                </tr>
              </thead>
              <tbody>
                {filteredServices.map((s) => (
                  <tr key={s.name} className="border-t border-overlay0/10">
                    <td className="py-0.5 text-text">{s.name.replace(/\.service$/, "")}</td>
                    <td className="py-0.5">
                      <span className={cn(
                        "px-1 rounded",
                        s.sub === "running" ? "text-green"
                          : s.sub === "failed" ? "text-red"
                          : s.sub === "dead" ? "text-overlay0"
                          : "text-overlay1",
                      )}>
                        {s.sub}
                      </span>
                    </td>
                    <td className="py-0.5 text-overlay1 truncate max-w-[260px]" title={s.description}>{s.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : services && svcFilter.trim() ? (
          <p className="text-overlay0 text-md py-2">No matches for &ldquo;{svcFilter}&rdquo;.</p>
        ) : (
          <p className="text-overlay0 text-md py-2">No active services.</p>
        )}
      </div>
      )}

      {showPorts && (
      /* Open Ports */
      <div className="bg-mantle rounded-lg p-3 border border-overlay0/20">
        <div className="flex items-center gap-2 mb-2">
          <Network size={12} className="text-blue" />
          <span className="text-md font-medium text-subtext0">Open Ports</span>
          {ports && (
            <>
              <span className="text-md text-overlay0 font-mono">{ports.length}</span>
              {/* Compact exposure summary */}
              {(() => {
                const pub = ports.filter((p) => p.exposure === "public").length;
                const lan = ports.filter((p) => p.exposure === "lan").length;
                const lo = ports.filter((p) => p.exposure === "loopback").length;
                return (
                  <span className="text-xs font-mono ml-1">
                    {pub > 0 && <span className="text-red mr-1.5">{pub} public</span>}
                    {lan > 0 && <span className="text-peach mr-1.5">{lan} lan</span>}
                    {lo > 0 && <span className="text-green">{lo} loopback</span>}
                  </span>
                );
              })()}
            </>
          )}
          <div className="flex-1" />
          <button onClick={refresh} disabled={loading} className="text-overlay0 hover:text-blue transition-colors disabled:opacity-50">
            <RefreshCw size={11} className={cn(loading && "animate-spin")} />
          </button>
        </div>
        {loading && !ports ? (
          <div className="flex items-center gap-2 text-overlay0 text-md py-2">
            <Loader2 size={11} className="animate-spin" /> Loading…
          </div>
        ) : ports && ports.length > 0 ? (
          <table className="w-full text-xs font-mono">
            <thead className="text-overlay0">
              <tr>
                <th className="text-left font-normal py-0.5">Port</th>
                <th className="text-left font-normal py-0.5">Proto</th>
                <th className="text-left font-normal py-0.5">Bind</th>
                <th className="text-left font-normal py-0.5">Exposure</th>
                <th className="text-left font-normal py-0.5">Process</th>
              </tr>
            </thead>
            <tbody>
              {ports.map((p, i) => (
                <tr key={i} className="border-t border-overlay0/10">
                  <td className="py-0.5 text-text">{p.port}</td>
                  <td className="py-0.5 text-overlay1">{p.proto}</td>
                  <td className="py-0.5 text-overlay1">{p.addr}</td>
                  <td className="py-0.5">
                    <span className={cn(
                      "px-1 rounded",
                      p.exposure === "public" ? "bg-red/15 text-red"
                        : p.exposure === "lan" ? "bg-peach/15 text-peach"
                        : "bg-green/15 text-green",
                    )}>
                      {p.exposure}
                    </span>
                  </td>
                  <td className="py-0.5 text-blue">{p.process || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-overlay0 text-md py-2">No listening ports.</p>
        )}
      </div>
      )}

      {error && <div className="col-span-full text-xs text-red font-mono">{error}</div>}
    </div>
  );
}

interface ProcRow {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
}

function parseProcesses(output: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Columns from `ps -eo pid,user,pcpu,pmem,args`: pid user cpu mem <args…>.
    // args is the remainder (may contain spaces), captured greedily.
    const m = line.match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, user, cpu, mem, command] = m;
    rows.push({ pid: Number(pid), user, cpu: Number(cpu), mem: Number(mem), command });
  }
  return rows;
}

/** Running-process list for a VM, driven by the popup's SSH `exec` (so it works
 *  for both project-linked and standalone admin VMs, unlike the project page's
 *  `vps:stats` flow). Sorted by CPU; supports filtering and per-row kill. */
export function VpsProcessesPanel({ exec }: { exec: ExecFn }) {
  const [procs, setProcs] = useState<ProcRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [killing, setKilling] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await exec("ps -eo pid,user,pcpu,pmem,args --sort=-pcpu --no-headers 2>/dev/null | head -n 100");
      if (res.error) setError(res.output.slice(0, 200));
      else setProcs(parseProcesses(res.output));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [exec]);

  useEffect(() => { refresh(); }, [refresh]);

  const kill = useCallback(async (proc: ProcRow, force: boolean) => {
    if (!window.confirm(`${force ? "Force kill" : "Kill"} PID ${proc.pid}?\n\n${proc.command.slice(0, 120)}`)) return;
    setKilling(proc.pid);
    try {
      await exec(`sudo kill ${force ? "-9 " : ""}${proc.pid} 2>&1 || kill ${force ? "-9 " : ""}${proc.pid}`);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setKilling(null);
  }, [exec, refresh]);

  const filtered = procs?.filter((p) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return p.command.toLowerCase().includes(q) || p.user.toLowerCase().includes(q) || String(p.pid).includes(q);
  });

  return (
    <div className="bg-mantle rounded-lg p-3 border border-overlay0/20">
      <div className="flex items-center gap-2 mb-2">
        <Activity size={12} className="text-peach" />
        <span className="text-md font-medium text-subtext0">Processes</span>
        {procs && (
          <span className="text-md text-overlay0 font-mono">
            {filter.trim() && filtered ? `${filtered.length} / ${procs.length}` : procs.length}
          </span>
        )}
        <div className="flex-1" />
        <button onClick={refresh} disabled={loading} className="text-overlay0 hover:text-blue transition-colors disabled:opacity-50">
          <RefreshCw size={11} className={cn(loading && "animate-spin")} />
        </button>
      </div>
      {procs && procs.length > 0 && (
        <div className="relative mb-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by command, user or PID…"
            spellCheck={false}
            className="w-full bg-background border border-surface0 rounded px-2 py-1 pr-6 text-xs text-text outline-none font-mono focus:border-blue placeholder:text-overlay0"
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-overlay0 hover:text-text"
              title="Clear filter"
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}
      {loading && !procs ? (
        <div className="flex items-center gap-2 text-overlay0 text-md py-2">
          <Loader2 size={11} className="animate-spin" /> Loading…
        </div>
      ) : filtered && filtered.length > 0 ? (
        <div className="max-h-72 overflow-auto pr-1">
          <table className="w-full text-xs font-mono">
            <thead className="text-overlay0 sticky top-0 bg-mantle">
              <tr>
                <th className="text-left font-normal py-0.5">PID</th>
                <th className="text-left font-normal py-0.5">User</th>
                <th className="text-right font-normal py-0.5">CPU%</th>
                <th className="text-right font-normal py-0.5">MEM%</th>
                <th className="text-left font-normal py-0.5 pl-3">Command</th>
                <th className="text-right font-normal py-0.5 w-0" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.pid} className="border-t border-overlay0/10 group">
                  <td className="py-0.5 text-text">{p.pid}</td>
                  <td className="py-0.5 text-overlay1">{p.user}</td>
                  <td className={cn("py-0.5 text-right", p.cpu >= 50 ? "text-red" : p.cpu >= 10 ? "text-peach" : "text-overlay1")}>{p.cpu.toFixed(1)}</td>
                  <td className={cn("py-0.5 text-right", p.mem >= 50 ? "text-red" : p.mem >= 10 ? "text-peach" : "text-overlay1")}>{p.mem.toFixed(1)}</td>
                  <td className="py-0.5 pl-3 text-overlay1 truncate max-w-[300px]" title={p.command}>{p.command}</td>
                  <td className="py-0.5 text-right whitespace-nowrap">
                    {killing === p.pid ? (
                      <Loader2 size={11} className="animate-spin text-overlay0 inline" />
                    ) : (
                      <span className="inline-flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => kill(p, false)} className="text-overlay0 hover:text-peach transition-colors" title={`Kill PID ${p.pid} (SIGTERM)`}>
                          kill
                        </button>
                        <button onClick={() => kill(p, true)} className="text-overlay0 hover:text-red transition-colors" title={`Force kill PID ${p.pid} (SIGKILL)`}>
                          -9
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : procs && filter.trim() ? (
        <p className="text-overlay0 text-md py-2">No matches for &ldquo;{filter}&rdquo;.</p>
      ) : (
        <p className="text-overlay0 text-md py-2">No processes.</p>
      )}
      {error && <div className="text-xs text-red font-mono mt-1">{error}</div>}
    </div>
  );
}
