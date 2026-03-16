import net from "node:net";
import tls from "node:tls";
import { v4 as uuidv4 } from "uuid";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { securityScans } from "./db/schema.js";

// --- Types ---

export type ScanStatus = "idle" | "running" | "stopping" | "completed" | "error";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface PortResult {
  port: number;
  state: "open" | "closed" | "filtered";
  service: string;
  banner?: string;
}

export interface WebFinding {
  id: string;
  category: "header" | "directory" | "ssl" | "disclosure" | "sqli" | "xss" | "redirect" | "other";
  severity: Severity;
  title: string;
  description: string;
  url: string;
  evidence?: string;
}

export interface SecurityScan {
  id: string;
  target: string;
  status: ScanStatus;
  startedAt: number;
  completedAt?: number;
  progress: number;
  phase: string;
  ports: PortResult[];
  findings: WebFinding[];
  operations: string[];
  error?: string;
}

// --- Port-to-service lookup ---

const PORT_SERVICES: Record<number, string> = {
  21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
  80: "http", 110: "pop3", 111: "rpcbind", 119: "nntp", 135: "msrpc",
  139: "netbios-ssn", 143: "imap", 161: "snmp", 389: "ldap", 443: "https",
  445: "microsoft-ds", 465: "smtps", 514: "syslog", 515: "printer",
  587: "submission", 631: "ipp", 636: "ldaps", 993: "imaps", 995: "pop3s",
  1080: "socks", 1433: "ms-sql", 1434: "ms-sql-m", 1521: "oracle",
  1723: "pptp", 2049: "nfs", 2082: "cpanel", 2083: "cpanel-ssl",
  2086: "whm", 2087: "whm-ssl", 3000: "http-alt", 3306: "mysql",
  3389: "ms-wbt-server", 3690: "svn", 4443: "https-alt", 5000: "http-alt",
  5432: "postgresql", 5900: "vnc", 5901: "vnc-1", 6379: "redis",
  6667: "irc", 8000: "http-alt", 8008: "http-alt", 8080: "http-proxy",
  8443: "https-alt", 8888: "http-alt", 9090: "http-alt", 9200: "elasticsearch",
  9300: "elasticsearch", 10000: "webmin", 11211: "memcached", 27017: "mongodb",
};

// Top 1000 ports (condensed to most common)
const TOP_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 111, 119, 135, 139, 143, 161, 389, 443,
  445, 465, 514, 515, 587, 631, 636, 993, 995, 1080, 1433, 1434, 1521,
  1723, 2049, 2082, 2083, 2086, 2087, 3000, 3306, 3389, 3690, 4443,
  5000, 5432, 5900, 5901, 6379, 6667, 8000, 8008, 8080, 8443, 8888,
  9090, 9200, 9300, 10000, 11211, 27017,
  // Extended common ports
  81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 100, 199, 211, 212, 214,
  256, 259, 264, 280, 311, 340, 366, 406, 407, 416, 417, 427, 444,
  497, 500, 513, 543, 544, 548, 554, 555, 556, 563, 564, 585, 593,
  616, 617, 625, 666, 683, 684, 687, 691, 700, 705, 711, 714, 720,
  722, 726, 749, 765, 777, 783, 787, 800, 801, 808, 843, 873, 880,
  888, 898, 900, 901, 902, 903, 911, 981, 987, 990, 991, 992, 999,
  1000, 1001, 1002, 1007, 1009, 1010, 1011, 1021, 1022, 1023, 1024,
  1025, 1026, 1027, 1028, 1029, 1030, 1031, 1032, 1033, 1034, 1035,
  1036, 1037, 1038, 1039, 1040, 1041, 1042, 1043, 1044, 1045, 1046,
  1047, 1048, 1049, 1050, 1051, 1052, 1053, 1054, 1055, 1056, 1057,
  1058, 1059, 1060, 1061, 1062, 1063, 1064, 1065, 1066, 1067, 1068,
  1069, 1070, 1071, 1072, 1073, 1074, 1075, 1076, 1077, 1078, 1079,
  1081, 1082, 1083, 1084, 1085, 1086, 1087, 1088, 1089, 1090, 1091,
  1092, 1093, 1094, 1095, 1096, 1097, 1098, 1099, 1100, 1102, 1104,
  1105, 1106, 1107, 1108, 1110, 1111, 1112, 1113, 1114, 1117, 1119,
  1121, 1122, 1123, 1124, 1126, 1130, 1131, 1132, 1137, 1138, 1141,
  1145, 1147, 1148, 1149, 1151, 1152, 1154, 1163, 1164, 1165, 1166,
  1169, 1174, 1175, 1183, 1185, 1186, 1187, 1192, 1198, 1199, 1201,
  1213, 1216, 1217, 1218, 1233, 1234, 1236, 1244, 1247, 1248, 1259,
  1271, 1272, 1277, 1287, 1296, 1300, 1301, 1309, 1310, 1311, 1322,
  1328, 1334, 1352, 1417, 1443, 1455, 1461, 1494, 1500, 1501, 1503,
  1524, 1533, 1556, 1580, 1583, 1594, 1600, 1641, 1658, 1666, 1687,
  1688, 1700, 1717, 1718, 1719, 1720, 1721, 1761, 1782, 1783, 1801,
  1805, 1812, 1839, 1840, 1862, 1863, 1864, 1875, 1900, 1914, 1935,
  1947, 1971, 1972, 1974, 1984, 1998, 1999, 2000, 2001, 2002, 2003,
  2004, 2005, 2006, 2007, 2008, 2009, 2010, 2013, 2020, 2021, 2022,
  2030, 2033, 2034, 2035, 2038, 2040, 2041, 2042, 2043, 2045, 2046,
  2047, 2048, 2065, 2068, 2099, 2100, 2103, 2105, 2106, 2107, 2111,
  2119, 2121, 2126, 2135, 2144, 2160, 2161, 2170, 2179, 2190, 2191,
  2196, 2200, 2222, 2251, 2260, 2288, 2301, 2323, 2366, 2381, 2382,
  2383, 2393, 2394, 2399, 2401, 2492, 2500, 2522, 2525, 2557, 2601,
  2602, 2604, 2605, 2607, 2608, 2638, 2701, 2702, 2710, 2717, 2718,
  2725, 2800, 2809, 2811, 2869, 2875, 2909, 2910, 2920, 2967, 2998,
  2999, 3001, 3003, 3005, 3006, 3007, 3011, 3013, 3017, 3030, 3031,
  3052, 3071, 3077, 3128, 3168, 3211, 3221, 3260, 3261, 3268, 3269,
  3283, 3300, 3301, 3323, 3325, 3333, 3351, 3367, 3369, 3370, 3371,
  3372, 3389, 3390, 3404, 3476, 3493, 3517, 3527, 3546, 3551, 3580,
  3659, 3689, 3703, 3737, 3766, 3784, 3800, 3801, 3809, 3814, 3826,
  3827, 3828, 3851, 3869, 3871, 3878, 3880, 3889, 3905, 3914, 3918,
  3920, 3945, 3971, 3986, 3995, 3998, 4000, 4001, 4002, 4003, 4004,
  4005, 4006, 4045, 4111, 4125, 4126, 4129, 4224, 4242, 4279, 4321,
  4343, 4444, 4445, 4446, 4449, 4550, 4567, 4662, 4848, 4899, 4900,
  4998, 5000, 5001, 5002, 5003, 5004, 5009, 5030, 5033, 5050, 5051,
  5054, 5060, 5061, 5080, 5087, 5100, 5101, 5102, 5120, 5190, 5200,
  5214, 5221, 5222, 5225, 5226, 5269, 5280, 5298, 5357, 5405, 5414,
  5431, 5440, 5500, 5510, 5544, 5550, 5555, 5560, 5566, 5631, 5633,
  5666, 5678, 5679, 5718, 5730, 5800, 5801, 5802, 5810, 5811, 5815,
  5822, 5825, 5850, 5859, 5862, 5877, 5902, 5903, 5904, 5906, 5907,
  5910, 5911, 5915, 5922, 5925, 5950, 5952, 5959, 5960, 5961, 5962,
  5963, 5987, 5988, 5989, 5998, 5999, 6000, 6001, 6002, 6003, 6004,
  6005, 6006, 6007, 6009, 6025, 6059, 6100, 6101, 6106, 6112, 6123,
  6129, 6156, 6346, 6389, 6502, 6510, 6543, 6547, 6565, 6566, 6567,
  6580, 6646, 6666, 6669, 6689, 6692, 6699, 6779, 6788, 6789, 6792,
  6839, 6881, 6901, 6969, 7000, 7001, 7002, 7004, 7007, 7019, 7025,
  7070, 7100, 7103, 7106, 7200, 7201, 7402, 7435, 7443, 7496, 7512,
  7625, 7627, 7676, 7741, 7777, 7778, 7800, 7911, 7920, 7921, 7937,
  7938, 7999, 8001, 8002, 8007, 8009, 8010, 8011, 8021, 8022, 8031,
  8042, 8045, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089,
  8090, 8093, 8099, 8100, 8180, 8181, 8192, 8193, 8194, 8200, 8222,
  8254, 8290, 8291, 8292, 8300, 8333, 8383, 8400, 8402, 8500, 8600,
  8649, 8651, 8652, 8654, 8701, 8800, 8873, 8899, 8994, 9000, 9001,
  9002, 9003, 9009, 9010, 9011, 9040, 9050, 9071, 9080, 9081, 9091,
  9099, 9100, 9101, 9102, 9103, 9110, 9111, 9191, 9199, 9207, 9220,
  9290, 9415, 9418, 9485, 9500, 9502, 9503, 9535, 9575, 9593, 9594,
  9595, 9618, 9666, 9876, 9877, 9878, 9898, 9900, 9917, 9929, 9943,
  9944, 9968, 9998, 9999, 10001, 10002, 10003, 10004, 10009, 10010,
  10012, 10024, 10025, 10082, 10180, 10215, 10243, 10566, 10616,
  10617, 10621, 10626, 10628, 10629, 10778,
];

const HTTP_PORTS = new Set([80, 443, 3000, 5000, 8000, 8008, 8080, 8443, 8888, 9090, 9200, 3001, 4443, 5001, 8081, 8082, 8083, 8084, 8085, 8180, 8181, 8800, 9000, 9080]);

// --- Directory enumeration paths ---

const COMMON_PATHS = [
  "/admin", "/administrator", "/login", "/wp-admin", "/wp-login.php",
  "/.env", "/.git/config", "/.git/HEAD", "/.gitignore", "/.htaccess",
  "/.svn/entries", "/backup", "/backups", "/config", "/configuration",
  "/console", "/dashboard", "/db", "/debug", "/dump", "/api",
  "/api/v1", "/api/v2", "/swagger", "/swagger-ui", "/swagger.json",
  "/openapi.json", "/graphql", "/graphiql", "/phpmyadmin", "/pma",
  "/adminer", "/server-status", "/server-info", "/status", "/health",
  "/healthcheck", "/info", "/info.php", "/phpinfo.php", "/test",
  "/test.php", "/robots.txt", "/sitemap.xml", "/crossdomain.xml",
  "/wp-content", "/wp-includes", "/xmlrpc.php", "/cgi-bin",
  "/manager", "/jmx-console", "/web-console", "/.DS_Store",
  "/.well-known/security.txt", "/security.txt", "/package.json",
  "/composer.json", "/Dockerfile", "/docker-compose.yml",
];

// --- SQL error patterns ---

const SQL_ERROR_PATTERNS = [
  /you have an error in your sql syntax/i,
  /unclosed quotation mark/i,
  /quoted string not properly terminated/i,
  /syntax error.*near/i,
  /mysql_fetch/i,
  /pg_query/i,
  /sqlite3?\.OperationalError/i,
  /ORA-\d{5}/,
  /Microsoft OLE DB Provider/i,
  /ODBC SQL Server Driver/i,
  /SQLServer JDBC Driver/i,
  /PostgreSQL.*ERROR/i,
  /Warning.*\Wmysql/i,
  /valid MySQL result/i,
  /MySqlClient\./i,
  /com\.mysql\.jdbc/i,
];

// --- Required security headers ---

const SECURITY_HEADERS = [
  { header: "strict-transport-security", title: "Missing Strict-Transport-Security", severity: "medium" as Severity, description: "The HTTP Strict-Transport-Security header is not set. This allows downgrade attacks and cookie hijacking." },
  { header: "x-content-type-options", title: "Missing X-Content-Type-Options", severity: "low" as Severity, description: "The X-Content-Type-Options header is not set to 'nosniff'. This may allow MIME-type sniffing attacks." },
  { header: "x-frame-options", title: "Missing X-Frame-Options", severity: "medium" as Severity, description: "The X-Frame-Options header is not set. This may allow clickjacking attacks." },
  { header: "content-security-policy", title: "Missing Content-Security-Policy", severity: "medium" as Severity, description: "No Content-Security-Policy header found. This increases the risk of XSS and data injection attacks." },
  { header: "referrer-policy", title: "Missing Referrer-Policy", severity: "low" as Severity, description: "The Referrer-Policy header is not set. The browser may leak the full URL in the Referer header." },
];

const DISCLOSURE_HEADERS = ["server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version"];

// --- Helpers ---

function resolveService(port: number, banner?: string): string {
  if (banner) {
    const bl = banner.toLowerCase();
    if (bl.includes("ssh")) return "ssh";
    if (bl.includes("ftp")) return "ftp";
    if (bl.includes("smtp")) return "smtp";
    if (bl.includes("http")) return "http";
    if (bl.includes("mysql")) return "mysql";
    if (bl.includes("postgresql") || bl.includes("postgres")) return "postgresql";
    if (bl.includes("redis")) return "redis";
    if (bl.includes("mongodb")) return "mongodb";
  }
  return PORT_SERVICES[port] || "unknown";
}

async function tcpConnect(host: string, port: number, timeoutMs: number): Promise<{ open: boolean; banner?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let banner: string | undefined;
    let settled = false;

    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({ open, banner });
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      // Wait briefly for banner
      socket.setTimeout(500);
    });
    socket.on("data", (data) => {
      banner = data.toString("utf-8").trim().slice(0, 256);
      finish(true);
    });
    socket.on("timeout", () => {
      if (socket.connecting) {
        finish(false);
      } else {
        // Connected but no banner
        finish(true);
      }
    });
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
    socket.connect(port, host);
  });
}

async function httpRequest(url: string, method: string = "GET", timeoutMs: number = 5000, followRedirects: boolean = false): Promise<{ status: number; headers: Record<string, string>; body: string; redirectUrl?: string } | null> {
  try {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const mod = isHttps ? await import("node:https") : await import("node:http");

    return new Promise((resolve) => {
      let settled = false;
      const done = (result: { status: number; headers: Record<string, string>; body: string; redirectUrl?: string } | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        resolve(result);
      };

      // Hard timeout — kills the request no matter what
      const hardTimer = setTimeout(() => {
        if (!settled) { req.destroy(); done(null); }
      }, timeoutMs + 1000);

      const req = mod.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method,
          timeout: timeoutMs,
          rejectUnauthorized: false,
          headers: {
            "User-Agent": "Genie-Security-Scanner/1.0",
            "Accept": "*/*",
          },
        },
        (res) => {
          const headers: Record<string, string> = {};
          for (const [key, val] of Object.entries(res.headers)) {
            if (typeof val === "string") headers[key.toLowerCase()] = val;
            else if (Array.isArray(val)) headers[key.toLowerCase()] = val.join(", ");
          }

          if (!followRedirects && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
            done({ status: res.statusCode, headers, body: "", redirectUrl: headers.location });
            req.destroy();
            return;
          }

          let body = "";
          res.setEncoding("utf-8");
          res.on("data", (chunk: string) => {
            body += chunk;
            if (body.length > 50000) {
              body = body.slice(0, 50000);
              res.destroy();
            }
          });
          res.on("end", () => done({ status: res.statusCode || 0, headers, body }));
          res.on("error", () => done(null));
        },
      );
      req.on("timeout", () => { req.destroy(); done(null); });
      req.on("error", () => done(null));
      req.end();
    });
  } catch {
    return null;
  }
}

// --- Main scan engine ---

export interface ScanCallbacks {
  onProgress: (update: Partial<SecurityScan>) => void;
  signal: AbortSignal;
}

function logOp(scan: SecurityScan, callbacks: ScanCallbacks, message: string): void {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const entry = `[${ts}] ${message}`;
  scan.operations.push(entry);
  callbacks.onProgress({ id: scan.id, operations: [...scan.operations] });
}

/**
 * Parse a target string which may be an IP, hostname, or full URL.
 * Returns the bare hostname for TCP scanning and optional scheme/port hints.
 */
function parseTarget(raw: string): { hostname: string; scheme?: string; explicitPort?: number } {
  const trimmed = raw.trim();
  // If it looks like a URL (has ://), parse it
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return {
        hostname: url.hostname,
        scheme: url.protocol.replace(":", ""),
        explicitPort: url.port ? parseInt(url.port, 10) : undefined,
      };
    } catch {
      // Fall through to plain hostname extraction
    }
  }
  // Strip any trailing path/port: "host:port/path" → "host"
  const noPath = trimmed.split("/")[0];
  const colonIdx = noPath.lastIndexOf(":");
  if (colonIdx > 0) {
    const portStr = noPath.slice(colonIdx + 1);
    const port = parseInt(portStr, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      return { hostname: noPath.slice(0, colonIdx), explicitPort: port };
    }
  }
  return { hostname: noPath };
}

export async function runSecurityScan(target: string, callbacks: ScanCallbacks): Promise<SecurityScan> {
  const parsed = parseTarget(target);
  const hostname = parsed.hostname;

  const scan: SecurityScan = {
    id: uuidv4(),
    target,
    status: "running",
    startedAt: Date.now(),
    progress: 0,
    phase: "Initializing",
    ports: [],
    findings: [],
    operations: [],
  };

  callbacks.onProgress({ id: scan.id, status: "running", startedAt: scan.startedAt, phase: "Port scanning", progress: 0 });
  logOp(scan, callbacks, `Starting security scan on ${target} (host: ${hostname})`);

  try {
    // Phase 1: Port scanning
    logOp(scan, callbacks, `Beginning TCP port scan (${[...new Set(TOP_PORTS)].length} ports)`);
    await scanPorts(hostname, scan, callbacks);
    if (callbacks.signal.aborted) {
      logOp(scan, callbacks, "Scan aborted by user");
      scan.status = "stopping";
      scan.completedAt = Date.now();
      return scan;
    }
    logOp(scan, callbacks, `Port scan complete — ${scan.ports.length} open port(s) found`);

    // Phase 2: Web vulnerability checks
    // Start with discovered HTTP ports from the scan
    const httpPorts = scan.ports.filter((p) => p.state === "open" && HTTP_PORTS.has(p.port));
    const includedPorts = new Set(httpPorts.map((p) => p.port));

    // Always probe standard HTTP/HTTPS even if port scan didn't detect them
    // (CDNs, load balancers, cloud proxies often don't respond to raw TCP SYN)
    const alwaysProbe: { port: number; service: string }[] = [
      { port: 80, service: "http" },
      { port: 443, service: "https" },
    ];

    // If target had an explicit port, include that too
    if (parsed.explicitPort && !includedPorts.has(parsed.explicitPort)) {
      alwaysProbe.push({ port: parsed.explicitPort, service: parsed.scheme === "https" ? "https" : "http" });
    }

    for (const { port, service } of alwaysProbe) {
      if (includedPorts.has(port)) continue;
      // Quick HTTP probe to see if the service responds
      const isHttps = port === 443 || port === 8443 || port === 4443 || service === "https";
      const probeUrl = `${isHttps ? "https" : "http"}://${hostname}${port === 80 || port === 443 ? "" : `:${port}`}/`;
      const probeResp = await httpRequest(probeUrl, "HEAD", 3000);
      if (probeResp && probeResp.status > 0) {
        logOp(scan, callbacks, `HTTP probe: ${probeUrl} responds (HTTP ${probeResp.status})`);
        httpPorts.push({ port, state: "open", service });
        includedPorts.add(port);
      }
    }

    if (httpPorts.length > 0) {
      logOp(scan, callbacks, `Starting web vulnerability checks on ${httpPorts.length} HTTP service(s)`);
      await runWebChecks(hostname, httpPorts, scan, callbacks);
      logOp(scan, callbacks, `Web checks complete — ${scan.findings.length} finding(s) total`);
    } else {
      logOp(scan, callbacks, "No HTTP services detected, skipping web vulnerability checks");
    }

    scan.status = "completed";
    scan.completedAt = Date.now();
    scan.progress = 100;
    scan.phase = "Complete";
    logOp(scan, callbacks, `Scan finished: ${scan.ports.length} open ports, ${scan.findings.length} findings`);
    callbacks.onProgress({ id: scan.id, status: "completed", completedAt: scan.completedAt, progress: 100, phase: "Complete" });
  } catch (err: unknown) {
    scan.status = "error";
    scan.error = err instanceof Error ? err.message : String(err);
    scan.completedAt = Date.now();
    logOp(scan, callbacks, `Scan error: ${scan.error}`);
    callbacks.onProgress({ id: scan.id, status: "error", error: scan.error, completedAt: scan.completedAt });
  }

  return scan;
}

async function scanPorts(host: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const uniquePorts = [...new Set(TOP_PORTS)].sort((a, b) => a - b);
  const totalPorts = uniquePorts.length;
  const batchSize = 100;
  let scanned = 0;

  for (let i = 0; i < totalPorts; i += batchSize) {
    if (callbacks.signal.aborted) return;

    const batch = uniquePorts.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (port) => {
        const { open, banner } = await tcpConnect(host, port, 300);
        return { port, open, banner };
      }),
    );

    for (const { port, open, banner } of results) {
      if (open) {
        const service = resolveService(port, banner);
        const portResult: PortResult = {
          port,
          state: "open",
          service,
          banner,
        };
        scan.ports.push(portResult);
        logOp(scan, callbacks, `Port ${port} open — ${service}${banner ? ` (${banner.slice(0, 60)})` : ""}`);
        callbacks.onProgress({
          id: scan.id,
          ports: [...scan.ports],
          phase: `Port scanning (${port})`,
        });
      }
    }

    scanned += batch.length;
    const progress = Math.round((scanned / totalPorts) * 50); // Port scanning = 0-50%
    scan.progress = progress;
    callbacks.onProgress({ id: scan.id, progress, phase: `Port scanning (${scanned}/${totalPorts})` });
  }
}

async function runWebChecks(host: string, httpPorts: PortResult[], scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const totalPhases = 5;
  let completedPhases = 0;

  for (const portResult of httpPorts) {
    if (callbacks.signal.aborted) return;

    const isHttps = portResult.port === 443 || portResult.port === 8443 || portResult.port === 4443;
    const protocol = isHttps ? "https" : "http";
    const portSuffix = (portResult.port === 80 || portResult.port === 443) ? "" : `:${portResult.port}`;
    const baseUrl = `${protocol}://${host}${portSuffix}`;

    // Phase 2a: Header security checks
    scan.phase = `Checking headers (${baseUrl})`;
    scan.progress = 50 + Math.round((completedPhases / totalPhases) * 50 / httpPorts.length);
    logOp(scan, callbacks, `Checking security headers on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase, progress: scan.progress });

    await checkHeaders(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2b: Directory enumeration
    scan.phase = `Directory scan (${baseUrl})`;
    logOp(scan, callbacks, `Enumerating ${COMMON_PATHS.length} common paths on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await enumerateDirectories(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2c: SSL/TLS analysis (only for HTTPS)
    if (isHttps) {
      scan.phase = `SSL/TLS analysis (${baseUrl})`;
      logOp(scan, callbacks, `Analyzing SSL/TLS certificate on ${host}:${portResult.port}`);
      callbacks.onProgress({ id: scan.id, phase: scan.phase });

      await checkSsl(host, portResult.port, scan, callbacks);
    }
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2d: SQL injection check
    scan.phase = `SQL injection check (${baseUrl})`;
    logOp(scan, callbacks, `Testing SQL injection vectors on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await checkSqlInjection(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2e: XSS reflection check
    scan.phase = `XSS reflection check (${baseUrl})`;
    logOp(scan, callbacks, `Testing XSS reflection on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await checkXssReflection(baseUrl, scan, callbacks);
    completedPhases++;
    if (callbacks.signal.aborted) return;

    // Phase 2f: Open redirect check
    scan.phase = `Open redirect check (${baseUrl})`;
    logOp(scan, callbacks, `Testing open redirect parameters on ${baseUrl}`);
    callbacks.onProgress({ id: scan.id, phase: scan.phase });

    await checkOpenRedirects(baseUrl, scan, callbacks);
    if (callbacks.signal.aborted) return;
  }
}

async function checkHeaders(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const resp = await httpRequest(baseUrl, "GET", 5000);
  if (!resp) {
    logOp(scan, callbacks, `No response from ${baseUrl}, skipping header checks`);
    return;
  }

  logOp(scan, callbacks, `Received HTTP ${resp.status} from ${baseUrl}, analyzing headers`);

  // Check missing security headers
  for (const check of SECURITY_HEADERS) {
    if (!resp.headers[check.header]) {
      const finding: WebFinding = {
        id: uuidv4(),
        category: "header",
        severity: check.severity,
        title: check.title,
        description: check.description,
        url: baseUrl,
      };
      scan.findings.push(finding);
      logOp(scan, callbacks, `[${check.severity.toUpperCase()}] ${check.title}`);
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    }
  }

  // Check disclosure headers
  for (const hdr of DISCLOSURE_HEADERS) {
    if (resp.headers[hdr]) {
      const finding: WebFinding = {
        id: uuidv4(),
        category: "disclosure",
        severity: "low",
        title: `Information Disclosure: ${hdr}`,
        description: `The ${hdr} header reveals server technology information.`,
        url: baseUrl,
        evidence: `${hdr}: ${resp.headers[hdr]}`,
      };
      scan.findings.push(finding);
      logOp(scan, callbacks, `[LOW] Server discloses ${hdr}: ${resp.headers[hdr]}`);
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    }
  }
}

const SENSITIVE_PATHS = new Set(["/.env", "/.git/config", "/.git/HEAD", "/.htaccess", "/.svn/entries", "/.DS_Store"]);

async function enumerateDirectories(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const batchSize = 10;
  for (let i = 0; i < COMMON_PATHS.length; i += batchSize) {
    if (callbacks.signal.aborted) return;

    const batch = COMMON_PATHS.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (pathStr) => {
        const url = `${baseUrl}${pathStr}`;
        const resp = await httpRequest(url, "HEAD", 3000);
        return { pathStr, url, resp };
      }),
    );

    for (const { pathStr, url, resp } of results) {
      if (!resp || resp.status === 0) continue;

      const status = resp.status;
      const isSensitive = SENSITIVE_PATHS.has(pathStr) || pathStr.includes(".env") || pathStr.includes(".git");

      // Skip non-interesting responses:
      // - 404/410: not found
      // - 3xx redirects: almost always a generic redirect, not evidence of the path existing
      // - 400: bad request
      // - 401/403 on non-sensitive paths: generic deny, not interesting
      if (status === 404 || status === 410 || status === 400) continue;
      if (status >= 300 && status < 400) continue;
      if ((status === 401 || status === 403) && !isSensitive) continue;

      let severity: Severity = "info";
      let title = `Accessible path: ${pathStr}`;
      let description = `${pathStr} returned HTTP ${status}`;

      if (isSensitive) {
        // 403 on sensitive paths means it exists but is blocked — still noteworthy
        if (status === 403 || status === 401) {
          severity = "medium";
          title = `Sensitive path exists (blocked): ${pathStr}`;
          description = `${pathStr} returned HTTP ${status}. The file exists but access is denied. Verify it cannot be accessed via other means.`;
        } else {
          severity = "high";
          title = `Sensitive file exposed: ${pathStr}`;
          description = `${pathStr} is accessible (HTTP ${status}). This may expose sensitive configuration or source code.`;
        }
      } else if (pathStr.includes("admin") || pathStr.includes("phpmyadmin") || pathStr.includes("console")) {
        severity = "medium";
        title = `Admin interface found: ${pathStr}`;
        description = `${pathStr} is accessible (HTTP ${status}). Administrative interfaces should be restricted.`;
      } else if (pathStr.includes("backup") || pathStr.includes("dump") || pathStr.includes("debug")) {
        severity = "medium";
        title = `Potentially sensitive path: ${pathStr}`;
        description = `${pathStr} returned HTTP ${status}. This may contain sensitive data.`;
      }

      const finding: WebFinding = {
        id: uuidv4(),
        category: "directory",
        severity,
        title,
        description,
        url,
        evidence: `HTTP ${status}`,
      };
      scan.findings.push(finding);
      logOp(scan, callbacks, `[${severity.toUpperCase()}] ${pathStr} → HTTP ${status}`);
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    }
  }
}

async function checkSsl(host: string, port: number, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port,
        rejectUnauthorized: false,
        timeout: 5000,
      },
      () => {
        const cert = socket.getPeerCertificate();
        if (cert && Object.keys(cert).length > 0) {
          // Check expiry
          const validTo = new Date(cert.valid_to);
          const now = new Date();
          const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          if (daysUntilExpiry < 0) {
            scan.findings.push({
              id: uuidv4(),
              category: "ssl",
              severity: "critical",
              title: "SSL Certificate Expired",
              description: `Certificate expired ${Math.abs(daysUntilExpiry)} days ago (${cert.valid_to}).`,
              url: `https://${host}:${port}`,
              evidence: `Valid to: ${cert.valid_to}`,
            });
            logOp(scan, callbacks, `[CRITICAL] SSL certificate expired ${Math.abs(daysUntilExpiry)} days ago`);
          } else if (daysUntilExpiry < 30) {
            scan.findings.push({
              id: uuidv4(),
              category: "ssl",
              severity: "medium",
              title: "SSL Certificate Expiring Soon",
              description: `Certificate expires in ${daysUntilExpiry} days (${cert.valid_to}).`,
              url: `https://${host}:${port}`,
              evidence: `Valid to: ${cert.valid_to}`,
            });
            logOp(scan, callbacks, `[MEDIUM] SSL certificate expires in ${daysUntilExpiry} days`);
          } else {
            logOp(scan, callbacks, `SSL certificate valid for ${daysUntilExpiry} days`);
          }

          // Check self-signed
          if (cert.issuer && cert.subject &&
            JSON.stringify(cert.issuer) === JSON.stringify(cert.subject)) {
            scan.findings.push({
              id: uuidv4(),
              category: "ssl",
              severity: "medium",
              title: "Self-Signed Certificate",
              description: "The server uses a self-signed certificate. This is not trusted by browsers.",
              url: `https://${host}:${port}`,
              evidence: `Issuer: ${cert.issuer?.CN || "N/A"}`,
            });
            logOp(scan, callbacks, `[MEDIUM] Self-signed certificate detected (issuer: ${cert.issuer?.CN || "N/A"})`);
          }

          callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
        }
        socket.end();
        resolve();
      },
    );

    socket.on("error", () => {
      resolve();
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve();
    });
  });
}

async function checkSqlInjection(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const testPaths = ["/", "/search", "/login", "/api"];
  const payloads = ["'", "' OR 1=1--", "\" OR 1=1--"];

  for (const pathStr of testPaths) {
    if (callbacks.signal.aborted) return;

    for (const payload of payloads) {
      const url = `${baseUrl}${pathStr}?q=${encodeURIComponent(payload)}&id=${encodeURIComponent(payload)}`;
      const resp = await httpRequest(url, "GET", 3000);
      if (!resp) continue;

      for (const pattern of SQL_ERROR_PATTERNS) {
        if (pattern.test(resp.body)) {
          scan.findings.push({
            id: uuidv4(),
            category: "sqli",
            severity: "critical",
            title: `Potential SQL Injection: ${pathStr}`,
            description: `SQL error detected in response when injecting test payload. The application may be vulnerable to SQL injection.`,
            url,
            evidence: resp.body.match(pattern)?.[0] || "SQL error pattern matched",
          });
          logOp(scan, callbacks, `[CRITICAL] SQL injection detected at ${pathStr} — SQL error in response`);
          callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
          return; // Found one, no need to keep testing this base
        }
      }
    }
  }
}

async function checkXssReflection(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const testPaths = ["/", "/search", "/api"];
  const xssPayload = "<script>alert(1)</script>";
  const xssPayloadEncoded = encodeURIComponent(xssPayload);

  for (const pathStr of testPaths) {
    if (callbacks.signal.aborted) return;

    const url = `${baseUrl}${pathStr}?q=${xssPayloadEncoded}&search=${xssPayloadEncoded}`;
    const resp = await httpRequest(url, "GET", 3000);
    if (!resp) continue;

    if (resp.body.includes(xssPayload)) {
      scan.findings.push({
        id: uuidv4(),
        category: "xss",
        severity: "high",
        title: `Reflected XSS: ${pathStr}`,
        description: `The application reflects user input without encoding. An attacker could inject malicious scripts.`,
        url,
        evidence: `Payload "<script>alert(1)</script>" reflected in response body`,
      });
      logOp(scan, callbacks, `[HIGH] Reflected XSS at ${pathStr} — payload reflected unescaped`);
      callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
    }
  }
}

async function checkOpenRedirects(baseUrl: string, scan: SecurityScan, callbacks: ScanCallbacks): Promise<void> {
  const params = ["redirect", "url", "next", "return", "returnUrl", "goto", "destination"];
  const evilDomain = "https://evil.example.com";

  for (const param of params) {
    if (callbacks.signal.aborted) return;

    const url = `${baseUrl}/?${param}=${encodeURIComponent(evilDomain)}`;
    const resp = await httpRequest(url, "GET", 3000, false);
    if (!resp) continue;

    if (resp.status >= 300 && resp.status < 400 && resp.redirectUrl) {
      if (resp.redirectUrl.includes("evil.example.com")) {
        scan.findings.push({
          id: uuidv4(),
          category: "redirect",
          severity: "medium",
          title: `Open Redirect via "${param}" parameter`,
          description: `The application redirects to an external domain controlled by the attacker via the "${param}" parameter.`,
          url,
          evidence: `Location: ${resp.redirectUrl}`,
        });
        logOp(scan, callbacks, `[MEDIUM] Open redirect via "${param}" parameter`);
        callbacks.onProgress({ id: scan.id, findings: [...scan.findings] });
      }
    }
  }
}

// --- DB persistence ---

export async function saveScan(userId: string, scan: SecurityScan): Promise<void> {
  const db = getDb();
  await db.insert(securityScans).values({
    id: scan.id,
    userId,
    target: scan.target,
    status: scan.status === "completed" ? "completed" : scan.status === "error" ? "error" : "stopping",
    startedAt: new Date(scan.startedAt),
    completedAt: scan.completedAt ? new Date(scan.completedAt) : null,
    ports: scan.ports as unknown as Record<string, unknown>[],
    findings: scan.findings as unknown as Record<string, unknown>[],
    operations: scan.operations as unknown as Record<string, unknown>[],
    error: scan.error || null,
  }).onConflictDoUpdate({
    target: securityScans.id,
    set: {
      status: scan.status === "completed" ? "completed" : scan.status === "error" ? "error" : "stopping",
      completedAt: scan.completedAt ? new Date(scan.completedAt) : null,
      ports: scan.ports as unknown as Record<string, unknown>[],
      findings: scan.findings as unknown as Record<string, unknown>[],
      operations: scan.operations as unknown as Record<string, unknown>[],
      error: scan.error || null,
    },
  });
}

export async function listScans(userId: string, limit = 50): Promise<SecurityScan[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(securityScans)
    .where(eq(securityScans.userId, userId))
    .orderBy(desc(securityScans.startedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    target: r.target,
    status: r.status as SecurityScan["status"],
    startedAt: r.startedAt.getTime(),
    completedAt: r.completedAt?.getTime(),
    progress: 100,
    phase: r.status === "completed" ? "Complete" : r.status === "error" ? "Error" : "Stopped",
    ports: (r.ports ?? []) as unknown as SecurityScan["ports"],
    findings: (r.findings ?? []) as unknown as SecurityScan["findings"],
    operations: (r.operations ?? []) as unknown as SecurityScan["operations"],
    error: r.error ?? undefined,
  }));
}

export async function deleteScan(scanId: string): Promise<void> {
  const db = getDb();
  await db.delete(securityScans).where(eq(securityScans.id, scanId));
}
