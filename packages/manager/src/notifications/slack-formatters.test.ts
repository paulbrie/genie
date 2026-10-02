import { describe, it, expect } from "vitest";
import {
  formatStats,
  formatContainers,
  formatProcesses,
  formatProjectList,
  formatCodeBlock,
  formatError,
  formatSuccess,
} from "./slack-formatters.js";
import type {
  VpsStats,
  VpsProcessInfo,
  VpsContainerStatus,
} from "../vps/deploy-service.js";
import type { ProjectDef } from "../types.js";

const proc = (over: Partial<VpsProcessInfo> = {}): VpsProcessInfo =>
  ({ pid: 1, ppid: 0, cpu: 0, mem: 0, user: "u", name: "p", port: 0, ...over } as VpsProcessInfo);

const baseStats: VpsStats = {
  cpuPercent: 50,
  memUsedBytes: 4 * 1e9,
  memTotalBytes: 8 * 1e9,
  memPercent: 50,
  diskUsedBytes: 20 * 1e9,
  diskTotalBytes: 100 * 1e9,
  diskPercent: 20,
  openPorts: [22, 80, 443],
  externalPorts: [],
  sshSessions: 0,
  processes: [],
} as VpsStats;

describe("formatStats", () => {
  it("renders a header block when a label is provided, and omits it otherwise", () => {
    const withLabel = formatStats(baseStats, "vps-1");
    expect(withLabel[0].type).toBe("header");
    const noLabel = formatStats(baseStats);
    expect(noLabel[0].type).not.toBe("header");
  });

  it("formats bytes in GB/MB/KB depending on magnitude", () => {
    const stats = { ...baseStats, processes: [] };
    const blocks = formatStats(stats);
    // section block with fields renders memory and disk in GB
    const section = blocks.find((b) => b.type === "section" && "fields" in b) as
      | { fields: Array<{ text: string }> }
      | undefined;
    expect(section).toBeDefined();
    const text = section!.fields.map((f) => f.text).join("\n");
    expect(text).toContain("4.0 GB");
    expect(text).toContain("8.0 GB");
    expect(text).toContain("20.0 GB");
    expect(text).toContain("100.0 GB");
  });

  it("handles zero totals without producing NaN%", () => {
    const stats = { ...baseStats, memTotalBytes: 0, diskTotalBytes: 0 };
    const blocks = formatStats(stats);
    const flat = JSON.stringify(blocks);
    expect(flat).not.toContain("NaN");
  });

  it("renders processes when present and omits the divider when empty", () => {
    const empty = formatStats(baseStats);
    expect(empty.some((b) => b.type === "divider")).toBe(false);
    const withProcs = formatStats({
      ...baseStats,
      processes: [
        proc({ pid: 1, cpu: 5, mem: 100, user: "root", name: "init" }),
        proc({ pid: 2, cpu: 10, mem: 200, user: "node", name: "server" }),
      ],
    });
    expect(withProcs.some((b) => b.type === "divider")).toBe(true);
  });

  it("caps the processes table to 10 rows", () => {
    const many = Array.from({ length: 25 }, (_, i) => proc({ pid: i, name: `p${i}` }));
    const blocks = formatStats({ ...baseStats, processes: many });
    const flat = JSON.stringify(blocks);
    expect(flat).toContain("p0");
    expect(flat).toContain("p9");
    expect(flat).not.toContain("p10");
  });
});

describe("formatContainers", () => {
  it("returns a single placeholder block for an empty list", () => {
    const blocks = formatContainers([]);
    expect(blocks).toHaveLength(1);
    expect(JSON.stringify(blocks)).toContain("No containers");
  });

  it("uses distinct status icons for running/exited/other", () => {
    const c = (state: string): VpsContainerStatus => ({
      name: state,
      service: state,
      state,
      ports: "",
      status: state,
    } as VpsContainerStatus);
    const blocks = formatContainers([c("running"), c("exited"), c("created")]);
    const flat = JSON.stringify(blocks);
    expect(flat).toContain("🟢");
    expect(flat).toContain("🔴");
    expect(flat).toContain("⚪");
  });
});

describe("formatProcesses", () => {
  it("returns a placeholder block for an empty list", () => {
    expect(JSON.stringify(formatProcesses([]))).toContain("No processes");
  });

  it("caps the visible rows at 20", () => {
    const many = Array.from({ length: 50 }, (_, i) => proc({ pid: i, name: `proc${i}` }));
    const flat = JSON.stringify(formatProcesses(many));
    expect(flat).toContain("proc0");
    expect(flat).toContain("proc19");
    expect(flat).not.toContain("proc20");
  });
});

describe("formatProjectList", () => {
  const project = (overrides: Partial<ProjectDef> = {}): ProjectDef =>
    ({
      id: "p1",
      name: "demo",
      vpsInstances: [],
      ...overrides,
    } as ProjectDef);

  it("returns a placeholder when there are no projects", () => {
    expect(JSON.stringify(formatProjectList([]))).toContain("No projects");
  });

  it("pluralizes 'instance' correctly", () => {
    const flat = JSON.stringify(
      formatProjectList([
        project({
          vpsInstances: [
            { connection: { host: "a" } } as ProjectDef["vpsInstances"][number],
          ],
        }),
      ]),
    );
    expect(flat).toContain("1 instance ");
    expect(flat).not.toContain("1 instances");

    const flatMany = JSON.stringify(
      formatProjectList([
        project({
          vpsInstances: [
            { connection: { host: "a" } } as ProjectDef["vpsInstances"][number],
            { connection: { host: "b" } } as ProjectDef["vpsInstances"][number],
          ],
        }),
      ]),
    );
    expect(flatMany).toContain("2 instances");
  });
});

describe("formatCodeBlock", () => {
  it("truncates long payloads to 2900 chars (Slack 3000-char block limit safety)", () => {
    const blocks = formatCodeBlock("x".repeat(5000));
    const flat = JSON.stringify(blocks);
    // 2900 'x' is what's preserved, plus the surrounding backticks
    expect(flat).toContain("x".repeat(2900));
    expect(flat).not.toContain("x".repeat(2901));
  });
});

describe("formatError / formatSuccess", () => {
  it("prefix messages with ❌ / ✅", () => {
    expect(JSON.stringify(formatError("nope"))).toContain("❌ nope");
    expect(JSON.stringify(formatSuccess("ok"))).toContain("✅ ok");
  });
});
