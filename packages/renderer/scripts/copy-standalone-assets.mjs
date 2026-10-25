#!/usr/bin/env node
/**
 * Copy the client assets into the standalone build. With `output: "standalone"`
 * `next build` writes the server to .next/standalone but leaves .next/static
 * and public/ out (they are meant for a CDN), so `node server.js` would 404
 * every JS/CSS chunk. Run after `next build`, from packages/renderer.
 */
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const distDir = ".next";
// Where server.js lands inside .next/standalone (packages/renderer in this
// monorepo, since the tracing root is the repo root).
const { relativeAppDir = "" } = JSON.parse(readFileSync(join(distDir, "required-server-files.json"), "utf8"));
const appDir = join(distDir, "standalone", relativeAppDir);
if (!existsSync(join(appDir, "server.js"))) {
  console.error(`[standalone] no server.js in ${appDir}; is output: "standalone" set?`);
  process.exit(1);
}

cpSync(join(distDir, "static"), join(appDir, distDir, "static"), { recursive: true, force: true });
if (existsSync("public")) cpSync("public", join(appDir, "public"), { recursive: true, force: true });
console.log(`[standalone] copied static assets into ${appDir}`);
