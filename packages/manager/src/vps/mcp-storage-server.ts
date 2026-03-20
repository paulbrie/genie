import http from "node:http";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SshSession } from "./ssh-client.js";

const TOOLS = [
  {
    name: "storage_screenshot",
    description:
      "Take a screenshot of a URL on the VPS and upload it to cloud storage. Returns the public URL of the saved screenshot. Useful for capturing the current state of the app, documenting bugs, or sharing visual progress.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to screenshot (e.g. http://<server-ip>:3000). Use the server's public IP, never localhost.",
        },
        name: {
          type: "string",
          description: "Optional descriptive name for the screenshot (e.g. 'homepage-after-fix'). Defaults to a timestamp.",
        },
        fullPage: {
          type: "boolean",
          description: "Capture the full scrollable page (default: false, captures viewport only)",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "storage_upload",
    description:
      "Upload a file from the VPS to cloud storage. Provide the absolute path to a file on the VPS. Returns the public URL.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the file on the VPS to upload",
        },
        name: {
          type: "string",
          description: "Optional name/key for the file in storage. Defaults to the original filename.",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "storage_list",
    description:
      "List files in cloud storage. Returns file names, sizes, and last modified dates.",
    inputSchema: {
      type: "object",
      properties: {
        prefix: {
          type: "string",
          description: "Filter by key prefix (e.g. 'screenshots/' or 'uploads/'). Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of items to return (default: 50)",
        },
      },
      required: [],
    },
  },
  {
    name: "storage_get_url",
    description:
      "Get a presigned URL for a file in cloud storage. The URL is valid for 1 hour.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The storage key (file path) to generate a URL for",
        },
      },
      required: ["key"],
    },
  },
  {
    name: "storage_delete",
    description:
      "Delete a file from cloud storage.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The storage key (file path) to delete",
        },
      },
      required: ["key"],
    },
  },
];

function getS3Client(): S3Client | null {
  const bucket = process.env.BUCKET_NAME;
  const region = process.env.BUCKET_REGION;
  const accessKeyId = process.env.BUCKET_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BUCKET_SECRET_ACCESS_KEY;
  const endpoint = process.env.BUCKET_ENDPOINT_URL;

  if (!bucket || !region || !accessKeyId || !secretAccessKey || !endpoint) return null;

  return new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

function getBucketName(): string {
  return process.env.BUCKET_NAME || "";
}

function jsonRpcResponse(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function sendSseResponse(res: http.ServerResponse, payload: object) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
  res.end();
}

/**
 * Create a local MCP HTTP server that exposes cloud storage tools.
 * Claude on the VPS can take screenshots and upload/manage files in an S3-compatible bucket.
 *
 * @param sshSession - SSH session to the VPS (used for taking screenshots and reading files remotely)
 * @param projectName - project name (used as storage prefix)
 */
export function createMcpStorageServer(
  sshSession: SshSession,
  projectName: string,
): Promise<{ port: number; close(): void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method === "GET") {
        res.writeHead(405).end();
        return;
      }
      if (req.method === "DELETE") {
        res.writeHead(200).end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString();

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify(jsonRpcError(null, -32700, "Parse error")));
        return;
      }

      const { id, method, params } = parsed as {
        id?: unknown;
        method?: string;
        params?: Record<string, unknown>;
      };

      if (id === undefined || id === null) {
        res.writeHead(202).end();
        return;
      }

      try {
        let result: object;

        if (method === "initialize") {
          result = jsonRpcResponse(id, {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "genie-storage-mcp", version: "1.0.0" },
            capabilities: { tools: {} },
          });
        } else if (method === "tools/list") {
          result = jsonRpcResponse(id, { tools: TOOLS });
        } else if (method === "tools/call") {
          const toolName = params?.name as string;
          const args = (params?.arguments ?? {}) as Record<string, unknown>;

          const s3 = getS3Client();
          if (!s3) {
            result = jsonRpcResponse(id, {
              content: [{ type: "text", text: "Storage not configured: BUCKET_NAME, BUCKET_REGION, BUCKET_ACCESS_KEY_ID, BUCKET_SECRET_ACCESS_KEY, and BUCKET_ENDPOINT_URL must be set." }],
              isError: true,
            });
          } else if (toolName === "storage_screenshot") {
            const url = args.url as string;
            if (!url) {
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: "Error: url is required." }],
                isError: true,
              });
            } else {
              try {
                const label = (args.name as string) || new Date().toISOString().replace(/[:.]/g, "-");
                const fullPage = args.fullPage === true;
                const filename = `${label}.png`;
                const remotePath = `/tmp/_genie_screenshot_${randomUUID()}.png`;

                // Run puppeteer on the VPS via a node one-liner
                const puppeteerScript = [
                  `node -e "`,
                  `const p = require('puppeteer');`,
                  `(async () => {`,
                  `  const b = await p.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });`,
                  `  const pg = await b.newPage();`,
                  `  await pg.setViewport({ width: 1280, height: 800 });`,
                  `  await pg.goto('${url.replace(/'/g, "\\'")}', { waitUntil: 'networkidle2', timeout: 30000 });`,
                  `  await pg.screenshot({ path: '${remotePath}', fullPage: ${fullPage} });`,
                  `  await b.close();`,
                  `  console.log('OK');`,
                  `})().catch(e => { console.error(e.message); process.exit(1); });`,
                  `"`,
                ].join(" ");

                const screenshotOutput = await sshSession.exec(puppeteerScript);
                if (!screenshotOutput.includes("OK")) {
                  result = jsonRpcResponse(id, {
                    content: [{ type: "text", text: `Screenshot failed: ${screenshotOutput.trim()}` }],
                    isError: true,
                  });
                } else {
                  // Read the file from VPS as base64
                  const b64 = await sshSession.exec(`base64 ${remotePath} | tr -d '\\n'`);
                  const imageData = Buffer.from(b64.trim(), "base64");
                  // Clean up temp file
                  sshSession.exec(`rm -f ${remotePath}`).catch(() => {});

                  const key = `${projectName}/screenshots/${filename}`;
                  await s3.send(new PutObjectCommand({
                    Bucket: getBucketName(),
                    Key: key,
                    Body: imageData,
                    ContentType: "image/png",
                  }));

                  const presignedUrl = await getSignedUrl(s3, new GetObjectCommand({
                    Bucket: getBucketName(),
                    Key: key,
                  }), { expiresIn: 3600 });

                  result = jsonRpcResponse(id, {
                    content: [{ type: "text", text: JSON.stringify({ key, url: presignedUrl, size: imageData.length }, null, 2) }],
                  });
                }
              } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : String(err);
                result = jsonRpcResponse(id, {
                  content: [{ type: "text", text: `Screenshot failed: ${errMsg}` }],
                  isError: true,
                });
              }
            }
          } else if (toolName === "storage_upload") {
            const filePath = args.filePath as string;
            if (!filePath) {
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: "Error: filePath is required." }],
                isError: true,
              });
            } else {
              try {
                const basename = (args.name as string) || filePath.split("/").pop() || "file";
                const key = `${projectName}/uploads/${basename}`;

                // Read file from VPS as base64
                const b64 = await sshSession.exec(`base64 '${filePath.replace(/'/g, "'\\''")}' | tr -d '\\n'`);
                const fileData = Buffer.from(b64.trim(), "base64");

                // Guess content type from extension
                const ext = basename.split(".").pop()?.toLowerCase() || "";
                const contentTypeMap: Record<string, string> = {
                  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
                  svg: "image/svg+xml", webp: "image/webp", pdf: "application/pdf",
                  json: "application/json", txt: "text/plain", html: "text/html",
                  css: "text/css", js: "application/javascript", zip: "application/zip",
                  tar: "application/x-tar", gz: "application/gzip",
                };
                const contentType = contentTypeMap[ext] || "application/octet-stream";

                await s3.send(new PutObjectCommand({
                  Bucket: getBucketName(),
                  Key: key,
                  Body: fileData,
                  ContentType: contentType,
                }));

                const presignedUrl = await getSignedUrl(s3, new GetObjectCommand({
                  Bucket: getBucketName(),
                  Key: key,
                }), { expiresIn: 3600 });

                result = jsonRpcResponse(id, {
                  content: [{ type: "text", text: JSON.stringify({ key, url: presignedUrl, size: fileData.length, contentType }, null, 2) }],
                });
              } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : String(err);
                result = jsonRpcResponse(id, {
                  content: [{ type: "text", text: `Upload failed: ${errMsg}` }],
                  isError: true,
                });
              }
            }
          } else if (toolName === "storage_list") {
            try {
              const prefix = args.prefix as string | undefined;
              const limit = (args.limit as number) || 50;
              const fullPrefix = prefix ? `${projectName}/${prefix}` : `${projectName}/`;

              const response = await s3.send(new ListObjectsV2Command({
                Bucket: getBucketName(),
                Prefix: fullPrefix,
                MaxKeys: limit,
              }));

              const items = (response.Contents || []).map((obj) => ({
                key: obj.Key,
                size: obj.Size,
                lastModified: obj.LastModified?.toISOString(),
              }));

              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
              });
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: `List failed: ${errMsg}` }],
                isError: true,
              });
            }
          } else if (toolName === "storage_get_url") {
            const key = args.key as string;
            if (!key) {
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: "Error: key is required." }],
                isError: true,
              });
            } else {
              try {
                const presignedUrl = await getSignedUrl(s3, new GetObjectCommand({
                  Bucket: getBucketName(),
                  Key: key,
                }), { expiresIn: 3600 });

                result = jsonRpcResponse(id, {
                  content: [{ type: "text", text: JSON.stringify({ key, url: presignedUrl }, null, 2) }],
                });
              } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : String(err);
                result = jsonRpcResponse(id, {
                  content: [{ type: "text", text: `Failed to generate URL: ${errMsg}` }],
                  isError: true,
                });
              }
            }
          } else if (toolName === "storage_delete") {
            const key = args.key as string;
            if (!key) {
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: "Error: key is required." }],
                isError: true,
              });
            } else {
              try {
                await s3.send(new DeleteObjectCommand({
                  Bucket: getBucketName(),
                  Key: key,
                }));

                result = jsonRpcResponse(id, {
                  content: [{ type: "text", text: `Deleted: ${key}` }],
                });
              } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : String(err);
                result = jsonRpcResponse(id, {
                  content: [{ type: "text", text: `Delete failed: ${errMsg}` }],
                  isError: true,
                });
              }
            }
          } else {
            result = jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
          }
        } else {
          result = jsonRpcError(id, -32601, `Method not found: ${method}`);
        }

        const accept = req.headers.accept || "";
        if (accept.includes("text/event-stream")) {
          sendSseResponse(res, result);
        } else {
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const errResp = jsonRpcError(id, -32000, message || "Internal error");
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(errResp));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      console.log(`[mcp-storage] Local HTTP server on port ${addr.port}`);
      resolve({
        port: addr.port,
        close() {
          server.close();
        },
      });
    });

    server.on("error", reject);
  });
}
