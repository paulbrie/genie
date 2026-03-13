import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

// env is  ../../.env
dotenv.config({ path: "../../.env" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DB!,
    ssl: process.env.DB_CERT ? { ca: process.env.DB_CERT } : undefined,
  },
});
