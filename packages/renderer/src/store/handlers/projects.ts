import { stripAnsi } from "@/lib/utils";
import { $terminal } from "../subjects/vps";
import {
  $commandRunOutputs,
  $projectLogBuffers,
  $projects,
  $selectedProjectId,
} from "../subjects/vps";
import type { ProjectDef } from "../types/vps";
import { addTerminalTab } from "../actions/terminal";
import type { HandlerMap } from "./types";

const MAX_LOG_BUFFER = 50000;

export const handlers: HandlerMap = {
  "project:list": (payload) => {
    const newProjects: ProjectDef[] = payload.projects;
    $projects.next(newProjects);
    const selProjId = $selectedProjectId.getValue();
    if (selProjId && !newProjects.find((p) => p.id === selProjId)) {
      $selectedProjectId.next(null);
    }
  },

  "project:log": (payload) => {
    const logKey = `${payload.projectId}:${payload.commandId}`;
    const clean = stripAnsi(payload.data);
    const pBufs = $projectLogBuffers.getValue();
    let buf = (pBufs[logKey] || "") + clean;
    if (buf.length > MAX_LOG_BUFFER) {
      buf = buf.slice(-MAX_LOG_BUFFER);
    }
    $projectLogBuffers.next({ ...pBufs, [logKey]: buf });
  },

  "project:command:started": (payload) => {
    const key = `${payload.projectId}:${payload.commandId}`;
    const outputs = $commandRunOutputs.getValue();
    $commandRunOutputs.next({ ...outputs, [key]: { output: "", running: true, exitCode: null } });
  },

  "project:command:output": (payload) => {
    const key = `${payload.projectId}:${payload.commandId}`;
    const outputs = $commandRunOutputs.getValue();
    const prev = outputs[key] || { output: "", running: true, exitCode: null };
    let output = prev.output + payload.data;
    if (output.length > MAX_LOG_BUFFER) output = output.slice(-MAX_LOG_BUFFER);
    $commandRunOutputs.next({ ...outputs, [key]: { ...prev, output } });
  },

  "project:command:done": (payload) => {
    const key = `${payload.projectId}:${payload.commandId}`;
    const outputs = $commandRunOutputs.getValue();
    const prev = outputs[key] || { output: "", running: false, exitCode: null };
    const errMsg = payload.error ? `\n${payload.error}` : "";
    $commandRunOutputs.next({ ...outputs, [key]: { output: prev.output + errMsg, running: false, exitCode: payload.exitCode } });
  },

  "project:command:terminal": (payload) => {
    const { projectId, commandId, instanceId, commandName, command } = payload;
    // Dispatch event for extension / main app to open an SSH terminal tab with the command
    window.dispatchEvent(new CustomEvent("genie:command:terminal", {
      detail: { projectId, instanceId, commandName, command },
    }));
    // Main app: open a terminal tab (the terminal panel will handle spawning SSH)
    const cmdTabId = addTerminalTab(commandName || "Command");
    const t = $terminal.getValue();
    const cmdTab = t.tabs.find((tab) => tab.id === cmdTabId);
    if (cmdTab) {
      $terminal.nextAssign({
        tabs: t.tabs.map((tab) =>
          tab.id === cmdTabId ? { ...tab, projectId, commandId: commandId as string, command } : tab,
        ),
      });
    }
  },
};
