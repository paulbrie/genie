import { useState, useEffect, useRef } from "react";
import { Bot, PanelRight, Globe } from "lucide-react";
import type { BackgroundMessage, ProjectDef } from "../shared/types";

export function Popup() {
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [project, setProject] = useState<ProjectDef | null>(null);
  const [tabUrl, setTabUrl] = useState("");
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: "genie-popup" });
    portRef.current = port;

    port.onMessage.addListener((msg: BackgroundMessage) => {
      switch (msg.type) {
        case "ws:status":
          setConnected(msg.connected);
          setAuthenticated(msg.authenticated);
          break;
        case "project:detected":
          setProject(msg.project);
          setTabUrl(msg.tabUrl);
          break;
      }
    });

    return () => port.disconnect();
  }, []);

  const statusDot = authenticated ? "bg-green" : connected ? "bg-yellow" : "bg-red";
  const statusText = authenticated
    ? "Connected"
    : connected
    ? "Not authenticated"
    : "Disconnected";

  let hostname = "";
  try { hostname = new URL(tabUrl).hostname; } catch { hostname = tabUrl; }

  return (
    <div style={{ width: 320 }} className="bg-base p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bot size={20} className="text-mauve" />
          <span className="font-semibold text-text" style={{ fontSize: 15 }}>Genie</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-overlay1" style={{ fontSize: 12 }}>{statusText}</span>
        </div>
      </div>

      {/* Detected project */}
      {project && (
        <div className="flex items-center gap-3 px-3 py-3 bg-surface0 rounded-lg mb-4">
          <Globe size={15} className="text-mauve shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-text font-medium truncate" style={{ fontSize: 13 }}>{project.name}</div>
            {hostname && (
              <div className="text-overlay0 truncate mt-1" style={{ fontSize: 12 }}>{hostname}</div>
            )}
          </div>
        </div>
      )}

      {!project && authenticated && (
        <div className="text-overlay0 px-3 py-3 bg-surface0 rounded-lg mb-4" style={{ fontSize: 13 }}>
          No project detected for current tab.
        </div>
      )}

      {/* Open Side Panel */}
      {authenticated && (
        <button
          onClick={async () => {
            const win = await chrome.windows.getCurrent();
            if (win.id != null) {
              chrome.sidePanel.open({ windowId: win.id });
            }
            window.close();
          }}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-mauve text-crust rounded-lg hover:bg-lavender transition-colors font-medium"
          style={{ fontSize: 13 }}
        >
          <PanelRight size={15} />
          Open Chat Panel
        </button>
      )}

      {connected && !authenticated && (
        <button
          onClick={() => portRef.current?.postMessage({ type: "login" })}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-mauve text-crust rounded-lg hover:bg-lavender transition-colors font-medium"
          style={{ fontSize: 13 }}
        >
          Sign in with Google
        </button>
      )}

      {!connected && (
        <button
          onClick={() => portRef.current?.postMessage({ type: "connect" })}
          className="w-full px-4 py-3 bg-surface0 text-subtext0 rounded-lg hover:bg-surface1 transition-colors"
          style={{ fontSize: 13 }}
        >
          Retry Connection
        </button>
      )}
    </div>
  );
}
