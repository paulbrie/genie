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
      className="rounded-lg border px-5 py-4 shadow-md min-w-[200px]"
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
  {
    id: "manager",
    type: "arch",
    position: { x: 350, y: 0 },
    data: {
      label: "Genie Manager",
      description: "Local Node.js server orchestrating everything",
      icon: "🧞",
      color: "#cba6f7",
      items: [
        "WebSocket server (real-time)",
        "PostgreSQL via Drizzle ORM",
        "Process & PTY management",
        "SSH tunnel to droplets",
      ],
    },
  },
  {
    id: "renderer",
    type: "arch",
    position: { x: 0, y: 350 },
    data: {
      label: "Web Dashboard",
      description: "Next.js app running locally",
      icon: "🖥️",
      color: "#89b4fa",
      items: [
        "Project management UI",
        "Docs editor, Tracker",
        "Terminal & process monitor",
        "Admin panel & DB explorer",
      ],
    },
  },
  {
    id: "extension",
    type: "arch",
    position: { x: 400, y: 350 },
    data: {
      label: "Chrome Extension",
      description: "Browser extension for remote VPS control",
      icon: "🧩",
      color: "#a6e3a1",
      items: [
        "Chat with AI assistant",
        "Run commands on droplets",
        "File editor & Docker view",
        "DB explorer & terminal",
      ],
    },
  },
  {
    id: "droplet",
    type: "arch",
    position: { x: 820, y: 0 },
    data: {
      label: "VPS Droplet",
      description: "DigitalOcean droplet running your services",
      icon: "☁️",
      color: "#f9e2af",
      items: [
        "Docker Compose services",
        "Deployed application code",
        "PostgreSQL databases",
        "Nginx / reverse proxy",
      ],
    },
  },
  {
    id: "claude",
    type: "arch",
    position: { x: 820, y: 380 },
    data: {
      label: "Claude Code",
      description: "Runs inside the droplet via SSH",
      icon: "🤖",
      color: "#f38ba8",
      items: [
        "Executes shell commands",
        "Edits files & manages services",
        "Sends DOM actions to extension",
        "Code generation & troubleshooting",
      ],
    },
  },
];

// --- Edges ---

const labelBg = { fill: "transparent", stroke: "none" } as const;
const white = "#cdd6f4";

const initialEdges: Edge[] = [
  {
    id: "manager-renderer",
    source: "manager",
    target: "renderer",
    label: "WebSocket",
    style: { stroke: "#89b4fa" },
    labelStyle: { fill: white, fontSize: 13, fontWeight: 500 },
    labelBgStyle: labelBg,
    animated: true,
  },
  {
    id: "manager-extension",
    source: "manager",
    target: "extension",
    label: "WebSocket",
    style: { stroke: "#a6e3a1" },
    labelStyle: { fill: white, fontSize: 13, fontWeight: 500 },
    labelBgStyle: labelBg,
    animated: true,
  },
  {
    id: "manager-droplet",
    source: "manager",
    sourceHandle: "right",
    target: "droplet",
    targetHandle: "left",
    label: "SSH / SCP",
    style: { stroke: "#f9e2af" },
    labelStyle: { fill: white, fontSize: 13, fontWeight: 500 },
    labelBgStyle: labelBg,
    animated: true,
  },
  {
    id: "droplet-claude",
    source: "droplet",
    target: "claude",
    label: "Runs inside",
    style: { stroke: "#f38ba8" },
    labelStyle: { fill: white, fontSize: 13, fontWeight: 500 },
    labelBgStyle: labelBg,
    animated: true,
  },
  {
    id: "claude-extension",
    source: "claude",
    sourceHandle: "left-out",
    target: "extension",
    targetHandle: "right-in",
    label: "DOM actions via WebSocket",
    style: { stroke: "#fab387" },
    animated: true,
    labelStyle: { fill: white, fontSize: 13, fontWeight: 500 },
    labelBgStyle: labelBg,
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
          How the Genie Manager, VPS droplets, Chrome extension, and Claude AI interact.
          Drag nodes to rearrange.
        </p>
      </div>

      <div className="flex-1 relative" style={{ minHeight: 500 }}>
        <ReactFlow
          nodes={nodes}
          edges={initialEdges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          zoomOnScroll
          panOnScroll
          minZoom={0.3}
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
