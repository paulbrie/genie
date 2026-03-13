import type { ChatMessageUsage } from "@/store";

function formatCost(cost: number): string {
  if (cost < 0.001) return `$${(cost * 100).toFixed(4)}c`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

export function UsageLine({ usage }: { usage: ChatMessageUsage }) {
  return (
    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-overlay0/70 px-1">
      <span>{usage.modelLabel}</span>
      <span className="text-overlay0/40">|</span>
      <span>{usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out</span>
      <span className="text-overlay0/40">|</span>
      <span>{formatCost(usage.cost)}</span>
    </div>
  );
}
