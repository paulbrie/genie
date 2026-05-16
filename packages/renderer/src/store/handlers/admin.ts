import { batch } from "subjecto";
import { $admin } from "../subjects/admin";
import type {
  AdminDroplet,
  AdminTazVm,
  AdminTeam,
  AdminTeamMember,
  AdminUser,
} from "../types/admin";
import {
  deletePendingAdminExec,
  getPendingAdminExec,
  loadAdminDroplets,
  loadAdminRows,
  loadAdminTables,
  loadAdminTazVms,
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
    console.error("Admin error:", payload.message);
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
          ipv6: vm.ipv6 || vm.ssh_host || "",
          image: vm.image,
          size: vm.size,
          projectId: pm?.projectId || null,
          projectName: pm?.projectName || null,
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

  "admin:tazcloud:stats": (payload) => {
    batch(() => {
      const t = $admin.getValue().tazcloud;
      if (payload.stats) Object.assign(t.vmStats, payload.stats);
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

  "admin:tazcloud:list:stale": (_payload) => {
    loadAdminTazVms();
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

  "admin:users:updated": (payload) => {
    const list = $admin.getValue().users.list;
    const idx = list.findIndex((u: AdminUser) => u.id === payload.user.id);
    if (idx >= 0) list[idx] = payload.user;
  },

  "admin:users:deleted": (payload) => {
    const u = $admin.getValue().users;
    u.list = u.list.filter((x: AdminUser) => x.id !== payload.userId);
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

  "admin:audit:list": (payload) => {
    batch(() => {
      const a = $admin.getValue().audit;
      a.logs = payload.logs;
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
