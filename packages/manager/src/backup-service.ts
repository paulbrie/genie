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

export async function createBackup(): Promise<string> {
  ensureBackupDir();

  const sql = getRawClient();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `backup-${timestamp}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  const lines: string[] = [];
  lines.push(`-- Genie DB Backup: ${new Date().toISOString()}`);
  lines.push("BEGIN;\n");

  // Get all user tables
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;

  for (const { tablename } of tables) {
    // Get column info
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tablename}
      ORDER BY ordinal_position
    `;
    const colNames = cols.map((c: any) => c.column_name);

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

  fs.writeFileSync(filepath, lines.join("\n"), "utf-8");
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
    } catch (err: any) {
      console.error("Daily backup failed:", err.message);
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
