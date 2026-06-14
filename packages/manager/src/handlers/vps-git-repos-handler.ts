// vps:git:repos:* — per-(project, instance) git repo registry. Drives the
// Manager popup's Github tab + the on-VM hourly auto-save daemon.
//
// CRUD writes go through git-repo-service (encryption lives there). Any
// mutation that touches `autoSave` reconciles the on-VM daemon via
// syncAutoSaveOnVm; init/clone use the same SSH session to run a one-off
// shell command. Browsing commits/branches goes through the existing
// git:log / git:branches in git-handler.ts — not duplicated here.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as gitRepoService from "../vps/git-repo-service.js";
import { getVpsConnection } from "../vps/connection-resolver.js";
import { connectSsh, type SshSession } from "../vps/ssh-client.js";
import { syncAutoSaveOnVm } from "../vps/git-autosave-reconciler.js";
import { type Role } from "../auth/ws-acl.js";
import { canAccessProject } from "./handler-auth.js";

const REPO_TYPES = new Set([
  "vps:git:repos:list",
  "vps:git:repos:add",
  "vps:git:repos:update",
  "vps:git:repos:remove",
  "vps:git:repos:init",
  "vps:git:repos:clone",
  "vps:git:repos:detect",
  "vps:git:repos:set-auto-save",
]);

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Run a one-shot command on the VM. Caller owns the session lifecycle. */
async function runOnVm(
  projectId: string,
  instanceId: string,
  fn: (session: SshSession) => Promise<void>,
): Promise<void> {
  const conn = await getVpsConnection(projectId, instanceId);
  const session = await connectSsh(conn, { timeoutMs: 15_000 });
  try {
    await fn(session);
  } finally {
    session.close();
  }
}

export async function handleVpsGitReposMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string | null,
  broadcast: (message: WsMessage) => void,
  role: Role | null,
): Promise<boolean> {
  if (!REPO_TYPES.has(msg.type)) return false;

  const { projectId, instanceId, reqId } = (msg.payload ?? {}) as { projectId?: string; instanceId?: string; reqId?: string };
  const reply = (type: string, payload: Record<string, unknown>) =>
    send(ws, { type, payload: { ...payload, ...(reqId ? { reqId } : {}) } });

  if (!projectId || !instanceId) {
    reply("vps:git:repos:error", { message: "projectId and instanceId required" });
    return true;
  }
  if (!(await canAccessProject(userId, role, projectId))) {
    reply("vps:git:repos:error", { message: "Not authorized for this project" });
    return true;
  }
  if (!userId) {
    reply("vps:git:repos:error", { message: "Not authenticated" });
    return true;
  }

  const broadcastStale = () => broadcast({ type: "vps:git:repos:list:stale", payload: { projectId, instanceId } });

  try {
    switch (msg.type) {
      case "vps:git:repos:list": {
        const repos = await gitRepoService.listForInstance(projectId, instanceId);
        reply("vps:git:repos:list", { projectId, instanceId, repos });
        return true;
      }

      case "vps:git:repos:add": {
        const { repoUrl, repoPath, provider, token, autoSave } = msg.payload as {
          repoUrl: string;
          repoPath: string;
          provider?: gitRepoService.GitProvider;
          token?: string | null;
          autoSave?: boolean;
        };
        if (!repoUrl || !repoPath) throw new Error("repoUrl and repoPath required");
        const row = await gitRepoService.add({
          projectId, instanceId, repoUrl, repoPath, provider, token, autoSave, createdBy: userId,
        });
        if (row.autoSave) {
          await runOnVm(projectId, instanceId, (s) => syncAutoSaveOnVm(s, projectId, instanceId));
        }
        reply("vps:git:repos:upserted", { repo: row });
        broadcastStale();
        return true;
      }

      case "vps:git:repos:update": {
        const { id, patch } = msg.payload as {
          id: string;
          patch: Parameters<typeof gitRepoService.update>[1];
        };
        const row = await gitRepoService.update(id, patch);
        if (!row) throw new Error("Repo not found");
        // Reconcile whenever the patch could have changed daemon state:
        // autoSave flips, token changes, repo path changes.
        if (patch && ("autoSave" in patch || "token" in patch || "repoPath" in patch || "repoUrl" in patch)) {
          await runOnVm(projectId, instanceId, (s) => syncAutoSaveOnVm(s, projectId, instanceId));
        }
        reply("vps:git:repos:upserted", { repo: row });
        broadcastStale();
        return true;
      }

      case "vps:git:repos:remove": {
        const { id } = msg.payload as { id: string };
        const existed = await gitRepoService.remove(id);
        if (!existed) throw new Error("Repo not found");
        await runOnVm(projectId, instanceId, (s) => syncAutoSaveOnVm(s, projectId, instanceId));
        reply("vps:git:repos:removed", { id });
        broadcastStale();
        return true;
      }

      case "vps:git:repos:set-auto-save": {
        const { id, enabled } = msg.payload as { id: string; enabled: boolean };
        const row = await gitRepoService.update(id, { autoSave: enabled });
        if (!row) throw new Error("Repo not found");
        await runOnVm(projectId, instanceId, (s) => syncAutoSaveOnVm(s, projectId, instanceId));
        reply("vps:git:repos:upserted", { repo: row });
        broadcastStale();
        return true;
      }

      case "vps:git:repos:detect": {
        // Probe the VM filesystem for a pre-existing git repo at repoPath that
        // isn't yet registered. Lets the Github tab offer "adopt this repo"
        // instead of showing an empty state when the box was set up out-of-band.
        const { repoPath } = msg.payload as { repoPath?: string };
        const path = repoPath || "/opt/project";
        const detected = await detectRepoOnVm(projectId, instanceId, path);
        reply("vps:git:repos:detected", { projectId, instanceId, repoPath: path, ...detected });
        return true;
      }

      case "vps:git:repos:init": {
        const { repoPath, repoUrl } = msg.payload as { repoPath: string; repoUrl?: string };
        if (!repoPath) throw new Error("repoPath required");
        await runOnVm(projectId, instanceId, async (s) => {
          const cmd = [
            `sudo mkdir -p ${shellQuote(repoPath)}`,
            `sudo chown -R genie:genie ${shellQuote(repoPath)}`,
            `cd ${shellQuote(repoPath)} && (git rev-parse --is-inside-work-tree 2>/dev/null || git init)`,
            repoUrl ? `cd ${shellQuote(repoPath)} && (git remote set-url origin ${shellQuote(repoUrl)} 2>/dev/null || git remote add origin ${shellQuote(repoUrl)})` : "true",
          ].join(" && ");
          await s.exec(cmd, undefined, { timeoutMs: 30_000 });
        });
        reply("vps:git:repos:init:done", { projectId, instanceId, repoPath });
        return true;
      }

      case "vps:git:repos:clone": {
        const { id, repoUrl, repoPath } = msg.payload as { id?: string; repoUrl: string; repoPath: string };
        if (!repoUrl || !repoPath) throw new Error("repoUrl and repoPath required");
        const token = id ? await gitRepoService.getTokenForRepo(id) : null;
        const authedUrl = token ? injectTokenIntoUrl(repoUrl, token) : repoUrl;
        await runOnVm(projectId, instanceId, async (s) => {
          // Wrap in single quotes via shellQuote so the token is invisible to
          // the SSH wire log (process listings on the VM still see it — that's
          // unavoidable for a one-shot clone). The shellQuote helper is safe
          // for arbitrary token chars.
          const cmd = [
            `sudo mkdir -p $(dirname ${shellQuote(repoPath)})`,
            `sudo chown -R genie:genie $(dirname ${shellQuote(repoPath)})`,
            `git clone ${shellQuote(authedUrl)} ${shellQuote(repoPath)}`,
          ].join(" && ");
          await s.exec(cmd, undefined, { timeoutMs: 120_000 });
        });
        reply("vps:git:repos:clone:done", { projectId, instanceId, repoPath });
        return true;
      }
    }
  } catch (err: unknown) {
    reply("vps:git:repos:error", { message: err instanceof Error ? err.message : String(err) });
    return true;
  }
  return false;
}

/** Probe a path on the VM for a git work tree. Returns whether one exists and,
 *  if so, its origin remote URL and current branch — enough for the Github tab
 *  to pre-fill an "adopt existing repo" form. Never throws: a missing repo, a
 *  missing path, or an SSH hiccup all collapse to `{ isRepo: false }`. */
async function detectRepoOnVm(
  projectId: string,
  instanceId: string,
  repoPath: string,
): Promise<{ isRepo: boolean; remoteUrl: string | null; branch: string | null }> {
  try {
    const conn = await getVpsConnection(projectId, instanceId);
    const session = await connectSsh(conn, { timeoutMs: 15_000 });
    try {
      const q = shellQuote(repoPath);
      // One round-trip: print a sentinel-delimited triple only when inside a
      // work tree, else "no". Tolerates the path not existing (cd fails -> no).
      const out = await session.exec(
        `cd ${q} 2>/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1 ` +
        `&& printf 'YES\\n%s\\n%s\\n' ` +
        `"$(git remote get-url origin 2>/dev/null)" ` +
        `"$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" ` +
        `|| printf 'NO\\n'`,
        undefined,
        { timeoutMs: 15_000 },
      );
      const [marker, remoteLine = "", branchLine = ""] = out.trim().split("\n");
      if (marker !== "YES") return { isRepo: false, remoteUrl: null, branch: null };
      return {
        isRepo: true,
        remoteUrl: remoteLine.trim() || null,
        branch: branchLine.trim() || null,
      };
    } finally {
      session.close();
    }
  } catch {
    return { isRepo: false, remoteUrl: null, branch: null };
  }
}

/** Inject `user:token@` into the https URL host segment. Picks the
 *  credential-style user the on-VM script will also use, so a manual clone
 *  here and a daemon push later see consistent credentials. */
function injectTokenIntoUrl(url: string, token: string): string {
  try {
    const u = new URL(url);
    const user = u.host === "github.com" ? "x-access-token" : "oauth2";
    u.username = user;
    u.password = token;
    return u.toString();
  } catch {
    return url;
  }
}
