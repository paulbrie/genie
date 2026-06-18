import type { ChatMessageUsage } from "@/store/types";

function formatCost(cost: number): string {
  if (cost < 0.001) return `$${(cost * 100).toFixed(4)}c`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

/** Compact elapsed-time label: "0.4s", "12.3s", "1m 5s". */
export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

/** Per-turn footer: model · tokens in/out · cost · thinking time. Every field is
 *  optional — renders nothing when there's nothing to show. `showCost` is false
 *  when the run is on a CLI subscription, where the reported cost is a would-be
 *  figure, not actual spend. */
export function UsageLine({ usage, thinkingMs, showCost = true }: { usage?: ChatMessageUsage; thinkingMs?: number; showCost?: boolean }) {
  const hasUsage = !!usage && (usage.inputTokens > 0 || usage.outputTokens > 0);
  const hasTime = typeof thinkingMs === "number" && thinkingMs > 0;
  if (!hasUsage && !hasTime) return null;
  return (
    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-overlay0/70 px-1">
      {hasUsage && (
        <>
          {usage!.modelLabel && (
            <>
              <span>{usage!.modelLabel}</span>
              <span className="text-overlay0/40">|</span>
            </>
          )}
          <span>{usage!.inputTokens.toLocaleString()} in / {usage!.outputTokens.toLocaleString()} out</span>
          {showCost && usage!.cost > 0 && (
            <>
              <span className="text-overlay0/40">|</span>
              <span>{formatCost(usage!.cost)}</span>
            </>
          )}
        </>
      )}
      {hasTime && (
        <>
          {hasUsage && <span className="text-overlay0/40">|</span>}
          <span title="Time spent on this turn">{formatDuration(thinkingMs!)}</span>
        </>
      )}
    </div>
  );
}
