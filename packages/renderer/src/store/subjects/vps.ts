import { Subject } from "subjecto/core";
import { DeepSubject } from "subjecto";
import type {
  DoSnapshot,
  PersistedTerminalsState,
  ProjectDef,
  TerminalState,
  VmConnectionsState,
  VpsDeployState,
  VpsMonitorState,
} from "../types/vps";
import type { FileEditorState, FileTemplatesState } from "../types/common";

export const $terminal = new Subject<TerminalState>({
  tabs: [], activeTabId: null, bottomPanelOpen: false, bottomPanelHeight: 200,
});

export const $persistedTerminals = new Subject<PersistedTerminalsState>({
  sessions: [],
  loading: false,
  filters: { projectId: null, instanceId: null, vpsHost: null, ownerId: undefined },
});

export const $projects = new Subject<ProjectDef[]>([]);
export const $selectedProjectId = new Subject<string | null>(null);
export const $showAddProjectForm = new Subject<boolean>(false);
export const $projectLogBuffers = new Subject<Record<string, string>>({});
export const $commandRunOutputs = new Subject<Record<string, { output: string; running: boolean; exitCode: number | null }>>({});
export const $doTokenValid = new Subject<{ valid: boolean; email?: string } | null>(null);
export const $railwayTestResult = new Subject<{ ok: boolean; message: string } | null>(null);
export const $doSnapshots = new Subject<DoSnapshot[]>([]);
export const $doSnapshotsLoading = new Subject<boolean>(false);
export const $vpsDeploy = new DeepSubject<VpsDeployState>({ instances: {}, activeDeploys: {}, testResult: null, deployLogs: [] });

/** Live VM SSH connections — keyed by `${projectId}:${instanceId}` (or
 *  `direct:${host}:${username}`). One entry per open Manage-popup. */
export const $vmConnections = new DeepSubject<VmConnectionsState>({ connections: {} });

/** Per-instance status of the "Sync stats agent" action, keyed by
 *  `${projectId}:${instanceId}`. */
export const $vpsStatsSync = new Subject<
  Record<string, { running: boolean; message: string; error: string | null }>
>({});

export const $vpsMonitor = new Subject<VpsMonitorState>({
  history: {},
  hours: 1,
  loading: false,
  error: null,
});

export const $fileEditor = new Subject<FileEditorState>({
  projectId: null, files: [], selectedFile: null, content: null,
  savedContent: null, loading: false, saving: false, error: null,
});
export const $fileTemplates = new Subject<FileTemplatesState>({ templates: [], loading: false });
