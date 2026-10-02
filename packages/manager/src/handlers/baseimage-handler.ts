import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as settingsService from "../settings-service.js";
import type { BaseImageConfig, BaseImageTemplate } from "../settings-service.js";
import { createDoClient } from "../vps/do-api-client.js";
import { ensureGenieKeyOnDisk, ensureGenieKeyPair, sshKeyFingerprint } from "../vps/do-provision.js";
import { createBaseImage } from "../vps/do-base-image.js";


/** Only one base-image build runs at a time across the process. */
let baseImageAbortController: AbortController | null = null;
/** Name of the template currently building (used to mirror progress to the UI). */
let baseImageBuildingName: string | null = null;

/** Handle every `admin:baseimage:*` message. Returns true if handled. */
export async function handleBaseimageMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  broadcast: (message: WsMessage) => void,
): Promise<boolean> {
  switch (msg.type) {
    case "admin:baseimage:configs:list": {
      const doToken = await settingsService.getGlobalDoToken();
      const configs = await settingsService.getAllBaseImageConfigs();
      const templates = await settingsService.getAllBaseImageTemplates();
      const verifiedTemplates: Record<string, unknown> = {};
      if (doToken) {
        try {
          const doClient = createDoClient(doToken);
          const snapshots = await doClient.listAccountSnapshots();
          const snapIds = new Set(snapshots.map((s) => String(s.id)));
          for (const [name, tmpl] of Object.entries(templates)) {
            const verified = tmpl.snapshotId ? snapIds.has(String(tmpl.snapshotId)) : false;
            let snapshotName = tmpl.snapshotName;
            if (tmpl.snapshotId) {
              const snap = snapshots.find((s) => String(s.id) === String(tmpl.snapshotId));
              if (snap) snapshotName = snap.name;
            }
            verifiedTemplates[name] = { ...tmpl, verified, snapshotName };
          }
        } catch {
          for (const [name, tmpl] of Object.entries(templates)) {
            verifiedTemplates[name] = { ...tmpl, verified: false };
          }
        }
      } else {
        for (const [name, tmpl] of Object.entries(templates)) {
          verifiedTemplates[name] = { ...tmpl, verified: false };
        }
      }
      const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
      send(ws, { type: "admin:baseimage:configs:list", payload: { configs, templates: verifiedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      return true;
    }

    case "admin:baseimage:config:save": {
      try {
        const { name, config, originalName } = msg.payload as { name: string; config: BaseImageConfig; originalName?: string };
        if (originalName && originalName !== name) {
          await settingsService.deleteBaseImageConfigByName(originalName);
          const allTemplates = await settingsService.getAllBaseImageTemplates();
          for (const [tName, tmpl] of Object.entries(allTemplates)) {
            if (tmpl.configName === originalName) {
              allTemplates[tName] = { ...tmpl, configName: name };
            }
          }
          await settingsService.saveAllBaseImageTemplates(allTemplates);
          await settingsService.saveBaseImageConfigByName(name, config);
        } else {
          await settingsService.saveBaseImageConfigByName(name, config);
        }
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:baseimage:config:delete": {
      try {
        const { name } = msg.payload as { name: string };
        await settingsService.deleteBaseImageConfigByName(name);
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:baseimage:template:save": {
      try {
        const { name, template, originalName } = msg.payload as { name: string; template: BaseImageTemplate; originalName?: string };
        if (originalName && originalName !== name) {
          const oldTmpl = await settingsService.getBaseImageTemplateByName(originalName);
          await settingsService.deleteBaseImageTemplateByName(originalName);
          await settingsService.saveBaseImageTemplateByName(name, {
            ...template,
            snapshotId: template.snapshotId ?? oldTmpl?.snapshotId ?? null,
            snapshotName: template.snapshotName ?? oldTmpl?.snapshotName ?? null,
          });
        } else {
          const existing = await settingsService.getBaseImageTemplateByName(name);
          await settingsService.saveBaseImageTemplateByName(name, {
            ...template,
            snapshotId: template.snapshotId ?? existing?.snapshotId ?? null,
            snapshotName: template.snapshotName ?? existing?.snapshotName ?? null,
          });
        }
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:baseimage:template:delete": {
      try {
        const { name } = msg.payload as { name: string };
        await settingsService.deleteBaseImageTemplateByName(name);
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:baseimage:template:restore": {
      try {
        const { name } = msg.payload as { name: string };
        await settingsService.restoreBaseImageTemplateByName(name);
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:baseimage:template:hard-delete": {
      try {
        const { name } = msg.payload as { name: string };
        await settingsService.hardDeleteBaseImageTemplateByName(name);
        const updatedConfigs = await settingsService.getAllBaseImageConfigs();
        const updatedTemplates = await settingsService.getAllBaseImageTemplates();
        const deletedTemplates = await settingsService.getDeletedBaseImageTemplates();
        send(ws, { type: "admin:baseimage:configs:list", payload: { configs: updatedConfigs, templates: updatedTemplates, deletedTemplates, buildingName: baseImageBuildingName } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:baseimage:template:history": {
      try {
        const { name } = msg.payload as { name?: string };
        const history = name
          ? await settingsService.getTemplateHistory(name)
          : await settingsService.getAllTemplateHistory();
        send(ws, { type: "admin:baseimage:template:history", payload: { history } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:baseimage:test": {
      const { templateName } = msg.payload as { templateName: string };
      const doToken = await settingsService.getGlobalDoToken();
      if (!doToken) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: "DigitalOcean API token not configured" } });
        return true;
      }
      const biTemplate = await settingsService.getBaseImageTemplateByName(templateName);
      if (!biTemplate?.snapshotId) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: `Template "${templateName}" has no snapshot — build it first` } });
        return true;
      }
      const biConfig = await settingsService.getBaseImageConfigByName(biTemplate.configName);
      if (!biConfig) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: `Config "${biTemplate.configName}" not found` } });
        return true;
      }
      baseImageBuildingName = templateName;
      void (async () => {
        try {
          const client = createDoClient(doToken);
          const keyPair = await ensureGenieKeyPair();
          await ensureGenieKeyOnDisk();
          const fingerprint = sshKeyFingerprint(keyPair.publicKey);
          const existingKeys = await client.listSshKeys();
          let keyId: number;
          const existing = existingKeys.find((k) => k.fingerprint === fingerprint);
          if (existing) {
            keyId = existing.id;
          } else {
            const created = await client.createSshKey(`genie-${Date.now()}`, keyPair.publicKey.trim());
            keyId = created.id;
          }

          broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: `Creating test droplet from snapshot ${biTemplate.snapshotId}...` } });
          const droplet = await client.createDroplet({
            name: `genie-test-${templateName}-${Date.now()}`,
            region: biConfig.region,
            size: biConfig.size,
            image: biTemplate.snapshotId!,
            sshKeyIds: [keyId],
            tags: ["genie-test"],
          });
          const dropletId = droplet.id;
          broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: `Test droplet created (id: ${dropletId}), waiting for active...` } });

          let ipAddress = "";
          const pollStart = Date.now();
          while (Date.now() - pollStart < 120_000) {
            const current = await client.getDroplet(dropletId);
            const pub = current.networks?.v4?.find((n) => n.type === "public");
            if (current.status === "active" && pub?.ip_address) {
              ipAddress = pub.ip_address;
              break;
            }
            broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: `Droplet status: ${current.status}...` } });
            await new Promise((r) => setTimeout(r, 5_000));
          }
          if (!ipAddress) throw Object.assign(new Error("Timed out waiting for droplet"), { failedDropletId: dropletId, failedDropletIp: "" });

          broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: `Test droplet ready at ${ipAddress}` } });
          broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: `SSH: ssh -o StrictHostKeyChecking=no -i ~/.genie/ssh/genie_ed25519 root@${ipAddress}` } });

          baseImageBuildingName = null;
          broadcast({ type: "admin:baseimage:error", payload: {
            configName: templateName,
            message: `Test droplet ready — connect to debug, destroy when done`,
            failedDropletId: dropletId,
            failedDropletIp: ipAddress,
          } });
        } catch (err: unknown) {
          baseImageBuildingName = null;
          broadcast({ type: "admin:baseimage:error", payload: {
            configName: templateName,
            message: (err instanceof Error ? err.message : String(err)),
            failedDropletId: ((err as Error & { failedDropletId?: number }).failedDropletId) || null,
            failedDropletIp: ((err as Error & { failedDropletIp?: string }).failedDropletIp) || null,
          } });
        }
      })();
      return true;
    }

    case "admin:baseimage:destroy-failed": {
      try {
        const { dropletId } = msg.payload as { dropletId: number };
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const doClient = createDoClient(doToken);
        await doClient.deleteDroplet(dropletId);
        broadcast({ type: "admin:baseimage:progress", payload: { configName: "", message: `Failed build droplet ${dropletId} destroyed` } });
      } catch (err: unknown) {
        send(ws, { type: "admin:baseimage:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:baseimage:create": {
      const { templateName } = msg.payload as { templateName: string };
      const doToken = await settingsService.getGlobalDoToken();
      if (!doToken) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: "DigitalOcean API token not configured" } });
        return true;
      }
      if (baseImageAbortController) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: "Base image creation already in progress" } });
        return true;
      }
      const biTemplate = await settingsService.getBaseImageTemplateByName(templateName);
      if (!biTemplate) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: `Template "${templateName}" not found` } });
        return true;
      }
      const biConfig = await settingsService.getBaseImageConfigByName(biTemplate.configName);
      if (!biConfig) {
        send(ws, { type: "admin:baseimage:error", payload: { configName: templateName, message: `Config "${biTemplate.configName}" referenced by template "${templateName}" not found` } });
        return true;
      }
      baseImageAbortController = new AbortController();
      baseImageBuildingName = templateName;
      void createBaseImage(
        {
          token: doToken,
          region: biConfig.region,
          size: biConfig.size,
          snapshotPrefix: biTemplate.snapshotPrefix,
          provisionScript: biConfig.provisionScript,
          signal: baseImageAbortController.signal,
        },
        (step) => { broadcast({ type: "admin:baseimage:progress", payload: { configName: templateName, message: step } }); },
      ).then(async (result) => {
        baseImageAbortController = null;
        baseImageBuildingName = null;
        await settingsService.saveBaseImageTemplateByName(templateName, { ...biTemplate, snapshotId: result.snapshotId, snapshotName: result.snapshotName });

        // Clean up old snapshots matching this template's prefix, but protect IDs used by any template.
        try {
          const allTemplates = await settingsService.getAllBaseImageTemplates();
          const protectedIds = new Set<string>();
          for (const tmpl of Object.values(allTemplates)) {
            if (tmpl.snapshotId) protectedIds.add(String(tmpl.snapshotId));
          }
          const doClient = createDoClient(doToken);
          const allSnapshots = await doClient.listAccountSnapshots();
          for (const old of allSnapshots) {
            if (old.name.startsWith("snapshot-" + biTemplate.snapshotPrefix + "-") && !protectedIds.has(String(old.id))) {
              try {
                await doClient.deleteSnapshot(old.id);
              } catch { /* best-effort cleanup */ }
            }
          }
        } catch { /* protective list/delete loop, best-effort */ }

        broadcast({ type: "admin:baseimage:done", payload: { configName: templateName, snapshotId: result.snapshotId, snapshotName: result.snapshotName } });
      }).catch((err: unknown) => {
        baseImageAbortController = null;
        baseImageBuildingName = null;
        broadcast({ type: "admin:baseimage:error", payload: {
          configName: templateName,
          message: (err instanceof Error ? err.message : String(err)),
          failedDropletId: ((err as Error & { failedDropletId?: number }).failedDropletId) || null,
          failedDropletIp: ((err as Error & { failedDropletIp?: string }).failedDropletIp) || null,
        } });
      });
      return true;
    }

    default:
      return false;
  }
}
