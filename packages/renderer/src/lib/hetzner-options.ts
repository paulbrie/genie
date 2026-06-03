// Hetzner location + server-type options, location-aware.
//
// Verified against the live Hetzner API (/datacenters + /server_types): the CPX
// (AMD) line is the only currently-placeable shared series, and its slug differs
// by region — US locations use cpx11–51, while EU + Singapore use cpx12–62.
// Picking a type that a location can't place returns "error during placement",
// so the create forms must filter types by the selected location. `fsn1` is
// intentionally omitted: it currently offers no placeable shared types.
//
// This is a static snapshot; if Hetzner shifts regional availability, update the
// maps below (or move to a live admin:hetzner:capabilities fetch).

export interface HetznerTypeOption { name: string; label: string }
export interface HetznerLocationOption { name: string; label: string }

const TYPE_SPECS: Record<string, string> = {
  cpx11: "2 vCPU / 2 GB / 40 GB",
  cpx21: "3 vCPU / 4 GB / 80 GB",
  cpx31: "4 vCPU / 8 GB / 160 GB",
  cpx41: "8 vCPU / 16 GB / 240 GB",
  cpx51: "16 vCPU / 32 GB / 360 GB",
  cpx12: "1 vCPU / 2 GB / 40 GB",
  cpx22: "2 vCPU / 4 GB / 80 GB",
  cpx32: "4 vCPU / 8 GB / 160 GB",
  cpx42: "8 vCPU / 16 GB / 320 GB",
  cpx52: "12 vCPU / 24 GB / 480 GB",
  cpx62: "16 vCPU / 32 GB / 640 GB",
};

const LOCATION_TYPES: Record<string, string[]> = {
  nbg1: ["cpx22", "cpx32", "cpx42", "cpx52", "cpx62"],
  hel1: ["cpx22", "cpx32", "cpx42", "cpx52", "cpx62"],
  sin: ["cpx12", "cpx22", "cpx32", "cpx42", "cpx52", "cpx62"],
  ash: ["cpx11", "cpx21", "cpx31", "cpx41"],
  hil: ["cpx11", "cpx21", "cpx31", "cpx41", "cpx51"],
};

export const HETZNER_LOCATIONS: HetznerLocationOption[] = [
  { name: "nbg1", label: "Nuremberg (nbg1)" },
  { name: "hel1", label: "Helsinki (hel1)" },
  { name: "ash", label: "Ashburn, VA (ash)" },
  { name: "hil", label: "Hillsboro, OR (hil)" },
  { name: "sin", label: "Singapore (sin)" },
];

export const HETZNER_IMAGES = ["ubuntu-22.04", "ubuntu-24.04", "debian-12"];

export const DEFAULT_HETZNER_LOCATION = "nbg1";

/** Placeable server types for a location, as labelled dropdown options. */
export function hetznerTypesForLocation(loc: string): HetznerTypeOption[] {
  return (LOCATION_TYPES[loc] || []).map((name) => ({
    name,
    label: `${name} — ${TYPE_SPECS[name] || name}`,
  }));
}

/** First (smallest) placeable type for a location — used as the default. */
export function defaultHetznerTypeForLocation(loc: string): string {
  return (LOCATION_TYPES[loc] || [])[0] || "cpx22";
}
