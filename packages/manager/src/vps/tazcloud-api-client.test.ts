import { describe, it, expect, vi, afterEach } from "vitest";
import { createTazClient, TAZ_RESIZE_TIMEOUT_MS } from "./tazcloud-api-client.js";

// Never talks to the real API: fetch is stubbed and the token is a dummy.
interface Call { url: string; init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal } }

function stubFetch(respond: () => { status: number; body: unknown } | Promise<never>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: Call["init"]) => {
      calls.push({ url, init });
      const r = await respond();
      const text = r.body === undefined ? "" : JSON.stringify(r.body);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text } as unknown as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TazApiClient.resizeVm", () => {
  it("POSTs the size to /v1/vm/{id}/resize and returns the new size", async () => {
    const calls = stubFetch(() => ({ status: 200, body: { status: "resized", id: "vm-1", size: "2xlarge" } }));
    const result = await createTazClient("dummy-token").resizeVm("vm-1", "2xlarge");

    expect(result).toEqual({ status: "resized", id: "vm-1", size: "2xlarge" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.taz.ro/v1/vm/vm-1/resize");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body ?? "{}")).toEqual({ size: "2xlarge" });
    expect(calls[0].init.headers.Authorization).toBe("Bearer dummy-token");
    // The call blocks while the VM reboots, so it carries its own timeout.
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("surfaces the API's error detail", async () => {
    stubFetch(() => ({ status: 422, body: { detail: "size must be one of: small, medium, large, xlarge, 2xlarge" } }));
    await expect(createTazClient("dummy-token").resizeVm("vm-1", "huge")).rejects.toThrow(
      "TazCloud API error (422): size must be one of: small, medium, large, xlarge, 2xlarge",
    );
  });

  it("explains a timeout instead of a bare abort", async () => {
    stubFetch(() => Promise.reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })));
    await expect(createTazClient("dummy-token").resizeVm("vm-1", "2xlarge")).rejects.toThrow(
      `TazCloud resize timed out after ${TAZ_RESIZE_TIMEOUT_MS / 60_000} min. The VM may still be resizing`,
    );
  });

  it("rejects an empty size without calling the API", async () => {
    const calls = stubFetch(() => ({ status: 200, body: {} }));
    await expect(createTazClient("dummy-token").resizeVm("vm-1", "")).rejects.toThrow("size is required");
    expect(calls).toHaveLength(0);
  });

  it("fails clearly when the API returns no body", async () => {
    stubFetch(() => ({ status: 204, body: undefined }));
    await expect(createTazClient("dummy-token").resizeVm("vm-1", "xlarge")).rejects.toThrow("TazCloud resize returned no body");
  });
});
