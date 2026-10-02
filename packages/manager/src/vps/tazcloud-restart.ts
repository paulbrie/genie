import type { TazApiClient } from "./tazcloud-api-client.js";

const REBOOT_MAX_WAIT_MS = 3 * 60_000;
const REBOOT_POLL_MS = 4_000;
/** The API flips the VM to `REBOOT` within a second or two of the 202, but if
 *  we poll fast enough to catch it still reporting `ACTIVE` we'd declare
 *  victory before the box ever went down. Don't trust an `ACTIVE` reading
 *  before this many ms unless we've already seen the `REBOOT` state. */
const REBOOT_MIN_ACTIVE_MS = 12_000;

/** Issue `POST /v1/vm/{id}/restart` and poll `GET /v1/vm/{id}` until the VM is
 *  back to `ACTIVE`. Shared by the project-card (`vps:reboot`) and admin-card
 *  (`admin:tazcloud:reboot`) handlers so both surfaces behave identically.
 *  `progress` receives human-readable lines to stream to the client. */
export async function tazRestartVmAndWait(
  client: TazApiClient,
  vmId: string,
  progress: (message: string) => void,
  opts?: { hard?: boolean },
): Promise<void> {
  progress(opts?.hard ? "Issuing hard reset to TazCloud…" : "Issuing restart to TazCloud…");
  await client.restartVm(vmId, opts);
  const start = Date.now();
  let seenRebooting = false;
  while (Date.now() - start < REBOOT_MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, REBOOT_POLL_MS));
    const elapsed = Date.now() - start;
    const vm = await client.getVm(vmId);
    const status = (vm.status ?? "").toUpperCase();
    if (status === "ACTIVE" && (seenRebooting || elapsed >= REBOOT_MIN_ACTIVE_MS)) {
      progress("VM rebooted.");
      return;
    }
    if (status === "ERROR") throw new Error("VM entered ERROR state during restart");
    if (status !== "ACTIVE") seenRebooting = true;
    progress(`Reboot in progress… (${Math.round(elapsed / 1000)}s, ${status.toLowerCase() || "unknown"})`);
  }
  throw new Error("Restart timed out after 3 minutes");
}
