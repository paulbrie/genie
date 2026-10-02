// Docs handlers — list/content/CRUD + shares + public toggles + binary
// downloads. Downloads route through a transient <a> element; tests spy on
// the click + URL.createObjectURL to assert the right bytes flowed without
// actually opening a browser save dialog.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handlers } from "./docs";
import { $docs } from "../subjects/docs";
import type { DocsState } from "../types/docs";

const FRESH: DocsState = {
  files: [], sharedFiles: [], publicFiles: [], folders: [], publicFolders: [],
  selectedDocId: null, title: "", content: "", folderId: null, isPublic: false,
  publicKey: null, projectId: null, editing: false, loading: false,
  permission: "write", isOwner: true, downloadingZip: false,
  activeShareDocId: null, currentDocShares: [],
};

beforeEach(() => {
  $docs.next({ ...FRESH });
});

describe("docs:list", () => {
  it("new format: populates own + shared + publicDocs + folders + publicFolders", () => {
    handlers["docs:list"]({
      own: [{ id: "f1", title: "A" }],
      shared: [{ id: "f2", title: "B" }],
      publicDocs: [{ id: "f3", title: "C" }],
      folders: [{ id: "fold-1", name: "Root" }],
      publicFolders: [{ id: "fold-2", name: "Public" }],
    });

    const v = $docs.getValue();
    expect(v.files).toEqual([{ id: "f1", title: "A" }]);
    expect(v.sharedFiles).toEqual([{ id: "f2", title: "B" }]);
    expect(v.publicFiles).toEqual([{ id: "f3", title: "C" }]);
    expect(v.folders).toEqual([{ id: "fold-1", name: "Root" }]);
    expect(v.publicFolders).toEqual([{ id: "fold-2", name: "Public" }]);
    expect(v.loading).toBe(false);
  });

  it("legacy format: { files } fills files only", () => {
    handlers["docs:list"]({ files: [{ id: "x", title: "T" }] });
    expect($docs.getValue().files).toEqual([{ id: "x", title: "T" }]);
    expect($docs.getValue().sharedFiles).toEqual([]);
  });
});

describe("docs:content / created", () => {
  it("docs:content selects + populates the doc with provided permissions", () => {
    handlers["docs:content"]({
      id: "d-1", title: "Hello", content: "# Hi", folderId: "fold-1",
      isPublic: true, publicKey: "pk_x", projectId: "p-1", isOwner: false, permission: "read",
    });

    expect($docs.getValue()).toMatchObject({
      selectedDocId: "d-1", title: "Hello", content: "# Hi", folderId: "fold-1",
      isPublic: true, publicKey: "pk_x", projectId: "p-1",
      isOwner: false, permission: "read", editing: false, loading: false,
    });
  });

  it("docs:content defaults isOwner=true + permission=write when fields missing", () => {
    handlers["docs:content"]({ id: "d-1", title: "T", content: "" });
    expect($docs.getValue().isOwner).toBe(true);
    expect($docs.getValue().permission).toBe("write");
    expect($docs.getValue().isPublic).toBe(false);
    expect($docs.getValue().publicKey).toBeNull();
  });

  it("docs:created always treats the doc as owner+write (newly created by us)", () => {
    handlers["docs:created"]({ id: "d-new", title: "Draft", content: "" });
    expect($docs.getValue().isOwner).toBe(true);
    expect($docs.getValue().permission).toBe("write");
  });
});

describe("docs:saved", () => {
  it("updates title+content when saving the currently selected doc", () => {
    $docs.next({ ...FRESH, selectedDocId: "d-1", title: "old", content: "old", editing: true, loading: true });

    handlers["docs:saved"]({ id: "d-1", title: "new", content: "fresh" });

    expect($docs.getValue()).toMatchObject({ title: "new", content: "fresh", editing: false, loading: false });
  });

  it("clears loading without touching content when saving a non-active doc", () => {
    $docs.next({ ...FRESH, selectedDocId: "d-1", title: "keep", content: "keep", loading: true });

    handlers["docs:saved"]({ id: "d-other", title: "x", content: "y" });

    expect($docs.getValue().title).toBe("keep");
    expect($docs.getValue().content).toBe("keep");
    expect($docs.getValue().loading).toBe(false);
  });
});

describe("docs:deleted", () => {
  it("clears the editor pane if the deleted doc was selected", () => {
    $docs.next({ ...FRESH, selectedDocId: "d-1", title: "T", content: "C", folderId: "f", isPublic: true, publicKey: "pk", projectId: "p" });

    handlers["docs:deleted"]({ docId: "d-1" });

    expect($docs.getValue()).toMatchObject({
      selectedDocId: null, title: "", content: "", folderId: null,
      isPublic: false, publicKey: null, projectId: null,
    });
  });

  it("only clears the loading flag when the deleted doc is not selected", () => {
    $docs.next({ ...FRESH, selectedDocId: "d-1", title: "keep", loading: true });

    handlers["docs:deleted"]({ docId: "d-other" });

    expect($docs.getValue().selectedDocId).toBe("d-1");
    expect($docs.getValue().title).toBe("keep");
    expect($docs.getValue().loading).toBe(false);
  });
});

describe("docs:shares", () => {
  it("writes currentDocShares when the share dialog is open for the target doc", () => {
    $docs.next({ ...FRESH, activeShareDocId: "d-1" });

    handlers["docs:shares"]({
      docId: "d-1",
      shares: [{ userId: "u-1", permission: "read" }],
    });

    expect($docs.getValue().currentDocShares).toEqual([{ userId: "u-1", permission: "read" }]);
  });

  it("ignores share lists for a different doc (stale response)", () => {
    $docs.next({ ...FRESH, activeShareDocId: "d-active" });

    handlers["docs:shares"]({ docId: "d-stale", shares: [{ userId: "u-1" }] });

    expect($docs.getValue().currentDocShares).toEqual([]);
  });
});

describe("docs:public-toggled", () => {
  it("updates the selected doc's isPublic/publicKey AND the row in the file list", () => {
    $docs.next({
      ...FRESH,
      selectedDocId: "d-1",
      files: [
        { id: "d-1", title: "Mine", isPublic: false, publicKey: null } as never,
        { id: "d-2", title: "Other", isPublic: false, publicKey: null } as never,
      ],
    });

    handlers["docs:public-toggled"]({ id: "d-1", isPublic: true, publicKey: "pk_abc" });

    expect($docs.getValue().isPublic).toBe(true);
    expect($docs.getValue().publicKey).toBe("pk_abc");
    expect($docs.getValue().files[0]).toMatchObject({ isPublic: true, publicKey: "pk_abc" });
    expect($docs.getValue().files[1]).toMatchObject({ isPublic: false });
  });

  it("updates only the file-list row when the toggled doc is not selected", () => {
    $docs.next({
      ...FRESH,
      selectedDocId: "d-other",
      isPublic: false,
      files: [{ id: "d-1", title: "x", isPublic: false, publicKey: null } as never],
    });

    handlers["docs:public-toggled"]({ id: "d-1", isPublic: true, publicKey: "pk" });

    // Selected doc's isPublic should NOT change (it's d-other).
    expect($docs.getValue().isPublic).toBe(false);
    expect($docs.getValue().files[0]).toMatchObject({ isPublic: true, publicKey: "pk" });
  });
});

describe("docs:folder:public-toggled", () => {
  it("patches the matching folder's isPublic", () => {
    $docs.next({
      ...FRESH,
      folders: [
        { id: "fold-1", name: "Root", isPublic: false } as never,
        { id: "fold-2", name: "Other", isPublic: true } as never,
      ],
    });

    handlers["docs:folder:public-toggled"]({ id: "fold-1", isPublic: true });

    expect($docs.getValue().folders[0]).toMatchObject({ id: "fold-1", isPublic: true });
    expect($docs.getValue().folders[1]).toMatchObject({ id: "fold-2", isPublic: true });
  });
});

describe("docs:download:zip", () => {
  it("clears downloadingZip and triggers a browser save via a transient <a>", () => {
    // Spy on the side-effect chain so we don't need a real download.
    const createUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:zip");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.fn();
    const aStub = { click: clickSpy, set href(_: string) {}, set download(_: string) {} } as unknown as HTMLAnchorElement;
    const createElSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return aStub;
      return {} as HTMLElement;
    });

    $docs.next({ ...FRESH, downloadingZip: true });
    // 4-byte payload, base64-encoded: "AAAA" → 3 bytes of 0x00, etc. We don't
    // verify the bytes — just that the download pipeline fired.
    handlers["docs:download:zip"]({ data: "AAAA" });

    expect($docs.getValue().downloadingZip).toBe(false);
    expect(createElSpy).toHaveBeenCalledWith("a");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:zip");

    createUrlSpy.mockRestore();
    revokeSpy.mockRestore();
    createElSpy.mockRestore();
  });

  it("is a no-op when payload.data is missing", () => {
    $docs.next({ ...FRESH, downloadingZip: true });
    const createElSpy = vi.spyOn(document, "createElement");

    handlers["docs:download:zip"]({});

    // Flag still gets reset; no DOM call.
    expect($docs.getValue().downloadingZip).toBe(false);
    expect(createElSpy).not.toHaveBeenCalled();
    createElSpy.mockRestore();
  });
});

describe("docs:download:item", () => {
  it("uses the server-supplied filename, falls back to 'download.zip'", () => {
    let assignedDownload: string | undefined;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:item");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const aStub = {
      click: vi.fn(),
      set href(_: string) {},
      set download(v: string) { assignedDownload = v; },
    } as unknown as HTMLAnchorElement;
    vi.spyOn(document, "createElement").mockReturnValue(aStub);

    handlers["docs:download:item"]({ fileName: "notes.md", data: "AAAA" });
    expect(assignedDownload).toBe("notes.md");

    handlers["docs:download:item"]({ data: "AAAA" }); // no fileName
    expect(assignedDownload).toBe("download.zip");

    vi.restoreAllMocks();
  });
});

describe("docs:error", () => {
  it("logs + clears both loading flags", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    $docs.next({ ...FRESH, loading: true, downloadingZip: true });

    handlers["docs:error"]({ message: "permission denied" });

    expect(warnSpy).toHaveBeenCalledWith("Docs error:", "permission denied");
    expect($docs.getValue().loading).toBe(false);
    expect($docs.getValue().downloadingZip).toBe(false);
    warnSpy.mockRestore();
  });
});
