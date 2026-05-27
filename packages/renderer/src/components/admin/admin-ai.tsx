"use client";

import { useEffect, useState } from "react";
import type { AdminState, AiUsageRow } from "@/store/types";
import { CHAT_MODELS, loadAiSettings, saveAiSettings, setAiSubTab } from "@/store/actions";
import { Button } from "@/components/ui/button";
import { ViewTabs } from "@/components/ui/view-tabs";

function formatCost(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function AiSettingsPanel({ aiState }: { aiState: AdminState["ai"] }) {
  const { settings, settingsLoading } = aiState;
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel);
  const [maxToolRounds, setMaxToolRounds] = useState(settings.maxToolRounds);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadAiSettings();
  }, []);

  useEffect(() => {
    setDefaultModel(settings.defaultModel);
    setMaxToolRounds(settings.maxToolRounds);
  }, [settings.defaultModel, settings.maxToolRounds]);

  const handleSave = () => {
    saveAiSettings({ defaultModel, maxToolRounds });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="px-4 py-4 max-w-md space-y-5">
      <div className="space-y-1.5">
        <label className="text-md text-overlay0">Default Model</label>
        <select
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          className="w-full bg-surface0 border border-surface1 rounded-lg px-3 py-2 text-text text-md outline-none focus:border-mauve cursor-pointer"
        >
          {Object.entries(CHAT_MODELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <p className="text-md text-overlay0/60">Used when no model is explicitly selected in chat.</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-md text-overlay0">Max Tool Rounds</label>
        <input
          type="number"
          min={1}
          max={50}
          value={maxToolRounds}
          onChange={(e) => setMaxToolRounds(Number(e.target.value) || 10)}
          className="w-full bg-surface0 border border-surface1 rounded-lg px-3 py-2 text-text text-md outline-none focus:border-mauve font-mono"
        />
        <p className="text-md text-overlay0/60">Maximum number of consecutive tool call rounds per chat message.</p>
      </div>

      <Button onClick={handleSave} disabled={settingsLoading}>
        {saved ? "Saved!" : "Save Settings"}
      </Button>
    </div>
  );
}

export function AiCostsPanel({ aiState }: { aiState: AdminState["ai"] }) {
  const { costs, loading, error } = aiState;

  // Aggregate totals
  const totalCost = costs.reduce((sum, r) => sum + r.cost, 0);
  const totalInput = costs.reduce((sum, r) => sum + r.inputTokens, 0);
  const totalOutput = costs.reduce((sum, r) => sum + r.outputTokens, 0);

  // Per-model breakdown
  const byModel: Record<string, { label: string; cost: number; input: number; output: number; count: number }> = {};
  for (const r of costs) {
    const m = byModel[r.modelId] || (byModel[r.modelId] = { label: r.modelLabel, cost: 0, input: 0, output: 0, count: 0 });
    m.cost += r.cost;
    m.input += r.inputTokens;
    m.output += r.outputTokens;
    m.count++;
  }
  const modelBreakdown = Object.values(byModel).sort((a, b) => b.cost - a.cost);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-surface0">
        <ViewTabs
          tabs={[
            { key: "costs" as const, label: "Costs" },
            { key: "settings" as const, label: "Settings" },
          ]}
          activeTab={aiState.subTab}
          onTabChange={(tab) => setAiSubTab(tab)}
        />
      </div>

      {aiState.subTab === "settings" ? (
        <AiSettingsPanel aiState={aiState} />
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-overlay0 text-base">{error}</div>
      ) : loading && costs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-overlay0 text-base">Loading...</div>
      ) : costs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-overlay0 text-base">No AI usage recorded yet.</div>
      ) : (
        <div className="flex-1 overflow-auto">
          {/* Summary cards */}
          <div className="flex gap-4 px-4 py-3">
            <div className="rounded-lg bg-surface0/50 px-4 py-3 flex flex-col gap-0.5">
              <span className="text-overlay0 text-md">Total Cost</span>
              <span className="text-text text-lg font-semibold">${totalCost.toFixed(4)}</span>
            </div>
            <div className="rounded-lg bg-surface0/50 px-4 py-3 flex flex-col gap-0.5">
              <span className="text-overlay0 text-md">Total Calls</span>
              <span className="text-text text-lg font-semibold">{costs.length}</span>
            </div>
            <div className="rounded-lg bg-surface0/50 px-4 py-3 flex flex-col gap-0.5">
              <span className="text-overlay0 text-md">Input Tokens</span>
              <span className="text-text text-lg font-semibold">{totalInput.toLocaleString()}</span>
            </div>
            <div className="rounded-lg bg-surface0/50 px-4 py-3 flex flex-col gap-0.5">
              <span className="text-overlay0 text-md">Output Tokens</span>
              <span className="text-text text-lg font-semibold">{totalOutput.toLocaleString()}</span>
            </div>
          </div>

          {/* Per-model breakdown */}
          <div className="px-4 pb-3">
            <h3 className="text-md text-overlay0 mb-2">Cost by Model</h3>
            <div className="flex gap-3 flex-wrap">
              {modelBreakdown.map((m) => (
                <div key={m.label} className="rounded-lg bg-surface0/50 px-4 py-2 flex flex-col gap-0.5 min-w-[160px]">
                  <span className="text-text text-md font-medium">{m.label}</span>
                  <span className="text-peach text-md font-semibold">${m.cost.toFixed(4)}</span>
                  <span className="text-overlay0 text-md">{m.count} calls &middot; {m.input.toLocaleString()} in / {m.output.toLocaleString()} out</span>
                </div>
              ))}
            </div>
          </div>

          {/* Usage log table */}
          <table className="w-full text-base border-collapse">
            <thead className="sticky top-0 bg-mantle z-10">
              <tr>
                <th className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Time</th>
                <th className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Source</th>
                <th className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">User</th>
                <th className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Model</th>
                <th className="text-right px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Input</th>
                <th className="text-right px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Output</th>
                <th className="text-right px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Cost</th>
              </tr>
            </thead>
            <tbody>
              {costs.map((r: AiUsageRow) => (
                <tr key={r.id} className="border-b border-surface0/50 hover:bg-surface0/30 transition-colors">
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md">{r.source || "-"}</td>
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md">{r.userName || "-"}</td>
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md">{r.modelLabel}</td>
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md text-right font-mono">{r.inputTokens.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md text-right font-mono">{r.outputTokens.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-peach whitespace-nowrap text-md text-right font-mono">{formatCost(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
