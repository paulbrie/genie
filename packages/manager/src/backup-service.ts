import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRawClient } from "./db/index.js";

const BACKUP_DIR = path.join(os.homedir(), ".genie", "backups");

function ensureBackupDir(): void {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// Append-only telemetry/log tables excluded from the logical backup. They are
// regenerable, not core state, and grow unbounded — audit_log alone was 2.5 GB /
// 1.5M rows, vps_metric_samples 458 MB / 1.3M rows. Including them made the dump
// load multiple GB into one in-memory string and OOM the process (which would
// crash the manager when an admin clicks "Download DB"). Skipping them keeps the
// backup to the few MB of actual operational state.
export const BACKUP_SKIP_TABLES = new Set([
  "audit_log",
  "vps_metric_samples",
  "server_metric_samples",
  "analytics_events",
  "ssh_events",
]);

/** Build the logical SQL dump (schema-less INSERTs wrapped in a txn) as a string,
 *  without touching disk. Excludes BACKUP_SKIP_TABLES. Shared by createBackup
 *  (writes it) and the admin "Download DB" path (sends it to the browser). */
export async function generateBackupSql(): Promise<string> {
  const sql = getRawClient();

  const lines: string[] = [];
  lines.push(`-- Genie DB Backup: ${new Date().toISOString()}`);
  if (BACKUP_SKIP_TABLES.size > 0) {
    lines.push(`-- Excludes telemetry tables: ${[...BACKUP_SKIP_TABLES].join(", ")}`);
  }
  lines.push("BEGIN;\n");

  // Get all user tables
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;

  for (const { tablename } of tables) {
    if (BACKUP_SKIP_TABLES.has(tablename as string)) continue;
    // Get column info
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tablename}
      ORDER BY ordinal_position
    `;
    const colNames = cols.map((c: Record<string, unknown>) => c.column_name as string);

    // Get all rows
    const rows = await sql.unsafe(`SELECT * FROM "${tablename}"`);
    if (rows.length === 0) continue;

    lines.push(`-- Table: ${tablename}`);
    lines.push(`DELETE FROM "${tablename}" CASCADE;`);

    for (const row of rows) {
      const values = colNames.map((col: string) => {
        const val = row[col];
        if (val === null || val === undefined) return "NULL";
        if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
        if (typeof val === "number") return String(val);
        if (val instanceof Date) return `'${val.toISOString()}'`;
        if (typeof val === "object") return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
        return `'${String(val).replace(/'/g, "''")}'`;
      });
      lines.push(`INSERT INTO "${tablename}" (${colNames.map((c: string) => `"${c}"`).join(", ")}) VALUES (${values.join(", ")});`);
    }
    lines.push("");
  }

  lines.push("COMMIT;\n");

  return lines.join("\n");
}

export async function createBackup(): Promise<string> {
  ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `backup-${timestamp}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  const sql = await generateBackupSql();
  fs.writeFileSync(filepath, sql, "utf-8");
  console.log(`DB backup saved: ${filepath}`);
  return filepath;
}

export async function sendBackupEmail(): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const email = process.env.BACKUP_EMAIL;
  if (!apiKey || !email) {
    console.warn("Skipping backup email: SENDGRID_API_KEY or BACKUP_EMAIL not set");
    return;
  }

  const filepath = await createBackup();
  const content = fs.readFileSync(filepath, "utf-8");
  const b64 = Buffer.from(content).toString("base64");
  const filename = path.basename(filepath);

  const sgMail = (await import("@sendgrid/mail")).default;
  sgMail.setApiKey(apiKey);

  await sgMail.send({
    to: email,
    from: email,
    subject: `Genie DB Backup - ${new Date().toISOString().split("T")[0]}`,
    text: `Automated daily backup attached.\n\nTimestamp: ${new Date().toISOString()}\nFile: ${filename}`,
    attachments: [{ content: b64, filename, type: "application/sql", disposition: "attachment" }],
  });

  console.log(`Backup email sent to ${email}`);
}

// --- List / delete backups ---

export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

export function listBackups(): BackupFile[] {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return files;
}

export function deleteBackup(name: string): void {
  const filepath = path.join(BACKUP_DIR, path.basename(name));
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }
}

// Schedule daily backup at midnight
let backupTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNextMidnight(): void {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const ms = midnight.getTime() - now.getTime();

  backupTimer = setTimeout(async () => {
    try {
      await sendBackupEmail();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Daily backup failed:", message);
    }
    scheduleNextMidnight();
  }, ms);
}

export function startBackupCron(): void {
  if (!process.env.SENDGRID_API_KEY || !process.env.BACKUP_EMAIL) {
    console.log("Backup cron not started: SENDGRID_API_KEY or BACKUP_EMAIL not set");
    return;
  }
  scheduleNextMidnight();
  console.log("Daily backup cron scheduled for midnight");
}

export function stopBackupCron(): void {
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
}
