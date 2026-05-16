import { handlers as authHandlers } from "./auth";
import { handlers as systemHandlers } from "./system";
import { handlers as appsHandlers } from "./apps";
import { handlers as chatHandlers } from "./chat";
import { handlers as conversationHandlers } from "./conversation";
import { handlers as terminalHandlers } from "./terminal";
import { handlers as projectsHandlers } from "./projects";
import { handlers as docsHandlers } from "./docs";
import { handlers as projectFilesHandlers } from "./project-files";
import { handlers as vpsHandlers } from "./vps";
import { handlers as trackerHandlers } from "./tracker";
import { handlers as adminHandlers } from "./admin";
import { handlers as securityHandlers } from "./security";
import { handlers as presenceHandlers } from "./presence";
import { handlers as recipesHandlers } from "./recipes";
import type { HandlerMap } from "./types";

const handlers: HandlerMap = Object.assign(
  {},
  authHandlers,
  systemHandlers,
  appsHandlers,
  chatHandlers,
  conversationHandlers,
  terminalHandlers,
  projectsHandlers,
  docsHandlers,
  projectFilesHandlers,
  vpsHandlers,
  trackerHandlers,
  adminHandlers,
  securityHandlers,
  presenceHandlers,
  recipesHandlers,
);

export function handleWsMessage(msg: { type: string; payload: any }): void {
  handlers[msg.type]?.(msg.payload);
}
