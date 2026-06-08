import { batch } from "subjecto";
import { $admin } from "../subjects/admin";
import type {
  AdminDroplet,
  AdminHetznerServer,
  AdminOrg,
  AdminOrgMember,
  AdminTazVm,
  AdminTeam,
  AdminTeamMember,
  AdminUser,
  ProjectMemberInfo,
  ProjectTeamInfo,
} from "../types/admin";
import {
  deletePendingAdminExec,
  getPendingAdminExec,
  loadAdminDroplets,
  loadAdminHetznerServers,
  loadAdminRows,
  loadAdminTables,
  loadAdminTazVms,
  loadAdminUsers,
  loadTazProjects,
  loadTazSnapshots,
} from "../actions/admin";
import type { HandlerMap } from "./types";

// --- Admin messages ---

export const handlers: HandlerMap = {
  "admin:tables": (payload) => {
    batch(() => { const v = $admin.getValue(); v.tables = payload.tables; v.loading = false; });
  },

  "admin:table:columns": (payload) => {
    batch(() => { const v = $admin.getValue(); v.columns = payload.columns; v.primaryKey = payload.primaryKey; });
  },

  "admin:table:rows": (payload) => {
    batch(() => {
      const v = $admin.getValue();
      v.rows = payload.rows;
      v.totalCount = payload.totalCount;
      v.page = payload.page;
      v.pageSize = payload.pageSize;
      v.loading = false;
    });
  },

  "admin:row:get": (payload) => {
    if (payload.row) {
      $admin.getValue().drawerRow = payload.row;
    }
  },

  "admin:row:inserted": (payload) => {
    const v = $admin.getValue();
    batch(() => { v.drawerOpen = false; v.drawerRow = null; });
    if (v.selectedTable === payload.tableName) {
      loadAdminRows();
      loadAdminTables();
    }
  },

  "admin:row:updated": (payload) => {
    const v = $admin.getValue();
    batch(() => { v.drawerOpen = false; v.drawerRow = null; });
    if (v.selectedTable === payload.tableName) {
      loadAdminRows();
    }
  },

  "admin:row:deleted": (payload) => {
    if ($admin.getValue().selectedTable === payload.tableName) {
      loadAdminRows();
      loadAdminTables();
    }
  },

  "admin:sql:result": (payload) => {
    batch(() => { const v = $admin.getValue(); v.sqlResult = payload; v.sqlLoading = false; v.sqlError = null; });
  },

  "admin:sql:error": (payload) => {
    batch(() => { const v = $admin.getValue(); v.sqlError = payload.message; v.sqlLoading = false; v.sqlResult = null; });
  },

  "admin:error": (payload) => {
    console.warn("Admin error:", payload.message);
    $admin.getValue().loading = false;
  },

  "admin:drizzle:push:output": (payload) => {
    $admin.getValue().drizzlePush.output += payload.data;
  },

  "admin:drizzle:push:done": (_payload) => {
    $admin.getValue().drizzlePush.running = false;
    loadAdminTables();
  },

  "admin:backups:list": (payload) => {
    batch(() => {
      const b = $admin.getValue().backups;
      b.files = payload.files;
      b.loading = false;
      b.creating = false;
    });
  },

  "admin:backups:created": (payload) => {
    batch(() => {
      const b = $admin.getValue().backups;
      b.files = payload.files;
      b.loading = false;
      b.creating = false;
    });
  },

  "admin:backups:deleted": (payload) => {
    $admin.getValue().backups.files = payload.files;
  },

  "admin:droplets:list": (payload) => {
    const v = $admin.getValue();
    if (payload.error) {
      batch(() => { v.dropletsError = payload.error; v.droplets = []; v.dropletsLoading = false; });
    } else {
      const projectMap = payload.projectMap || {};
      const running: AdminDroplet[] = (payload.droplets || []).map((d: any) => {
        const pub = d.networks?.v4?.find((n: any) => n.type === "public");
        const pm = projectMap[d.id];
        return {
          id: d.id,
          name: d.name,
          status: d.status,
          ip: pub?.ip_address || null,
          region: d.region?.slug || "",
          size: d.size_slug || "",
          vcpus: d.vcpus || 0,
          memoryMb: d.memory || 0,
          diskGb: d.disk || 0,
          createdAt: d.created_at || null,
          createdBy: pm?.createdBy || null,
          projectId: pm?.projectId || null,
          projectName: pm?.projectName || null,
          locked: d.locked === true,
          domain: d.domain
            ? { fqdn: d.domain.fqdn, url: d.domain.url, appPort: d.domain.appPort }
            : undefined,
        } as AdminDroplet;
      });
      batch(() => { v.droplets = running; v.dropletsError = null; v.dropletsLoading = false; });
    }
  },

  "admin:droplets:deleted": (payload) => {
    const v = $admin.getValue();
    const deletedId = payload.dropletId;
    batch(() => {
      v.droplets = v.droplets.filter((d) => d.id !== deletedId);
      delete v.dropletStats[deletedId];
    });
  },

  "admin:tazcloud:list": (payload) => {
    const v = $admin.getValue();
    if (payload.error) {
      batch(() => { v.tazcloud.error = payload.error; v.tazcloud.vms = []; v.tazcloud.loading = false; });
    } else {
      const projectMap = payload.projectMap || {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list: AdminTazVm[] = (payload.vms || []).map((vm: any) => {
        const pm = projectMap[vm.id];
        return {
          id: vm.id,
          name: vm.name,
          status: vm.status,
          // `ipv6` is kept as the display+SSH host for legacy v6 VMs; for the
          // new vxlan-bastion mode it's null on the API and we fall back to
          // ssh_host (a private 10.x IP reached via WireGuard). Callers that
          // need to know the host is private should look at `isPrivateHost`.
          ipv6: vm.ipv6 || vm.ssh_host || "",
          /** True when `ssh_host` is RFC1918 (i.e. v2 vxlan-bastion mode) — the
           *  user can't hit it from their browser without WireGuard/ingress. */
          isPrivateHost: typeof vm.ssh_host === "string" && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(vm.ssh_host),
          image: vm.image,
          size: vm.size,
          tazProjectId: vm.project_id ?? null,
          projectId: pm?.projectId || null,
          projectName: pm?.projectName || null,
          locked: vm.locked === true,
          ingress: vm.ingress
            ? {
                domain: vm.ingress.domain,
                url: vm.ingress.url,
                status: vm.ingress.status,
                ip: vm.ingress.ip,
                dnsAction: vm.ingress.dns_action ?? vm.ingress.dnsAction,
              }
            : null,
        } as AdminTazVm;
      });
      batch(() => { v.tazcloud.vms = list; v.tazcloud.error = null; v.tazcloud.loading = false; });
    }
  },

  "admin:tazcloud:deleted": (payload) => {
    const v = $admin.getValue();
    const deletedId = payload.vmId;
    batch(() => { v.tazcloud.vms = v.tazcloud.vms.filter((vm) => vm.id !== deletedId); });
  },

  "admin:droplets:stats": (payload) => {
    if (payload.stats) {
      Object.assign($admin.getValue().dropletStats, payload.stats);
    }
  },

  "admin:droplets:created": (_payload) => {
    batch(() => {
      const v = $admin.getValue();
      v.dropletsCreating = false;
      v.dropletsCreateError = null;
    });
    // Refresh the list so the new droplet appears with current status.
    loadAdminDroplets();
  },

  "admin:droplets:create:error": (payload) => {
    batch(() => {
      const v = $admin.getValue();
      v.dropletsCreating = false;
      v.dropletsCreateError = payload.message ?? "Unknown error";
    });
  },

  "admin:droplets:renamed": (payload) => {
    const v = $admin.getValue();
    const d = v.droplets.find((x) => x.id === payload.dropletId);
    if (d) d.name = payload.name;
  },

  "admin:droplets:locked": (payload) => {
    const v = $admin.getValue();
    const d = v.droplets.find((x) => x.id === payload.dropletId);
    if (d) d.locked = payload.locked === true;
  },

  "admin:droplets:resize:progress": (payload) => {
    const v = $admin.getValue();
    const id = payload.dropletId as number;
    batch(() => {
      const cur = v.dropletResize[id] ?? { messages: [], targetSize: payload.targetSize ?? "", error: null, done: false };
      cur.messages = [...cur.messages, payload.message];
      v.dropletResize[id] = cur;
    });
  },

  "admin:droplets:resize:done": (payload) => {
    const v = $admin.getValue();
    const id = payload.dropletId as number;
    batch(() => {
      const cur = v.dropletResize[id] ?? { messages: [], targetSize: payload.size ?? "", error: null, done: false };
      cur.done = true;
      cur.targetSize = payload.size ?? cur.targetSize;
      v.dropletResize[id] = cur;
    });
    // Refresh stats (size + vcpus change). The :list:stale broadcast already
    // covers the list refetch; stats need their own ping.
    loadAdminDroplets();
  },

  "admin:droplets:resize:error": (payload) => {
    const v = $admin.getValue();
    const id = payload.dropletId as number;
    batch(() => {
      const cur = v.dropletResize[id] ?? { messages: [], targetSize: "", error: null, done: false };
      cur.error = payload.message;
      v.dropletResize[id] = cur;
    });
  },

  "admin:droplets:reboot:progress": (payload) => {
    const v = $admin.getValue();
    const id = payload.dropletId as number;
    batch(() => {
      const cur = v.dropletReboot[id] ?? { messages: [], error: null, done: false };
      cur.messages = [...cur.messages, payload.message];
      v.dropletReboot[id] = cur;
    });
  },

  "admin:droplets:reboot:done": (payload) => {
    const v = $admin.getValue();
    const id = payload.dropletId as number;
    batch(() => { delete v.dropletReboot[id]; });
  },

  "admin:droplets:reboot:error": (payload) => {
    const v = $admin.getValue();
    const id = payload.dropletId as number;
    batch(() => {
      const cur = v.dropletReboot[id] ?? { messages: [], error: null, done: false };
      cur.error = payload.message;
      v.dropletReboot[id] = cur;
    });
  },

  // Broadcast by the server after any droplet mutation — refetch to pick
  // up new rows/state.
  "admin:droplets:list:stale": (_payload) => {
    loadAdminDroplets();
  },

  "admin:droplets:exec:progress": (payload) => {
    const pending = getPendingAdminExec(payload.execId);
    if (!pending) return;
    pending.output += payload.chunk;
    pending.onChunk?.(payload.chunk);
  },

  "admin:droplets:exec:result": (payload) => {
    const pending = getPendingAdminExec(payload.execId);
    if (!pending) return;
    deletePendingAdminExec(payload.execId);
    pending.resolve({ output: payload.output, error: payload.error });
  },

  // ── Hetzner admin (Clouds panel) ──────────────────────────────────────────

  "admin:hetzner:list": (payload) => {
    const v = $admin.getValue();
    if (payload.error) {
      batch(() => { v.hetzner.error = payload.error; v.hetzner.servers = []; v.hetzner.loading = false; });
    } else {
      const projectMap = payload.projectMap || {};
      // The manager already normalizes each server; just attach the project link.
      const servers: AdminHetznerServer[] = (payload.servers || []).map((s: any) => {
        const pm = projectMap[s.id];
        return { ...s, projectId: pm?.projectId || null, projectName: pm?.projectName || null, instanceId: pm?.instanceId || null } as AdminHetznerServer;
      });
      batch(() => { v.hetzner.servers = servers; v.hetzner.error = null; v.hetzner.loading = false; });
    }
  },

  "admin:hetzner:stats": (payload) => {
    if (payload.stats) Object.assign($admin.getValue().hetzner.stats, payload.stats);
  },

  "admin:hetzner:deleted": (payload) => {
    const v = $admin.getValue();
    const id = payload.serverId;
    batch(() => {
      v.hetzner.servers = v.hetzner.servers.filter((s) => s.id !== id);
      delete v.hetzner.stats[id];
    });
  },

  "admin:hetzner:created": (_payload) => {
    batch(() => { const v = $admin.getValue(); v.hetzner.creating = false; v.hetzner.createError = null; });
    loadAdminHetznerServers();
  },

  "admin:hetzner:create:error": (payload) => {
    batch(() => { const v = $admin.getValue(); v.hetzner.creating = false; v.hetzner.createError = payload.message ?? "Unknown error"; });
  },

  "admin:hetzner:renamed": (payload) => {
    const s = $admin.getValue().hetzner.servers.find((x) => x.id === payload.serverId);
    if (s) s.name = payload.name;
  },

  "admin:hetzner:locked": (payload) => {
    const s = $admin.getValue().hetzner.servers.find((x) => x.id === payload.serverId);
    if (s) s.locked = payload.locked === true;
  },

  "admin:hetzner:reboot:progress": (payload) => {
    const v = $admin.getValue();
    const id = payload.serverId as number;
    batch(() => {
      const cur = v.hetzner.reboot[id] ?? { messages: [], error: null, done: false };
      cur.messages = [...cur.messages, payload.message];
      v.hetzner.reboot[id] = cur;
    });
  },

  "admin:hetzner:reboot:done": (payload) => {
    batch(() => { delete $admin.getValue().hetzner.reboot[payload.serverId as number]; });
  },

  "admin:hetzner:reboot:error": (payload) => {
    const v = $admin.getValue();
    const id = payload.serverId as number;
    batch(() => {
      const cur = v.hetzner.reboot[id] ?? { messages: [], error: null, done: false };
      cur.error = payload.message;
      v.hetzner.reboot[id] = cur;
    });
  },

  "admin:hetzner:list:stale": (_payload) => {
    loadAdminHetznerServers();
  },

  "admin:hetzner:exec:progress": (payload) => {
    const pending = getPendingAdminExec(payload.execId);
    if (!pending) return;
    pending.output += payload.chunk;
    pending.onChunk?.(payload.chunk);
  },

  "admin:hetzner:exec:result": (payload) => {
    const pending = getPendingAdminExec(payload.execId);
    if (!pending) return;
    deletePendingAdminExec(payload.execId);
    pending.resolve({ output: payload.output, error: payload.error });
  },

  "admin:tazcloud:stats": (payload) => {
    batch(() => {
      const t = $admin.getValue().tazcloud;
      if (payload.stats) {
        Object.assign(t.vmStats, payload.stats);
        // A VM that now reports stats clears any prior error — even when this
        // payload carries no `errors` key.
        for (const id of Object.keys(payload.stats)) delete t.vmStatsErrors[id];
      }
      // Freshly-failed probes record the reason for the card to surface.
      if (payload.errors) Object.assign(t.vmStatsErrors, payload.errors);
      t.vmStatsLoading = false;
    });
  },

  "admin:tazcloud:created": (_payload) => {
    batch(() => {
      const t = $admin.getValue().tazcloud;
      t.creating = false;
      t.createError = null;
    });
    loadAdminTazVms();
  },

  "admin:tazcloud:create:error": (payload) => {
    batch(() => {
      const t = $admin.getValue().tazcloud;
      t.creating = false;
      t.createError = payload.message ?? "Unknown error";
    });
  },

  "admin:tazcloud:renamed": (payload) => {
    const t = $admin.getValue().tazcloud;
    const vm = t.vms.find((x) => x.id === payload.vmId);
    if (vm) vm.name = payload.name;
  },

  "admin:tazcloud:locked": (payload) => {
    const t = $admin.getValue().tazcloud;
    const vm = t.vms.find((x) => x.id === payload.vmId);
    if (vm) vm.locked = payload.locked === true;
  },

  "admin:tazcloud:list:stale": (_payload) => {
    loadAdminTazVms();
  },

  "admin:tazcloud:snapshot:list": (payload) => {
    const t = $admin.getValue().tazcloud;
    if (payload.error) {
      batch(() => { t.snapshotsError = payload.error; t.snapshots = []; t.snapshotsLoading = false; });
      return;
    }
    // Wire format uses snake_case (mirrors the TazCloud API). Normalise to
    // camelCase to match the rest of the store.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (payload.snapshots || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      sourceVmId: s.source_vm_id ?? s.sourceVmId,
      status: s.status,
      sizeGb: s.size_gb ?? s.sizeGb,
      created: s.created,
    }));
    batch(() => { t.snapshots = list; t.snapshotsError = null; t.snapshotsLoading = false; });
  },

  // Server-broadcast after create/delete — pick up the refreshed list without
  // the originating client having to call loadTazSnapshots itself.
  "admin:tazcloud:snapshot:list:stale": (_payload) => {
    loadTazSnapshots();
  },

  "admin:tazcloud:snapshot:created": (payload) => {
    const t = $admin.getValue().tazcloud;
    batch(() => {
      delete t.snapshotCreating[payload.snapshot.source_vm_id];
      t.snapshotCreateError = null;
    });
  },

  "admin:tazcloud:snapshot:deleted": (_payload) => {
    // No-op — the :list:stale broadcast reloads the table.
  },

  "admin:tazcloud:snapshot:error": (payload) => {
    const t = $admin.getValue().tazcloud;
    batch(() => {
      // We don't get the vmId echoed back, so clear all "creating" flags — only
      // the one that failed had a matching :error and not :created in this round.
      t.snapshotCreating = {};
      t.snapshotCreateError = payload.message ?? "Snapshot operation failed";
    });
  },

  // --- TazCloud project (v2.0.0) handlers ---

  "admin:tazcloud:capabilities": (payload) => {
    const t = $admin.getValue().tazcloud;
    if (payload.error) {
      batch(() => {
        t.capabilitiesError = payload.error;
        t.capabilityImages = [];
        t.capabilitiesLoading = false;
      });
      return;
    }
    batch(() => {
      t.capabilityImages = payload.images || [];
      t.capabilitiesError = null;
      t.capabilitiesLoading = false;
    });
  },

  "admin:tazcloud:project:list": (payload) => {
    const t = $admin.getValue().tazcloud;
    if (payload.error) {
      batch(() => { t.projectsError = payload.error; t.projects = []; t.projectsLoading = false; });
      return;
    }
    // Wire format is snake_case (matches the TazCloud API verbatim). Normalise.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (payload.projects || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      subnetCidr: p.subnet_cidr ?? p.subnetCidr,
      networkId: p.network_id ?? p.networkId,
      vmCount: p.vm_count ?? p.vmCount,
      created: p.created,
    }));
    batch(() => { t.projects = list; t.projectsError = null; t.projectsLoading = false; });
  },

  "admin:tazcloud:project:list:stale": (_payload) => {
    loadTazProjects();
  },

  "admin:tazcloud:project:created": (_payload) => {
    // Server emits :list:stale; we just clear the in-flight banner state.
    batch(() => {
      const t = $admin.getValue().tazcloud;
      t.projectCreating = false;
      t.projectError = null;
    });
  },

  "admin:tazcloud:project:deleted": (_payload) => {
    // :list:stale broadcast triggers the refresh; nothing else to do here.
  },

  "admin:tazcloud:project:error": (payload) => {
    batch(() => {
      const t = $admin.getValue().tazcloud;
      t.projectCreating = false;
      t.projectError = payload.message ?? "Project operation failed";
    });
  },

  "admin:droplets:domain:progress": (payload) => {
    const v = $admin.getValue();
    const id = payload.dropletId;
    if (id === undefined || id === null) return;
    const arr = v.dropletDomainProgress[id] || [];
    arr.push(payload.chunk);
    v.dropletDomainProgress[id] = arr.slice(-50);
  },

  "admin:droplets:domain:attached": (payload) => {
    const v = $admin.getValue();
    batch(() => {
      delete v.dropletDomainBusy[payload.dropletId];
      v.dropletDomainError = null;
      const d = v.droplets.find((x) => x.id === payload.dropletId);
      if (d) d.domain = { fqdn: payload.domain, url: payload.url, status: payload.status };
    });
  },

  "admin:droplets:domain:detached": (payload) => {
    const v = $admin.getValue();
    batch(() => {
      delete v.dropletDomainBusy[payload.dropletId];
      v.dropletDomainError = null;
      const d = v.droplets.find((x) => x.id === payload.dropletId);
      if (d) d.domain = undefined;
    });
  },

  "admin:droplets:domain:error": (payload) => {
    const v = $admin.getValue();
    batch(() => {
      if (payload.dropletId !== undefined && payload.dropletId !== null) delete v.dropletDomainBusy[payload.dropletId];
      v.dropletDomainError = payload.message ?? "Domain operation failed";
    });
  },

  "admin:tazcloud:ingress:registered": (payload) => {
    const t = $admin.getValue().tazcloud;
    batch(() => {
      delete t.ingressBusy[payload.vmId];
      t.ingressError = null;
      const vm = t.vms.find((x) => x.id === payload.vmId);
      if (vm && payload.ingress) {
        vm.ingress = {
          domain: payload.ingress.domain,
          url: payload.ingress.url,
          status: payload.ingress.status,
          ip: payload.ingress.ip,
          dnsAction: payload.ingress.dns_action ?? payload.ingress.dnsAction,
        };
      }
    });
  },

  "admin:tazcloud:ingress:removed": (payload) => {
    const t = $admin.getValue().tazcloud;
    batch(() => {
      delete t.ingressBusy[payload.vmId];
      t.ingressError = null;
      const vm = t.vms.find((x) => x.id === payload.vmId);
      if (vm) vm.ingress = null;
    });
  },

  "admin:tazcloud:ingress:error": (payload) => {
    const t = $admin.getValue().tazcloud;
    batch(() => {
      if (payload.vmId) delete t.ingressBusy[payload.vmId];
      else t.ingressBusy = {};
      t.ingressError = payload.message ?? "Ingress operation failed";
    });
  },

  "admin:tazcloud:exec:progress": (payload) => {
    const pending = getPendingAdminExec(payload.execId);
    if (!pending) return;
    pending.output += payload.chunk;
    pending.onChunk?.(payload.chunk);
  },

  "admin:tazcloud:exec:result": (payload) => {
    const pending = getPendingAdminExec(payload.execId);
    if (!pending) return;
    deletePendingAdminExec(payload.execId);
    pending.resolve({ output: payload.output, error: payload.error });
  },

  "admin:baseimage:configs:list": (payload) => {
    batch(() => {
      const bi = $admin.getValue().baseImage;
      bi.configs = payload.configs;
      bi.templates = payload.templates || {};
      bi.deletedTemplates = payload.deletedTemplates || {};
      bi.buildingName = payload.buildingName;
    });
  },

  "admin:baseimage:progress": (payload) => {
    const { configName, message } = payload;
    const bi = $admin.getValue().baseImage;
    if (configName === bi.buildingName) {
      bi.progress = [...bi.progress.slice(-49), message];
    }
  },

  "admin:baseimage:done": (payload) => {
    const { configName, snapshotId, snapshotName } = payload;
    const bi = $admin.getValue().baseImage;
    batch(() => {
      const tmpl = bi.templates[configName];
      if (tmpl) {
        tmpl.snapshotId = snapshotId;
        tmpl.snapshotName = snapshotName;
        tmpl.verified = true;
      }
      bi.buildingName = null;
      bi.error = null;
      bi.failedDropletId = null;
      bi.failedDropletIp = null;
    });
  },

  "admin:baseimage:error": (payload) => {
    const errPrefix = payload.configName ? `[${payload.configName}] ` : "";
    batch(() => {
      const bi = $admin.getValue().baseImage;
      bi.buildingName = null;
      bi.error = errPrefix + payload.message;
      bi.failedDropletId = payload.failedDropletId || null;
      bi.failedDropletIp = payload.failedDropletIp || null;
    });
  },

  "admin:baseimage:template:history": (payload) => {
    $admin.getValue().baseImage.history = payload.history || [];
  },

  "admin:sshkey:result": (payload) => {
    batch(() => {
      const sk = $admin.getValue().sshKey;
      sk.exists = payload.exists;
      sk.publicKey = payload.publicKey;
      sk.fingerprint = payload.fingerprint;
      sk.createdAt = payload.createdAt || null;
      sk.history = payload.history || [];
      sk.loading = false;
      sk.regenerating = false;
    });
  },

  "admin:sshkey:error": (_payload) => {
    batch(() => {
      const sk = $admin.getValue().sshKey;
      sk.loading = false;
      sk.regenerating = false;
    });
  },

  "admin:ai:costs": (payload) => {
    batch(() => {
      const ai = $admin.getValue().ai;
      ai.costs = payload.rows || [];
      ai.error = payload.error || null;
      ai.loading = false;
    });
  },

  "admin:ai:settings": (payload) => {
    batch(() => {
      const ai = $admin.getValue().ai;
      if (payload.defaultModel !== undefined) {
        ai.settings.defaultModel = payload.defaultModel;
      }
      if (payload.maxToolRounds !== undefined) {
        ai.settings.maxToolRounds = payload.maxToolRounds;
      }
      ai.settingsLoading = false;
    });
  },

  "admin:users:list": (payload) => {
    batch(() => {
      const u = $admin.getValue().users;
      u.list = payload.users;
      u.loading = false;
    });
  },

  "admin:users:list:paged": (payload) => {
    batch(() => {
      const u = $admin.getValue().users.paged;
      u.list = payload.users;
      u.total = payload.total;
      u.page = payload.page;
      u.pageSize = payload.pageSize;
      u.search = payload.search;
      u.loading = false;
    });
  },

  "admin:users:updated": (payload) => {
    const u = $admin.getValue().users;
    const idx = u.list.findIndex((x: AdminUser) => x.id === payload.user.id);
    if (idx >= 0) u.list[idx] = payload.user;
    const pidx = u.paged.list.findIndex((x: AdminUser) => x.id === payload.user.id);
    if (pidx >= 0) u.paged.list[pidx] = payload.user;
  },

  "admin:users:deleted": (payload) => {
    const u = $admin.getValue().users;
    u.list = u.list.filter((x: AdminUser) => x.id !== payload.userId);
    const removed = u.paged.list.some((x: AdminUser) => x.id === payload.userId);
    u.paged.list = u.paged.list.filter((x: AdminUser) => x.id !== payload.userId);
    if (removed) u.paged.total = Math.max(0, u.paged.total - 1);
  },

  "admin:teams:list": (payload) => {
    batch(() => {
      const t = $admin.getValue().teams;
      t.list = payload.teams;
      t.members = payload.members;
      t.loading = false;
    });
  },

  "admin:teams:created": (payload) => {
    $admin.getValue().teams.list.push(payload.team);
  },

  "admin:teams:updated": (payload) => {
    const list = $admin.getValue().teams.list;
    const idx = list.findIndex((t: AdminTeam) => t.id === payload.team.id);
    if (idx >= 0) list[idx] = payload.team;
  },

  "admin:teams:deleted": (payload) => {
    const t = $admin.getValue().teams;
    t.list = t.list.filter((x: AdminTeam) => x.id !== payload.teamId);
    t.members = t.members.filter((m: AdminTeamMember) => m.teamId !== payload.teamId);
  },

  "admin:teams:member-added": (payload) => {
    $admin.getValue().teams.members.push(payload.member);
  },

  "admin:teams:member-removed": (payload) => {
    const t = $admin.getValue().teams;
    t.members = t.members.filter((m: AdminTeamMember) => m.id !== payload.memberId);
  },

  "admin:teams:role-updated": (payload) => {
    const members = $admin.getValue().teams.members;
    const idx = members.findIndex((m: AdminTeamMember) => m.id === payload.member.id);
    if (idx >= 0) members[idx] = payload.member;
  },

  // --- Orgs ---
  "admin:orgs:list": (payload) => {
    batch(() => {
      const o = $admin.getValue().orgs;
      o.list = payload.orgs;
      o.members = payload.members || {};
      o.loading = false;
    });
  },

  "admin:orgs:created": (payload) => {
    batch(() => {
      const o = $admin.getValue().orgs;
      o.list.push(payload.org);
      o.members[payload.org.id] = payload.members || [];
      o.selectedOrgId = payload.org.id;
    });
  },

  "admin:orgs:updated": (payload) => {
    const list = $admin.getValue().orgs.list;
    const idx = list.findIndex((o: AdminOrg) => o.id === payload.org.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...payload.org };
  },

  "admin:orgs:deleted": (payload) => {
    const o = $admin.getValue().orgs;
    o.list = o.list.filter((x: AdminOrg) => x.id !== payload.orgId);
    delete o.members[payload.orgId];
    if (o.selectedOrgId === payload.orgId) o.selectedOrgId = null;
  },

  "admin:orgs:member-added": (payload) => {
    const o = $admin.getValue().orgs;
    const list = o.members[payload.orgId] || [];
    const idx = list.findIndex((m: AdminOrgMember) => m.userId === payload.member.userId);
    if (idx >= 0) list[idx] = payload.member;
    else list.push(payload.member);
    o.members[payload.orgId] = list;
  },

  "admin:orgs:member-removed": (payload) => {
    const o = $admin.getValue().orgs;
    o.members[payload.orgId] = (o.members[payload.orgId] || []).filter(
      (m: AdminOrgMember) => m.userId !== payload.userId,
    );
  },

  "admin:orgs:member-role-updated": (payload) => {
    const o = $admin.getValue().orgs;
    const list = o.members[payload.orgId] || [];
    const idx = list.findIndex((m: AdminOrgMember) => m.userId === payload.member.userId);
    if (idx >= 0) list[idx] = payload.member;
    o.members[payload.orgId] = list;
  },

  // --- User invitation ---
  "admin:users:invited": () => {
    // Refresh user list so the new stub user appears in the table; the server
    // doesn't broadcast a list-refresh on its own.
    loadAdminUsers();
  },

  // --- Per-project members ---
  "project:members:list": (payload) => {
    $admin.getValue().projectMembers[payload.projectId] = payload.members;
  },

  "project:members:updated": (payload) => {
    const list = $admin.getValue().projectMembers[payload.projectId] || [];
    if (payload.action === "added" || payload.action === "role-updated") {
      const m: ProjectMemberInfo | undefined = payload.member;
      if (!m) return;
      const idx = list.findIndex((x: ProjectMemberInfo) => x.userId === m.userId);
      if (idx >= 0) list[idx] = m;
      else list.push(m);
    } else if (payload.action === "removed") {
      $admin.getValue().projectMembers[payload.projectId] = list.filter(
        (x: ProjectMemberInfo) => x.userId !== payload.userId,
      );
      return;
    }
    $admin.getValue().projectMembers[payload.projectId] = list;
  },

  // --- Per-project secondary teams ---
  "project:teams:list": (payload) => {
    $admin.getValue().projectTeams[payload.projectId] = payload.teams;
  },

  "project:teams:updated": (payload) => {
    const list = $admin.getValue().projectTeams[payload.projectId] || [];
    if (payload.action === "added") {
      const t: ProjectTeamInfo | undefined = payload.team;
      if (!t) return;
      if (!list.some((x: ProjectTeamInfo) => x.teamId === t.teamId)) list.push(t);
      $admin.getValue().projectTeams[payload.projectId] = list;
    } else if (payload.action === "removed") {
      $admin.getValue().projectTeams[payload.projectId] = list.filter(
        (x: ProjectTeamInfo) => x.teamId !== payload.teamId,
      );
    }
  },

  "project:list:stale": () => {
    // Server hints that the caller's visible project list changed (they were
    // added to / removed from a project). Re-fetch.
    // Importing the project action would create a cycle, so just fire the WS
    // message directly via the global helper.
    void import("@/lib/ws").then(({ wsSend }) => wsSend("project:list", {}));
  },

  "admin:email:logs": (payload) => {
    batch(() => {
      const c = $admin.getValue().communication;
      c.logs = payload.logs;
      c.loading = false;
    });
  },

  "admin:email:sent": (payload) => {
    batch(() => {
      const c = $admin.getValue().communication;
      c.sending = false;
      c.error = null;
      c.lastResult = { sent: payload.sent, failed: payload.failed, total: payload.total };
    });
  },

  "admin:email:send:error": (payload) => {
    batch(() => {
      const c = $admin.getValue().communication;
      c.sending = false;
      c.error = payload.message ?? "Failed to send email";
    });
  },

  "admin:audit:list": (payload) => {
    batch(() => {
      const a = $admin.getValue().audit;
      a.logs = payload.logs;
      a.loading = false;
    });
  },

  "admin:analytics:summary": (payload) => {
    batch(() => {
      const a = $admin.getValue().analytics;
      a.summary = payload.summary;
      if (typeof payload.days === "number") a.days = payload.days;
      a.filterUserId = payload.userId ?? null;
      a.filterProjectId = payload.projectId ?? null;
      a.loading = false;
    });
  },

  "admin:prodlogs:deployments": (payload) => {
    batch(() => {
      const p = $admin.getValue().prodlogs;
      p.deployments = payload.deployments;
      p.loading = false;
    });
  },

  "admin:prodlogs:logs": (payload) => {
    batch(() => {
      const p = $admin.getValue().prodlogs;
      p.logs = payload.logs;
      p.logsLoading = false;
    });
  },
};
