import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SshSession } from "./ssh-client.js";
import { type JsonRpcRequest, jsonRpcResponse, jsonRpcError, isNotification, initializeResult } from "./mcp-jsonrpc.js";

/** Per-instance context the storage handler needs to reach the VM + scope keys. */
export interface StorageMcpContext {
  /** SSH session to the VM (for screenshots + reading files to upload). */
  sshSession: SshSession;
  /** Project name, used as the storage key prefix. */
  projectName: string;
}

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

/**
 * Handle one JSON-RPC request for the genie-storage MCP service. Needs an SSH
 * session to the VM (for screenshots + reading files to upload) and the project
 * name as the key prefix. Returns a JSON-RPC response object, or null for a
 * notification.
 */
export async function handleStorageMcpRequest(parsed: JsonRpcRequest, ctx: StorageMcpContext): Promise<object | null> {
  if (isNotification(parsed)) return null;
  const { id, method, params } = parsed;
  const { sshSession, projectName } = ctx;

  try {
    if (method === "initialize") {
      return initializeResult(id, "genie-storage-mcp");
    }
    if (method === "tools/list") {
      return jsonRpcResponse(id, { tools: TOOLS });
    }
    if (method !== "tools/call") {
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }

    const toolName = params?.name as string;
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    const s3 = getS3Client();
    if (!s3) {
      return jsonRpcResponse(id, {
        content: [{ type: "text", text: "Storage not configured: BUCKET_NAME, BUCKET_REGION, BUCKET_ACCESS_KEY_ID, BUCKET_SECRET_ACCESS_KEY, and BUCKET_ENDPOINT_URL must be set." }],
        isError: true,
      });
    }

    if (toolName === "storage_screenshot") {
      const url = args.url as string;
      if (!url) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Error: url is required." }],
          isError: true,
        });
      }
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
          return jsonRpcResponse(id, {
            content: [{ type: "text", text: `Screenshot failed: ${screenshotOutput.trim()}` }],
            isError: true,
          });
        }
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

        return jsonRpcResponse(id, {
          content: [{ type: "text", text: JSON.stringify({ key, url: presignedUrl, size: imageData.length }, null, 2) }],
        });
      } catch (err: unknown) {
        console.error("[mcp-storage] operation failed:", err);
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Screenshot failed.` }],
          isError: true,
        });
      }
    }

    if (toolName === "storage_upload") {
      const filePath = args.filePath as string;
      if (!filePath) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Error: filePath is required." }],
          isError: true,
        });
      }
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

        return jsonRpcResponse(id, {
          content: [{ type: "text", text: JSON.stringify({ key, url: presignedUrl, size: fileData.length, contentType }, null, 2) }],
        });
      } catch (err: unknown) {
        console.error("[mcp-storage] operation failed:", err);
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Upload failed.` }],
          isError: true,
        });
      }
    }

    if (toolName === "storage_list") {
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

        return jsonRpcResponse(id, {
          content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
        });
      } catch (err: unknown) {
        console.error("[mcp-storage] operation failed:", err);
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `List failed.` }],
          isError: true,
        });
      }
    }

    if (toolName === "storage_get_url") {
      const key = args.key as string;
      if (!key) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Error: key is required." }],
          isError: true,
        });
      }
      // The token is scoped to one project; keys live under `${projectName}/`.
      // Reject keys outside that prefix so a project can't mint presigned URLs
      // for another project's objects.
      if (!key.startsWith(`${projectName}/`)) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Error: key is outside this project's storage." }],
          isError: true,
        });
      }
      try {
        const presignedUrl = await getSignedUrl(s3, new GetObjectCommand({
          Bucket: getBucketName(),
          Key: key,
        }), { expiresIn: 3600 });

        return jsonRpcResponse(id, {
          content: [{ type: "text", text: JSON.stringify({ key, url: presignedUrl }, null, 2) }],
        });
      } catch (err: unknown) {
        console.error("[mcp-storage] operation failed:", err);
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Failed to generate URL.` }],
          isError: true,
        });
      }
    }

    if (toolName === "storage_delete") {
      const key = args.key as string;
      if (!key) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Error: key is required." }],
          isError: true,
        });
      }
      // Scoped to this project's prefix — a project must not delete another
      // project's stored objects.
      if (!key.startsWith(`${projectName}/`)) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Error: key is outside this project's storage." }],
          isError: true,
        });
      }
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: getBucketName(),
          Key: key,
        }));

        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Deleted: ${key}` }],
        });
      } catch (err: unknown) {
        console.error("[mcp-storage] operation failed:", err);
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Delete failed.` }],
          isError: true,
        });
      }
    }

    return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
  } catch (err: unknown) {
    console.error("[mcp-storage] tool call failed:", err);
    return jsonRpcError(id, -32000, "Internal error — the request could not be completed.");
  }
}
