declare module "pidusage" {
  interface Stats {
    cpu: number;
    memory: number;
    pid: number;
    ppid: number;
    elapsed: number;
    timestamp: number;
  }
  function pidusage(
    pids: number | number[]
  ): Promise<Record<number, Stats>>;
  export = pidusage;
}
