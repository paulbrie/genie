import { spawn } from "node:child_process";
import * as store from "./store.js";
const processes = new Map();
const logBuffers = new Map();
const MAX_LOG_BUFFER = 50000;
let onEvent = () => { };
export function getLogBuffer(id) {
    return logBuffers.get(id) || "";
}
export function getAllLogBuffers() {
    const result = {};
    for (const [id, buf] of logBuffers) {
        if (buf)
            result[id] = buf;
    }
    return result;
}
function appendLogBuffer(id, data) {
    let buf = logBuffers.get(id) || "";
    buf += data;
    if (buf.length > MAX_LOG_BUFFER) {
        buf = buf.slice(-MAX_LOG_BUFFER);
    }
    logBuffers.set(id, buf);
}
export function setEventCallback(cb) {
    onEvent = cb;
}
export function getRunningPids() {
    const pids = new Map();
    for (const [id, proc] of processes) {
        if (proc.pid)
            pids.set(id, proc.pid);
    }
    return pids;
}
export function startApp(id) {
    if (processes.has(id))
        return false;
    const apps = store.getAll();
    const app = apps.find((a) => a.id === id);
    if (!app)
        return false;
    const child = spawn(app.command, {
        shell: true,
        cwd: app.cwd || process.cwd(),
        env: { ...process.env, ...app.env },
        stdio: ["ignore", "pipe", "pipe"],
    });
    processes.set(id, child);
    store.updateStatus(id, "running");
    onEvent({ type: "app:status", payload: { id, status: "running" } });
    child.stdout?.on("data", (data) => {
        const text = data.toString();
        appendLogBuffer(id, text);
        onEvent({
            type: "app:log",
            payload: { id, stream: "stdout", data: text },
        });
    });
    child.stderr?.on("data", (data) => {
        const text = data.toString();
        appendLogBuffer(id, text);
        onEvent({
            type: "app:log",
            payload: { id, stream: "stderr", data: text },
        });
    });
    child.on("exit", (code) => {
        processes.delete(id);
        const status = code === 0 || code === null ? "stopped" : "crashed";
        store.updateStatus(id, status);
        onEvent({ type: "app:status", payload: { id, status } });
    });
    child.on("error", (err) => {
        processes.delete(id);
        store.updateStatus(id, "crashed");
        onEvent({ type: "app:status", payload: { id, status: "crashed" } });
        onEvent({
            type: "error",
            payload: { message: err.message, context: `app:${id}` },
        });
    });
    return true;
}
export function stopApp(id) {
    const child = processes.get(id);
    if (!child)
        return false;
    child.kill("SIGTERM");
    // Force kill after 5 seconds if still alive
    setTimeout(() => {
        if (processes.has(id)) {
            child.kill("SIGKILL");
        }
    }, 5000);
    return true;
}
export function stopAll() {
    for (const [id] of processes) {
        stopApp(id);
    }
}
//# sourceMappingURL=app-manager.js.map