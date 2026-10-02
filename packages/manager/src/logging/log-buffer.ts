const MAX_LOG_BUFFER = 50000;

export class LogBuffer {
  private buffers = new Map<string, string>();

  append(key: string, data: string): void {
    let buf = this.buffers.get(key) || "";
    buf += data;
    if (buf.length > MAX_LOG_BUFFER) {
      buf = buf.slice(-MAX_LOG_BUFFER);
    }
    this.buffers.set(key, buf);
  }

  get(key: string): string {
    return this.buffers.get(key) || "";
  }

  getAll(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, buf] of this.buffers) {
      if (buf) result[key] = buf;
    }
    return result;
  }
}
