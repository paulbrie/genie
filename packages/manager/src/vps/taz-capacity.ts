import { getGlobalSetting, setGlobalSetting } from "../settings-service.js";

/**
 * The Taz Cloud's capacity and the resources of each VM size (T240), kept in global_settings ("tazCapacity") so a
 * superadmin can change them as the cloud grows. The /clouds/taz/resources page measures allocation against them.
 * Units: GB, decimal (the sizes' own units); "2 TB" is 2000 GB.
 */
export interface TazSizeSpec {
  vcpu: number;
  ramGb: number;
  diskGb: number;
  /** a guess, not seen on a fresh VM yet (2xlarge's disk) */
  assumed?: boolean;
}

export interface TazCapacity {
  vcpu: number;
  ramGb: number;
  diskGb: number;
  sizes: Record<string, TazSizeSpec>;
  updatedAt?: string;
}

const KEY = "tazCapacity";

/** today's cloud (250 vCPU, 500 GB RAM, 2 TB SSD) and the sizes as docs/API-v2.md gives them */
export const DEFAULT_TAZ_CAPACITY: TazCapacity = {
  vcpu: 250,
  ramGb: 500,
  diskGb: 2000,
  sizes: {
    small: { vcpu: 1, ramGb: 1, diskGb: 20 },
    medium: { vcpu: 2, ramGb: 2, diskGb: 40 },
    large: { vcpu: 4, ramGb: 8, diskGb: 80 },
    xlarge: { vcpu: 8, ramGb: 16, diskGb: 160 },
    // (16 vCPU / 32 GB seen on a VM resized to it; a fresh one's disk isn't known, the resized one kept its 160 GB)
    "2xlarge": { vcpu: 16, ramGb: 32, diskGb: 160, assumed: true },
  },
};

const LIMIT = { vcpu: 100_000, ramGb: 1_000_000, diskGb: 100_000_000 };

function positive(v: unknown, what: string, max: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > max) throw new Error(`${what} must be a number between 0 and ${max}`);
  return Math.round(n * 100) / 100;
}

/**
 * A capacity from what was stored or sent: the three totals required and positive; the sizes merged over the defaults
 * (a size may be changed or added, each with positive vcpu/ramGb/diskGb). Throws on anything else.
 */
export function parseTazCapacity(raw: unknown): TazCapacity {
  if (!raw || typeof raw !== "object") throw new Error("capacity must be an object");
  const r = raw as Record<string, unknown>;
  const sizes: Record<string, TazSizeSpec> = { ...DEFAULT_TAZ_CAPACITY.sizes };
  if (r.sizes !== undefined) {
    if (!r.sizes || typeof r.sizes !== "object") throw new Error("sizes must be an object");
    for (const [name, spec] of Object.entries(r.sizes as Record<string, unknown>)) {
      if (!/^[a-z0-9-]{1,20}$/i.test(name)) throw new Error(`bad size name: ${name}`);
      const s = (spec ?? {}) as Record<string, unknown>;
      sizes[name] = {
        vcpu: positive(s.vcpu, `${name}.vcpu`, 1024),
        ramGb: positive(s.ramGb, `${name}.ramGb`, 16_384),
        diskGb: positive(s.diskGb, `${name}.diskGb`, 100_000),
        ...(s.assumed === true ? { assumed: true } : {}),
      };
    }
  }
  return {
    vcpu: positive(r.vcpu, "vcpu", LIMIT.vcpu),
    ramGb: positive(r.ramGb, "ramGb", LIMIT.ramGb),
    diskGb: positive(r.diskGb, "diskGb", LIMIT.diskGb),
    sizes,
    ...(typeof r.updatedAt === "string" ? { updatedAt: r.updatedAt } : {}),
  };
}

/** The capacity in use: the stored one, or the defaults when none is stored (or the stored one can't be read). */
export async function getTazCapacity(): Promise<TazCapacity> {
  const stored = await getGlobalSetting<unknown>(KEY);
  if (!stored) return DEFAULT_TAZ_CAPACITY;
  try {
    return parseTazCapacity(stored);
  } catch {
    return DEFAULT_TAZ_CAPACITY;
  }
}

/** Validates and stores a new capacity (superadmin only: the handler checks); returns what is stored. */
export async function setTazCapacity(raw: unknown): Promise<TazCapacity> {
  const capacity = { ...parseTazCapacity(raw), updatedAt: new Date().toISOString() };
  await setGlobalSetting(KEY, capacity);
  return capacity;
}
