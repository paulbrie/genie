// project-file:* and file-template:* handlers.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../actions/project-files", () => ({
  loadProjectFiles: vi.fn(),
  selectFile: vi.fn(),
}));
vi.mock("../actions/file-template", () => ({
  loadFileTemplates: vi.fn(),
}));

import { handlers } from "./project-files";
import { $fileEditor, $fileTemplates } from "../subjects/vps";
import { loadProjectFiles, selectFile } from "../actions/project-files";
import { loadFileTemplates } from "../actions/file-template";

beforeEach(() => {
  $fileEditor.next({
    projectId: null, files: [], selectedFile: null, content: null,
    savedContent: null, loading: false, saving: false, error: null,
  });
  $fileTemplates.next({ templates: [], loading: false });
  vi.clearAllMocks();
});

describe("project-file:files", () => {
  it("writes files + selects the first one when nothing is selected", () => {
    $fileEditor.next({
      projectId: "p-1", files: [], selectedFile: null, content: null,
      savedContent: null, loading: true, saving: false, error: null,
    });

    handlers["project-file:files"]({
      projectId: "p-1",
      files: ["setup.sh", "README.md"],
    });

    expect($fileEditor.getValue()).toMatchObject({
      files: ["setup.sh", "README.md"],
      loading: false,
    });
    expect(selectFile).toHaveBeenCalledExactlyOnceWith("setup.sh");
  });

  it("does NOT auto-select when something is already selected", () => {
    $fileEditor.next({
      projectId: "p-1", files: [], selectedFile: "Dockerfile", content: null,
      savedContent: null, loading: true, saving: false, error: null,
    });

    handlers["project-file:files"]({
      projectId: "p-1",
      files: ["setup.sh", "Dockerfile"],
    });

    expect(selectFile).not.toHaveBeenCalled();
  });

  it("is a no-op when payload.projectId doesn't match current editor project", () => {
    $fileEditor.next({
      projectId: "p-active", files: [], selectedFile: null, content: null,
      savedContent: null, loading: true, saving: false, error: null,
    });

    handlers["project-file:files"]({
      projectId: "p-stale",
      files: ["leaked.txt"],
    });

    expect($fileEditor.getValue().files).toEqual([]);
    expect($fileEditor.getValue().loading).toBe(true);  // unchanged
  });
});

describe("project-file:content", () => {
  it("writes content + savedContent when matching project + file", () => {
    $fileEditor.next({
      projectId: "p-1", files: ["setup.sh"], selectedFile: "setup.sh",
      content: null, savedContent: null, loading: true, saving: false, error: null,
    });

    handlers["project-file:content"]({
      projectId: "p-1",
      fileName: "setup.sh",
      content: "#!/bin/bash\necho hi",
    });

    expect($fileEditor.getValue()).toMatchObject({
      content: "#!/bin/bash\necho hi",
      savedContent: "#!/bin/bash\necho hi",
      loading: false,
    });
  });

  it("ignores content for a different selected file (stale response)", () => {
    $fileEditor.next({
      projectId: "p-1", files: ["a.txt"], selectedFile: "a.txt",
      content: null, savedContent: null, loading: true, saving: false, error: null,
    });

    handlers["project-file:content"]({
      projectId: "p-1",
      fileName: "b.txt", // user moved on
      content: "stale",
    });

    expect($fileEditor.getValue().content).toBeNull();
  });
});

describe("project-file:saved", () => {
  it("ok=true: clears saving, advances savedContent to current content", () => {
    $fileEditor.next({
      projectId: "p-1", files: ["a.txt"], selectedFile: "a.txt",
      content: "new", savedContent: "old", loading: false, saving: true, error: null,
    });

    handlers["project-file:saved"]({ projectId: "p-1", fileName: "a.txt", ok: true });

    expect($fileEditor.getValue()).toMatchObject({
      saving: false, savedContent: "new", error: null,
    });
  });

  it("ok=false: clears saving, preserves savedContent, stores error", () => {
    $fileEditor.next({
      projectId: "p-1", files: ["a.txt"], selectedFile: "a.txt",
      content: "new", savedContent: "old", loading: false, saving: true, error: null,
    });

    handlers["project-file:saved"]({ projectId: "p-1", fileName: "a.txt", ok: false, error: "disk full" });

    expect($fileEditor.getValue()).toMatchObject({
      saving: false, savedContent: "old", error: "disk full",
    });
  });
});

describe("project-file refetch triggers", () => {
  it.each(["project-file:deleted", "project-file:added", "project-file:imported"] as const)(
    "%s for the active project triggers loadProjectFiles",
    (msg) => {
      $fileEditor.next({
        projectId: "p-1", files: [], selectedFile: null, content: null,
        savedContent: null, loading: false, saving: false, error: null,
      });

      handlers[msg]({ projectId: "p-1" });

      expect(loadProjectFiles).toHaveBeenCalledExactlyOnceWith("p-1");
    },
  );

  it("each refetch trigger is a no-op when the project isn't the active editor", () => {
    $fileEditor.next({
      projectId: "p-other", files: [], selectedFile: null, content: null,
      savedContent: null, loading: false, saving: false, error: null,
    });

    handlers["project-file:added"]({ projectId: "p-1" });

    expect(loadProjectFiles).not.toHaveBeenCalled();
  });
});

describe("file-template:* handlers", () => {
  it("list replaces templates + clears loading", () => {
    $fileTemplates.next({ templates: [], loading: true });
    handlers["file-template:list"]({
      templates: [{ id: "t-1", name: "Dockerfile starter", body: "FROM node" }],
    });
    expect($fileTemplates.getValue()).toEqual({
      templates: [{ id: "t-1", name: "Dockerfile starter", body: "FROM node" }],
      loading: false,
    });
  });

  it.each(["file-template:created", "file-template:updated", "file-template:deleted"] as const)(
    "%s triggers loadFileTemplates",
    (msg) => {
      handlers[msg]({});
      expect(loadFileTemplates).toHaveBeenCalledTimes(1);
    },
  );

  it("file-template:injected with ok=true reloads the active project's files", () => {
    $fileEditor.next({
      projectId: "p-1", files: [], selectedFile: null, content: null,
      savedContent: null, loading: false, saving: false, error: null,
    });

    handlers["file-template:injected"]({ projectId: "p-1", ok: true });

    expect(loadProjectFiles).toHaveBeenCalledExactlyOnceWith("p-1");
  });

  it("file-template:injected with ok=false is a no-op", () => {
    handlers["file-template:injected"]({ projectId: "p-1", ok: false });
    expect(loadProjectFiles).not.toHaveBeenCalled();
  });
});
