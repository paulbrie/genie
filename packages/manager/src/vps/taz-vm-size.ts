/**
 * A Taz VM's size, from whatever its API object carries (T240b). The list (`GET /v1/vm`) carries none; the VM itself
 * (`GET /v1/vm/{id}`, "the same shape as create") has `size: "small"`; an OpenStack-style object may carry a `flavor`
 * (a name, or `{ name, vcpus, ram (MB), disk (GB) }`) or the numbers directly. Explicit numbers win over a name.
 */
export interface TazVmSizeSpecs {
  vcpu: number;
  ramGb: number;
  diskGb: number;
}

export interface TazVmSize {
  /** the size's name as given ("small", "TAZ-LARGE"…); the renderer maps it, case-insensitively */
  size: string | null;
  /** the VM's resources when the object gives them as numbers */
  specs: TazVmSizeSpecs | null;
  /** what the object said about its size, for display when it can't be mapped */
  raw: string | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** RAM in GB from a value whose unit isn't stated: OpenStack gives MB (1024, 2048…), so a large number is MB */
const ramGbOf = (o: Record<string, unknown>): number | null => {
  const gb = num(o.memory_gb ?? o.ram_gb ?? o.memoryGb ?? o.ramGb);
  if (gb) return gb;
  const mb = num(o.ram_mb ?? o.memory_mb ?? o.memoryMb ?? o.ramMb);
  if (mb) return mb / 1024;
  const any = num(o.ram ?? o.memory);
  return any ? (any >= 256 ? any / 1024 : any) : null;
};

function specsOf(o: Record<string, unknown>): TazVmSizeSpecs | null {
  const vcpu = num(o.vcpus ?? o.vcpu ?? o.cpus ?? o.cpu);
  const ramGb = ramGbOf(o);
  const diskGb = num(o.disk_gb ?? o.diskGb ?? o.disk ?? o.root_gb);
  return vcpu && ramGb && diskGb ? { vcpu, ramGb: Math.round(ramGb * 100) / 100, diskGb } : null;
}

export function tazVmSize(vm: Record<string, unknown>): TazVmSize {
  const flavor = vm.flavor;
  const flavorObj = flavor && typeof flavor === "object" ? (flavor as Record<string, unknown>) : null;
  const size =
    str(vm.size) ?? str(vm.flavor_name) ?? str(vm.size_name) ?? str(typeof flavor === "string" ? flavor : null) ??
    (flavorObj ? str(flavorObj.name) ?? str(flavorObj.original_name) ?? str(flavorObj.id) : null);
  const specs = specsOf(vm) ?? (flavorObj ? specsOf(flavorObj) : null);
  const raw = size ?? (specs ? `${specs.vcpu} vCPU / ${specs.ramGb} GB / ${specs.diskGb} GB` : null);
  return { size, specs, raw };
}
