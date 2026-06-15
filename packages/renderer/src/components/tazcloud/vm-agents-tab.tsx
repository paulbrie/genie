"use client";

// Manage popup tab: the AI agents whose sandbox targets THIS project + VM
// instance. Agents are private to the viewing user (agents:list is user-scoped),
// so this shows "your agents for this container". Read-only here — editing/running
// happens in the /agents panel, one click away.

import { useEffect } from "react";
import { Bot, Loader2, ArrowUpRight } from "lucide-react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { $agents } from "@/store/subjects";
import { loadAgents } from "@/store/actions";
import { useNavigate } from "@/lib/navigation";
import { Button } from "@/components/ui/button";

export function VmAgentsTab({ projectId, instanceId }: { projectId: string; instanceId: string }) {
  const agents = useDeepSubjectAll($agents);
  const { navigateToNav } = useNavigate();

  useEffect(() => { loadAgents(); }, []);

  const mine = agents.list.filter(
    (a) => a.sandbox.kind === "project-docker"
      && a.sandbox.projectId === projectId
      && a.sandbox.instanceId === instanceId,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-overlay0 text-sm">
          {mine.length} agent{mine.length === 1 ? "" : "s"} targeting this VM
        </div>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => navigateToNav("agents")}>
          Open Agents <ArrowUpRight size={13} />
        </Button>
      </div>

      {agents.loading && agents.list.length === 0 ? (
        <div className="flex items-center gap-2 p-4 text-overlay0">
          <Loader2 size={14} className="animate-spin" /> Loading agents…
        </div>
      ) : mine.length === 0 ? (
        <div className="rounded-md border border-surface0 bg-mantle p-4 text-md text-overlay0">
          No agents target this VM yet. Create one in <button className="text-blue hover:underline bg-transparent border-none cursor-pointer p-0" onClick={() => navigateToNav("agents")}>Agents</button> and pick this project + instance as the sandbox.
        </div>
      ) : (
        <div className="space-y-2">
          {mine.map((a) => (
            <div key={a.id} className="border border-surface0 rounded bg-mantle px-3 py-2.5 flex items-center gap-3">
              <Bot size={18} className="text-overlay1 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-text">{a.label}</span>
                  <code className="text-sm text-overlay0 font-mono">{a.slug}</code>
                  {a.isBuiltin && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-surface0 text-subtext0 uppercase tracking-wide">built-in</span>
                  )}
                </div>
                <div className="text-sm text-subtext0 truncate">
                  {a.description || <span className="italic text-overlay0">no description</span>}
                </div>
                <div className="text-xs text-overlay0 mt-0.5">
                  {a.modelId} · {a.tools.length > 0 ? a.tools.join(", ") : "all tools"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
