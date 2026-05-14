import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// packages/manager/src/load-env.ts → packages/manager/.env.local
dotenv.config({ path: resolve(here, "../.env.local") });
dotenv.config({ path: resolve(here, "../.env") });
