import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNamecheapClient, splitRegisteredDomain } from "./namecheap-dns-client.js";

const OPTS = { apiUser: "u", apiKey: "k", userName: "u", clientIp: "9.9.9.9" };

// A representative getHosts response: A (apex) + CNAME + MX (with MXPref) + TXT.
// These must all survive a single-record upsert/remove (read-modify-write).
const GET_HOSTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" EmailType="MX" IsUsingOurDNS="true">
      <host HostId="1" Name="@" Type="A" Address="1.1.1.1" MXPref="10" TTL="1800" />
      <host HostId="2" Name="www" Type="CNAME" Address="example.com." MXPref="10" TTL="1800" />
      <host HostId="3" Name="@" Type="MX" Address="mail.example.com." MXPref="5" TTL="1800" />
      <host HostId="4" Name="@" Type="TXT" Address="v=spf1 ~all" MXPref="10" TTL="1800" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`;

const SET_HOSTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK"><Errors /><CommandResponse Type="namecheap.domains.dns.setHosts"><DomainDNSSetHostsResult Domain="example.com" IsSuccess="true" /></CommandResponse></ApiResponse>`;

const ERROR_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="ERROR"><Errors><Error Number="2030280">Domain not found</Error></Errors></ApiResponse>`;

// Malformed OK response: no DomainDNSGetHostsResult block. Treating this as
// "zero records" and proceeding to setHosts would WIPE the zone — the client
// must throw instead.
const MALFORMED_OK_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK"><Errors /><CommandResponse Type="namecheap.domains.dns.getHosts" /></ApiResponse>`;

interface Captured { command: string; body: URLSearchParams }

function installFetch(responder: (command: string) => string): { calls: Captured[] } {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = new URLSearchParams(init.body);
      const command = body.get("Command") || "";
      calls.push({ command, body });
      const xml = responder(command);
      return { ok: true, status: 200, text: async () => xml } as unknown as Response;
    }),
  );
  return { calls };
}

/** Flatten a setHosts request body back into records for assertions. */
function recordsFromSetHosts(body: URLSearchParams) {
  const recs: { name: string; type: string; address: string; ttl?: string; mxPref?: string }[] = [];
  for (let i = 1; body.has(`HostName${i}`); i++) {
    recs.push({
      name: body.get(`HostName${i}`)!,
      type: body.get(`RecordType${i}`)!,
      address: body.get(`Address${i}`)!,
      ttl: body.get(`TTL${i}`) ?? undefined,
      mxPref: body.get(`MXPref${i}`) ?? undefined,
    });
  }
  return recs;
}

const defaultResponder = (command: string) =>
  command === "namecheap.domains.dns.getHosts" ? GET_HOSTS_XML : SET_HOSTS_XML;

describe("splitRegisteredDomain", () => {
  it("splits a two-label domain", () => {
    expect(splitRegisteredDomain("example.com")).toEqual({ sld: "example", tld: "com" });
  });
  it("keeps multi-label TLDs together", () => {
    expect(splitRegisteredDomain("example.co.uk")).toEqual({ sld: "example", tld: "co.uk" });
  });
  it("rejects a bare label", () => {
    expect(() => splitRegisteredDomain("localhost")).toThrow();
  });
});

describe("upsertARecord", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("appends a new A record while preserving every existing record", async () => {
    const { calls } = installFetch(defaultResponder);
    const client = createNamecheapClient(OPTS);
    const next = await client.upsertARecord("example.com", "app", "2.2.2.2");

    // getHosts then setHosts.
    expect(calls.map((c) => c.command)).toEqual([
      "namecheap.domains.dns.getHosts",
      "namecheap.domains.dns.setHosts",
    ]);
    const sent = recordsFromSetHosts(calls[1].body);
    // 4 originals + 1 new.
    expect(sent).toHaveLength(5);
    // Originals preserved (incl. the MX with its MXPref).
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "@", type: "A", address: "1.1.1.1" }),
      expect.objectContaining({ name: "www", type: "CNAME", address: "example.com." }),
      expect.objectContaining({ name: "@", type: "MX", address: "mail.example.com.", mxPref: "5" }),
      expect.objectContaining({ name: "@", type: "TXT", address: "v=spf1 ~all" }),
      expect.objectContaining({ name: "app", type: "A", address: "2.2.2.2" }),
    ]));
    // EmailType round-tripped so MX records aren't rejected.
    expect(calls[1].body.get("EmailType")).toBe("MX");
    expect(next).toHaveLength(5);
  });

  it("updates an existing A record in place (no duplicate)", async () => {
    const { calls } = installFetch(defaultResponder);
    const client = createNamecheapClient(OPTS);
    await client.upsertARecord("example.com", "@", "9.9.9.9");
    const sent = recordsFromSetHosts(calls[1].body);
    const apexA = sent.filter((r) => r.name === "@" && r.type === "A");
    expect(apexA).toHaveLength(1);
    expect(apexA[0].address).toBe("9.9.9.9");
    expect(sent).toHaveLength(4); // unchanged count
  });

  it("REFUSES to setHosts when getHosts is malformed (data-loss guard)", async () => {
    const { calls } = installFetch((cmd) => (cmd === "namecheap.domains.dns.getHosts" ? MALFORMED_OK_XML : SET_HOSTS_XML));
    const client = createNamecheapClient(OPTS);
    await expect(client.upsertARecord("example.com", "app", "2.2.2.2")).rejects.toThrow(/refusing to continue/i);
    // Only the getHosts call happened — setHosts was never sent.
    expect(calls.map((c) => c.command)).toEqual(["namecheap.domains.dns.getHosts"]);
  });

  it("throws on an API ERROR status", async () => {
    installFetch(() => ERROR_XML);
    const client = createNamecheapClient(OPTS);
    await expect(client.upsertARecord("example.com", "app", "2.2.2.2")).rejects.toThrow(/Domain not found/);
  });
});

describe("removeRecord", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("removes only the matching A record, preserving the rest", async () => {
    const { calls } = installFetch(defaultResponder);
    const client = createNamecheapClient(OPTS);
    await client.removeRecord("example.com", "@", "A");
    const sent = recordsFromSetHosts(calls[1].body);
    expect(sent).toHaveLength(3);
    expect(sent.some((r) => r.type === "A")).toBe(false);
    // The MX/CNAME/TXT survive.
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "CNAME" }),
      expect.objectContaining({ type: "MX" }),
      expect.objectContaining({ type: "TXT" }),
    ]));
  });

  it("is a no-op (no setHosts) when nothing matches", async () => {
    const { calls } = installFetch(defaultResponder);
    const client = createNamecheapClient(OPTS);
    await client.removeRecord("example.com", "doesnotexist", "A");
    expect(calls.map((c) => c.command)).toEqual(["namecheap.domains.dns.getHosts"]);
  });
});
