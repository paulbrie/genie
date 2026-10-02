"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ProcessInfo } from "@/store/types";
interface ProcessCityProps {
  processes: ProcessInfo[];
  geniePids: Set<number>;
  layoutMode: "stable" | "landmark";
  neighborhoodMode: "user" | "process-tree";
  onNeighborhoodModeChange?: (mode: "user" | "process-tree") => void;
  visibleProcessIds: Set<number>;
  filterActive: boolean;
  onProcessContextMenu?: (event: React.MouseEvent, pid: number) => void;
  contextTargetPid?: number | null;
  explodingPid?: number | null;
  explosionStartedAt?: number | null;
  showLegend?: boolean;
}

interface Palette {
  top: string;
  left: string;
  right: string;
  road: string;
  plaza: string;
  accent: string;
  window: string;
}

interface Neighborhood {
  user: string;
  title: string;
  subtitle: string;
  processes: ProcessInfo[];
  totalCpu: number;
  totalMem: number;
  gx: number;
  gy: number;
  cols: number;
  rows: number;
  palette: Palette;
  sortKey: number;
}

interface BuildingData {
  proc: ProcessInfo;
  district: Neighborhood;
  gx: number;
  gy: number;
  h: number;
  footprint: number;
  palette: Palette;
  isGenie: boolean;
  isInit: boolean;
  hasPort: boolean;
  sortKey: number;
}

interface EmptyLotData {
  district: Neighborhood;
  gx: number;
  gy: number;
  sortKey: number;
}

interface SkyBridgeData {
  parent: BuildingData;
  child: BuildingData;
  sortKey: number;
}

const TILE_WIDTH = 34;
const TILE_HEIGHT = 17;
const STREET_GAP = 4;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 4;
const PAN_STEP = 48;
const FLAT_BUILDING_HEIGHT = 12;
const DEFAULT_CAMERA_TRANSITION = "transform 420ms cubic-bezier(0.2, 0.9, 0.22, 1)";
const FOCUS_CAMERA_TRANSITION = "transform 1760ms cubic-bezier(0.18, 1, 0.22, 1)";
const FOCUS_CAMERA_TRANSITION_MS = 1760;
const EXPLOSION_ANIMATION_MS = 720;

const PALETTES: Palette[] = [
  {
    top: "#8bd5ff",
    left: "#4b79c5",
    right: "#3461a8",
    road: "#2a3048",
    plaza: "#5cc9b4",
    accent: "#9dd7ff",
    window: "#ecf8ff",
  },
  {
    top: "#c6f28a",
    left: "#6ea84d",
    right: "#56893a",
    road: "#2f3526",
    plaza: "#b6ef9c",
    accent: "#d8ffb8",
    window: "#fcffe8",
  },
  {
    top: "#d6b3ff",
    left: "#8a63c2",
    right: "#714cab",
    road: "#332741",
    plaza: "#f3b3ff",
    accent: "#efd8ff",
    window: "#fff2ff",
  },
  {
    top: "#ffbe88",
    left: "#cf7b47",
    right: "#b56534",
    road: "#3a2b24",
    plaza: "#ffd39b",
    accent: "#ffe3ba",
    window: "#fff4df",
  },
  {
    top: "#ff9fb2",
    left: "#c55d74",
    right: "#ac465c",
    road: "#40252d",
    plaza: "#ffc4ca",
    accent: "#ffd8df",
    window: "#fff0f3",
  },
  {
    top: "#8ef0df",
    left: "#4d9d90",
    right: "#387f73",
    road: "#243a39",
    plaza: "#acead8",
    accent: "#d1fff5",
    window: "#effffb",
  },
];

function toIso(gx: number, gy: number) {
  return {
    x: (gx - gy) * (TILE_WIDTH / 2),
    y: (gx + gy) * (TILE_HEIGHT / 2),
  };
}

function quadPoints(
  gx: number,
  gy: number,
  cols: number,
  rows: number,
  elevation = 0,
) {
  const tl = toIso(gx, gy);
  const tr = toIso(gx + cols, gy);
  const br = toIso(gx + cols, gy + rows);
  const bl = toIso(gx, gy + rows);
  return [
    `${tl.x},${tl.y - elevation}`,
    `${tr.x},${tr.y - elevation}`,
    `${br.x},${br.y - elevation}`,
    `${bl.x},${bl.y - elevation}`,
  ].join(" ");
}

function cubePoints(gx: number, gy: number, h: number, footprint = 1) {
  const { x: sx, y: sy } = toIso(gx, gy);
  const halfWidth = (TILE_WIDTH / 2) * footprint;
  const halfHeight = (TILE_HEIGHT / 2) * footprint;
  return {
    sx,
    sy,
    top: [
      `${sx},${sy - halfHeight - h}`,
      `${sx + halfWidth},${sy - h}`,
      `${sx},${sy + halfHeight - h}`,
      `${sx - halfWidth},${sy - h}`,
    ].join(" "),
    left: [
      `${sx - halfWidth},${sy - h}`,
      `${sx},${sy + halfHeight - h}`,
      `${sx},${sy + halfHeight}`,
      `${sx - halfWidth},${sy}`,
    ].join(" "),
    right: [
      `${sx + halfWidth},${sy - h}`,
      `${sx},${sy + halfHeight - h}`,
      `${sx},${sy + halfHeight}`,
      `${sx + halfWidth},${sy}`,
    ].join(" "),
  };
}

function footprintDiamond(gx: number, gy: number, footprint = 1, elevation = 0) {
  const { x: sx, y: sy } = toIso(gx, gy);
  const halfWidth = (TILE_WIDTH / 2) * footprint;
  const halfHeight = (TILE_HEIGHT / 2) * footprint;
  return [
    `${sx},${sy - halfHeight - elevation}`,
    `${sx + halfWidth},${sy - elevation}`,
    `${sx},${sy + halfHeight - elevation}`,
    `${sx - halfWidth},${sy - elevation}`,
  ].join(" ");
}

function formatMem(memMb: number) {
  if (memMb >= 1024) return `${(memMb / 1024).toFixed(memMb >= 10240 ? 0 : 1)} GB`;
  return `${memMb.toFixed(memMb >= 100 ? 0 : 1)} MB`;
}

function formatCpu(cpu: number) {
  return `${cpu.toFixed(cpu >= 10 ? 0 : 1)}%`;
}

function buildDistrictSubtitle(user: string, count: number, totalCpu: number) {
  const normalized = user.toLowerCase();
  if (normalized === "root") return "Kernel Heights";
  if (normalized === "system") return "Service Borough";
  if (normalized.includes("daemon")) return "Daemon Row";
  if (totalCpu >= 100) return "Rush Hour";
  if (count >= 8) return "Dense Block";
  if (count <= 2) return "Pocket Plaza";
  return "Midtown Terrace";
}

function buildProcessTreeSubtitle(root: ProcessInfo, count: number, totalCpu: number) {
  if (totalCpu >= 100) return `Root PID ${root.pid} · Hot process family`;
  if (count >= 8) return `Root PID ${root.pid} · Deep process tree`;
  if (count <= 2) return `Root PID ${root.pid} · Small branch`;
  return `Root PID ${root.pid} · ${root.user}`;
}

function buildProcessTreeTitle(root: ProcessInfo, count: number) {
  return `${root.name} · ${count} process${count === 1 ? "" : "es"}`;
}

function buildSoloProcessTitle(count: number) {
  return `Solo Processes · ${count} process${count === 1 ? "" : "es"}`;
}

function buildSoloProcessSubtitle(count: number) {
  if (count >= 12) return "Independent processes collected together";
  if (count >= 4) return "Small standalone processes";
  return "Standalone processes";
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function formatTowerLabel(name: string, zoom: number) {
  const maxChars = zoom >= 2.4 ? 24 : zoom >= 1.6 ? 18 : 13;
  return name.length > maxChars ? `${name.slice(0, maxChars - 3)}...` : name;
}

function mixHexColors(colorA: string, colorB: string, ratio: number) {
  const normalizedRatio = Math.max(0, Math.min(1, ratio));
  const a = colorA.replace("#", "");
  const b = colorB.replace("#", "");
  const ar = Number.parseInt(a.slice(0, 2), 16);
  const ag = Number.parseInt(a.slice(2, 4), 16);
  const ab = Number.parseInt(a.slice(4, 6), 16);
  const br = Number.parseInt(b.slice(0, 2), 16);
  const bg = Number.parseInt(b.slice(2, 4), 16);
  const bb = Number.parseInt(b.slice(4, 6), 16);
  const r = Math.round(ar + (br - ar) * normalizedRatio);
  const g = Math.round(ag + (bg - ag) * normalizedRatio);
  const bChannel = Math.round(ab + (bb - ab) * normalizedRatio);
  return `rgb(${r}, ${g}, ${bChannel})`;
}

function getMemoryRatio(mem: number, maxMem: number) {
  const normalizedMax = Math.max(maxMem, 1);
  const logMem = Math.log10(mem + 1);
  const logMax = Math.log10(normalizedMax + 1);
  return logMax > 0 ? logMem / logMax : 0;
}

function getRenderedBuildingHeight(
  building: BuildingData,
  flatMemoryMode: boolean,
  selectedPid: number | null,
  selectedProcessTree: Set<number>,
) {
  const isExpandedInFlatMode =
    flatMemoryMode && selectedPid !== null && selectedProcessTree.has(building.proc.pid);
  return flatMemoryMode && !isExpandedInFlatMode ? FLAT_BUILDING_HEIGHT : building.h;
}

function buildWindowPath(
  sx: number,
  sy: number,
  h: number,
  footprint: number,
  count: number,
) {
  const segments: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = (index + 1) * 14;
    const leftY = sy + TILE_HEIGHT / 2 - offset;
    const x1 = sx - TILE_WIDTH * 0.32 * footprint;
    const y1 = leftY;
    const x2 = sx - TILE_WIDTH * 0.08 * footprint;
    const y2 = leftY - TILE_HEIGHT * 0.14 * footprint;
    if (y1 <= sy - h + 6) break;
    segments.push(`M ${x1} ${y1} L ${x2} ${y2}`);
  }
  return segments.join(" ");
}

function getFootprintScale(mem: number, maxMem: number) {
  const normalizedMax = Math.max(maxMem, 1);
  const logMem = Math.log10(mem + 1);
  const logMax = Math.log10(normalizedMax + 1);
  const ratio = logMax > 0 ? logMem / logMax : 0;
  return 0.38 + ratio * 0.6;
}

function getCenterOutSlotOrder(cols: number, rows: number) {
  const centerX = (cols - 1) / 2;
  const centerY = (rows - 1) / 2;
  return Array.from({ length: cols * rows }, (_, slot) => {
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    return { slot, col, row };
  })
    .sort((a, b) => {
      const distA = Math.hypot(a.col - centerX, a.row - centerY);
      const distB = Math.hypot(b.col - centerX, b.row - centerY);
      return distA - distB || a.row - b.row || a.col - b.col;
    })
    .map((entry) => entry.slot);
}

export function ProcessCity({
  processes,
  geniePids,
  layoutMode,
  neighborhoodMode,
  onNeighborhoodModeChange,
  visibleProcessIds,
  filterActive,
  onProcessContextMenu,
  contextTargetPid = null,
  explodingPid = null,
  explosionStartedAt = null,
  showLegend = true,
}: ProcessCityProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragOrigin = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const userOrder = useRef<Map<string, number>>(new Map());
  const neighborhoodFootprints = useRef<Map<string, { cols: number; rows: number }>>(
    new Map(),
  );
  const pidSquareAssignments = useRef<Map<string, Map<number, number>>>(new Map());
  const landmarkSquareAssignments = useRef<Map<string, Map<number, number>>>(new Map());
  const landmarkChampions = useRef<Map<string, number>>(new Map());
  const [renderProcesses, setRenderProcesses] = useState(processes);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredPid, setHoveredPid] = useState<number | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [flatMemoryMode, setFlatMemoryMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 960, h: 620 });
  const [explosionProgress, setExplosionProgress] = useState(0);
  const animatedHeights = useRef(new Map<number, number>());
  const heightAnimRef = useRef<number | null>(null);
  const heightTickRef = useRef(0);
  const isPointerOverCity = useRef(false);
  const focusTransitionResetTimeout = useRef<number | null>(null);
  const isFocusAnimating = useRef(false);
  const pendingProcesses = useRef<ProcessInfo[] | null>(null);
  const [cameraTransition, setCameraTransition] = useState(DEFAULT_CAMERA_TRANSITION);

  const cityMounted = renderProcesses.length > 0;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setContainerSize({ w: rect.width, h: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [cityMounted]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const eventTargetsCity = (event: Event) => {
      const target = event.target;
      return (
        isPointerOverCity.current ||
        (target instanceof Node && element.contains(target))
      );
    };
    const preventGesture = (event: Event) => {
      if (!eventTargetsCity(event)) return;
      event.preventDefault();
    };
    const preventPinchTouch = (event: TouchEvent) => {
      if (!eventTargetsCity(event)) return;
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };
    const handleNativeWheel = (event: WheelEvent) => {
      const targetsCity = eventTargetsCity(event);
      if (event.ctrlKey) {
        if (targetsCity) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (!targetsCity) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const factor = direction > 0 ? 1.1 : 0.9;
      setZoom((current) => clampZoom(current * factor));
    };

    document.addEventListener("gesturestart", preventGesture, { passive: false, capture: true });
    document.addEventListener("gesturechange", preventGesture, { passive: false, capture: true });
    document.addEventListener("gestureend", preventGesture, { passive: false, capture: true });
    document.addEventListener("touchmove", preventPinchTouch, { passive: false, capture: true });
    element.addEventListener("wheel", handleNativeWheel, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventGesture, true);
      document.removeEventListener("gesturechange", preventGesture, true);
      document.removeEventListener("gestureend", preventGesture, true);
      document.removeEventListener("touchmove", preventPinchTouch, true);
      element.removeEventListener("wheel", handleNativeWheel);
    };
    // Re-run when cityMounted changes so the listener is set up after the
    // container div appears (it's absent during the empty-state early return).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityMounted]);

  useEffect(() => {
    if (hoveredPid !== null) return;
    if (isFocusAnimating.current) {
      pendingProcesses.current = processes;
      return;
    }
    pendingProcesses.current = null;
    setRenderProcesses(processes);
  }, [hoveredPid, processes]);

  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (explodingPid === null || explosionStartedAt === null) {
      setExplosionProgress(0);
      return;
    }

    let frameId = 0;
    const tick = () => {
      const nextProgress = Math.min(1, (Date.now() - explosionStartedAt) / EXPLOSION_ANIMATION_MS);
      setExplosionProgress(nextProgress);
      if (nextProgress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [explodingPid, explosionStartedAt]);

  useEffect(() => {
    return () => {
      if (focusTransitionResetTimeout.current !== null) {
        window.clearTimeout(focusTransitionResetTimeout.current);
      }
      isFocusAnimating.current = false;
      pendingProcesses.current = null;
    };
  }, []);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      setIsDragging(true);
      dragOrigin.current = {
        x: event.clientX,
        y: event.clientY,
        ox: dragOffset.x,
        oy: dragOffset.y,
      };
    },
    [dragOffset],
  );

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (event: MouseEvent) => {
      setDragOffset({
        x: dragOrigin.current.ox + (event.clientX - dragOrigin.current.x),
        y: dragOrigin.current.oy + (event.clientY - dragOrigin.current.y),
      });
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const handleResetCamera = useCallback(() => {
    if (focusTransitionResetTimeout.current !== null) {
      window.clearTimeout(focusTransitionResetTimeout.current);
      focusTransitionResetTimeout.current = null;
    }
    isFocusAnimating.current = false;
    if (hoveredPid === null && pendingProcesses.current !== null) {
      setRenderProcesses(pendingProcesses.current);
      pendingProcesses.current = null;
    }
    setCameraTransition(DEFAULT_CAMERA_TRANSITION);
    setDragOffset({ x: 0, y: 0 });
    setZoom(1);
  }, [hoveredPid]);
  const nudgeCamera = useCallback((dx: number, dy: number) => {
    setDragOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
  }, []);
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;

      switch (event.key) {
        case "ArrowUp":
        case "w":
        case "W":
          event.preventDefault();
          nudgeCamera(0, PAN_STEP);
          return;
        case "ArrowDown":
        case "s":
        case "S":
          event.preventDefault();
          nudgeCamera(0, -PAN_STEP);
          return;
        case "ArrowLeft":
        case "a":
        case "A":
          event.preventDefault();
          nudgeCamera(PAN_STEP, 0);
          return;
        case "ArrowRight":
        case "d":
        case "D":
          event.preventDefault();
          nudgeCamera(-PAN_STEP, 0);
          return;
        default:
          return;
      }
    },
    [nudgeCamera],
  );

  const handleNeighborhoodSelect = useCallback(
    (user: string) => {
      if (selectedPid !== null) return;
      setSelectedUser((current) => (current === user ? null : user));
    },
    [selectedPid],
  );
  const handleProcessSelect = useCallback((pid: number) => {
    setSelectedPid((current) => (current === pid ? null : pid));
  }, []);
  const clearSelections = useCallback(() => {
    setSelectedPid(null);
    setSelectedUser(null);
  }, []);

  const {
    buildings,
    emptyLots,
    neighborhoods,
    maxMem,
    totalMem,
    maxCpu,
    totalPorts,
    totalGenie,
  } = useMemo(() => {
    const procByPid = new Map<number, ProcessInfo>();
    for (const process of renderProcesses) {
      procByPid.set(process.pid, process);
    }

    const groups = new Map<
      string,
      {
        key: string;
        title: string;
        subtitle: string;
        processes: ProcessInfo[];
      }
    >();
    let highestMem = 0;
    let highestCpu = 0;
    let portCount = 0;
    let genieCount = 0;

    for (const process of renderProcesses) {
      highestMem = Math.max(highestMem, process.mem);
      highestCpu = Math.max(highestCpu, process.cpu);
      if (process.port) portCount += 1;
      if (geniePids.has(process.pid)) genieCount += 1;
    }

    if (neighborhoodMode === "process-tree") {
      const neighborsByPid = new Map<number, number[]>();
      const soloProcesses: ProcessInfo[] = [];
      for (const process of renderProcesses) {
        if (process.pid === 1) continue;
        neighborsByPid.set(process.pid, []);
      }
      for (const process of renderProcesses) {
        if (process.pid === 1 || !process.ppid || process.ppid === 1) continue;
        const parent = procByPid.get(process.ppid);
        if (!parent || parent.pid === 1) continue;
        neighborsByPid.get(process.pid)?.push(parent.pid);
        neighborsByPid.get(parent.pid)?.push(process.pid);
      }

      const visited = new Set<number>();
      for (const process of renderProcesses) {
        if (process.pid === 1) continue;
        if (visited.has(process.pid)) continue;

        const component: ProcessInfo[] = [];
        const queue = [process.pid];
        while (queue.length > 0) {
          const pid = queue.shift();
          if (pid === undefined || visited.has(pid)) continue;
          visited.add(pid);
          const current = procByPid.get(pid);
          if (!current) continue;
          component.push(current);
          for (const neighborPid of neighborsByPid.get(pid) ?? []) {
            if (!visited.has(neighborPid)) queue.push(neighborPid);
          }
        }

        const componentPids = new Set(component.map((entry) => entry.pid));
        const rootCandidates = component.filter(
          (entry) => !entry.ppid || entry.ppid === 1 || !componentPids.has(entry.ppid),
        );
        const root = [...(rootCandidates.length > 0 ? rootCandidates : component)].sort(
          (a, b) => b.mem - a.mem || b.cpu - a.cpu || a.pid - b.pid,
        )[0];
        if (!root) continue;
        if (component.length === 1) {
          soloProcesses.push(component[0]!);
          continue;
        }

        const key = `tree:${root.pid}`;
        groups.set(key, {
          key,
          title: buildProcessTreeTitle(root, component.length),
          subtitle: buildProcessTreeSubtitle(root, component.length, root.cpu),
          processes: component,
        });
      }

      if (soloProcesses.length > 0) {
        groups.set("tree:solo", {
          key: "tree:solo",
          title: buildSoloProcessTitle(soloProcesses.length),
          subtitle: buildSoloProcessSubtitle(soloProcesses.length),
          processes: soloProcesses,
        });
      }
    } else {
      for (const process of renderProcesses) {
        const key = process.user || "system";
        const group = groups.get(key);
        if (group) {
          group.processes.push(process);
        } else {
          groups.set(key, {
            key,
            title: key,
            subtitle: buildDistrictSubtitle(key, 1, process.cpu),
            processes: [process],
          });
        }
      }
    }

    const districts: Neighborhood[] = [];
    const towers: BuildingData[] = [];
    const vacantLots: EmptyLotData[] = [];
    const ordered = [...groups.values()]
      .map((group) => {
        if (!userOrder.current.has(group.key)) {
          userOrder.current.set(group.key, userOrder.current.size);
        }
        const totalCpuForUser = group.processes.reduce((sum, proc) => sum + proc.cpu, 0);
        const totalMemForUser = group.processes.reduce((sum, proc) => sum + proc.mem, 0);
        const isSoloProcessGroup = group.key === "tree:solo";
        const rootProcess =
          neighborhoodMode === "process-tree" && !isSoloProcessGroup && group.processes.length > 0
            ? [...group.processes].sort((a, b) => b.mem - a.mem || b.cpu - a.cpu || a.pid - b.pid)[0]
            : null;
        return {
          user: group.key,
          title:
            neighborhoodMode === "process-tree" && isSoloProcessGroup
              ? buildSoloProcessTitle(group.processes.length)
              : group.title,
          subtitle:
            neighborhoodMode === "process-tree" && isSoloProcessGroup
              ? buildSoloProcessSubtitle(group.processes.length)
              : neighborhoodMode === "process-tree" && rootProcess
              ? buildProcessTreeSubtitle(rootProcess, group.processes.length, totalCpuForUser)
              : buildDistrictSubtitle(group.title, group.processes.length, totalCpuForUser),
          processes: group.processes,
          totalCpu: totalCpuForUser,
          totalMem: totalMemForUser,
          stableOrder: userOrder.current.get(group.key) ?? 0,
        };
      })
      .sort((a, b) => a.stableOrder - b.stableOrder);

    let blockX = 0;
    let blockY = 0;
    let rowDepth = 0;
    const districtsPerRow = Math.max(2, Math.ceil(Math.sqrt(Math.max(ordered.length, 1))));

    ordered.forEach((district, index) => {
      const towersInDistrict = [...district.processes].sort((a, b) => a.pid - b.pid);
      let landmarkPid: number | null = null;
      if (layoutMode === "landmark") {
        const activePids = new Set(district.processes.map((proc) => proc.pid));
        const existingChampion = landmarkChampions.current.get(district.user);
        if (existingChampion !== undefined && activePids.has(existingChampion)) {
          landmarkPid = existingChampion;
        } else {
          landmarkPid =
            [...district.processes].sort(
              (a, b) => b.mem - a.mem || b.cpu - a.cpu || a.pid - b.pid,
            )[0]?.pid ?? null;
          if (landmarkPid !== null) {
            landmarkChampions.current.set(district.user, landmarkPid);
          } else {
            landmarkChampions.current.delete(district.user);
          }
        }
      }
      const desiredCols = Math.max(
        2,
        Math.ceil(Math.sqrt(Math.max(towersInDistrict.length, 1))),
      );
      const assignmentStore =
        layoutMode === "landmark"
          ? landmarkSquareAssignments.current
          : pidSquareAssignments.current;
      const slotAssignments =
        assignmentStore.get(district.user) ?? new Map<number, number>();
      assignmentStore.set(district.user, slotAssignments);

      const activePidSet = new Set(towersInDistrict.map((proc) => proc.pid));
      for (const pid of [...slotAssignments.keys()]) {
        if (!activePidSet.has(pid)) {
          slotAssignments.delete(pid);
        }
      }

      const previousFootprint = neighborhoodFootprints.current.get(district.user);
      const cols = previousFootprint?.cols ?? desiredCols;

      let neededCells = towersInDistrict.length;
      let desiredRows = Math.max(1, Math.ceil(neededCells / cols));
      let rows = previousFootprint?.rows ?? desiredRows;
      if (neededCells > cols * rows) {
        rows = Math.max(rows, desiredRows, Math.ceil(neededCells / cols));
      }

      neighborhoodFootprints.current.set(district.user, { cols, rows });
      const palette = PALETTES[index % PALETTES.length];
      const orderedSlots =
        layoutMode === "landmark" ? getCenterOutSlotOrder(cols, rows) : [];
      const centerSlot = layoutMode === "landmark" ? orderedSlots[0] ?? 0 : null;

      if (layoutMode === "landmark" && centerSlot !== null) {
        if (landmarkPid !== null) slotAssignments.delete(landmarkPid);
        for (const [pid, slot] of [...slotAssignments.entries()]) {
          if (slot === centerSlot && pid !== landmarkPid) {
            slotAssignments.delete(pid);
          }
        }
      }

      const usedSlots = new Set<number>();
      for (const [pid, slot] of slotAssignments.entries()) {
        if (layoutMode === "landmark" && centerSlot !== null && slot === centerSlot) {
          slotAssignments.delete(pid);
          continue;
        }
        usedSlots.add(slot);
      }

      const fillOrder =
        layoutMode === "landmark" ? orderedSlots.filter((slot) => slot !== centerSlot) : null;
      let fillCursor = 0;
      for (const proc of towersInDistrict) {
        if (layoutMode === "landmark" && proc.pid === landmarkPid) continue;
        if (slotAssignments.has(proc.pid)) continue;
        let slot = 0;
        if (fillOrder) {
          while (fillCursor < fillOrder.length && usedSlots.has(fillOrder[fillCursor])) {
            fillCursor += 1;
          }
          slot = fillOrder[fillCursor] ?? 0;
          fillCursor += 1;
        } else {
          while (usedSlots.has(slot)) slot += 1;
        }
        slotAssignments.set(proc.pid, slot);
        usedSlots.add(slot);
      }

      const neighborhood: Neighborhood = {
        user: district.user,
        title: district.title,
        subtitle: district.subtitle,
        processes: district.processes,
        totalCpu: district.totalCpu,
        totalMem: district.totalMem,
        gx: blockX,
        gy: blockY,
        cols,
        rows,
        palette,
        sortKey: blockX + blockY,
      };
      districts.push(neighborhood);

      towersInDistrict.forEach((proc, towerIndex) => {
        const slot =
          layoutMode === "landmark" && landmarkPid !== null && proc.pid === landmarkPid
            ? centerSlot ?? 0
            : slotAssignments.get(proc.pid) ?? towerIndex;
        const col = slot % cols;
        const row = Math.floor(slot / cols);
        const gx = blockX + col;
        const gy = blockY + row;
        const towerHeight = 18 + (proc.mem / Math.max(highestMem, 1)) * 132;

        towers.push({
          proc,
          district: neighborhood,
          gx,
          gy,
          h: towerHeight,
          footprint: getFootprintScale(proc.mem, highestMem),
          palette,
          isGenie: geniePids.has(proc.pid),
          isInit: proc.pid === 1,
          hasPort: Boolean(proc.port),
          sortKey: gx + gy,
        });
      });

      for (let lotIndex = towersInDistrict.length; lotIndex < cols * rows; lotIndex += 1) {
        const col = lotIndex % cols;
        const row = Math.floor(lotIndex / cols);
        vacantLots.push({
          district: neighborhood,
          gx: blockX + col,
          gy: blockY + row,
          sortKey: blockX + col + blockY + row,
        });
      }

      rowDepth = Math.max(rowDepth, rows);
      if ((index + 1) % districtsPerRow === 0) {
        blockX = 0;
        blockY += rowDepth + STREET_GAP;
        rowDepth = 0;
      } else {
        blockX += cols + STREET_GAP;
      }
    });

    towers.sort((a, b) => a.sortKey - b.sortKey || a.gy - b.gy || a.gx - b.gx);
    vacantLots.sort((a, b) => a.sortKey - b.sortKey || a.gy - b.gy || a.gx - b.gx);
    districts.sort((a, b) => a.sortKey - b.sortKey);

    return {
      buildings: towers,
      emptyLots: vacantLots,
      neighborhoods: districts,
      maxMem: highestMem,
      totalMem: renderProcesses.reduce((sum, proc) => sum + proc.mem, 0),
      maxCpu: highestCpu,
      totalPorts: portCount,
      totalGenie: genieCount,
    };
  }, [geniePids, layoutMode, neighborhoodMode, renderProcesses]);

  const selectedProcessTree = useMemo(() => {
    if (selectedPid === null) return new Set<number>();

    const childrenByParent = new Map<number, number[]>();
    const parentByPid = new Map<number, number>();
    for (const building of buildings) {
      const siblings = childrenByParent.get(building.proc.ppid);
      if (siblings) siblings.push(building.proc.pid);
      else childrenByParent.set(building.proc.ppid, [building.proc.pid]);
      parentByPid.set(building.proc.pid, building.proc.ppid);
    }

    const focused = new Set<number>();
    const queue = [selectedPid];
    while (queue.length > 0) {
      const pid = queue.shift();
      if (pid === undefined || focused.has(pid)) continue;
      focused.add(pid);
      const children = childrenByParent.get(pid) ?? [];
      for (const childPid of children) {
        if (!focused.has(childPid)) queue.push(childPid);
      }
    }

    let currentParent = parentByPid.get(selectedPid) ?? 0;
    while (currentParent && !focused.has(currentParent)) {
      focused.add(currentParent);
      currentParent = parentByPid.get(currentParent) ?? 0;
    }

    return focused;
  }, [buildings, selectedPid]);

  // --- Animated building heights (direct DOM updates, no React re-renders) ---
  useEffect(() => {
    const anim = animatedHeights.current;
    const activePids = new Set<number>();
    for (const building of buildings) {
      const target = getRenderedBuildingHeight(building, flatMemoryMode, selectedPid, selectedProcessTree);
      activePids.add(building.proc.pid);
      if (!anim.has(building.proc.pid)) {
        anim.set(building.proc.pid, target);
      }
    }
    for (const pid of anim.keys()) {
      if (!activePids.has(pid)) anim.delete(pid);
    }

    const svg = svgRef.current;
    let running = true;
    function tick() {
      if (!running) return;
      let anyMoving = false;
      for (const building of buildings) {
        const target = getRenderedBuildingHeight(building, flatMemoryMode, selectedPid, selectedProcessTree);
        const current = anim.get(building.proc.pid) ?? target;
        if (Math.abs(current - target) > 0.3) {
          anim.set(building.proc.pid, current + (target - current) * 0.18);
          anyMoving = true;
        } else if (current !== target) {
          anim.set(building.proc.pid, target);
        }
      }
      if (anyMoving && svg) {
        // Direct DOM update: re-compute polygon points for each animating building
        for (const building of buildings) {
          const h = anim.get(building.proc.pid);
          if (h === undefined) continue;
          const group = svg.querySelector(`[data-building-pid="${building.proc.pid}"]`);
          if (!group) continue;
          const pts = cubePoints(building.gx, building.gy, h, building.footprint);
          const top = group.querySelector("[data-face=top]") as SVGPolygonElement | null;
          const left = group.querySelector("[data-face=left]") as SVGPolygonElement | null;
          const right = group.querySelector("[data-face=right]") as SVGPolygonElement | null;
          if (top) top.setAttribute("points", pts.top);
          if (left) left.setAttribute("points", pts.left);
          if (right) right.setAttribute("points", pts.right);
        }
        heightTickRef.current += 1;
        heightAnimRef.current = requestAnimationFrame(tick);
      } else {
        heightAnimRef.current = null;
      }
    }
    if (heightAnimRef.current !== null) cancelAnimationFrame(heightAnimRef.current);
    heightAnimRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (heightAnimRef.current !== null) {
        cancelAnimationFrame(heightAnimRef.current);
        heightAnimRef.current = null;
      }
    };
  }, [buildings, flatMemoryMode, selectedPid, selectedProcessTree]);

  const viewBox = useMemo(() => {
    if (buildings.length === 0) return "-460 -260 920 720";

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const district of neighborhoods) {
      const roadTopLeft = toIso(district.gx - 0.7, district.gy - 0.7);
      const roadBottomRight = toIso(
        district.gx + district.cols + 0.7,
        district.gy + district.rows + 0.7,
      );
      minX = Math.min(minX, roadTopLeft.x - TILE_WIDTH);
      maxX = Math.max(maxX, roadBottomRight.x + TILE_WIDTH);
      minY = Math.min(minY, roadTopLeft.y - 80);
      maxY = Math.max(maxY, roadBottomRight.y + TILE_HEIGHT * 3);
    }

    for (const building of buildings) {
      const base = toIso(building.gx, building.gy);
      const renderedHeight = getRenderedBuildingHeight(
        building,
        flatMemoryMode,
        selectedPid,
        selectedProcessTree,
      );
      minX = Math.min(minX, base.x - TILE_WIDTH);
      maxX = Math.max(maxX, base.x + TILE_WIDTH);
      minY = Math.min(minY, base.y - renderedHeight - TILE_HEIGHT - 42);
      maxY = Math.max(maxY, base.y + TILE_HEIGHT * 2.5);
    }

    const pad = 90;
    return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  }, [buildings, flatMemoryMode, neighborhoods, selectedPid, selectedProcessTree]);
  const focusNeighborhood = useCallback(
    (district: Neighborhood) => {
      const [minX, minY, width, height] = viewBox.split(" ").map(Number);
      if (
        !Number.isFinite(minX) ||
        !Number.isFinite(minY) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return;
      }

      const center = toIso(
        district.gx + district.cols / 2,
        district.gy + district.rows / 2,
      );
      const roadTopLeft = toIso(district.gx - 0.7, district.gy - 0.7);
      const roadBottomRight = toIso(
        district.gx + district.cols + 0.7,
        district.gy + district.rows + 0.7,
      );
      const districtWidth = Math.max(
        1,
        ((roadBottomRight.x - roadTopLeft.x + TILE_WIDTH * 2) / width) * containerSize.w,
      );
      const districtHeight = Math.max(
        1,
        ((roadBottomRight.y - roadTopLeft.y + TILE_HEIGHT * 6) / height) * containerSize.h,
      );
      const fitZoom = clampZoom(
        Math.min(
          3.2,
          Math.max(
            1.15,
            Math.min(
              (containerSize.w * 0.52) / districtWidth,
              (containerSize.h * 0.46) / districtHeight,
            ),
          ),
        ),
      );
      const baseX = ((center.x - minX) / width) * containerSize.w;
      const baseY = ((center.y - minY) / height) * containerSize.h;
      const viewportCenterX = containerSize.w / 2;
      const viewportCenterY = containerSize.h / 2;

      setCameraTransition(FOCUS_CAMERA_TRANSITION);
      isFocusAnimating.current = true;
      if (focusTransitionResetTimeout.current !== null) {
        window.clearTimeout(focusTransitionResetTimeout.current);
      }
      setZoom(fitZoom);
      setDragOffset({
        x: -(baseX - viewportCenterX) * fitZoom,
        y: -(baseY - viewportCenterY) * fitZoom,
      });
      focusTransitionResetTimeout.current = window.setTimeout(() => {
        isFocusAnimating.current = false;
        setCameraTransition(DEFAULT_CAMERA_TRANSITION);
        if (hoveredPid === null && pendingProcesses.current !== null) {
          setRenderProcesses(pendingProcesses.current);
          pendingProcesses.current = null;
        }
        focusTransitionResetTimeout.current = null;
      }, FOCUS_CAMERA_TRANSITION_MS);
    },
    [containerSize.h, containerSize.w, hoveredPid, viewBox],
  );

  const hoveredBuilding = useMemo(
    () => buildings.find((building) => building.proc.pid === hoveredPid) ?? null,
    [buildings, hoveredPid],
  );
  const hoveredLabelData = useMemo(() => {
    if (!hoveredBuilding) return null;

    const renderedHeight = animatedHeights.current.get(hoveredBuilding.proc.pid) ?? getRenderedBuildingHeight(
      hoveredBuilding,
      flatMemoryMode,
      selectedPid,
      selectedProcessTree,
    );
    const geometryHeight = Math.max(hoveredBuilding.h, 1);
    const points = cubePoints(
      hoveredBuilding.gx,
      hoveredBuilding.gy,
      renderedHeight,
      hoveredBuilding.footprint,
    );
    const labelWidth = zoom >= 2.4 ? 78 : zoom >= 1.6 ? 62 : 52;
    const labelY = points.sy - renderedHeight - (zoom >= 1.6 ? 36 : 33);
    const labelTextY = labelY + 8.5;

    return {
      sx: points.sx,
      connectorStartY: points.sy - renderedHeight - 6,
      labelWidth,
      labelY,
      labelTextY,
      name: formatTowerLabel(hoveredBuilding.proc.name, zoom),
    };
  }, [flatMemoryMode, hoveredBuilding, selectedPid, selectedProcessTree, zoom]);
  const explodingBuilding = useMemo(
    () => buildings.find((building) => building.proc.pid === explodingPid) ?? null,
    [buildings, explodingPid],
  );
  const explodingOverlayData = useMemo(() => {
    if (!explodingBuilding) return null;

    const renderedHeight = animatedHeights.current.get(explodingBuilding.proc.pid) ?? getRenderedBuildingHeight(
      explodingBuilding,
      flatMemoryMode,
      selectedPid,
      selectedProcessTree,
    );
    const points = cubePoints(
      explodingBuilding.gx,
      explodingBuilding.gy,
      renderedHeight,
      explodingBuilding.footprint,
    );

    return {
      sx: points.sx,
      sy: points.sy,
      cy: points.sy - renderedHeight * 0.62,
      renderedHeight,
    };
  }, [explodingBuilding, flatMemoryMode, selectedPid, selectedProcessTree]);
  const selectedBuilding = useMemo(
    () => buildings.find((building) => building.proc.pid === selectedPid) ?? null,
    [buildings, selectedPid],
  );
  const mainProcessPids = useMemo(() => {
    const visiblePids = new Set(buildings.map((building) => building.proc.pid));
    const roots = new Set<number>();
    for (const building of buildings) {
      if (!building.proc.ppid || !visiblePids.has(building.proc.ppid)) {
        roots.add(building.proc.pid);
      }
    }
    return roots;
  }, [buildings]);
  const selectedNeighborhood = useMemo(
    () => neighborhoods.find((district) => district.user === selectedUser) ?? null,
    [neighborhoods, selectedUser],
  );
  const buildingsByPid = useMemo(() => {
    const map = new Map<number, BuildingData>();
    for (const building of buildings) map.set(building.proc.pid, building);
    return map;
  }, [buildings]);
  const selectedParentBuilding = useMemo(() => {
    if (!selectedBuilding?.proc.ppid) return null;
    return buildingsByPid.get(selectedBuilding.proc.ppid) ?? null;
  }, [buildingsByPid, selectedBuilding]);
  const skyBridges = useMemo(() => {
    const byPid = new Map<number, BuildingData>();
    for (const building of buildings) byPid.set(building.proc.pid, building);

    const bridges: SkyBridgeData[] = [];
    for (const child of buildings) {
      if (!child.proc.ppid) continue;
      const parent = byPid.get(child.proc.ppid);
      if (!parent) continue;
      if (parent.proc.pid === child.proc.pid) continue;

      const sameDistrict = parent.district.user === child.district.user;
      const touchesHovered =
        hoveredBuilding !== null &&
        (hoveredBuilding.proc.pid === parent.proc.pid ||
          hoveredBuilding.proc.pid === child.proc.pid);
      const touchesSelectedProcess =
        selectedPid !== null &&
        (selectedProcessTree.has(parent.proc.pid) || selectedProcessTree.has(child.proc.pid));
      const selectedDistrictMatch =
        selectedUser !== null &&
        (parent.district.user === selectedUser || child.district.user === selectedUser);
      const parentTop = toIso(parent.gx, parent.gy);
      const childTop = toIso(child.gx, child.gy);
      const dx = childTop.x - parentTop.x;
      const dy = childTop.y - parentTop.y;
      const bridgeDistance = Math.hypot(dx, dy);

      const allowBridge =
        selectedPid !== null &&
        touchesSelectedProcess &&
        (selectedPid === 1 || parent.proc.pid !== 1) &&
        bridgeDistance >= 26;

      if (!allowBridge) continue;

      bridges.push({
        parent,
        child,
        sortKey: Math.min(parent.sortKey, child.sortKey),
      });
    }

    bridges.sort((a, b) => a.sortKey - b.sortKey);
    return bridges;
  }, [buildings, hoveredBuilding, selectedPid, selectedProcessTree, selectedUser, zoom]);
  const detailLevel = useMemo(() => {
    const cityNodeCount = buildings.length + emptyLots.length;
    const denseCity = cityNodeCount > 220;
    return {
      showDistrictTrees: zoom >= 1.25 && neighborhoods.length <= 6 && !denseCity,
      showEmptyLots:
        emptyLots.length > 0 &&
        (zoom >= 1.05 || selectedPid !== null || selectedUser !== null) &&
        cityNodeCount <= 420,
      showLotGuides:
        zoom >= 1.45 &&
        emptyLots.length <= 180 &&
        !denseCity &&
        (selectedPid !== null || selectedUser !== null || zoom >= 1.8),
      simplifyBuildings: denseCity || zoom <= 1.05,
      showFacadeWindows: zoom >= 1.15 && buildings.length <= 180,
      richFacadeWindows: zoom >= 1.65 && buildings.length <= 110,
      showBaseShadows: zoom >= 1.1 && buildings.length <= 180,
      showPortBeacons: zoom >= 1.15 || selectedPid !== null,
    };
  }, [buildings.length, emptyLots.length, neighborhoods.length, selectedPid, selectedUser, zoom]);

  useEffect(() => {
    if (!selectedUser) return;
    const stillExists = neighborhoods.some((district) => district.user === selectedUser);
    if (!stillExists) setSelectedUser(null);
  }, [neighborhoods, selectedUser]);
  useEffect(() => {
    if (selectedPid === null) return;
    const stillExists = buildings.some((building) => building.proc.pid === selectedPid);
    if (!stillExists) setSelectedPid(null);
  }, [buildings, selectedPid]);

  if (renderProcesses.length === 0) {
    return (
      <div className="flex-1 rounded-xl border border-surface0 bg-mantle grid place-items-center text-center px-6">
        <div>
          <div className="text-lg font-semibold text-text">No skyline yet</div>
          <div className="mt-1 text-md text-subtext0">
            When processes appear, this view will lay them out as user districts and memory towers.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={
        isFullscreen
          ? "fixed inset-0 z-70 overflow-hidden select-none cursor-grab active:cursor-grabbing"
          : "relative flex-1 min-h-0 overflow-hidden rounded-xl border border-surface0 select-none cursor-grab active:cursor-grabbing"
      }
      onPointerEnter={() => {
        isPointerOverCity.current = true;
      }}
      onPointerLeave={() => {
        isPointerOverCity.current = false;
      }}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        if (
          event.target === event.currentTarget ||
          event.target === svgRef.current
        ) {
          clearSelections();
        }
      }}
      style={{
        backgroundColor: "#11111b",
        backgroundImage:
          "radial-gradient(circle at top, rgba(88,91,167,0.35) 0%, rgba(30,30,46,0.65) 32%, rgba(17,17,27,1) 100%)",
        touchAction: "pan-x pan-y",
        borderRadius: isFullscreen ? "0" : undefined,
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-36 bg-linear-to-b from-base/30 to-transparent" />

      <div
        className="absolute right-3 top-3 z-20 flex items-center gap-2"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <Button
          size="sm"
          variant={flatMemoryMode ? "active" : "default"}
          className="gap-1.5"
          onClick={() => setFlatMemoryMode((current) => !current)}
        >
          {flatMemoryMode ? "Height View" : "Flat Memory"}
        </Button>
        {onNeighborhoodModeChange && (
          <label className="inline-flex items-center gap-1.5 text-md text-text cursor-pointer select-none">
            By User
            <Switch
              checked={neighborhoodMode === "process-tree"}
              onCheckedChange={(checked) =>
                onNeighborhoodModeChange(checked ? "process-tree" : "user")
              }
            />
            Process Trees
          </label>
        )}
        <Button
          size="sm"
          variant={isFullscreen ? "active" : "default"}
          onClick={() => setIsFullscreen((current) => !current)}
          title={isFullscreen ? "Exit Full View" : "Full View"}
        >
          {isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={handleResetCamera}
          title="Reset View"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <svg
        ref={svgRef}
        width={containerSize.w}
        height={containerSize.h}
        viewBox={viewBox}
        className="absolute inset-0"
        style={{
          transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) scale(${zoom})`,
          transformOrigin: "center center",
          transition: isDragging ? undefined : cameraTransition,
        }}
      >
        <defs>
          <pattern
            id="city-grid"
            width={TILE_WIDTH}
            height={TILE_HEIGHT}
            patternUnits="userSpaceOnUse"
          >
            <line
              x1="0"
              y1={TILE_HEIGHT}
              x2={TILE_WIDTH / 2}
              y2={TILE_HEIGHT / 2}
              stroke="rgba(186,194,222,0.08)"
              strokeWidth="0.8"
            />
            <line
              x1={TILE_WIDTH}
              y1={TILE_HEIGHT}
              x2={TILE_WIDTH / 2}
              y2={TILE_HEIGHT / 2}
              stroke="rgba(186,194,222,0.08)"
              strokeWidth="0.8"
            />
          </pattern>
          <filter id="city-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker
            id="bridge-arrow-default"
            markerWidth="8"
            markerHeight="8"
            refX="6.2"
            refY="4"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#89dceb" opacity="0.9" />
          </marker>
          <marker
            id="bridge-arrow-active"
            markerWidth="8"
            markerHeight="8"
            refX="6.2"
            refY="4"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#f9e2af" opacity="0.96" />
          </marker>
        </defs>

        {neighborhoods.map((district) => {
          const isSelected = selectedUser === district.user;
          const hasVisibleProcess = district.processes.some((process) =>
            visibleProcessIds.has(process.pid),
          );
          const isDimmed =
            selectedPid !== null
              ? !district.processes.some((process) => selectedProcessTree.has(process.pid))
              : filterActive && !hasVisibleProcess
                ? true
              : selectedUser !== null && !isSelected;
          const road = quadPoints(
            district.gx - 0.55,
            district.gy - 0.55,
            district.cols + 1.1,
            district.rows + 1.1,
          );
          const block = quadPoints(district.gx, district.gy, district.cols, district.rows, 2);
          const plaza = quadPoints(
            district.gx + 0.25,
            district.gy + district.rows - 0.65,
            Math.min(district.cols - 0.5, 1.6),
            0.4,
            3,
          );
          const labelPos = toIso(
            district.gx + district.cols / 2,
            district.gy + district.rows + 1.2,
          );

          return (
            <g
              key={district.user}
              style={{ cursor: "pointer", opacity: isDimmed ? 0.26 : 1 }}
              onClick={(event) => {
                event.stopPropagation();
                handleNeighborhoodSelect(district.user);
                focusNeighborhood(district);
              }}
            >
              <polygon
                points={road}
                fill={district.palette.road}
                opacity={isSelected ? 1 : 0.92}
                stroke={isSelected ? district.palette.accent : "rgba(255,255,255,0.05)"}
                strokeWidth={isSelected ? 1.2 : 0.8}
              />
              <polygon
                points={block}
                fill={district.palette.top}
                opacity={isSelected ? 0.28 : 0.14}
                stroke={district.palette.accent}
                strokeWidth={isSelected ? 1.5 : 0.9}
              />
              <polygon
                points={block}
                fill="url(#city-grid)"
                opacity={isSelected ? 0.8 : 0.55}
              />
              <polygon
                points={plaza}
                fill={district.palette.plaza}
                opacity={isSelected ? 0.9 : 0.65}
              />

              {detailLevel.showDistrictTrees
                ? Array.from({ length: Math.min(district.cols, 4) }).map((_, index) => {
                    const tree = toIso(
                      district.gx + index + 0.35,
                      district.gy + district.rows + 0.25,
                    );
                    return (
                      <g key={`${district.user}-tree-${index}`}>
                        <line
                          x1={tree.x}
                          y1={tree.y - 4}
                          x2={tree.x}
                          y2={tree.y + 2}
                          stroke="#6f8f54"
                          strokeWidth="1.2"
                        />
                        <circle
                          cx={tree.x}
                          cy={tree.y - 6}
                          r="2.6"
                          fill={district.palette.plaza}
                        />
                      </g>
                    );
                  })
                : null}

              <g
                transform={`translate(${labelPos.x} ${labelPos.y}) rotate(26.565) scale(1 0.82)`}
                style={{ pointerEvents: "none" }}
              >
              <text
                  x="0"
                  y="0"
                textAnchor="middle"
                  fill={district.palette.accent}
                  fontSize="9"
                  fontWeight="700"
                  fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
                  letterSpacing="0.08em"
                  stroke="rgba(17,17,27,0.45)"
                  strokeWidth="1.1"
                  paintOrder="stroke"
                >
                  {district.title}
              </text>
              <text
                  x="0"
                  y="11"
                textAnchor="middle"
                  fill="#bac2de"
                  fontSize="6.2"
                  fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
                  opacity="0.92"
                >
                  {district.subtitle} · {formatMem(district.totalMem)}
              </text>
              </g>
            </g>
          );
        })}

        {detailLevel.showEmptyLots
          ? emptyLots.map((lot) => {
          const hasVisibleProcess = lot.district.processes.some((process) =>
            visibleProcessIds.has(process.pid),
          );
          const isSelectedDistrict =
            selectedPid !== null
              ? lot.district.processes.some((process) => selectedProcessTree.has(process.pid))
              : selectedUser === lot.district.user;
          const isDimmed =
            selectedPid !== null
              ? !isSelectedDistrict
              : filterActive && !hasVisibleProcess
                ? true
              : selectedUser !== null && !isSelectedDistrict;
          const tile = quadPoints(lot.gx + 0.08, lot.gy + 0.08, 0.84, 0.84, 1.2);
          const topLeft = toIso(lot.gx + 0.18, lot.gy + 0.18);
          const bottomRight = toIso(lot.gx + 0.82, lot.gy + 0.82);
          const topRight = toIso(lot.gx + 0.82, lot.gy + 0.18);
          const bottomLeft = toIso(lot.gx + 0.18, lot.gy + 0.82);

          return (
            <g
              key={`lot-${lot.district.user}-${lot.gx}-${lot.gy}`}
              style={{
                opacity: isDimmed ? 0.18 : isSelectedDistrict ? 0.9 : 0.58,
              }}
            >
              <polygon
                points={tile}
                fill={`${lot.district.palette.plaza}22`}
                stroke={lot.district.palette.accent}
                strokeDasharray="3 3"
                strokeWidth="0.8"
              />
              {detailLevel.showLotGuides ? (
                <path
                  d={[
                    `M ${topLeft.x} ${topLeft.y - 1} L ${bottomRight.x} ${bottomRight.y - 1}`,
                    `M ${topRight.x} ${topRight.y - 1} L ${bottomLeft.x} ${bottomLeft.y - 1}`,
                  ].join(" ")}
                  stroke={lot.district.palette.accent}
                  strokeOpacity="0.55"
                  strokeWidth="0.8"
                  fill="none"
                />
              ) : null}
            </g>
          );
        })
          : null}

        {buildings.map((building) => {
          const targetHeight = getRenderedBuildingHeight(
            building,
            flatMemoryMode,
            selectedPid,
            selectedProcessTree,
          );
          const renderedHeight = animatedHeights.current.get(building.proc.pid) ?? targetHeight;
          const geometryHeight = Math.max(building.h, 1);
          const points = cubePoints(
            building.gx,
            building.gy,
            renderedHeight,
            building.footprint,
          );
          const baseDiamond = footprintDiamond(
            building.gx,
            building.gy,
            building.footprint,
            0.6,
          );
          const baseShadow = footprintDiamond(
            building.gx + 0.04,
            building.gy + 0.1,
            building.footprint * 0.96,
            -2.2,
          );
          const isHovered = building.proc.pid === hoveredPid;
          const isContextTarget = building.proc.pid === contextTargetPid;
          const isExploding = building.proc.pid === explodingPid;
          const isSelectedProcess = building.proc.pid === selectedPid;
          const isInSelectedTree =
            selectedPid !== null && selectedProcessTree.has(building.proc.pid);
          const isSelectedDistrict =
            selectedPid !== null ? isInSelectedTree : selectedUser === building.district.user;
          const isDimmed =
            selectedPid !== null
              ? !isInSelectedTree
              : filterActive && !visibleProcessIds.has(building.proc.pid)
                ? true
              : selectedUser !== null && !isSelectedDistrict;
          const isVisibleProcess = visibleProcessIds.has(building.proc.pid);
          const isMainProcess =
            mainProcessPids.has(building.proc.pid) &&
            !building.isInit &&
            building.district.user !== "tree:solo";
          const isFlatCollapsed = renderedHeight === FLAT_BUILDING_HEIGHT && flatMemoryMode;
          const memoryRatio = getMemoryRatio(building.proc.mem, maxMem);
          const topFill = isFlatCollapsed
            ? mixHexColors(
                "#273044",
                building.isInit ? "#f38ba8" : isMainProcess ? "#f9e2af" : building.palette.top,
                0.18 + memoryRatio * 0.82,
              )
            : building.isInit
              ? "#f38ba8"
              : isMainProcess
                ? "#f9e2af"
                : building.palette.top;
          const leftFill = isFlatCollapsed
            ? mixHexColors(
                "#1c2333",
                building.isInit ? "#c55d74" : building.palette.left,
                0.12 + memoryRatio * 0.72,
              )
            : building.isInit
              ? "#c55d74"
              : building.palette.left;
          const rightFill = isFlatCollapsed
            ? mixHexColors(
                "#182031",
                building.isInit ? "#ac465c" : building.palette.right,
                0.12 + memoryRatio * 0.72,
              )
            : building.isInit
              ? "#ac465c"
              : building.palette.right;
          const highlightStroke =
            building.isInit
              ? "#f9e2af"
              : isMainProcess
                ? "#f2cd65"
              : isSelectedProcess || isHovered || isContextTarget
                ? "#f9e2af"
                : "rgba(255,255,255,0.08)";
          const beaconY = points.sy - renderedHeight - 12;
          const cpuGlow = 0.72 + (building.proc.cpu / Math.max(maxCpu, 1)) * 0.28;
          const roofFill = mixHexColors(topFill, "#ffffff", (cpuGlow - 0.72) / 0.28 * 0.16);
          const windowCount = detailLevel.richFacadeWindows
            ? Math.max(1, Math.min(4, Math.floor(geometryHeight / 18)))
            : Math.max(1, Math.min(2, Math.floor(geometryHeight / 26)));
          const windowPath = detailLevel.showFacadeWindows && !isFlatCollapsed
            ? buildWindowPath(points.sx, points.sy, renderedHeight, building.footprint, windowCount)
            : "";
          const showFacadeWindows =
            !isFlatCollapsed &&
            detailLevel.showFacadeWindows &&
            windowPath.length > 0 &&
            (
              isHovered ||
              isContextTarget ||
              isSelectedProcess ||
              isMainProcess ||
              !detailLevel.simplifyBuildings
            );
          const showBaseShadow =
            detailLevel.showBaseShadows &&
            (
              isHovered ||
              isContextTarget ||
              isSelectedProcess ||
              isMainProcess ||
              !detailLevel.simplifyBuildings
            );

          return (
            <g
              key={building.proc.pid}
              data-building-pid={building.proc.pid}
              style={{
                cursor: "pointer",
                opacity: isVisibleProcess
                  ? isExploding
                    ? 0.22
                    : isDimmed
                      ? 0.1
                      : isSelectedProcess
                        ? 1
                        : isSelectedDistrict
                          ? 1
                          : 0.96
                  : 0,
                pointerEvents: isVisibleProcess && !isExploding ? "auto" : "none",
                transform: `translateY(${isVisibleProcess ? 0 : 12}px) scaleY(${isVisibleProcess ? 1 : 0.001})${isExploding ? " scale(1.18)" : ""}`,
                transformOrigin: `${points.sx}px ${points.sy}px`,
                transition:
                  "transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out",
              }}
              onClick={(event) => {
                event.stopPropagation();
                handleProcessSelect(building.proc.pid);
              }}
              onContextMenu={(event) => {
                if (!onProcessContextMenu) return;
                event.stopPropagation();
                onProcessContextMenu(event, building.proc.pid);
              }}
              onMouseEnter={() => setHoveredPid(building.proc.pid)}
              onMouseLeave={() => setHoveredPid(null)}
            >
              {showBaseShadow && !isExploding ? (
              <polygon
                  points={baseShadow}
                  fill="rgba(0,0,0,0.18)"
                />
              ) : null}
              {!isExploding ? (
              <polygon
                  points={baseDiamond}
                  fill="rgba(17,17,27,0.42)"
                  stroke={
                    building.isInit
                      ? "#f9e2af55"
                      : isMainProcess
                        ? "#f2cd6560"
                        : `${building.palette.accent}44`
                  }
                  strokeWidth="0.65"
                />
              ) : null}
              {showBaseShadow && !isExploding ? (
                <ellipse
                  cx={points.sx}
                  cy={points.sy + TILE_HEIGHT * 0.36 * building.footprint + 1.5}
                  rx={TILE_WIDTH * 0.36 * building.footprint}
                  ry={TILE_HEIGHT * 0.34 * building.footprint}
                  fill="rgba(0,0,0,0.14)"
                />
              ) : null}
              {!isExploding ? (
                <>
                <polygon
                    data-face="left"
                    points={points.left}
                    fill={leftFill}
                    opacity={1}
                    stroke={highlightStroke}
                    strokeWidth={isSelectedProcess ? 1.4 : isHovered ? 1.1 : 0.55}
                  />
                  <polygon
                    data-face="right"
                    points={points.right}
                    fill={rightFill}
                    opacity={1}
                    stroke={highlightStroke}
                    strokeWidth={isSelectedProcess ? 1.4 : isHovered ? 1.1 : 0.55}
                  />
                  <polygon
                    data-face="top"
                    points={points.top}
                    fill={roofFill}
                    opacity={1}
                    stroke={
                      building.isInit || isSelectedProcess || isHovered || isContextTarget
                        ? "#f9e2af"
                        : building.palette.accent
                    }
                    strokeWidth={
                      isSelectedProcess ? 1.6 : isHovered || isContextTarget ? 1.2 : 0.75
                    }
                  />
                </>
              ) : null}

              {showFacadeWindows && !isExploding ? (
                <path
                  d={windowPath}
                  stroke={building.palette.window}
                  strokeOpacity={0.35}
                  strokeWidth="1.05"
                  fill="none"
                />
              ) : null}

              {isExploding ? (
                <g pointerEvents="none" filter="url(#city-glow)">
                  <ellipse
                    cx={points.sx}
                    cy={points.sy + TILE_HEIGHT * 0.18}
                    rx="8"
                    ry="3"
                    fill="none"
                    stroke="#f9e2af"
                    strokeWidth="1.4"
                  >
                    <animate
                      attributeName="rx"
                      values="8;34;58"
                      dur={`${EXPLOSION_ANIMATION_MS}ms`}
                      fill="freeze"
                    />
                    <animate
                      attributeName="ry"
                      values="3;10;16"
                      dur={`${EXPLOSION_ANIMATION_MS}ms`}
                      fill="freeze"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.95;0.75;0"
                      dur={`${EXPLOSION_ANIMATION_MS}ms`}
                      fill="freeze"
                    />
                  </ellipse>
                  <circle cx={points.sx} cy={points.sy - renderedHeight * 0.62} r="11" fill="#ffd37a">
                    <animate
                      attributeName="r"
                      values="11;28;46"
                      dur={`${EXPLOSION_ANIMATION_MS}ms`}
                      fill="freeze"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.95;0.8;0"
                      dur={`${EXPLOSION_ANIMATION_MS}ms`}
                      fill="freeze"
                    />
                  </circle>
                  <circle
                    cx={points.sx}
                    cy={points.sy - renderedHeight * 0.62}
                    r="18"
                    fill="rgba(255,124,77,0.5)"
                  >
                    <animate
                      attributeName="r"
                      values="18;38;64"
                      dur={`${EXPLOSION_ANIMATION_MS}ms`}
                      fill="freeze"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.75;0.38;0"
                      dur={`${EXPLOSION_ANIMATION_MS}ms`}
                      fill="freeze"
                    />
                  </circle>
                  <circle
                    cx={points.sx}
                    cy={points.sy - renderedHeight * 0.72}
                    r="6"
                    fill="#fff6bf"
                  >
                    <animate
                      attributeName="r"
                      values="6;14;24"
                      dur={`${EXPLOSION_ANIMATION_MS}ms`}
                      fill="freeze"
                    />
                    <animate
                      attributeName="opacity"
                      values="1;0.9;0"
                      dur={`${EXPLOSION_ANIMATION_MS}ms`}
                      fill="freeze"
                    />
                  </circle>
                  {[
                    { dx: -42, dy: -30 },
                    { dx: -26, dy: -48 },
                    { dx: 0, dy: -58 },
                    { dx: 26, dy: -48 },
                    { dx: 42, dy: -30 },
                    { dx: -36, dy: -6 },
                    { dx: 36, dy: -6 },
                  ].map((vector, index) => (
                    <line
                      key={`explosion-ray-${building.proc.pid}-${index}`}
                      x1={points.sx}
                      y1={points.sy - renderedHeight * 0.62}
                      x2={points.sx}
                      y2={points.sy - renderedHeight * 0.62}
                      stroke={index % 2 === 0 ? "#f9e2af" : "#fab387"}
                      strokeWidth={index === 2 ? 2.8 : 2.1}
                      strokeLinecap="round"
                    >
                      <animate
                        attributeName="x2"
                        values={`${points.sx};${points.sx + vector.dx}`}
                        dur={`${EXPLOSION_ANIMATION_MS}ms`}
                        fill="freeze"
                      />
                      <animate
                        attributeName="y2"
                        values={`${points.sy - renderedHeight * 0.62};${points.sy - renderedHeight * 0.62 + vector.dy}`}
                        dur={`${EXPLOSION_ANIMATION_MS}ms`}
                        fill="freeze"
                      />
                      <animate
                        attributeName="opacity"
                        values="1;0.9;0"
                        dur={`${EXPLOSION_ANIMATION_MS}ms`}
                        fill="freeze"
                      />
                    </line>
                  ))}
                </g>
              ) : null}

              {building.hasPort && detailLevel.showPortBeacons && !isExploding && (
                <g>
                  <line
                    x1={points.sx}
                    y1={points.sy - renderedHeight - 4}
                    x2={points.sx}
                    y2={beaconY}
                    stroke="#89dceb"
                    strokeWidth="1.1"
                  />
                  <circle
                    cx={points.sx}
                    cy={beaconY}
                    r="4.6"
                    fill="none"
                    stroke="#89dceb"
                    strokeOpacity="0.45"
                    strokeWidth="0.9"
                  >
                    <animate
                      attributeName="r"
                      values="4.6;8.2;4.6"
                      dur="1.8s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="stroke-opacity"
                      values="0.45;0.12;0.45"
                      dur="1.8s"
                      repeatCount="indefinite"
                    />
                  </circle>
                  <circle
                    cx={points.sx}
                    cy={beaconY}
                    r="3"
                    fill="#89dceb"
                    filter="url(#city-glow)"
                  >
                    <animate
                      attributeName="opacity"
                      values="0.92;1;0.92"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                </g>
              )}

              {building.isGenie && !isExploding && (
                <g filter="url(#city-glow)">
                  <ellipse
                    cx={points.sx}
                    cy={points.sy - renderedHeight}
                    rx="9"
                    ry="3.4"
                    fill="none"
                    stroke="#cba6f7"
                    strokeWidth="1.4"
                  />
                  <circle
                    cx={points.sx}
                    cy={points.sy - renderedHeight - 7}
                    r="1.8"
                    fill="#cba6f7"
                  />
                </g>
              )}

              {building.isInit && !isExploding && (
                <g filter="url(#city-glow)">
                  <ellipse
                    cx={points.sx}
                    cy={points.sy - renderedHeight - 2}
                    rx="12"
                    ry="4.6"
                    fill="none"
                    stroke="#f38ba8"
                    strokeWidth="1.8"
                  />
                  <text
                    x={points.sx}
                    y={points.sy - renderedHeight - 10}
                    textAnchor="middle"
                    fill="#f9e2af"
                    fontSize="5.6"
                    fontWeight="800"
                    fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
                    pointerEvents="none"
                  >
                    PID 1
                  </text>
                </g>
              )}

              {isMainProcess && !isExploding && (
                <g filter="url(#city-glow)">
                  <polygon
                    points={[
                      `${points.sx},${points.sy - renderedHeight - 14}`,
                      `${points.sx + 4.5},${points.sy - renderedHeight - 9.5}`,
                      `${points.sx},${points.sy - renderedHeight - 5}`,
                      `${points.sx - 4.5},${points.sy - renderedHeight - 9.5}`,
                    ].join(" ")}
                    fill="#f2cd65"
                    stroke="#f9e2af"
                    strokeWidth="0.9"
                  />
                </g>
              )}

            </g>
          );
        })}

        {skyBridges.map((bridge) => {
          const isHoveredBridge =
            hoveredBuilding !== null &&
            (hoveredBuilding.proc.pid === bridge.parent.proc.pid ||
              hoveredBuilding.proc.pid === bridge.child.proc.pid);
          const isSelectedBridge =
            selectedPid !== null &&
            selectedProcessTree.has(bridge.parent.proc.pid) &&
            selectedProcessTree.has(bridge.child.proc.pid);
          const selectedDistrictMatch =
            selectedUser !== null &&
            (bridge.parent.district.user === selectedUser ||
              bridge.child.district.user === selectedUser);
          const isDimmed =
            selectedPid !== null
              ? !isSelectedBridge
              : selectedUser !== null && !selectedDistrictMatch;

          const parentTop = toIso(bridge.parent.gx, bridge.parent.gy);
          const childTop = toIso(bridge.child.gx, bridge.child.gy);
          const parentTargetH = getRenderedBuildingHeight(
            bridge.parent,
            flatMemoryMode,
            selectedPid,
            selectedProcessTree,
          );
          const childTargetH = getRenderedBuildingHeight(
            bridge.child,
            flatMemoryMode,
            selectedPid,
            selectedProcessTree,
          );
          const x1 = parentTop.x;
          const y1 =
            parentTop.y -
            (animatedHeights.current.get(bridge.parent.proc.pid) ?? parentTargetH) -
            10;
          const x2 = childTop.x;
          const y2 =
            childTop.y -
            (animatedHeights.current.get(bridge.child.proc.pid) ?? childTargetH) -
            10;
          const midX = (x1 + x2) / 2;
          const archLift = isSelectedBridge
            ? Math.max(24, Math.min(58, Math.abs(x1 - x2) * 0.18 + Math.abs(y1 - y2) * 0.28))
            : Math.max(16, Math.min(42, Math.abs(x1 - x2) * 0.14 + Math.abs(y1 - y2) * 0.2));
          const midY = Math.min(y1, y2) - archLift;

          return (
            <g
              key={`bridge-foreground-${bridge.parent.proc.pid}-${bridge.child.proc.pid}`}
              style={{ opacity: isDimmed ? 0.08 : isSelectedBridge || isHoveredBridge ? 0.98 : 0.42 }}
            >
              <path
                d={`M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`}
                fill="none"
                stroke={isSelectedBridge || isHoveredBridge ? "#f9e2af" : "#89dceb"}
                strokeWidth={isSelectedBridge ? 1.7 : isHoveredBridge ? 1.35 : 0.9}
                strokeLinecap="round"
                filter={isSelectedBridge || isHoveredBridge ? "url(#city-glow)" : undefined}
                markerEnd={`url(#${isSelectedBridge || isHoveredBridge ? "bridge-arrow-active" : "bridge-arrow-default"})`}
              />
            </g>
          );
        })}
        {hoveredBuilding && hoveredLabelData ? (
          <g style={{ pointerEvents: "none" }}>
            <line
              x1={hoveredLabelData.sx}
              y1={hoveredLabelData.connectorStartY}
              x2={hoveredLabelData.sx}
              y2={hoveredLabelData.labelY + 12}
              stroke="rgba(205,214,244,0.5)"
              strokeWidth="0.9"
            />
            <rect
              x={hoveredLabelData.sx - hoveredLabelData.labelWidth / 2}
              y={hoveredLabelData.labelY}
              width={hoveredLabelData.labelWidth}
              height="12"
              rx="4"
              fill="rgba(24,24,37,0.96)"
              stroke="#f9e2af"
              strokeWidth="0.8"
            />
            <text
              x={hoveredLabelData.sx}
              y={hoveredLabelData.labelTextY}
              textAnchor="middle"
              fill="#cdd6f4"
              fontSize={zoom >= 2.4 ? "6.1" : zoom >= 1.6 ? "5.8" : "5.3"}
              fontWeight="700"
              fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
            >
              {hoveredLabelData.name}
            </text>
          </g>
        ) : null}
        {explodingOverlayData && explosionProgress > 0 ? (
          <g pointerEvents="none" filter="url(#city-glow)">
            <ellipse
              cx={explodingOverlayData.sx}
              cy={explodingOverlayData.sy + TILE_HEIGHT * 0.18}
              rx={10 + explosionProgress * 72}
              ry={3.8 + explosionProgress * 18.2}
              fill="none"
              stroke="#f9e2af"
              strokeWidth="1.8"
              opacity={1 - explosionProgress}
            />
            <circle
              cx={explodingOverlayData.sx}
              cy={explodingOverlayData.cy}
              r={14 + explosionProgress * 46}
              fill="#fff6bf"
              opacity={Math.max(0, 1 - explosionProgress * 0.95)}
            />
            <circle
              cx={explodingOverlayData.sx}
              cy={explodingOverlayData.cy}
              r={24 + explosionProgress * 64}
              fill="rgba(255,124,77,0.6)"
              opacity={Math.max(0, 0.95 - explosionProgress * 0.95)}
            />
            {[
              { dx: -58, dy: -42 },
              { dx: -36, dy: -64 },
              { dx: 0, dy: -78 },
              { dx: 36, dy: -64 },
              { dx: 58, dy: -42 },
              { dx: -52, dy: -10 },
              { dx: 52, dy: -10 },
              { dx: -18, dy: 18 },
              { dx: 18, dy: 18 },
            ].map((vector, index) => (
              <line
                key={`explosion-overlay-ray-${explodingPid}-${index}`}
                x1={explodingOverlayData.sx}
                y1={explodingOverlayData.cy}
                x2={explodingOverlayData.sx + vector.dx * explosionProgress}
                y2={explodingOverlayData.cy + vector.dy * explosionProgress}
                stroke={index % 2 === 0 ? "#f9e2af" : "#fab387"}
                strokeWidth={index === 2 ? 3.6 : 2.6}
                strokeLinecap="round"
                opacity={Math.max(0, 1 - explosionProgress)}
              />
            ))}
          </g>
        ) : null}
      </svg>

      {selectedBuilding ? (
        <div
          className="absolute bottom-3 right-3 z-20 w-[320px] rounded-xl border px-4 py-3 backdrop-blur-sm"
          style={{
            borderColor: "#f9e2af",
            background: "rgba(24, 24, 37, 0.94)",
            boxShadow: "0 0 0 1px rgba(249,226,175,0.18)",
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-text">
                {selectedBuilding.proc.name}
          </div>
              <div className="text-md text-subtext0">
                Focused process tree · PID {selectedBuilding.proc.pid}
              </div>
            </div>
            <button
              type="button"
              className="text-xs uppercase tracking-[0.18em] text-overlay0 hover:text-text cursor-pointer"
              onClick={() => setSelectedPid(null)}
            >
              Clear
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-md">
            <div className="rounded-lg bg-surface0/80 px-2.5 py-2">
              <div className="text-xs uppercase tracking-[0.18em] text-overlay0">
                Memory
              </div>
              <div className="mt-1 font-semibold text-text">
                {formatMem(selectedBuilding.proc.mem)}
              </div>
            </div>
            <div className="rounded-lg bg-surface0/80 px-2.5 py-2">
              <div className="text-xs uppercase tracking-[0.18em] text-overlay0">
                Linked Processes
              </div>
              <div className="mt-1 font-semibold text-text">
                {Math.max(selectedProcessTree.size - 1, 0)}
              </div>
            </div>
          </div>
          <div className="mt-2 text-md text-overlay0">
            Neighborhood: {selectedBuilding.district.title}
          </div>
          <div className="mt-1 text-md text-overlay0">
            CPU load: {formatCpu(selectedBuilding.proc.cpu)}
          </div>
          {selectedParentBuilding ? (
            <div className="mt-1 text-md text-overlay0">
              Parent: {selectedParentBuilding.proc.name} · PID {selectedParentBuilding.proc.pid}
            </div>
          ) : null}
          {mainProcessPids.has(selectedBuilding.proc.pid) ? (
            <div className="mt-1 text-md text-yellow">
              Main process in this visible process graph
            </div>
          ) : null}
          {hoveredBuilding && selectedProcessTree.has(hoveredBuilding.proc.pid) ? (
            <div className="mt-3 rounded-lg bg-surface0/80 px-2.5 py-2 text-md text-overlay0">
              Inspecting <span className="font-semibold text-text">{hoveredBuilding.proc.name}</span>
              {" · "}
              PID {hoveredBuilding.proc.pid}
            </div>
          ) : null}
        </div>
      ) : selectedNeighborhood ? (
        <div
          className="absolute bottom-3 right-3 z-20 w-[320px] rounded-xl border px-4 py-3 backdrop-blur-sm"
          style={{
            borderColor: selectedNeighborhood.palette.accent,
            background: "rgba(24, 24, 37, 0.92)",
            boxShadow: `0 0 0 1px ${selectedNeighborhood.palette.top}33`,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-text">
                {selectedNeighborhood.title}
              </div>
              <div className="text-md text-subtext0">
                {selectedNeighborhood.subtitle}
              </div>
            </div>
            <button
              type="button"
              className="text-xs uppercase tracking-[0.18em] text-overlay0 hover:text-text cursor-pointer"
              onClick={() => setSelectedUser(null)}
            >
              Clear
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-md">
            <div className="rounded-lg bg-surface0/80 px-2.5 py-2">
              <div className="text-xs uppercase tracking-[0.18em] text-overlay0">
                Buildings
              </div>
              <div className="mt-1 font-semibold text-text">
                {selectedNeighborhood.processes.length}
              </div>
            </div>
            <div className="rounded-lg bg-surface0/80 px-2.5 py-2">
              <div className="text-xs uppercase tracking-[0.18em] text-overlay0">
                Total Memory
              </div>
              <div className="mt-1 font-semibold text-text">
                {formatMem(selectedNeighborhood.totalMem)}
              </div>
            </div>
          </div>
          <div className="mt-2 text-md text-overlay0">
            CPU load across district: {formatCpu(selectedNeighborhood.totalCpu)}
          </div>
          <div className="mt-1 text-md text-overlay0">
            Empty lots held:{" "}
            {selectedNeighborhood.cols * selectedNeighborhood.rows -
              selectedNeighborhood.processes.length}
          </div>
          <div className="mt-1 text-md text-overlay0">
            Tallest tower:{" "}
            {formatMem(
              Math.max(...selectedNeighborhood.processes.map((process) => process.mem), 0),
            )}
          </div>
          {hoveredBuilding && hoveredBuilding.district.user === selectedNeighborhood.user ? (
            <div className="mt-3 rounded-lg bg-surface0/80 px-2.5 py-2 text-md text-overlay0">
              Inspecting <span className="font-semibold text-text">{hoveredBuilding.proc.name}</span>
              {" · "}
              PID {hoveredBuilding.proc.pid}
            </div>
          ) : null}
        </div>
      ) : hoveredBuilding ? (
        <div
          className="absolute bottom-3 right-3 z-20 w-[280px] rounded-xl border border-surface0 bg-crust/90 px-4 py-3 backdrop-blur-sm"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-text">
                {hoveredBuilding.proc.name}
              </div>
              <div className="text-md text-subtext0">
                {hoveredBuilding.district.title} · PID {hoveredBuilding.proc.pid}
              </div>
            </div>
            {hoveredBuilding.isGenie ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-mauve/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.18em] text-mauve">
                <Sparkles className="h-3 w-3" />
                Genie
              </span>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-md">
            <div className="rounded-lg bg-surface0/80 px-2.5 py-2">
              <div className="text-xs uppercase tracking-[0.18em] text-overlay0">
                Memory Tower
              </div>
              <div className="mt-1 font-semibold text-text">
                {formatMem(hoveredBuilding.proc.mem)}
              </div>
            </div>
            <div className="rounded-lg bg-surface0/80 px-2.5 py-2">
              <div className="text-xs uppercase tracking-[0.18em] text-overlay0">
                CPU Traffic
              </div>
              <div className="mt-1 font-semibold text-text">
                {formatCpu(hoveredBuilding.proc.cpu)}
              </div>
            </div>
          </div>
          {hoveredBuilding.hasPort ? (
            <div className="mt-2 rounded-lg bg-surface0/80 px-2.5 py-2">
              <div className="text-xs uppercase tracking-[0.18em] text-overlay0">Port</div>
              <div className="mt-1 font-semibold text-text">{hoveredBuilding.proc.port}</div>
            </div>
          ) : (
            <div className="mt-2 text-md text-overlay0">No public port beacon</div>
          )}
          {mainProcessPids.has(hoveredBuilding.proc.pid) ? (
            <div className="mt-1 text-md text-yellow">
              Main process
            </div>
          ) : null}
          <div className="mt-1 text-md text-overlay0">
            District: {hoveredBuilding.district.subtitle}
          </div>
        </div>
      ) : (
        <div className="absolute bottom-3 right-3 z-20 rounded-xl border border-surface0 bg-crust/80 px-4 py-3 text-md text-overlay0 backdrop-blur-sm">
          Hover a building to inspect the process skyline.
        </div>
      )}

      {showLegend && (
        <div
          className="absolute bottom-3 left-3 z-20 rounded-xl border border-surface0 bg-crust/80 px-4 py-3 backdrop-blur-sm"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-2 text-base font-semibold text-text">
            <Building2 className="h-4 w-4 text-blue" />
            Process City
          </div>
          <div className="mt-1 text-md text-subtext0">
            Neighborhoods map to users. Building height maps to memory usage.
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-md text-overlay0">
            <span>{formatMem(totalMem)} total memory</span>
            <span>{totalPorts} port beacons</span>
            <span>{totalGenie} genie towers</span>
            <span>{formatMem(maxMem)} tallest tower</span>
          </div>
        </div>
      )}
    </div>
  );
}
