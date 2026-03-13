import { eq } from "drizzle-orm";
import { getDb } from "./index.js";
import { users } from "./schema.js";

const CLAUDE_GOOGLE_ID = "claude-ai";
const CLAUDE_EMAIL = "claude@genie.local";

let claudeUserId: string | null = null;

export async function seedClaude(): Promise<void> {
  const db = getDb();

  // Upsert Claude user
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.googleId, CLAUDE_GOOGLE_ID))
    .limit(1);

  if (existing.length > 0) {
    claudeUserId = existing[0].id;
    console.log(`Claude user exists: ${claudeUserId}`);
  } else {
    const [claude] = await db
      .insert(users)
      .values({
        googleId: CLAUDE_GOOGLE_ID,
        email: CLAUDE_EMAIL,
        name: "Claude",
        isAgent: true,
      })
      .returning();
    claudeUserId = claude.id;
    console.log(`Claude user created: ${claudeUserId}`);
  }
}

export function getClaudeUserId(): string {
  if (!claudeUserId) {
    throw new Error("Claude user not seeded yet — call seedClaude() first");
  }
  return claudeUserId;
}
