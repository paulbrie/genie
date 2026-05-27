"use client";

// Extension-side Docker container browser. Talks to the manager's
// `vps:docker:logs` handler — one round-trip returns all containers + tail
// logs. First container auto-expands so admins land on something useful.

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Container, Loader2, RefreshCw } from "lucide-react";
import { wsRequest } from "@/lib/ws";

// Minimal projection of the manager's project shape — duplicated rather than
// imported from `../page` to keep the tab modules independent of the page.
interface ExtensionProject {
  id: string;
  name: string;
  dbUrl?: string;
  gitFolders?: string[];
  vpsInstances: {
    id: string;
    label: string;
    connection: { host: string };
    digitalocean?: { ipAddress: string };
  }[];
}

interface DockerContainer {
  name: string;
  status: string;
  logs: string;
}

export function DockerLogs({ project }: { project: ExtensionProject }) {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedContainer, setExpandedContainer] = useState<string | null>(null);

  const inst = project.vpsInstances[0];

  const loadLogs = useCallback(async () => {
    if (!inst) return;
    setLoading(true);
    setError(null);
    try {
      const res = await wsRequest("vps:docker:logs", { projectId: project.id, instanceId: inst.id }, 30000);
      if (res.ok) {
        setContainers(res.containers);
        if (res.containers.length > 0 && !expandedContainer) {
          setExpandedContainer(res.containers[0].name);
        }
      } else {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [project.id, inst?.id, expandedContainer]);

  useEffect(() => {
    loadLogs();
  }, []);

  if (!inst) return <div className="p-4 text-overlay0" style={{ fontSize: 13 }}>No VPS instance available.</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
        <Container size={13} className="text-mauve" />
        <span className="text-text" style={{ fontSize: 13 }}>Docker Containers</span>
        <div className="flex-1" />
        <button onClick={loadLogs} disabled={loading} className="text-overlay1 hover:text-text transition-colors p-1">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-red bg-red/10 border-b border-red/20" style={{ fontSize: 13 }}>{error}</div>
      )}

      {loading && containers.length === 0 ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 size={18} className="text-mauve animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {containers.length === 0 && !loading && (
            <div className="text-overlay0 text-center py-8" style={{ fontSize: 13 }}>No containers found</div>
          )}
          {containers.map((c) => {
            const isUp = c.status.toLowerCase().includes("up");
            const isExpanded = expandedContainer === c.name;
            return (
              <div key={c.name} className="border-b border-surface0">
                <button
                  onClick={() => setExpandedContainer(isExpanded ? null : c.name)}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-surface0/50 transition-colors text-left"
                  style={{ fontSize: 13 }}
                >
                  {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isUp ? "bg-green" : "bg-overlay0"}`} />
                  <span className="text-text truncate">{c.name}</span>
                  <span className="text-overlay0 ml-auto shrink-0" style={{ fontSize: 12 }}>{c.status}</span>
                </button>
                {isExpanded && (
                  <pre className="px-3 py-2 bg-mantle text-subtext0 overflow-x-auto whitespace-pre-wrap break-words" style={{ fontSize: 12, lineHeight: 1.5, maxHeight: 400 }}>
                    {c.logs || "(no logs)"}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
