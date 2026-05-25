"use client";

import { useMemo, useRef, useState, Suspense } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  OrbitControls,
  Html,
  Line,
  Stars,
  Float,
  Sparkles,
  Environment,
} from "@react-three/drei";
import * as THREE from "three";
import { useSubject } from "subjecto/react";
import { $projects, $presenceSessions, $auth } from "@/store/subjects";
import { useEffect } from "react";
import { requestPresenceDetail } from "@/store/actions";
import type { ProjectDef, VpsInstance } from "@/store/types/vps";
import type { PresenceSession } from "@/store/types/common";

// --- Catppuccin Mocha palette (matches globals.css) ---
const C = {
  bg: "#11111b",
  surface: "#313244",
  text: "#cdd6f4",
  subtext: "#a6adc8",
  mauve: "#cba6f7",
  blue: "#89b4fa",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  peach: "#fab387",
  red: "#f38ba8",
  lavender: "#b4befe",
  teal: "#94e2d5",
} as const;

// --- Layout ---
// Stable concentric ring layout. Projects sit on a flat ring around Genie at
// y=0; servers orbit slightly above their parent project; users float above
// the server they're "attached" to (deterministic hash since the server has
// no per-user project context yet).

const PROJECT_RING = 5.5;
const SERVER_ORBIT = 1.6;
// Users orbit Genie itself — they connect to the Manager via WebSocket. We
// don't currently track which specific project/server a session is "on", so
// inventing that link would be a lie (see commit history).
const USER_ORBIT_RADIUS = 2.4;
const USER_ORBIT_HEIGHT_RANGE = 1.2;

interface ServerNode {
  id: string;
  label: string;
  position: THREE.Vector3;
  provider: "digitalocean" | "tazcloud" | "local";
  ip?: string;
}

interface ProjectNode {
  id: string;
  name: string;
  position: THREE.Vector3;
  servers: ServerNode[];
}

interface UserNode {
  /** Stable key for React — userId + session index, since one user can have
   *  multiple tabs/sessions and we render each as its own sphere. */
  key: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  clientType: string;
  position: THREE.Vector3;
  /** ID of the project this session currently has open, or null if not on a
   *  project page. Comes from the server-tracked presence state. */
  attachedProjectId: string | null;
  /** IDs of every server the user has a live PTY session connected to.
   *  Sourced from the server-side `ptySessions` table — one edge is drawn per
   *  entry. Empty when the user has no active terminal sessions, in which
   *  case the user→target edge falls back to the Genie core. */
  attachedServerIds: string[];
}

interface Graph {
  projects: ProjectNode[];
  users: UserNode[];
  allServers: ServerNode[];
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildGraph(projects: ProjectDef[], sessions: PresenceSession[]): Graph {
  const projectNodes: ProjectNode[] = [];
  const allServers: ServerNode[] = [];

  const N = Math.max(projects.length, 1);
  projects.forEach((p, i) => {
    const angle = (i / N) * Math.PI * 2;
    const pos = new THREE.Vector3(
      Math.cos(angle) * PROJECT_RING,
      0,
      Math.sin(angle) * PROJECT_RING,
    );

    const servers: ServerNode[] = (p.vpsInstances ?? []).map((vps: VpsInstance, j: number, arr) => {
      const sAngle = (j / Math.max(arr.length, 1)) * Math.PI * 2;
      const provider: ServerNode["provider"] = vps.digitalocean
        ? "digitalocean"
        : vps.tazcloud
          ? "tazcloud"
          : "local";
      const ip =
        vps.digitalocean?.ipAddress ??
        vps.tazcloud?.ipv6 ??
        vps.connection?.host;
      // Servers spiral up + outward around the project node so they don't
      // overlap with neighboring projects.
      const dir = pos.clone().normalize();
      const tangent = new THREE.Vector3(-dir.z, 0, dir.x);
      const localOffset = dir
        .clone()
        .multiplyScalar(Math.cos(sAngle) * SERVER_ORBIT)
        .add(tangent.clone().multiplyScalar(Math.sin(sAngle) * SERVER_ORBIT * 0.6));
      const sPos = pos.clone().add(localOffset).add(new THREE.Vector3(0, 0.9 + j * 0.4, 0));
      return {
        id: vps.id,
        label: vps.label || `${provider} VM`,
        position: sPos,
        provider,
        ip,
      };
    });

    allServers.push(...servers);
    projectNodes.push({ id: p.id, name: p.name, position: pos, servers });
  });

  // Render one node per session (not per user) — two tabs from the same
  // person become two spheres, each pointing to whichever project that
  // specific tab has open.
  const projectIndex = new Map<string, ProjectNode>();
  for (const p of projectNodes) projectIndex.set(p.id, p);

  // Indexes for resolving PTY-session attachments to a server node. Direct
  // SSH terminals carry no instanceId, so we also index by host (`ip`).
  const serverById = new Map<string, ServerNode>();
  const serverByHost = new Map<string, ServerNode>();
  for (const s of allServers) {
    serverById.set(s.id, s);
    if (s.ip) serverByHost.set(s.ip, s);
  }

  // Sub-counter per user so we can fan out multiple sessions of the same
  // user side-by-side instead of stacking them on top of each other.
  const sessionIndexPerUser = new Map<string, number>();
  const users: UserNode[] = [];
  const total = Math.max(sessions.length, 1);

  sessions.forEach((s, idx) => {
    const subIdx = sessionIndexPerUser.get(s.id) ?? 0;
    sessionIndexPerUser.set(s.id, subIdx + 1);

    const h = hashString(s.id);
    const baseAngle = (idx / total) * Math.PI * 2;
    const jitter = ((h % 100) / 100 - 0.5) * 0.3;
    const angle = baseAngle + jitter;
    // Stack same-user sessions at slightly different radii + heights so the
    // pills don't overlap.
    const radius = USER_ORBIT_RADIUS + subIdx * 0.55;
    const heightPhase = ((h >> 8) % 1000) / 1000;
    const y = 0.4 + heightPhase * USER_ORBIT_HEIGHT_RANGE + subIdx * 0.35;
    const pos = new THREE.Vector3(
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius,
    );

    const attachedProject = s.selectedProjectId ? projectIndex.get(s.selectedProjectId) ?? null : null;

    // Resolve each attached PTY entry to a server: prefer instanceId, fall
    // back to host. Dedupe by server id so two terminals on the same VM
    // collapse into one edge.
    const attachedServerIds: string[] = [];
    const seen = new Set<string>();
    for (const entry of s.attachedServers ?? []) {
      const server =
        (entry.instanceId ? serverById.get(entry.instanceId) : null) ??
        (entry.host ? serverByHost.get(entry.host) : null);
      if (server && !seen.has(server.id)) {
        seen.add(server.id);
        attachedServerIds.push(server.id);
      }
    }

    users.push({
      key: `${s.id}#${subIdx}`,
      userId: s.id,
      name: s.name,
      email: s.email,
      avatarUrl: s.avatarUrl,
      clientType: s.clientType,
      position: pos,
      attachedProjectId: attachedProject ? attachedProject.id : null,
      attachedServerIds,
    });
  });

  return { projects: projectNodes, users, allServers };
}

// --- 3D primitives ---

function GenieCore() {
  const inner = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);

  useFrame((_, dt) => {
    if (inner.current) {
      inner.current.rotation.y += dt * 0.3;
      inner.current.rotation.x += dt * 0.15;
    }
    if (halo.current) {
      halo.current.rotation.z -= dt * 0.2;
    }
  });

  return (
    <group>
      {/* Outer glow halo */}
      <mesh ref={halo}>
        <icosahedronGeometry args={[1.5, 1]} />
        <meshBasicMaterial
          color={C.mauve}
          wireframe
          transparent
          opacity={0.25}
        />
      </mesh>

      {/* Core */}
      <mesh ref={inner}>
        <icosahedronGeometry args={[1.05, 2]} />
        <meshStandardMaterial
          color={C.mauve}
          emissive={C.mauve}
          emissiveIntensity={0.8}
          roughness={0.25}
          metalness={0.4}
        />
      </mesh>

      {/* Inner sparkles */}
      <Sparkles count={40} scale={2.6} size={3} speed={0.5} color={C.lavender} />

      {/* Bottom label */}
      <Html position={[0, -1.9, 0]} center distanceFactor={10} zIndexRange={[1, 0]}>
        <div
          style={{
            color: C.text,
            fontFamily: "var(--font-sans)",
            fontWeight: 600,
            fontSize: 14,
            letterSpacing: 0.5,
            textShadow: "0 0 8px rgba(203,166,247,0.6)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          GENIE
        </div>
      </Html>
    </group>
  );
}

function ProjectNodeMesh({
  node,
  onSelect,
  highlighted,
}: {
  node: ProjectNode;
  onSelect: () => void;
  highlighted: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.y = Math.sin(t * 0.6 + node.position.x) * 0.05;
  });

  const color = highlighted ? C.yellow : C.peach;

  return (
    <group position={node.position}>
      <Float speed={1.2} rotationIntensity={0.3} floatIntensity={0.4}>
        <mesh
          ref={ref}
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            setHovered(true);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = "auto";
          }}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation();
            onSelect();
          }}
          scale={hovered ? 1.2 : 1}
        >
          <dodecahedronGeometry args={[0.42, 0]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={hovered ? 0.55 : 0.2}
            roughness={0.25}
            metalness={0.6}
          />
        </mesh>
      </Float>
      <Html position={[0, 0.65, 0]} center distanceFactor={9} zIndexRange={[1, 0]}>
        <div
          style={{
            color: hovered ? C.yellow : C.peach,
            fontFamily: "var(--font-sans)",
            fontWeight: 600,
            fontSize: 11,
            background: "rgba(17,17,27,0.7)",
            padding: "2px 6px",
            borderRadius: 4,
            border: `1px solid ${hovered ? C.yellow : "rgba(250,179,135,0.4)"}`,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            maxWidth: 160,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {node.name}
        </div>
      </Html>
    </group>
  );
}

function ServerMesh({
  server,
  highlighted,
}: {
  server: ServerNode;
  highlighted: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.x = state.clock.elapsedTime * 0.4;
    ref.current.rotation.y = state.clock.elapsedTime * 0.25;
  });

  const color =
    server.provider === "digitalocean"
      ? C.blue
      : server.provider === "tazcloud"
        ? C.teal
        : C.lavender;

  return (
    <group position={server.position}>
      <mesh
        ref={ref}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        scale={hovered || highlighted ? 1.25 : 1}
      >
        <boxGeometry args={[0.42, 0.42, 0.42]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={highlighted ? 0.6 : 0.18}
          roughness={0.2}
          metalness={0.85}
        />
      </mesh>

      {(hovered || highlighted) && (
        <Html position={[0, 0.5, 0]} center distanceFactor={8} zIndexRange={[1, 0]}>
          <div
            style={{
              color,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              background: "rgba(17,17,27,0.85)",
              padding: "3px 7px",
              borderRadius: 4,
              border: `1px solid ${color}`,
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            <div style={{ color: C.text, fontWeight: 600 }}>{server.label}</div>
            {server.ip && (
              <div style={{ color: C.subtext, marginTop: 1 }}>{server.ip}</div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

function UserMesh({
  user,
  highlighted,
}: {
  user: UserNode;
  highlighted: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime + (hashString(user.key) % 100);
    // Local offset only — the parent <group> already carries user.position.
    ref.current.position.y = Math.sin(t * 1.3) * 0.08;
  });

  const color = highlighted ? C.yellow : C.green;

  return (
    <group position={user.position}>
      <Float speed={2} rotationIntensity={0.6} floatIntensity={0.4}>
        <mesh
          ref={ref}
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
          scale={hovered ? 1.3 : 1}
        >
          <sphereGeometry args={[0.32, 32, 32]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={hovered ? 1.3 : 0.8}
            roughness={0.2}
            metalness={0.1}
          />
        </mesh>
      </Float>

      {/* Soft outer glow */}
      <mesh>
        <sphereGeometry args={[0.5, 24, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} />
      </mesh>

      {/* Pulsing ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.56, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>

      <Html position={[0, 0.7, 0]} center distanceFactor={7} zIndexRange={[1, 0]}>
        <div
          style={{
            color: C.text,
            fontFamily: "var(--font-sans)",
            fontSize: 10,
            fontWeight: 500,
            background: "rgba(17,17,27,0.75)",
            padding: "2px 6px",
            borderRadius: 999,
            border: `1px solid ${color}`,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              style={{ width: 12, height: 12, borderRadius: "50%" }}
            />
          ) : (
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: color,
                color: C.bg,
                fontSize: 8,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {user.name[0]?.toUpperCase() ?? "?"}
            </span>
          )}
          {user.name}
        </div>
      </Html>
    </group>
  );
}

// --- Edges ---

function FlowingEdge({
  from,
  to,
  color,
  active,
  dashed,
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: string;
  active?: boolean;
  dashed?: boolean;
}) {
  // Build a gentle bezier curve so edges arc instead of intersecting nodes.
  const curve = useMemo(() => {
    const mid = from.clone().add(to).multiplyScalar(0.5);
    // Lift the midpoint slightly off the line for arc-shaped edges.
    const direction = to.clone().sub(from);
    const lift = Math.max(0.4, direction.length() * 0.15);
    mid.y += lift;
    const c = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
    return c.getPoints(40);
  }, [from, to]);

  return (
    <Line
      points={curve}
      color={color}
      lineWidth={active ? 2.2 : 1.1}
      transparent
      opacity={active ? 0.9 : 0.45}
      dashed={dashed}
      dashSize={dashed ? 0.18 : 0}
      gapSize={dashed ? 0.12 : 0}
    />
  );
}

function RingFloor() {
  const points = useMemo(() => {
    const segments = 128;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * PROJECT_RING, -0.02, Math.sin(a) * PROJECT_RING));
    }
    return pts;
  }, []);
  return <Line points={points} color={C.surface} lineWidth={1} transparent opacity={0.7} dashed dashSize={0.25} gapSize={0.18} />;
}

// --- Scene ---

function Scene({ graph, currentUserId }: { graph: Graph; currentUserId: string | null }) {
  return (
    <>
      {/* Image-based lighting — gives metallic/rough materials proper reflections
          without us having to hand-place every light. */}
      <Environment preset="city" environmentIntensity={0.45} />

      {/* Sky/ground tint */}
      <hemisphereLight args={[C.lavender, C.bg, 0.45]} />

      {/* Soft ambient base so backsides never go pitch black */}
      <ambientLight intensity={0.25} />

      {/* Key directional light — primary highlight angle */}
      <directionalLight position={[8, 12, 6]} intensity={1.4} color="#ffffff" />

      {/* Fill light from the opposite side, cool tone */}
      <directionalLight position={[-7, 4, -5]} intensity={0.55} color={C.blue} />

      {/* Rim light from below-back, warm tone for edge separation */}
      <directionalLight position={[2, -3, -8]} intensity={0.35} color={C.peach} />

      {/* Genie core glow — colors the inner region with its own magic */}
      <pointLight position={[0, 0, 0]} intensity={2.2} color={C.mauve} distance={18} decay={2} />

      {/* Top accent — picks out the upward-facing faces */}
      <pointLight position={[0, 9, 0]} intensity={0.6} color={C.lavender} distance={20} decay={2} />

      <Stars radius={50} depth={50} count={2500} factor={3} saturation={0} fade speed={0.5} />

      <RingFloor />

      <GenieCore />

      {/* Genie → Project edges */}
      {graph.projects.map((p) => (
        <FlowingEdge
          key={`gp-${p.id}`}
          from={new THREE.Vector3(0, 0, 0)}
          to={p.position}
          color={C.mauve}
          active
        />
      ))}

      {/* Project → Server edges */}
      {graph.projects.map((p) =>
        p.servers.map((s) => (
          <FlowingEdge
            key={`ps-${s.id}`}
            from={p.position}
            to={s.position}
            color={s.provider === "tazcloud" ? C.teal : s.provider === "digitalocean" ? C.blue : C.lavender}
            active
          />
        )),
      )}

      {/* User edges — one per server the user has a live PTY session
          connected to. Falls back to a single edge into the Genie core when
          the user has no active terminal sessions. */}
      {graph.users.flatMap((u) => {
        const isCurrent = u.userId === currentUserId;
        const color = isCurrent ? C.yellow : C.green;
        const targets = u.attachedServerIds
          .map((id) => graph.allServers.find((s) => s.id === id))
          .filter((s): s is ServerNode => Boolean(s));

        if (targets.length === 0) {
          return [
            <FlowingEdge
              key={`ut-${u.key}-genie`}
              from={u.position}
              to={new THREE.Vector3(0, 0, 0)}
              color={color}
              dashed
              active={isCurrent}
            />,
          ];
        }

        return targets.map((server) => (
          <FlowingEdge
            key={`ut-${u.key}-${server.id}`}
            from={u.position}
            to={server.position}
            color={color}
            dashed
            active={isCurrent}
          />
        ));
      })}

      {/* Projects */}
      {graph.projects.map((p) => (
        <ProjectNodeMesh
          key={p.id}
          node={p}
          onSelect={() => {}}
          highlighted={false}
        />
      ))}

      {/* Servers */}
      {graph.projects.map((p) =>
        p.servers.map((s) => (
          <ServerMesh
            key={s.id}
            server={s}
            highlighted={false}
          />
        )),
      )}

      {/* Users — one mesh per session */}
      {graph.users.map((u) => (
        <UserMesh key={u.key} user={u} highlighted={u.userId === currentUserId} />
      ))}
    </>
  );
}

// --- Legend overlay ---

function Legend({ counts }: { counts: { projects: number; servers: number; users: number } }) {
  const items = [
    { color: C.mauve, label: "Genie", value: 1 },
    { color: C.peach, label: "Projects", value: counts.projects },
    { color: C.blue, label: "Servers", value: counts.servers },
    { color: C.green, label: "Sessions", value: counts.users },
  ];
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        background: "rgba(17,17,27,0.78)",
        border: `1px solid ${C.surface}`,
        borderRadius: 8,
        padding: "10px 14px",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        pointerEvents: "none",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        color: C.text,
        minWidth: 140,
      }}
    >
      {items.map((it) => (
        <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: it.color,
              boxShadow: `0 0 8px ${it.color}`,
            }}
          />
          <span style={{ flex: 1 }}>{it.label}</span>
          <span style={{ color: C.subtext, fontVariantNumeric: "tabular-nums" }}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

// --- Public component ---

export function TopologyGraph3D() {
  const [projects] = useSubject($projects);
  const [sessions] = useSubject($presenceSessions);
  const [auth] = useSubject($auth);

  useEffect(() => {
    requestPresenceDetail();
  }, []);

  const graph = useMemo(() => buildGraph(projects, sessions), [projects, sessions]);

  const counts = {
    projects: graph.projects.length,
    servers: graph.allServers.length,
    users: graph.users.length,
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: `radial-gradient(ellipse at center, ${C.surface} 0%, ${C.bg} 70%)`,
      }}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [9, 7, 9], fov: 50 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={[C.bg]} />
        <fog attach="fog" args={[C.bg, 18, 45]} />

        <Suspense fallback={null}>
          <Scene graph={graph} currentUserId={auth.user?.id ?? null} />
        </Suspense>

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={4}
          maxDistance={30}
          maxPolarAngle={Math.PI * 0.85}
        />
      </Canvas>

      <Legend counts={counts} />

      {graph.projects.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: C.subtext,
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          No projects to visualize yet — add one to see the topology.
        </div>
      )}
    </div>
  );
}
