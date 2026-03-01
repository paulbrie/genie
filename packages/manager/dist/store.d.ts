import type { AppDef } from "./types.js";
export declare function load(): AppDef[];
export declare function save(apps: AppDef[]): void;
export declare function add(entry: {
    name: string;
    command: string;
    cwd?: string;
    env?: Record<string, string>;
}): AppDef;
export declare function remove(id: string): boolean;
export declare function getAll(): AppDef[];
export declare function updateStatus(id: string, status: AppDef["status"]): void;
//# sourceMappingURL=store.d.ts.map