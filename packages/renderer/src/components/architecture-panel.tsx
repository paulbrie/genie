"use client";

import { useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type OnNodesChange,
  Handle,
  Position,
  BackgroundVariant,
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// --- Custom Node ---

interface GroupNodeData {
  label: string;
  description: string;
  icon: string;
  color: string;
  items?: string[];
  children?: { icon: string; label: string; color: string; description: string }[];
  [key: string]: unknown;
}

function ArchNode({ data }: { data: GroupNodeData }) {
  return (
    <div
      className="rounded-lg border px-5 py-4 shadow-md min-w-[220px] max-w-[300px]"
      style={{
        background: "var(--ctp-mantle)",
        borderColor: data.color,
        borderWidth: 2,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: data.color }} />
      <Handle type="target" position={Position.Left} id="left" style={{ background: data.color }} />
      <Handle type="source" position={Position.Bottom} style={{ background: data.color }} />
      <Handle type="source" position={Position.Right} id="right" style={{ background: data.color }} />
      <Handle type="target" position={Position.Right} id="right-in" style={{ background: data.color }} />
      <Handle type="source" position={Position.Left} id="left-out" style={{ background: data.color }} />
      <Handle type="source" position={Position.Top} id="top-out" style={{ background: data.color }} />
      <Handle type="target" position={Position.Bottom} id="bottom-in" style={{ background: data.color }} />

      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xl">{data.icon}</span>
        <span className="font-semibold text-lg text-text">{data.label}</span>
      </div>
      <p className="text-md text-subtext0 mb-0 leading-snug">{data.description}</p>
      {data.items && data.items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {data.items.map((item) => (
            <li key={item} className="text-md text-overlay1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: data.color }} />
              {item}
            </li>
          ))}
        </ul>
      )}
      {data.children && data.children.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {data.children.map((child) => (
            <div
              key={child.label}
              className="rounded-md border px-3 py-2"
              style={{ borderColor: child.color, background: "var(--ctp-base)" }}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-md">{child.icon}</span>
                <span className="font-medium text-md text-text">{child.label}</span>
              </div>
              <p className="text-md text-overlay1 mt-0.5 leading-snug">{child.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  arch: ArchNode,
};

// --- Nodes ---

const initialNodes: Node[] = [
  // --- Left column: clients ---
  {
    id: "dashboard",
    type: "arch",
    position: { x: 0, y: 80 },
    data: {
      label: "Web Dashboard",
      description: "Next.js renderer, URL-based routing",
      icon: "🖥️",
      color: "#89b4fa",
      items: [
        "Projects · Docs · Tracker · Recipes",
        "Admin DB browser, droplets, SSH keys",
        "Terminal, logs, deploy windows",
        "Real-time WS sync (subjecto stores)",
      ],
    },
  },
  {
    id: "extension",
    type: "arch",
    position: { x: 0, y: 440 },
    data: {
      label: "Chrome Extension",
      description: "User's browser, remotely driven by the VPS agent",
      icon: "🧩",
      color: "#a6e3a1",
      items: [
        "DOM actions (click, type, navigate)",
        "Page snapshots back to the agent",
        "Chrome MV3, WS link to manager",
      ],
    },
  },
  {
    id: "slack",
    type: "arch",
    position: { x: 0, y: 770 },
    data: {
      label: "Slack",
      description: "Optional bot integration",
      icon: "💬",
      color: "#94e2d5",
      items: [
        "Alerts & notifications",
        "Mention-to-chat bridge",
      ],
    },
  },

  // --- Center: manager + DB ---
  {
    id: "manager",
    type: "arch",
    position: { x: 460, y: 180 },
    data: {
      label: "Genie Manager",
      description: "Local Node.js orchestrator (localhost:9876)",
      icon: "🧞",
      color: "#cba6f7",
      items: [
        "WS server · role-based ACL",
        "Multi-model chat router",
        "Project / deploy / recipes / tracker / docs",
        "PTY · process · audit · security",
        "SSH provisioning + bootstrap",
        "MCP servers (tunneled to VPS)",
      ],
    },
  },
  {
    id: "db",
    type: "arch",
    position: { x: 460, y: 780 },
    data: {
      label: "PostgreSQL",
      description: "Railway-hosted, accessed via Drizzle ORM",
      icon: "🐘",
      color: "#fab387",
      items: [
        "Projects + setup_files JSONB",
        "Docs, recipes, tracker issues",
        "Users, ACL, audit log",
        "VM aliases + cloud VM locks",
      ],
    },
  },

  // --- Right column: external services ---
  {
    id: "llm",
    type: "arch",
    position: { x: 980, y: 0 },
    data: {
      label: "LLM Providers",
      description: "Pluggable chat backends, picked per message",
      icon: "🧠",
      color: "#f5c2e7",
      children: [
        { icon: "🟣", label: "Anthropic", color: "#cba6f7", description: "Claude Sonnet 4 (default)" },
        { icon: "🟠", label: "Fireworks", color: "#fab387", description: "DeepSeek V3 · Kimi K2.5" },
      ],
    },
  },
  {
    id: "providers",
    type: "arch",
    position: { x: 980, y: 360 },
    data: {
      label: "VPS Providers",
      description: "Cloud APIs the manager provisions against",
      icon: "☁️",
      color: "#f9e2af",
      children: [
        { icon: "🌊", label: "DigitalOcean", color: "#89b4fa", description: "Droplets, snapshots, base images" },
        { icon: "🌀", label: "TazCloud", color: "#a6e3a1", description: "IPv6 VMs, snapshots, HTTPS ingress" },
      ],
    },
  },
  {
    id: "mcp",
    type: "arch",
    position: { x: 980, y: 800 },
    data: {
      label: "MCP Servers",
      description: "Manager-hosted tools, SSH-tunneled to the VPS",
      icon: "🔌",
      color: "#74c7ec",
      items: [
        "tracker — list/create/update issues",
        "security — repo scans",
        "storage — uploads + screenshots",
        "notify — email + chat messages",
        "browser — DOM via extension",
      ],
    },
  },

  // --- Far right: VPS ---
  {
    id: "vps",
    type: "arch",
    position: { x: 1480, y: 280 },
    data: {
      label: "VPS Instance",
      description: "Bootstrapped via SSH (apt/dnf, idempotent)",
      icon: "🖧",
      color: "#f38ba8",
      children: [
        { icon: "🤖", label: "@genie/vps-agent", color: "#f38ba8", description: "Claude API client over SSH stdio (NDJSON)" },
        { icon: "🧠", label: "Claude Code", color: "#cba6f7", description: "Optional CLI in the genie user shell" },
        { icon: "🐳", label: "Docker Compose", color: "#89dceb", description: "Project services + hot-reload web-src" },
      ],
    },
  },
];

// --- Edges ---

const labelBg = { fill: "transparent", stroke: "none" } as const;
const labelStyle = { fill: "#cdd6f4", fontSize: 13, fontWeight: 500 };

const initialEdges: Edge[] = [
  // Clients ↔ Manager
  {
    id: "dashboard-manager",
    source: "dashboard",
    sourceHandle: "right",
    target: "manager",
    targetHandle: "left",
    label: "WebSocket",
    style: { stroke: "#89b4fa" },
    labelStyle,
    labelBgStyle: labelBg,
    animated: true,
  },
  {
    id: "extension-manager",
    source: "extension",
    sourceHandle: "right",
    target: "manager",
    targetHandle: "left",
    label: "WebSocket",
    style: { stroke: "#a6e3a1" },
    labelStyle,
    labelBgStyle: labelBg,
    animated: true,
  },
  {
    id: "slack-manager",
    source: "slack",
    sourceHandle: "right",
    target: "manager",
    targetHandle: "left",
    label: "Bot API",
    style: { stroke: "#94e2d5" },
    labelStyle,
    labelBgStyle: labelBg,
    animated: true,
  },

  // Manager → DB
  {
    id: "manager-db",
    source: "manager",
    target: "db",
    label: "Drizzle ORM",
    style: { stroke: "#fab387" },
    labelStyle,
    labelBgStyle: labelBg,
    animated: true,
  },

  // Manager ↔ external
  {
    id: "manager-llm",
    source: "manager",
    sourceHandle: "right",
    target: "llm",
    targetHandle: "left",
    label: "HTTPS",
    style: { stroke: "#f5c2e7" },
    labelStyle,
    labelBgStyle: labelBg,
    animated: true,
  },
  {
    id: "manager-providers",
    source: "manager",
    sourceHandle: "right",
    target: "providers",
    targetHandle: "left",
    label: "REST API",
    style: { stroke: "#f9e2af" },
    labelStyle,
    labelBgStyle: labelBg,
    animated: true,
  },
  {
    id: "manager-mcp",
    source: "manager",
    sourceHandle: "right",
    target: "mcp",
    targetHandle: "left",
    label: "hosts",
    style: { stroke: "#74c7ec" },
    labelStyle,
    labelBgStyle: labelBg,
  },

  // Providers → VPS (provisions)
  {
    id: "providers-vps",
    source: "providers",
    sourceHandle: "right",
    target: "vps",
    targetHandle: "left",
    label: "provisions",
    style: { stroke: "#f9e2af", strokeDasharray: "5 5" },
    labelStyle,
    labelBgStyle: labelBg,
  },

  // Manager → VPS (SSH stdio to vps-agent + SCP)
  {
    id: "manager-vps",
    source: "manager",
    sourceHandle: "right",
    target: "vps",
    targetHandle: "left",
    label: "SSH stdio (NDJSON) + SCP",
    style: { stroke: "#f38ba8" },
    labelStyle,
    labelBgStyle: labelBg,
    animated: true,
  },

  // VPS → MCP (SSH reverse tunnel)
  {
    id: "vps-mcp",
    source: "vps",
    sourceHandle: "left-out",
    target: "mcp",
    targetHandle: "right-in",
    label: "SSH tunnel",
    style: { stroke: "#74c7ec" },
    labelStyle,
    labelBgStyle: labelBg,
    animated: true,
  },

  // VPS agent → Chrome extension (DOM actions, proxied via manager WS)
  {
    id: "vps-extension",
    source: "vps",
    sourceHandle: "bottom",
    target: "extension",
    targetHandle: "bottom-in",
    label: "DOM actions (via manager WS)",
    style: { stroke: "#fab387" },
    labelStyle,
    labelBgStyle: labelBg,
    animated: true,
  },
];

// --- Panel ---

export function ArchitecturePanel() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-6 py-4 border-b border-surface0">
        <h1 className="text-xl font-semibold text-text">System Architecture</h1>
        <p className="text-md text-subtext0 mt-1">
          How the Genie Manager, web dashboard, Chrome extension, VPS providers, and the
          on-VPS agent fit together. Drag nodes to rearrange.
        </p>
      </div>

      <div className="flex-1 relative" style={{ minHeight: 500 }}>
        <ReactFlow
          nodes={nodes}
          edges={initialEdges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          zoomOnScroll
          panOnScroll
          minZoom={0.2}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--ctp-surface0)" />
          <Controls
            showInteractive={false}
            style={{ background: "var(--ctp-mantle)", borderColor: "var(--ctp-surface0)" }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
