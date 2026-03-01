type EventCallback = (event: {
    type: string;
    payload: Record<string, unknown>;
}) => void;
export declare function getLogBuffer(id: string): string;
export declare function getAllLogBuffers(): Record<string, string>;
export declare function setEventCallback(cb: EventCallback): void;
export declare function getRunningPids(): Map<string, number>;
export declare function startApp(id: string): boolean;
export declare function stopApp(id: string): boolean;
export declare function stopAll(): void;
export {};
//# sourceMappingURL=app-manager.d.ts.map