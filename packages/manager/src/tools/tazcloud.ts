import { createTazClient, defaultSshUserForVm } from "../vps/tazcloud-api-client.js";

function getClient(): { client: ReturnType<typeof createTazClient> } | { error: string } {
  const token = process.env.TAZCLOUD_API_TOKEN;
  if (!token) return { error: "Error: TAZCLOUD_API_TOKEN is not configured on the manager." };
  return { client: createTazClient(token) };
}

export async function executeTazListVms(): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  try {
    const vms = await c.client.listVms();
    if (vms.length === 0) return "No TazCloud VMs.";
    const lines = vms.map((vm) => {
      const parts = [
        `${vm.name} (${vm.id})`,
        `status=${vm.status}`,
        // v2 vxlan-bastion VMs have null ipv6 — show ssh_host (private IP) instead.
        `host=${vm.ssh_host || vm.ipv6 || "-"}`,
      ];
      if (vm.ssh_bastion) parts.push(`bastion=${vm.ssh_bastion}`);
      if (vm.image) parts.push(`image=${vm.image}`);
      if (vm.size) parts.push(`size=${vm.size}`);
      if (vm.project_id) parts.push(`project=${vm.project_id}`);
      if (vm.ingress) {
        parts.push(`domain=${vm.ingress.domain}`);
        parts.push(`url=${vm.ingress.url}`);
        if (vm.ingress.status) parts.push(`ingress_status=${vm.ingress.status}`);
      }
      return `- ${parts.join(" ")}`;
    });
    return `${vms.length} VM(s):\n${lines.join("\n")}`;
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeTazGetVm(vmId: string): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  try {
    const vm = await c.client.getVm(vmId);
    const lines = [
      `VM ${vm.name} (${vm.id})`,
      `Status: ${vm.status}`,
      `Host: ${vm.ssh_host}${vm.ipv6 ? ` (ipv6: ${vm.ipv6})` : ""}`,
      // Prefer the API's ready-to-run ssh_command on v2 since it includes -J.
      `SSH: ${vm.ssh_command ?? `ssh ${defaultSshUserForVm(vm)}@${vm.ssh_host} -p ${vm.ssh_port}`}`,
    ];
    if (vm.image) lines.push(`Image: ${vm.image}`);
    if (vm.snapshot_id) lines.push(`Booted from snapshot: ${vm.snapshot_id}`);
    if (vm.size) lines.push(`Size: ${vm.size}`);
    if (vm.project_id) lines.push(`Project: ${vm.project_id}`);
    if (vm.ingress) {
      lines.push("");
      lines.push("Ingress:");
      lines.push(`  Domain: ${vm.ingress.domain}`);
      lines.push(`  Public URL: ${vm.ingress.url}`);
      lines.push(`  Status: ${vm.ingress.status}`);
      lines.push(`  Ingress IP: ${vm.ingress.ip}`);
      lines.push(`  DNS action: ${vm.ingress.dns_action}`);
    } else {
      lines.push("Ingress: not registered (no custom domain attached)");
    }
    return lines.join("\n");
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeTazCreateVm(opts: {
  name: string;
  image?: string;
  size?: string;
  snapshot_id?: string;
}): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  if (opts.image && opts.snapshot_id) {
    return "Error: `image` and `snapshot_id` are mutually exclusive — choose one.";
  }
  try {
    const vm = await c.client.createVm(opts);
    const lines = [
      `Created VM ${vm.name} (${vm.id})`,
      `Status: ${vm.status}`,
      `Host: ${vm.ssh_host}${vm.ipv6 ? ` (ipv6: ${vm.ipv6})` : ""}`,
    ];
    if (vm.image) lines.push(`Image: ${vm.image}`);
    if (vm.snapshot_id) lines.push(`Booted from snapshot: ${vm.snapshot_id}`);
    if (vm.size) lines.push(`Size: ${vm.size}`);
    if (vm.project_id) lines.push(`Project: ${vm.project_id}`);
    lines.push(`SSH: ${vm.ssh_command ?? `ssh ${defaultSshUserForVm(vm)}@${vm.ssh_host} -p ${vm.ssh_port}`}`);
    return lines.join("\n");
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeTazDeleteVm(vmId: string): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  try {
    const result = await c.client.deleteVm(vmId);
    return `Deleted VM ${result.id}. Status: ${result.status}. Released ports: ${result.deleted_ports.join(", ") || "(none)"}.`;
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---- Snapshots ----

export async function executeTazListSnapshots(): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  try {
    const snaps = await c.client.listSnapshots();
    if (snaps.length === 0) return "No TazCloud snapshots.";
    const lines = snaps.map((s) =>
      `- ${s.name} (${s.id}) status=${s.status} size=${s.size_gb}GB source_vm=${s.source_vm_id} created=${s.created}`,
    );
    return `${snaps.length} snapshot(s):\n${lines.join("\n")}`;
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeTazGetSnapshot(snapshotId: string): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  try {
    const s = await c.client.getSnapshot(snapshotId);
    return [
      `Snapshot ${s.name} (${s.id})`,
      `Status: ${s.status}`,
      `Size: ${s.size_gb} GB`,
      `Source VM: ${s.source_vm_id}`,
      `Created: ${s.created}`,
    ].join("\n");
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeTazCreateSnapshot(opts: {
  vmId: string;
  name: string;
  stop_first?: boolean;
}): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  try {
    const s = await c.client.createSnapshot(opts.vmId, { name: opts.name, stop_first: opts.stop_first });
    return [
      `Snapshot create accepted: ${s.name} (${s.id})`,
      `Status: ${s.status} — poll tazcloud_get_snapshot until 'active' (typically 1–5 min)${opts.stop_first ? ", +30–90s for VM stop/restart" : ""}.`,
      `Source VM: ${s.source_vm_id}`,
      `Size: ${s.size_gb} GB`,
    ].join("\n");
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeTazDeleteSnapshot(snapshotId: string): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  try {
    const result = await c.client.deleteSnapshot(snapshotId);
    return `Deleted snapshot ${result.id}. Status: ${result.status}.`;
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---- Ingress ----

export async function executeTazRegisterIngress(opts: {
  vmId: string;
  domain: string;
  app_port?: number;
}): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  try {
    const ing = await c.client.registerIngress(opts.vmId, { domain: opts.domain, app_port: opts.app_port });
    return [
      `Ingress registered for ${ing.domain}`,
      `URL: ${ing.url}`,
      `Status: ${ing.status}`,
      `DNS action: ${ing.dns_action}`,
      `(All TazCloud ingress domains resolve to ${ing.ip}. TLS is issued via Let's Encrypt automatically once DNS propagates, usually within ~60s.)`,
    ].join("\n");
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeTazRemoveIngress(vmId: string): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  try {
    const result = await c.client.removeIngress(vmId);
    return `Ingress removed from VM ${result.vm_id}. Status: ${result.status}.`;
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---- Capabilities ----

export async function executeTazGetCapabilities(): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  try {
    const caps = await c.client.getCapabilities();
    const lines = [
      `Images: ${caps.images.join(", ")}`,
      `Sizes: ${caps.sizes.join(", ")}`,
      `SSH access: ${caps.vm_access.mode} via ${caps.vm_access.bastion_ip}`,
    ];
    if (caps.ingress) {
      lines.push(
        `Ingress: ${caps.ingress.available ? "available" : "unavailable"}` +
        ` — public IP ${caps.ingress.public_ip}, TLS=${caps.ingress.tls}`,
      );
    } else {
      lines.push("Ingress: not advertised on this deployment");
    }
    if (caps.projects?.available) {
      lines.push("Projects: required (every VM must belong to one)");
    }
    return lines.join("\n");
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
