import * as projectService from "../project-service.js";
import { connectSsh } from "../vps/ssh-client.js";

const MAX_OUTPUT_BYTES = 30_000;
const HEAD_BYTES = 8_000;
const TAIL_BYTES = 22_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_BYTES) return output;
  const head = output.slice(0, HEAD_BYTES);
  const tail = output.slice(-TAIL_BYTES);
  return `${head}\n\n[...truncated ${output.length - HEAD_BYTES - TAIL_BYTES} characters...]\n\n${tail}`;
}

export async function executeSshExec(
  projectId: string,
  instanceIdentifier: string,
  command: string,
  timeoutMs: number,
): Promise<string> {
  const project = await projectService.getById(projectId);
  if (!project) return `Error: Project not found (id: ${projectId})`;

  const instances = project.vpsInstances;
  if (instances.length === 0) {
    return "Error: This project has no VPS instances configured. Add a VPS instance in the project settings first.";
  }

  // Match by id or label (case-insensitive), or auto-select if only one
  let instance = instances.find(
    (i) =>
      i.id === instanceIdentifier ||
      i.label.toLowerCase() === instanceIdentifier.toLowerCase(),
  );
  if (!instance && instances.length === 1) {
    instance = instances[0];
  }
  if (!instance) {
    const labels = instances.map((i) => `"${i.label}" (${i.id})`).join(", ");
    return `Error: Instance "${instanceIdentifier}" not found. Available instances: ${labels}`;
  }

  let session;
  try {
    session = await connectSsh(instance.connection, { timeoutMs: 30_000 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: Failed to connect to "${instance.label}" (${instance.connection.host}): ${message}`;
  }

  let output = "";
  try {
    // Use ssh-client's built-in timeouts:
    //   timeoutMs    — hard cap on total runtime (caller-controlled, max 10 min)
    //   idleTimeoutMs — kill if no stdout/stderr for 90s. Recipe installs all
    //     emit `log`/`wait_apt` heartbeats so they reset this timer; only a
    //     genuinely-hung command silently exceeds it, and now we surface that
    //     fast (with partial output) instead of waiting the full timeoutMs.
    const result = await session.exec(command, (chunk) => {
      output += chunk;
    }, { timeoutMs, idleTimeoutMs: 90_000 });
    return truncateOutput(result as string) || "(no output)";
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (output) {
      return truncateOutput(output) + `\n\n[Aborted: ${errMsg}]`;
    }
    return `Error: ${errMsg}`;
  } finally {
    session.close();
  }
}
