import { type WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq, desc } from "drizzle-orm";
import type { WsMessage } from "../types.js";
import * as railwayService from "../cloud/railway-service.js";
import * as auditService from "../logging/audit-service.js";
import * as emailService from "../notifications/email-service.js";
import * as settingsService from "../settings-service.js";
import { getDb } from "../db/index.js";
import { users, aiUsage } from "../db/schema.js";
import { generateEd25519KeyPair, sshKeyFingerprint, writeKeyToDisk } from "../vps/do-provision.js";
import { evictSession } from "../vps/ssh-session-cache.js";
import { type ClientState, activeExecTargets } from "../ws-server.js";


/** Handle admin:* leftovers: railway, prodlogs, audit, email, exec:cancel,
 *  sshkey, ai. Returns true if handled. */
export async function handleAdminMiscMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  state: ClientState,
): Promise<boolean> {
  const userId = state.userId;
  switch (msg.type) {
    case "admin:railway:test": {
      try {
        const result = await railwayService.testConnection();
        send(ws, { type: "admin:railway:test", payload: result });
      } catch (err: unknown) {
        send(ws, { type: "admin:railway:test", payload: { ok: false, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:prodlogs:deployments": {
      try {
        const deployments = await railwayService.getDeployments(msg.payload.limit ?? 20);
        send(ws, { type: "admin:prodlogs:deployments", payload: { deployments } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:prodlogs:logs": {
      try {
        const { deploymentId, logType, limit } = msg.payload;
        const logs = logType === "build"
          ? await railwayService.getBuildLogs(deploymentId, limit ?? 500)
          : await railwayService.getDeploymentLogs(deploymentId, limit ?? 500);
        send(ws, { type: "admin:prodlogs:logs", payload: { deploymentId, logType, logs } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:audit:list": {
      try {
        const { userId: filterUserId, action, from, to, limit, offset } = msg.payload;
        const logs = await auditService.getAuditLogs({
          userId: filterUserId,
          action,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
          limit,
          offset,
        });
        send(ws, { type: "admin:audit:list", payload: { logs } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:email:logs": {
      try {
        const logs = await emailService.getEmailLogs(200);
        send(ws, { type: "admin:email:logs", payload: { logs } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:email:send": {
      try {
        if (!userId) return true;
        const { recipientUserIds, allUsers, subject, body } = msg.payload as {
          recipientUserIds?: string[];
          allUsers?: boolean;
          subject?: string;
          body?: string;
        };
        if (!subject?.trim()) { send(ws, { type: "admin:email:send:error", payload: { message: "Subject is required" } }); return true; }
        if (!body?.trim()) { send(ws, { type: "admin:email:send:error", payload: { message: "Body is required" } }); return true; }

        const db = getDb();
        const allRows = await db.select({ id: users.id, email: users.email, isAgent: users.isAgent, validated: users.validated }).from(users);
        let recipients: emailService.EmailRecipient[];
        if (allUsers) {
          recipients = allRows
            .filter((u) => !u.isAgent && u.validated && u.email)
            .map((u) => ({ userId: u.id, email: u.email }));
        } else {
          const idSet = new Set(recipientUserIds ?? []);
          recipients = allRows
            .filter((u) => idSet.has(u.id) && u.email)
            .map((u) => ({ userId: u.id, email: u.email }));
        }

        if (recipients.length === 0) {
          send(ws, { type: "admin:email:send:error", payload: { message: "No valid recipients selected" } });
          return true;
        }

        const results = await emailService.sendCommunicationEmail({
          recipients,
          subject: subject.trim(),
          body: body.trim(),
          sentByUserId: userId,
          sentByName: state.user?.name ?? null,
        });

        const sent = results.filter((r) => r.status === "sent").length;
        const failed = results.length - sent;
        send(ws, { type: "admin:email:sent", payload: { sent, failed, total: results.length } });

        const logs = await emailService.getEmailLogs(200);
        send(ws, { type: "admin:email:logs", payload: { logs } });
      } catch (err: unknown) {
        send(ws, { type: "admin:email:send:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:exec:cancel": {
      const { execId } = msg.payload as { execId: string };
      const target = activeExecTargets.get(execId);
      if (target) {
        activeExecTargets.delete(execId);
        evictSession(target);
      }
      return true;
    }

    case "admin:sshkey:get": {
      try {
        const stored = await settingsService.getGenieKeyPair();
        const history = await settingsService.getGenieKeyHistory();
        const createdAt = await settingsService.getGlobalSetting<string>("genieKeyCreatedAt");
        if (stored) {
          const fingerprint = sshKeyFingerprint(stored.publicKey);
          send(ws, { type: "admin:sshkey:result", payload: { exists: true, publicKey: stored.publicKey, fingerprint, createdAt, history } });
        } else {
          send(ws, { type: "admin:sshkey:result", payload: { exists: false, publicKey: null, fingerprint: null, createdAt: null, history } });
        }
      } catch (err: unknown) {
        send(ws, { type: "admin:sshkey:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:sshkey:regenerate": {
      try {
        const { privateKey, publicKey } = await generateEd25519KeyPair("genie-deploy");
        await settingsService.saveGenieKeyPair(privateKey, publicKey);
        writeKeyToDisk(privateKey, publicKey);

        const fingerprint = sshKeyFingerprint(publicKey);
        const history = await settingsService.getGenieKeyHistory();
        const createdAt = await settingsService.getGlobalSetting<string>("genieKeyCreatedAt");
        send(ws, { type: "admin:sshkey:result", payload: { exists: true, publicKey, fingerprint, createdAt, history } });
      } catch (err: unknown) {
        send(ws, { type: "admin:sshkey:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:sshkey:delete": {
      try {
        await settingsService.deleteGenieKeyPair();
        const homeDir = os.homedir();
        const privPath = path.join(homeDir, ".genie", "ssh", "genie_ed25519");
        const pubPath = path.join(homeDir, ".genie", "ssh", "genie_ed25519.pub");
        try { fs.unlinkSync(privPath); } catch { /* missing → already gone */ }
        try { fs.unlinkSync(pubPath); } catch { /* missing → already gone */ }
        const history = await settingsService.getGenieKeyHistory();
        send(ws, { type: "admin:sshkey:result", payload: { exists: false, publicKey: null, fingerprint: null, createdAt: null, history } });
      } catch (err: unknown) {
        send(ws, { type: "admin:sshkey:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:ai:costs": {
      try {
        const db = getDb();
        const rows = await db
          .select({
            id: aiUsage.id,
            userId: aiUsage.userId,
            userName: users.name,
            modelId: aiUsage.modelId,
            modelLabel: aiUsage.modelLabel,
            inputTokens: aiUsage.inputTokens,
            outputTokens: aiUsage.outputTokens,
            cost: aiUsage.cost,
            source: aiUsage.source,
            createdAt: aiUsage.createdAt,
          })
          .from(aiUsage)
          .leftJoin(users, eq(aiUsage.userId, users.id))
          .orderBy(desc(aiUsage.createdAt))
          .limit(500);
        send(ws, { type: "admin:ai:costs", payload: { rows } });
      } catch (err: unknown) {
        send(ws, { type: "admin:ai:costs", payload: { rows: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:ai:settings:get": {
      try {
        const defaultModel = await settingsService.getGlobalSetting<string>("aiDefaultModel") ?? "claude-sonnet";
        const maxToolRounds = await settingsService.getGlobalSetting<number>("aiMaxToolRounds") ?? 10;
        send(ws, { type: "admin:ai:settings", payload: { defaultModel, maxToolRounds } });
      } catch (err: unknown) {
        send(ws, { type: "admin:ai:settings", payload: { defaultModel: "claude-sonnet", maxToolRounds: 10, error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:ai:settings:save": {
      try {
        const { defaultModel, maxToolRounds } = msg.payload;
        if (defaultModel != null) await settingsService.setGlobalSetting("aiDefaultModel", defaultModel);
        if (maxToolRounds != null) await settingsService.setGlobalSetting("aiMaxToolRounds", maxToolRounds);
        send(ws, { type: "admin:ai:settings", payload: { defaultModel, maxToolRounds } });
      } catch (err: unknown) {
        send(ws, { type: "admin:ai:settings:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
