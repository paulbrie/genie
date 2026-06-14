// git-repo-service integration tests. Skips when DB_TEST is unset.
//
// The token is the load-bearing invariant: it must round-trip via
// add/getTokenForRepo, but never leak through list responses or rows passed
// to the wire layer.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { isTestDbAvailable, setupTestDb, truncateAllTables } from "../test-helpers/db.js";
import { makeUser, makeProject } from "../test-helpers/fixtures.js";
import * as gitRepoService from "./git-repo-service.js";

// Provide a real encryption secret so credential-crypto doesn't refuse.
process.env.GENIE_SECRET ||= "test-secret-for-git-repo-service-only";

describe.skipIf(!isTestDbAvailable())("git-repo-service (integration)", () => {
  let userId: string;
  let projectId: string;
  const instanceId = "vm-test";

  beforeAll(async () => { await setupTestDb(); });

  beforeEach(async () => {
    await truncateAllTables();
    const user = await makeUser();
    userId = user.id;
    const project = await makeProject();
    projectId = project.id;
  });

  it("add() + listForInstance() round-trips minus the token bundle", async () => {
    const added = await gitRepoService.add({
      projectId,
      instanceId,
      repoUrl: "https://github.com/owner/repo.git",
      repoPath: "/opt/project",
      provider: "github",
      token: "github_pat_secret",
      autoSave: true,
      createdBy: userId,
    });
    expect(added.hasToken).toBe(true);
    expect(added.autoSave).toBe(true);
    // The returned shape MUST NOT carry token or ciphertext fields.
    expect("token" in added).toBe(false);
    expect("ciphertext" in added).toBe(false);

    const list = await gitRepoService.listForInstance(projectId, instanceId);
    expect(list).toHaveLength(1);
    expect(list[0].hasToken).toBe(true);
    expect("token" in list[0]).toBe(false);
    expect("ciphertext" in list[0]).toBe(false);
  });

  it("getTokenForRepo() decrypts the stored token", async () => {
    const row = await gitRepoService.add({
      projectId, instanceId,
      repoUrl: "https://gitlab.com/g/p.git", repoPath: "/opt/project",
      provider: "gitlab", token: "glpat-secret", createdBy: userId,
    });
    expect(await gitRepoService.getTokenForRepo(row.id)).toBe("glpat-secret");
  });

  it("getTokenForRepo() returns null when no token was stored", async () => {
    const row = await gitRepoService.add({
      projectId, instanceId,
      repoUrl: "https://github.com/o/r.git", repoPath: "/opt/project",
      createdBy: userId,
    });
    expect(row.hasToken).toBe(false);
    expect(await gitRepoService.getTokenForRepo(row.id)).toBeNull();
  });

  it("update({token}) re-encrypts; update({token: null}) clears the bundle", async () => {
    const row = await gitRepoService.add({
      projectId, instanceId,
      repoUrl: "https://github.com/o/r.git", repoPath: "/opt/project",
      token: "first-token", createdBy: userId,
    });
    expect(await gitRepoService.getTokenForRepo(row.id)).toBe("first-token");

    await gitRepoService.update(row.id, { token: "rotated-token" });
    expect(await gitRepoService.getTokenForRepo(row.id)).toBe("rotated-token");

    const cleared = await gitRepoService.update(row.id, { token: null });
    expect(cleared?.hasToken).toBe(false);
    expect(await gitRepoService.getTokenForRepo(row.id)).toBeNull();
  });

  it("update({autoSave}) toggles the flag without touching the token", async () => {
    const row = await gitRepoService.add({
      projectId, instanceId,
      repoUrl: "https://github.com/o/r.git", repoPath: "/opt/project",
      token: "stay-the-same", autoSave: false, createdBy: userId,
    });
    const toggled = await gitRepoService.update(row.id, { autoSave: true });
    expect(toggled?.autoSave).toBe(true);
    expect(await gitRepoService.getTokenForRepo(row.id)).toBe("stay-the-same");
  });

  it("listAutoSaveWithTokens() returns only enabled rows with decrypted tokens", async () => {
    await gitRepoService.add({
      projectId, instanceId,
      repoUrl: "https://github.com/a/a.git", repoPath: "/opt/a",
      token: "tok-a", autoSave: true, createdBy: userId,
    });
    await gitRepoService.add({
      projectId, instanceId,
      repoUrl: "https://github.com/b/b.git", repoPath: "/opt/b",
      token: "tok-b", autoSave: false, createdBy: userId,
    });
    const enabled = await gitRepoService.listAutoSaveWithTokens(projectId, instanceId);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].repoPath).toBe("/opt/a");
    expect(enabled[0].token).toBe("tok-a");
  });

  it("remove() returns true the first time, false thereafter", async () => {
    const row = await gitRepoService.add({
      projectId, instanceId,
      repoUrl: "https://github.com/o/r.git", repoPath: "/opt/project",
      createdBy: userId,
    });
    expect(await gitRepoService.remove(row.id)).toBe(true);
    expect(await gitRepoService.remove(row.id)).toBe(false);
    expect(await gitRepoService.getById(row.id)).toBeNull();
  });

  it("listForInstance() scopes by (projectId, instanceId) — no leak across VMs", async () => {
    const otherProject = await makeProject();
    await gitRepoService.add({
      projectId, instanceId,
      repoUrl: "https://github.com/o/r.git", repoPath: "/opt/project", createdBy: userId,
    });
    await gitRepoService.add({
      projectId, instanceId: "vm-other",
      repoUrl: "https://github.com/o/r.git", repoPath: "/opt/project", createdBy: userId,
    });
    await gitRepoService.add({
      projectId: otherProject.id, instanceId,
      repoUrl: "https://github.com/o/r.git", repoPath: "/opt/project", createdBy: userId,
    });

    expect(await gitRepoService.listForInstance(projectId, instanceId)).toHaveLength(1);
  });
});
