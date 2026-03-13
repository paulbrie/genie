// Shared message types between background, content script, side panel, and popup

export interface WsMessage {
  type: string;
  payload: any;
}

export interface ProjectDef {
  id: string;
  name: string;
  vpsInstances: VpsInstance[];
}

export interface VpsInstance {
  id: string;
  label: string;
  connection: { host: string; port: number; username: string; privateKeyPath: string };
  services: { name: string; service: string; status: string; state: string; ports: string }[];
  digitalocean?: { dropletId: number; ipAddress: string; region: string; size: string };
}

// Messages from side panel / popup → background
export type PanelMessage =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "login" }
  | { type: "get:status" }
  | { type: "get:project" }
  | { type: "get:snapshot" }
  | { type: "navigate"; url: string }
  | { type: "open:sidepanel" };

// Messages from background → side panel / popup
export type BackgroundMessage =
  | { type: "ws:status"; connected: boolean; authenticated: boolean }
  | { type: "dom:snapshot"; html: string }
  | { type: "project:detected"; project: ProjectDef | null; tabUrl: string }
  | { type: "project:list"; projects: ProjectDef[] };

// Messages from background → content script
export type ContentScriptMessage =
  | { type: "dom:get_snapshot" }
  | { type: "dom:action"; requestId: string; action: DomAction; params: DomActionParams };

// Messages from content script → background
export type ContentScriptResponse =
  | { type: "dom:snapshot"; html: string }
  | { type: "dom:action_result"; requestId: string; success: boolean; result: string };

export type DomAction =
  | "click"
  | "type"
  | "select"
  | "scroll"
  | "read_text"
  | "read_attr"
  | "get_snapshot"
  | "navigate"
  | "wait_for";

export interface DomActionParams {
  selector?: string;
  value?: string;
  url?: string;
  attribute?: string;
  direction?: "up" | "down";
  amount?: number;
  timeout?: number;
}
