import type { DockerInfo, ProcessInfo, StatsPayload } from "./types.js";
export declare function getDockerBin(): string | null;
export declare function collectStats(): Promise<StatsPayload>;
export declare function getCachedProcesses(): ProcessInfo[];
export declare function getCachedDockerInfo(): DockerInfo;
export declare function startMonitoring(onStats: (stats: StatsPayload) => void, intervalMs?: number): void;
export declare function stopMonitoring(): void;
//# sourceMappingURL=monitor.d.ts.map