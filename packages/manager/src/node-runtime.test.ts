import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isNodePatched, NODE_BASH_HELPERS } from "./node-runtime.js";

const CASES: [string, boolean][] = [
  ["v20.19.5", false], // EOL line, never patched
  ["v22.23.3", false],
  ["v22.23.4", true],
  ["v22.24.0", true],
  ["v23.11.1", false], // odd major, EOL
  ["v24.22.0", false],
  ["v24.22.1", true],
  ["v24.100.0", true],
  ["v26.12.0", false],
  ["v26.12.1", true],
  ["v27.0.0", true], // released after the advisory
];

describe("isNodePatched", () => {
  it.each(CASES)("%s → %s", (version, patched) => {
    expect(isNodePatched(version)).toBe(patched);
  });
});

describe("node_is_patched (bash)", () => {
  let bin: string;
  beforeAll(() => {
    bin = fs.mkdtempSync(path.join(os.tmpdir(), "node-runtime-"));
    fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\necho 10.0.0\n", { mode: 0o755 });
  });
  afterAll(() => fs.rmSync(bin, { recursive: true, force: true }));

  const run = (env: NodeJS.ProcessEnv): boolean => {
    try {
      execFileSync("bash", ["-c", `${NODE_BASH_HELPERS}\nnode_is_patched`], { env });
      return true;
    } catch {
      return false;
    }
  };

  it.each(CASES)("%s → %s", (version, patched) => {
    fs.writeFileSync(path.join(bin, "node"), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
    expect(run({ PATH: `${bin}:/usr/bin:/bin` })).toBe(patched);
  });

  it("fails when node is missing", () => {
    fs.rmSync(path.join(bin, "node"), { force: true });
    expect(run({ PATH: bin })).toBe(false);
  });
});
