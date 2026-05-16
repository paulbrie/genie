import { batch } from "subjecto";
import {
  $doSnapshots,
  $doSnapshotsLoading,
  $doTokenValid,
  $railwayTestResult,
  $vpsDeploy,
} from "../subjects/vps";
import type { VpsProcessInfo } from "../types/vps";
import { ensureInstanceState, execCallbacks, updateInstanceState } from "../actions/vps";
import type { HandlerMap } from "./types";

// --- VPS / DO / deploy messages ---

export const handlers: HandlerMap = {
  "admin:railway:test": (payload) => {
    $railwayTestResult.next(payload);
  },

  "do:token-valid": (payload) => {
    $doTokenValid.next(payload);
  },

  "do:snapshots:list": (payload) => {
    $doSnapshots.next(payload.snapshots || []);
    $doSnapshotsLoading.next(false);
  },

  "vps:test-connection:ok": (payload) => {
    $vpsDeploy.getValue().testResult = { ok: true, hostname: payload.hostname };
  },

  "vps:test-connection:error": (payload) => {
    $vpsDeploy.getValue().testResult = { ok: false, error: payload.message };
  },

  "vps:deploy:progress": (payload) => {
    const { instanceId: progInstId } = payload;
    if (progInstId) {
      ensureInstanceState(progInstId);
      const v = $vpsDeploy.getValue();
      v.instances[progInstId].progress = [...v.instances[progInstId].progress, payload.message];
      const deploy = v.activeDeploys[progInstId];
      if (deploy) deploy.progress = [...deploy.progress, payload.message];
    }
  },

  "vps:deploy:done": (payload) => {
    const { instanceId: doneInstId } = payload;
    if (doneInstId) {
      ensureInstanceState(doneInstId);
      const v = $vpsDeploy.getValue();
      batch(() => {
        const inst = v.instances[doneInstId];
        inst.deploying = false;
        inst.endedAt = Date.now();
        const deploy = v.activeDeploys[doneInstId];
        if (deploy) { deploy.deploying = false; deploy.endedAt = Date.now(); }
      });
    }
  },

  "vps:deploy:error": (payload) => {
    const { instanceId: errInstId } = payload;
    if (errInstId) {
      ensureInstanceState(errInstId);
      const v = $vpsDeploy.getValue();
      batch(() => {
        const inst = v.instances[errInstId];
        inst.deploying = false;
        inst.endedAt = Date.now();
        inst.error = payload.message;
        const deploy = v.activeDeploys[errInstId];
        if (deploy) {
          deploy.deploying = false;
          deploy.endedAt = Date.now();
          deploy.error = payload.message;
          deploy.failedDroplet = payload.failedDroplet || null;
        }
      });
    }
  },

  "do:destroy-failed-droplet:done": (payload) => {
    const { dropletId } = payload;
    const v = $vpsDeploy.getValue();
    batch(() => {
      for (const d of Object.values(v.activeDeploys)) {
        if (d.failedDroplet?.dropletId === dropletId) {
          d.failedDroplet = null;
          d.destroyingDroplet = false;
        }
      }
    });
  },

  "do:destroy-failed-droplet:error": (payload) => {
    const { dropletId: failDId, message: failMsg } = payload;
    const v = $vpsDeploy.getValue();
    batch(() => {
      for (const d of Object.values(v.activeDeploys)) {
        if (d.failedDroplet?.dropletId === failDId) {
          d.destroyingDroplet = false;
          d.error = `Failed to destroy droplet: ${failMsg}`;
        }
      }
    });
  },

  "vps:status:update": (_payload) => {
    // Services updated via project:list broadcast
  },

  "vps:stats:result": (payload) => {
    const { instanceId: statsInstId } = payload;
    if (statsInstId) {
      ensureInstanceState(statsInstId);
      updateInstanceState(statsInstId, { stats: payload.stats, statsError: null });
    }
  },

  "vps:stats:error": (payload) => {
    const { instanceId: statsErrInstId } = payload;
    if (statsErrInstId) {
      ensureInstanceState(statsErrInstId);
      updateInstanceState(statsErrInstId, { statsError: payload.message });
    }
  },

  "vps:process:kill:result": (payload) => {
    const { instanceId: killInstId } = payload;
    if (killInstId) {
      const inst = $vpsDeploy.getValue().instances[killInstId];
      if (payload.ok && inst?.stats?.processes) {
        inst.stats.processes = inst.stats.processes.filter(
          (p: VpsProcessInfo) => p.pid !== payload.pid,
        );
      }
    }
  },

  "vps:teardown:done": (payload) => {
    const { instanceId: tdInstId } = payload;
    if (tdInstId) {
      delete $vpsDeploy.getValue().instances[tdInstId];
    }
  },

  "vps:teardown:progress": (payload) => {
    const { instanceId: tdpInstId } = payload;
    if (tdpInstId) {
      ensureInstanceState(tdpInstId);
      const inst = $vpsDeploy.getValue().instances[tdpInstId];
      inst.progress = [...inst.progress, payload.message];
    }
  },

  "vps:teardown:error": (payload) => {
    const { instanceId: tdeInstId } = payload;
    if (tdeInstId) {
      ensureInstanceState(tdeInstId);
      updateInstanceState(tdeInstId, { error: payload.message });
    }
  },

  "vps:hibernate:progress": (payload) => {
    const { instanceId: hpInstId } = payload;
    if (hpInstId) {
      ensureInstanceState(hpInstId);
      const inst = $vpsDeploy.getValue().instances[hpInstId];
      inst.progress = [...inst.progress, payload.message];
    }
  },

  "vps:hibernate:done": (payload) => {
    const { instanceId: hdInstId } = payload;
    if (hdInstId) {
      ensureInstanceState(hdInstId);
      updateInstanceState(hdInstId, { hibernating: false, progress: [], error: null });
    }
  },

  "vps:hibernate:error": (payload) => {
    const { instanceId: heInstId } = payload;
    if (heInstId) {
      ensureInstanceState(heInstId);
      updateInstanceState(heInstId, { hibernating: false, error: payload.message });
    }
  },

  "vps:wake:progress": (payload) => {
    const { instanceId: wpInstId } = payload;
    if (wpInstId) {
      ensureInstanceState(wpInstId);
      const inst = $vpsDeploy.getValue().instances[wpInstId];
      inst.progress = [...inst.progress, payload.message];
    }
  },

  "vps:wake:done": (payload) => {
    const { instanceId: wdInstId } = payload;
    if (wdInstId) {
      ensureInstanceState(wdInstId);
      updateInstanceState(wdInstId, { wakingUp: false, progress: [], error: null });
    }
  },

  "vps:wake:error": (payload) => {
    const { instanceId: weInstId } = payload;
    if (weInstId) {
      ensureInstanceState(weInstId);
      updateInstanceState(weInstId, { wakingUp: false, error: payload.message });
    }
  },

  "vps:recipe:check:result": (payload) => {
    const { instanceId: rcInstId, recipeId: rcId, installed: rcInstalled } = payload;
    if (rcInstId && rcId) {
      ensureInstanceState(rcInstId);
      const inst = $vpsDeploy.getValue().instances[rcInstId];
      if (inst.recipes[rcId]) {
        inst.recipes[rcId].checking = false;
        inst.recipes[rcId].installed = rcInstalled;
      }
    }
  },

  "vps:recipe:progress": (payload) => {
    const { instanceId: rpInstId, recipeId: rpId, message: rpMsg } = payload;
    if (rpInstId && rpId) {
      ensureInstanceState(rpInstId);
      const inst = $vpsDeploy.getValue().instances[rpInstId];
      if (inst.recipes[rpId]) {
        inst.recipes[rpId].progress = [...inst.recipes[rpId].progress, rpMsg];
      }
    }
  },

  "vps:recipe:done": (payload) => {
    const { instanceId: rdInstId, recipeId: rdId } = payload;
    if (rdInstId && rdId) {
      ensureInstanceState(rdInstId);
      const inst = $vpsDeploy.getValue().instances[rdInstId];
      if (inst.recipes[rdId]) {
        inst.recipes[rdId].running = false;
        inst.recipes[rdId].installed = true;
      }
    }
  },

  "vps:recipe:uninstall:done": (payload) => {
    const { instanceId: ruInstId, recipeId: ruId } = payload;
    if (ruInstId && ruId) {
      ensureInstanceState(ruInstId);
      const inst = $vpsDeploy.getValue().instances[ruInstId];
      if (inst.recipes[ruId]) {
        inst.recipes[ruId].running = false;
        inst.recipes[ruId].installed = false;
      }
    }
  },

  "vps:recipe:error": (payload) => {
    const { instanceId: reInstId, recipeId: reId, message: reMsg } = payload;
    if (reInstId && reId) {
      ensureInstanceState(reInstId);
      const inst = $vpsDeploy.getValue().instances[reInstId];
      if (inst.recipes[reId]) {
        inst.recipes[reId].running = false;
        inst.recipes[reId].error = reMsg;
      }
    }
  },

  "vps:exec:result": (payload) => {
    const { execId, output, error } = payload;
    const cb = execCallbacks.get(execId);
    if (cb) {
      execCallbacks.delete(execId);
      cb(output, error);
    }
  },

  "vps:logs:data": (payload) => {
    const { instanceId: logsInstId, serviceName, logs } = payload;
    if (logsInstId) {
      ensureInstanceState(logsInstId);
      updateInstanceState(logsInstId, { logs: { serviceName: serviceName || null, logs } });
    }
  },

  "deploy:logs:list": (payload) => {
    $vpsDeploy.getValue().deployLogs = payload.logs;
  },
};
