// Minimal Namecheap DNS API client.
//
// Namecheap's API is XML (not JSON) and authenticates via query/body params:
//   ApiUser, ApiKey, UserName, ClientIp + Command + per-command params.
// The ClientIp MUST be whitelisted in the Namecheap account
// (Profile → Tools → API Access → Whitelisted IPs) and API access must be
// enabled. We pass the manager's MANAGER_PUBLIC_IP as ClientIp.
//
// CRITICAL: Namecheap has NO "add one record" endpoint. `setHosts` REPLACES the
// entire host-record set for a domain. So adding/removing a single record is a
// read-modify-write: getHosts → mutate the array → setHosts. getHosts() throws
// (rather than returning []) on a malformed/empty response so a follow-up
// setHosts can never silently WIPE the zone.

import { XMLParser } from "fast-xml-parser";

const NAMECHEAP_API = "https://api.namecheap.com/xml.response";

export interface NamecheapClientOpts {
  apiUser: string;
  apiKey: string;
  userName: string;
  clientIp: string;
}

/** One DNS host record, normalized from Namecheap's `<host>` attributes. */
export interface NamecheapHostRecord {
  name: string;     // host label: "@", "www", "app", …
  type: string;     // "A", "AAAA", "CNAME", "MX", "TXT", "URL", …
  address: string;  // record value
  mxPref?: number;  // MX priority (only meaningful for MX records)
  ttl?: number;     // seconds; Namecheap min is 60, default 1799
}

export interface NamecheapDnsClient {
  /** Read all host records for a registered domain (split into SLD + TLD). */
  getHosts(sld: string, tld: string): Promise<{ records: NamecheapHostRecord[]; emailType: string }>;
  /** Replace ALL host records for a domain. Caller is responsible for passing
   *  the full, already-merged set — Namecheap deletes anything omitted. */
  setHosts(sld: string, tld: string, records: NamecheapHostRecord[], emailType?: string): Promise<void>;
  /** Create or update a single A record (read-modify-write). Returns the new set. */
  upsertARecord(domain: string, host: string, address: string, ttl?: number): Promise<NamecheapHostRecord[]>;
  /** Remove records matching host+type (read-modify-write). Idempotent. */
  removeRecord(domain: string, host: string, type?: string): Promise<NamecheapHostRecord[]>;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Split a registrable domain into Namecheap's SLD + TLD by the FIRST dot, so
 *  multi-label TLDs survive: "example.com" → {example, com};
 *  "example.co.uk" → {example, co.uk}. */
export function splitRegisteredDomain(domain: string): { sld: string; tld: string } {
  const clean = domain.trim().replace(/\.$/, "").toLowerCase();
  const dot = clean.indexOf(".");
  if (dot < 1 || dot === clean.length - 1) {
    throw new Error(`Invalid registered domain "${domain}" — expected something like "example.com".`);
  }
  return { sld: clean.slice(0, dot), tld: clean.slice(dot + 1) };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function errorText(parsed: any): string {
  const errs = toArray(parsed?.ApiResponse?.Errors?.Error);
  const msg = errs
    .map((e: any) => (typeof e === "string" ? e : e?.["#text"] ?? (e?.Number ? `Error ${e.Number}` : "")))
    .filter(Boolean)
    .join("; ");
  return msg || "unknown error";
}

export function createNamecheapClient(opts: NamecheapClientOpts): NamecheapDnsClient {
  async function request(command: string, params: Record<string, string>): Promise<any> {
    const body = new URLSearchParams({
      ApiUser: opts.apiUser,
      ApiKey: opts.apiKey,
      UserName: opts.userName,
      ClientIp: opts.clientIp,
      Command: command,
      ...params,
    });
    let res: Response;
    try {
      res = await fetch(NAMECHEAP_API, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (err) {
      throw new Error(`Namecheap API request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await res.text();
    let parsed: any;
    try {
      parsed = parser.parse(text);
    } catch {
      throw new Error(`Namecheap API returned an unparseable response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (parsed?.ApiResponse?.Status !== "OK") {
      throw new Error(`Namecheap API error: ${errorText(parsed)}`);
    }
    return parsed;
  }

  async function getHosts(sld: string, tld: string): Promise<{ records: NamecheapHostRecord[]; emailType: string }> {
    const parsed = await request("namecheap.domains.dns.getHosts", { SLD: sld, TLD: tld });
    const result = parsed?.ApiResponse?.CommandResponse?.DomainDNSGetHostsResult;
    // Data-loss guard: a missing result block is NOT "zero records". Treating it
    // as [] and then calling setHosts would wipe the whole zone. Refuse instead.
    if (!result) {
      throw new Error("Namecheap getHosts returned no host result — refusing to continue (a setHosts now would erase existing DNS records).");
    }
    const records = toArray<any>(result.host).map((h) => ({
      name: String(h.Name),
      type: String(h.Type),
      address: String(h.Address),
      mxPref: h.MXPref !== undefined && h.MXPref !== "" ? Number(h.MXPref) : undefined,
      ttl: h.TTL !== undefined && h.TTL !== "" ? Number(h.TTL) : undefined,
    }));
    return { records, emailType: result.EmailType ? String(result.EmailType) : "" };
  }

  async function setHosts(sld: string, tld: string, records: NamecheapHostRecord[], emailType?: string): Promise<void> {
    const params: Record<string, string> = { SLD: sld, TLD: tld };
    records.forEach((r, i) => {
      const n = i + 1;
      params[`HostName${n}`] = r.name;
      params[`RecordType${n}`] = r.type;
      params[`Address${n}`] = r.address;
      if (r.ttl !== undefined) params[`TTL${n}`] = String(r.ttl);
      // MXPref is required for MX records (Namecheap rejects the call otherwise).
      if (r.type.toUpperCase() === "MX") params[`MXPref${n}`] = String(r.mxPref ?? 10);
    });
    // Preserve the email routing mode; if MX records exist but no type came back,
    // force "MX" so the records aren't rejected.
    const hasMx = records.some((r) => r.type.toUpperCase() === "MX");
    const et = emailType || (hasMx ? "MX" : "");
    if (et) params.EmailType = et;
    await request("namecheap.domains.dns.setHosts", params);
  }

  async function upsertARecord(domain: string, host: string, address: string, ttl = 300): Promise<NamecheapHostRecord[]> {
    const { sld, tld } = splitRegisteredDomain(domain);
    const { records, emailType } = await getHosts(sld, tld);
    const next = records.slice();
    const idx = next.findIndex((r) => r.type.toUpperCase() === "A" && r.name.toLowerCase() === host.toLowerCase());
    if (idx >= 0) {
      next[idx] = { ...next[idx], address, ttl };
    } else {
      next.push({ name: host, type: "A", address, ttl });
    }
    await setHosts(sld, tld, next, emailType);
    return next;
  }

  async function removeRecord(domain: string, host: string, type = "A"): Promise<NamecheapHostRecord[]> {
    const { sld, tld } = splitRegisteredDomain(domain);
    const { records, emailType } = await getHosts(sld, tld);
    const next = records.filter(
      (r) => !(r.type.toUpperCase() === type.toUpperCase() && r.name.toLowerCase() === host.toLowerCase()),
    );
    if (next.length === records.length) return records; // nothing matched — no-op
    await setHosts(sld, tld, next, emailType);
    return next;
  }

  return { getHosts, setHosts, upsertARecord, removeRecord };
}
