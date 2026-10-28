// writeStatsPostbackDropin: the genie-stats drop-in (root-only 0600, it holds
// the stats token) and the identity file genie-local reads for "Sign in with
// Genie" (/opt/project/.genie-instance.json, owner genie, 0644, no token).
// SSH is mocked; the generated shell is also run for real against temp paths
// with a pass-through `sudo`, to check the modes it leaves behind.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  commands: [] as string[],
  instance: null as null | Record<string, unknown>,
}));

vi.mock("./ssh-session-cache.js", () => ({
  execCached: async (_conn: unknown, cmd: string) => { mocks.commands.push(cmd); return ""; },
  evictSession: () => {},
}));
vi.mock("./ssh-client.js", () => ({ connectSsh: async () => { throw new Error("no ssh in tests"); } }));
vi.mock("./stats-token-service.js", () => ({ ensureStatsToken: async () => "SECRET-STATS-TOKEN" }));
vi.mock("../projects/project-service.js", () => ({
  getById: async (id: string) => (mocks.instance ? { id, vpsInstances: [mocks.instance] } : null),
}));

const {
  writeStatsPostbackDropin,
  buildDropinWriteCommand,
  buildIdentityWriteCommand,
  buildInstanceIdentity,
  buildStatsDropin,
  GENIE_INSTANCE_IDENTITY_PATH,
} = await import("./ensure-vps-stats.js");

const PROJECT = "11111111-2222-4333-8444-555555555555";
const conn = { host: "10.0.0.1", port: 22, username: "genie", privateKeyPath: "" };

/** Payloads of `echo '<b64>' | …` in the captured commands, decoded. */
function decodedPayloads(cmd: string): string[] {
  return [...cmd.matchAll(/echo '([A-Za-z0-9+/=]+)'/g)].map((m) => Buffer.from(m[1], "base64").toString());
}

describe("writeStatsPostbackDropin", () => {
  const savedUrl = process.env.VPS_MANAGER_URL;
  beforeEach(() => {
    mocks.commands = [];
    mocks.instance = { id: "inst-1", domain: "paul.cloud.example", domainUrl: "https://paul.cloud.example" };
    process.env.VPS_MANAGER_URL = "https://manager.test";
  });
  afterAll(() => {
    if (savedUrl === undefined) delete process.env.VPS_MANAGER_URL;
    else process.env.VPS_MANAGER_URL = savedUrl;
  });

  it("writes the drop-in 0600 via a umask-077 temp file and the identity file 0644 owned by genie", async () => {
    expect(await writeStatsPostbackDropin(conn, PROJECT, "inst-1")).toBe(true);
    expect(mocks.commands).toHaveLength(2);
    const [dropinCmd, identityCmd] = mocks.commands;

    expect(dropinCmd).toContain("/etc/systemd/system/genie-stats.service.d/10-genie-postback.conf");
    expect(dropinCmd).toContain("umask 077");
    expect(dropinCmd).toContain("chmod 0600");
    expect(dropinCmd).not.toContain("tee");
    const [dropin] = decodedPayloads(dropinCmd);
    expect(dropin).toContain("Environment=GENIE_STATS_TOKEN=SECRET-STATS-TOKEN");
    expect(dropin).toContain("Environment=GENIE_MANAGER_URL=https://manager.test");
    expect(dropin).toContain(`Environment=GENIE_PROJECT_ID=${PROJECT}`);
    expect(dropin).toContain("Environment=GENIE_INSTANCE_ID=inst-1");

    expect(identityCmd).toContain(GENIE_INSTANCE_IDENTITY_PATH);
    expect(identityCmd).toContain("chown genie ");
    expect(identityCmd).toContain("chmod 0644");
    const [identity] = decodedPayloads(identityCmd);
    expect(identity).toBe(
      `{"managerUrl":"https://manager.test","projectId":"${PROJECT}","instanceId":"inst-1","publicOrigin":"https://paul.cloud.example"}\n`,
    );
    expect(identityCmd).not.toContain(Buffer.from("SECRET-STATS-TOKEN").toString("base64").slice(0, 12));
    expect(identity).not.toContain("SECRET");
  });

  it("publicOrigin: the SSO origin wins, null when genie knows none", async () => {
    mocks.instance = { id: "inst-1", ssoOrigin: "https://box.example.org", domain: "paul.cloud.example" };
    await writeStatsPostbackDropin(conn, PROJECT, "inst-1");
    expect(JSON.parse(decodedPayloads(mocks.commands[1])[0]).publicOrigin).toBe("https://box.example.org");

    mocks.commands = [];
    mocks.instance = { id: "inst-1" };
    await writeStatsPostbackDropin(conn, PROJECT, "inst-1");
    expect(JSON.parse(decodedPayloads(mocks.commands[1])[0]).publicOrigin).toBeNull();
  });
});

describe("the generated shell, run for real", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genie-postback-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("leaves the drop-in 0600 (even over an old 0644 one) and the identity file 0644", () => {
    // A pass-through sudo, so nothing runs as root.
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "sudo"), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
    const me = os.userInfo().username;
    const paths = {
      dropinDir: path.join(dir, "genie-stats.service.d"),
      dropinPath: path.join(dir, "genie-stats.service.d", "10-genie-postback.conf"),
      identityPath: path.join(dir, "project", ".genie-instance.json"),
      identityOwner: me,
    };
    fs.mkdirSync(paths.dropinDir);
    fs.writeFileSync(paths.dropinPath, "old\n", { mode: 0o644 });

    const id = { managerUrl: "https://manager.test", projectId: PROJECT, instanceId: "inst-1", publicOrigin: null };
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    execFileSync("sh", ["-c", buildDropinWriteCommand(buildStatsDropin(id, "tok"), paths)], { env });
    execFileSync("sh", ["-c", buildIdentityWriteCommand(buildInstanceIdentity(id), paths)], { env });

    expect(fs.statSync(paths.dropinPath).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(paths.dropinPath, "utf8")).toContain("GENIE_STATS_TOKEN=tok");
    expect(fs.existsSync(`${paths.dropinPath}.tmp`)).toBe(false);
    expect(fs.statSync(paths.identityPath).mode & 0o777).toBe(0o644);
    expect(JSON.parse(fs.readFileSync(paths.identityPath, "utf8"))).toEqual(id);
  });
});
