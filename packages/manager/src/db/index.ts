import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

let db: PostgresJsDatabase<typeof schema> | null = null;
let client: ReturnType<typeof postgres> | null = null;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!db) {
    const url = process.env.DB;
    if (!url) {
      throw new Error("DB environment variable is not set");
    }
    const ssl = process.env.DB_CERT ? { ca: process.env.DB_CERT } : undefined;
    client = postgres(url, { ssl, onnotice: () => {} });
    db = drizzle(client, { schema });
  }
  return db;
}

export function getRawClient(): ReturnType<typeof postgres> {
  getDb(); // ensure client is initialized
  return client!;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}
