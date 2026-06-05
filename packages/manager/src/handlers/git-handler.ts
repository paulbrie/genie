// Git handlers: status, log, branches, diff, stage/unstage, commit, push,
// pull, checkout, stash/pop. All twelve cases share the same prologue —
// resolve the VPS connection from (projectId, instanceId), open one SSH
// session, run the relevant git command in `folder` (or /opt/project by
// default), and reply on the `git:*:result` or `git:*:done` channel. Errors
// short-circuit through a single `git:error` reply.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import { getVpsConnection } from "../vps/connection-resolver.js";
import { connectSsh, type SshSession } from "../vps/ssh-client.js";
import * as projectService from "../project-service.js";
import { isPrivilegedRole, type Role } from "../ws-acl.js";


const GIT_TYPES = new Set([
  "git:status", "git:log", "git:branches", "git:diff",
  "git:stage", "git:unstage", "git:commit",
  "git:push", "git:pull", "git:checkout",
  "git:stash", "git:stash-pop",
]);

export async function handleGitMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string | null,
  role: Role | null,
): Promise<boolean> {
  if (!GIT_TYPES.has(msg.type)) return false;

  const { projectId, instanceId, folder, reqId } = msg.payload;
  const gitReply = (type: string, extra: Record<string, unknown>) =>
    send(ws, { type, payload: { ...extra, ...(reqId ? { reqId } : {}) } });

  // git:* runs arbitrary git commands on the project's VPS — gate on project
  // access (privileged roles bypass) so a user can't operate on a project's
  // repo they have no access to.
  if (!isPrivilegedRole(role) && !(await projectService.userCanSeeProject(userId, projectId))) {
    gitReply("git:error", { message: "Not authorized for this project" });
    return true;
  }

  let conn;
  try {
    conn = await getVpsConnection(projectId, instanceId);
  } catch {
    gitReply("git:error", { message: "VPS instance not found" });
    return true;
  }
  let session: SshSession;
  try {
    session = await connectSsh(conn, { timeoutMs: 15_000 });
  } catch (err: unknown) {
    gitReply("git:error", { message: `SSH failed: ${(err instanceof Error ? err.message : String(err))}` });
    return true;
  }

  const cwd = folder || "/opt/project";
  try {
    let result: string;
    switch (msg.type) {
      case "git:status": {
        const porcelain = await session.exec(`cd ${cwd} && git status --porcelain -b 2>&1`);
        const branch = await session.exec(`cd ${cwd} && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""`);
        const ahead = await session.exec(`cd ${cwd} && git rev-list --count @{u}..HEAD 2>/dev/null || echo "0"`);
        const behind = await session.exec(`cd ${cwd} && git rev-list --count HEAD..@{u} 2>/dev/null || echo "0"`);
        gitReply("git:status:result", { projectId, folder: cwd, porcelain: porcelain.trim(), branch: branch.trim(), ahead: parseInt(ahead.trim()) || 0, behind: parseInt(behind.trim()) || 0 });
        break;
      }
      case "git:log": {
        const count = msg.payload.count || 50;
        result = await session.exec(`cd ${cwd} && git log --oneline --decorate -n ${count} 2>&1`);
        gitReply("git:log:result", { projectId, folder: cwd, log: result.trim() });
        break;
      }
      case "git:branches": {
        result = await session.exec(`cd ${cwd} && git branch -a --format='%(refname:short) %(HEAD)' 2>&1`);
        gitReply("git:branches:result", { projectId, folder: cwd, branches: result.trim() });
        break;
      }
      case "git:diff": {
        const { file, staged } = msg.payload;
        const diffCmd = staged ? "git diff --cached" : "git diff";
        const target = file ? ` -- "${file}"` : "";
        result = await session.exec(`cd ${cwd} && ${diffCmd}${target} 2>&1`);
        gitReply("git:diff:result", { projectId, folder: cwd, file, staged, diff: result });
        break;
      }
      case "git:stage": {
        const files: string[] = msg.payload.files || ["."];
        result = await session.exec(`cd ${cwd} && git add ${files.map((f: string) => `"${f}"`).join(" ")} 2>&1`);
        gitReply("git:stage:done", { projectId, folder: cwd });
        break;
      }
      case "git:unstage": {
        const files: string[] = msg.payload.files || ["."];
        result = await session.exec(`cd ${cwd} && git reset HEAD ${files.map((f: string) => `"${f}"`).join(" ")} 2>&1`);
        gitReply("git:unstage:done", { projectId, folder: cwd });
        break;
      }
      case "git:commit": {
        const message = msg.payload.message || "commit";
        // Escape single quotes in commit message
        const safeMsg = message.replace(/'/g, "'\\''");
        result = await session.exec(`cd ${cwd} && git commit -m '${safeMsg}' 2>&1`);
        gitReply("git:commit:done", { projectId, folder: cwd, output: result.trim() });
        break;
      }
      case "git:push": {
        result = await session.exec(`cd ${cwd} && git push 2>&1`, undefined, { timeoutMs: 60_000 });
        gitReply("git:push:done", { projectId, folder: cwd, output: result.trim() });
        break;
      }
      case "git:pull": {
        result = await session.exec(`cd ${cwd} && git pull 2>&1`, undefined, { timeoutMs: 60_000 });
        gitReply("git:pull:done", { projectId, folder: cwd, output: result.trim() });
        break;
      }
      case "git:checkout": {
        const branchName = msg.payload.branch;
        result = await session.exec(`cd ${cwd} && git checkout "${branchName}" 2>&1`);
        gitReply("git:checkout:done", { projectId, folder: cwd, output: result.trim() });
        break;
      }
      case "git:stash": {
        result = await session.exec(`cd ${cwd} && git stash 2>&1`);
        gitReply("git:stash:done", { projectId, folder: cwd, output: result.trim() });
        break;
      }
      case "git:stash-pop": {
        result = await session.exec(`cd ${cwd} && git stash pop 2>&1`);
        gitReply("git:stash-pop:done", { projectId, folder: cwd, output: result.trim() });
        break;
      }
    }
  } catch (err: unknown) {
    gitReply("git:error", { message: (err instanceof Error ? err.message : String(err)) });
  } finally {
    session.close();
  }
  return true;
}
