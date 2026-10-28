// "Sign in with Genie" origin: the set action and its three replies, all on
// $vpsDeploy.instances[id] (the server card only renders them).
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/ws", () => ({
  wsSend: vi.fn(),
  wsRequest: vi.fn(),
  onWsClose: vi.fn(),
}));

import { setVpsSsoOrigin } from "./vps";
import { handlers } from "../handlers/vps";
import { $vpsDeploy } from "../subjects/vps";
import { wsSend } from "@/lib/ws";

const INST = "inst-1";
const inst = () => $vpsDeploy.getValue().instances[INST];

beforeEach(() => {
  $vpsDeploy.next({ instances: {}, activeDeploys: {}, testResult: null });
  vi.mocked(wsSend).mockClear();
});

describe("setVpsSsoOrigin", () => {
  it("sends the trimmed origin (or null) and marks saving", () => {
    setVpsSsoOrigin("p-1", INST, "  https://box.example.com ");
    expect(wsSend).toHaveBeenCalledExactlyOnceWith("vps:sso-origin:set", { projectId: "p-1", instanceId: INST, origin: "https://box.example.com" });
    expect(inst()).toMatchObject({ ssoOriginSaving: true, ssoOriginError: null, ssoOriginSynced: null });

    setVpsSsoOrigin("p-1", INST, "   ");
    expect(vi.mocked(wsSend).mock.calls[1][1]).toEqual({ projectId: "p-1", instanceId: INST, origin: null });
  });

  it("done clears saving; error keeps the message; synced records the server update", () => {
    setVpsSsoOrigin("p-1", INST, "https://x.example");
    handlers["vps:sso-origin:set:error"]({ projectId: "p-1", instanceId: INST, message: "The origin must use https://" });
    expect(inst()).toMatchObject({ ssoOriginSaving: false, ssoOriginError: "The origin must use https://" });

    setVpsSsoOrigin("p-1", INST, "https://x.example");
    handlers["vps:sso-origin:set:done"]({ projectId: "p-1", instanceId: INST, origin: "https://x.example" });
    expect(inst()).toMatchObject({ ssoOriginSaving: false, ssoOriginError: null });

    handlers["vps:sso-origin:synced"]({ projectId: "p-1", instanceId: INST, ok: false, message: "ssh timeout" });
    expect(inst().ssoOriginSynced).toBe(false);
    handlers["vps:sso-origin:synced"]({ projectId: "p-1", instanceId: INST, ok: true });
    expect(inst().ssoOriginSynced).toBe(true);
  });
});
