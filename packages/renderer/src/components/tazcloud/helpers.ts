// Helpers shared between tazcloud-panel.tsx and its extracted modules
// (taz-snapshots-section.tsx, manage-vm-popup.tsx). Kept colocated under
// `./tazcloud/` rather than `@/lib` because they're TazCloud-specific.

export const IMAGES = ["ubuntu-22", "ubuntu-24", "debian-12", "almalinux-9"];
export const SIZES = ["small", "medium", "large", "xlarge"];

export type VmBootSource =
  | { kind: "image"; image: string }
  | { kind: "snapshot"; snapshotId: string };

/** Select value for the deploy form — `base:<image>` or `snapshot:<id>`. */
export function formatVmBootSource(source: VmBootSource): string {
  return source.kind === "snapshot" ? `snapshot:${source.snapshotId}` : `base:${source.image}`;
}

export function parseVmBootSource(value: string): VmBootSource | null {
  if (value.startsWith("snapshot:")) {
    const snapshotId = value.slice("snapshot:".length);
    return snapshotId ? { kind: "snapshot", snapshotId } : null;
  }
  if (value.startsWith("base:")) {
    const image = value.slice("base:".length);
    return image ? { kind: "image", image } : null;
  }
  // Legacy plain image id (pre optgroup select).
  return value ? { kind: "image", image: value } : null;
}

export function defaultVmBootSource(images: string[] = IMAGES): string {
  return formatVmBootSource({ kind: "image", image: images[0] ?? "ubuntu-22" });
}

/** Image-default SSH user — the one TazCloud injects the key into. Always
 *  exists, regardless of whether Genie's bootstrap has run on this VM. */
export function imageDefaultUser(image?: string): string {
  switch (image) {
    case "ubuntu-22":
    case "ubuntu-24": return "ubuntu";
    case "debian-12": return "debian";
    case "almalinux-9": return "almalinux";
    default: return "ubuntu";  // best guess when image is unknown (listVms doesn't return it)
  }
}

/** SSH user the user probably wants for an interactive session. Order of
 *  inference:
 *    1. v2.0.0 vxlan-bastion VMs (`isPrivateHost`) — `genie` is the **only**
 *       user; image-default users don't exist there.
 *    2. Project-linked VMs (any provider/mode) — Genie's deploy flow creates
 *       a `genie` user.
 *    3. Otherwise — image-default user (legacy v6 bare VMs).
 *  Users can override via the dropdown if the heuristic is wrong. */
export function defaultSshUserFor(vm: { image?: string; projectId: string | null; isPrivateHost?: boolean }): string {
  if (vm.isPrivateHost) return "genie";
  if (vm.projectId) return "genie";
  return imageDefaultUser(vm.image);
}

export function defaultVmName(): string {
  // taz-<yyyymmddhhmm>-<3-char-random>
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
  const rand = Math.random().toString(36).slice(2, 5);
  return `taz-${ts}-${rand}`;
}

/** API name rule: starts with lowercase letter, ends lowercase letter/digit,
 *  body of lowercase letters/digits/hyphens, total length 3–63. Exported so
 *  callers can do their own inline "name is valid" checks without importing
 *  `validateTazVmName` and discarding its error message. */
export const TAZ_NAME_RE = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/;

export function validateTazVmName(name: string): string | null {
  if (!name) return "Name is required.";
  if (name.length < 3) return "Name must be at least 3 characters.";
  if (name.length > 63) return "Name must be at most 63 characters.";
  if (!TAZ_NAME_RE.test(name)) {
    return "Name must be lowercase, start with a letter, end with a letter or digit, and contain only letters, digits, and hyphens.";
  }
  return null;
}

