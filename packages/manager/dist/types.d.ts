export interface AppDef {
    id: string;
    name: string;
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    status: "running" | "stopped" | "crashed";
}
export interface WsMessage {
    type: string;
    payload: any;
}
export interface AppStats {
    cpu: number;
    mem: number;
    pid: number;
}
export interface MemoryInfo {
    physical: number;
    used: number;
    cached: number;
    swap: number;
    appMem: number;
    wired: number;
    compressed: number;
}
export interface SystemStats {
    cpu: number;
    mem: number;
    memory?: MemoryInfo;
}
export interface ProcessInfo {
    pid: number;
    name: string;
    cpu: number;
    mem: number;
    user: string;
    port: string;
}
export interface DockerContainerInfo {
    id: string;
    name: string;
    image: string;
    status: string;
    state: string;
    ports: string;
    cpu: number;
    mem: number;
    memLimit: number;
    memPercent: number;
    project: string;
    service: string;
}
export interface DockerInfo {
    daemonRunning: boolean;
    containers: DockerContainerInfo[];
}
export interface StatsPayload {
    system: SystemStats;
    apps: Record<string, AppStats>;
    processes: ProcessInfo[];
    docker: DockerInfo;
}
//# sourceMappingURL=types.d.ts.map