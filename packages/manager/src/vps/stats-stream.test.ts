// The MaxStartups ingest branch: a stats sample reporting drops>0 must emit the
// tagged fleet-trace warning AND record a discrete event; drops==0 / undefined
// (older agent) must do neither. DB-touching deps are mocked.
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { VpsStatsPayload } from "@genie/vps-stats";

vi.mock("./vps-metric-service.js", () => ({
  enqueueVpsMetricSample: vi.fn(),
  getLatestVpsMetricSamples: vi.fn(async () => ({})),
}));
vi.mock("./ssh-maxstartups-service.js", () => ({
  recordSshMaxStartupsEvent: vi.fn(),
}));

import { ingestVpsStats } from "./stats-stream.js";
import { recordSshMaxStartupsEvent } from "./ssh-maxstartups-service.js";

const recordMock = vi.mocked(recordSshMaxStartupsEvent);
const send = vi.fn();

function payload(over: Partial<VpsStatsPayload> = {}): VpsStatsPayload {
  return {
    cpuPercent: 1, memUsedBytes: 1, memTotalBytes: 2, memPercent: 50,
    diskUsedBytes: 1, diskTotalBytes: 2, diskPercent: 50,
    processes: [], openPorts: [], externalPorts: [], sshSessions: 0,
    ...over,
  };
}

beforeEach(() => { recordMock.mockClear(); send.mockClear(); });

describe("ingestVpsStats — MaxStartups drops", () => {
  it("records an event and warns when drops > 0", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ingestVpsStats("proj-1", "inst-1", 1_700_000_000_000, payload({ sshMaxStartups: "10:30:100", sshMaxStartupsDrops: 3 }), send);

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "proj-1", instanceId: "inst-1", drops: 3, maxStartups: "10:30:100",
    }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[ssh-maxstartups]"));
    warn.mockRestore();
  });

  it("does nothing when drops == 0", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ingestVpsStats("p", "i", 1, payload({ sshMaxStartups: "10:30:100", sshMaxStartupsDrops: 0 }), send);
    expect(recordMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("[ssh-maxstartups]"));
    warn.mockRestore();
  });

  it("tolerates an older agent that omits the fields", () => {
    ingestVpsStats("p", "i", 1, payload(), send); // no sshMaxStartups* fields
    expect(recordMock).not.toHaveBeenCalled();
  });
});
