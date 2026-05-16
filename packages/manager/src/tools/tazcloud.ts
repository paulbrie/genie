import { createTazClient } from "../vps/tazcloud-api-client.js";

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
        `ipv6=${vm.ipv6}`,
      ];
      if (vm.image) parts.push(`image=${vm.image}`);
      if (vm.size) parts.push(`size=${vm.size}`);
      return `- ${parts.join(" ")}`;
    });
    return `${vms.length} VM(s):\n${lines.join("\n")}`;
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeTazCreateVm(opts: { name: string; image?: string; size?: string }): Promise<string> {
  const c = getClient();
  if ("error" in c) return c.error;
  try {
    const vm = await c.client.createVm(opts);
    return [
      `Created VM ${vm.name} (${vm.id})`,
      `Status: ${vm.status}`,
      `IPv6: ${vm.ipv6}`,
      `Image: ${vm.image ?? "unknown"}`,
      `Size: ${vm.size ?? "unknown"}`,
      `SSH: ssh ${vm.ssh_host} -p ${vm.ssh_port}  (user depends on image — ubuntu/debian/almalinux)`,
    ].join("\n");
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
