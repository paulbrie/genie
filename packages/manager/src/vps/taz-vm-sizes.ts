import { tazVmSize, type TazVmSize } from "./taz-vm-size.js";

/**
 * Every listed Taz VM's size (T240b). `GET /v1/vm` carries none, so a VM it doesn't size is asked itself
 * (`GET /v1/vm/{id}`), a few at a time; each answer (with or without a size) is kept TTL_MS so the list stays fast,
 * and a resize records the new size at once (`noteTazVmSize`).
 */
export type ResolvedTazVmSize = TazVmSize & { source: "list" | "vm" };

const TTL_MS = 10 * 60_000, AT_ONCE = 4;
const cache = new Map<string, { size: TazVmSize; at: number }>();

export async function resolveTazVmSizes(
  client: { getVm(id: string): Promise<unknown> },
  vms: { id: string }[],
  now: () => number = Date.now,
): Promise<Map<string, ResolvedTazVmSize>> {
  const out = new Map<string, ResolvedTazVmSize>();
  const ask: string[] = [];
  for (const v of vms) {
    const own = tazVmSize(v as Record<string, unknown>);
    if (own.size || own.specs) { out.set(v.id, { ...own, source: "list" }); continue; }
    const kept = cache.get(v.id);
    if (kept && now() - kept.at < TTL_MS) out.set(v.id, { ...kept.size, source: "vm" });
    else ask.push(v.id);
  }
  for (let i = 0; i < ask.length; i += AT_ONCE) {
    await Promise.all(ask.slice(i, i + AT_ONCE).map(async (id) => {
      try {
        const vm = ((await client.getVm(id)) ?? {}) as Record<string, unknown>;
        const s = tazVmSize(vm);
        // (no size in it: say what it has, field names only, so the real shape shows on the page; T240c)
        const kept = s.size || s.specs ? s : { ...s, raw: `no size in GET /v1/vm/{id} (fields: ${Object.keys(vm).slice(0, 20).join(", ") || "none"})` };
        cache.set(id, { size: kept, at: now() });
        out.set(id, { ...kept, source: "vm" });
      } catch (err: unknown) {
        // (asked again on the next list; the reason shows meanwhile)
        const message = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 100);
        out.set(id, { size: null, specs: null, raw: `lookup failed: ${message}`, source: "vm" });
      }
    }));
  }
  return out;
}

/** A resize's new size, kept so the next list shows it without asking. */
export function noteTazVmSize(id: string, size: string, now: () => number = Date.now): void {
  cache.set(id, { size: { size, specs: null, raw: size }, at: now() });
}

/** (tests) */
export function clearTazVmSizeCache(): void {
  cache.clear();
}
