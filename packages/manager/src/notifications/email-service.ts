import { desc } from "drizzle-orm";
import type { MailService } from "@sendgrid/mail";
import { getDb } from "../db/index.js";
import { emailLogs } from "../db/schema.js";

/** From-address for platform communication emails. SendGrid requires this to be
 *  a verified sender / domain. Reuses BACKUP_EMAIL (already configured for the
 *  backup + feedback flows) and falls back to a noreply address. */
function fromAddress(): string {
  return process.env.COMMUNICATION_FROM_EMAIL || process.env.BACKUP_EMAIL || "noreply@teleporthq.io";
}

export interface EmailRecipient {
  userId: string | null;
  email: string;
}

export interface SendResult {
  email: string;
  status: "sent" | "failed";
  error?: string;
}

/** Send one email per recipient and persist a log row for each. Sends are
 *  sequential (recipient lists are small — the platform's whole user base) so a
 *  SendGrid rate-limit on a large blast degrades gracefully instead of firing
 *  hundreds of concurrent requests. Never throws — every recipient produces a
 *  log row, success or failure. */
export async function sendCommunicationEmail(opts: {
  recipients: EmailRecipient[];
  subject: string;
  body: string;
  sentByUserId: string | null;
  sentByName: string | null;
}): Promise<SendResult[]> {
  const { recipients, subject, body, sentByUserId, sentByName } = opts;
  const db = getDb();
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = fromAddress();

  // Plain-text body → simple HTML (preserve line breaks) so the email renders
  // sensibly in clients that prefer HTML.
  const html = body
    .split("\n")
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br/>");

  let sgMail: MailService | null = null;
  if (apiKey) {
    sgMail = (await import("@sendgrid/mail")).default;
    sgMail.setApiKey(apiKey);
  }

  const results: SendResult[] = [];

  for (const r of recipients) {
    let status: "sent" | "failed" = "sent";
    let error: string | null = null;

    if (!sgMail) {
      status = "failed";
      error = "SENDGRID_API_KEY not configured on the manager";
    } else {
      try {
        await sgMail.send({ to: r.email, from, subject, text: body, html });
      } catch (err: unknown) {
        status = "failed";
        // SendGrid surfaces useful detail under response.body.errors.
        const sgErr = err as { response?: { body?: { errors?: { message?: string }[] } }; message?: string };
        error = sgErr?.response?.body?.errors?.map((e) => e.message).filter(Boolean).join("; ")
          || (err instanceof Error ? err.message : String(err));
      }
    }

    try {
      await db.insert(emailLogs).values({
        recipientUserId: r.userId,
        recipientEmail: r.email,
        subject,
        body,
        status,
        error,
        sentByUserId,
        sentByName,
      });
    } catch (logErr) {
      console.error("[email] Failed to persist email log:", logErr instanceof Error ? logErr.message : String(logErr));
    }

    results.push({ email: r.email, status, error: error ?? undefined });
  }

  return results;
}

/** Most recent email log rows, newest first. */
export async function getEmailLogs(limit = 200) {
  const db = getDb();
  return db.select().from(emailLogs).orderBy(desc(emailLogs.createdAt)).limit(limit);
}


/**
 * Fire-and-forget email notification to the app's superadmin. Silent no-op when
 * SENDGRID_API_KEY is not configured — never throws into the caller. Pattern mirrors
 * the new-user-signup notification in auth.ts.
 */
export async function notifySuperadmin(subject: string, text: string): Promise<void> {
  const sgApiKey = process.env.SENDGRID_API_KEY;
  if (!sgApiKey) return;
  try {
    const sgMail = (await import("@sendgrid/mail")).default;
    sgMail.setApiKey(sgApiKey);
    await sgMail.send({
      to: "paul.brie@teleporthq.io",
      from: process.env.BACKUP_EMAIL || "noreply@teleporthq.io",
      subject,
      text,
    });
  } catch (err: unknown) {
    console.warn("[notify] Failed to send admin email:", err instanceof Error ? err.message : String(err));
  }
}
