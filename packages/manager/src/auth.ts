import { URL } from "node:url";
import type http from "node:http";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { users } from "./db/schema.js";

const JWT_SECRET = process.env.GENIE_JWT_SECRET || process.env.ANTHROPIC_API_KEY || "genie-secret-fallback";
const JWT_EXPIRY = "30d";
const MANAGER_PORT = Number(process.env.PORT) || 9876;
const MANAGER_BASE_URL = process.env.MANAGER_URL || `http://127.0.0.1:${MANAGER_PORT}`;
const REDIRECT_URI = `${MANAGER_BASE_URL}/auth/callback`;

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export function createToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded;
  } catch {
    return null;
  }
}

export async function getUserById(id: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user || null;
}

/** Admin = first non-agent user by creation date */
export async function isAdmin(userId: string): Promise<boolean> {
  const db = getDb();
  const [first] = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.isAgent, false))
    .orderBy(users.createdAt)
    .limit(1);
  return first?.id === userId;
}

// --- Pending OAuth state ---

interface PendingOAuth {
  oauth2Client: OAuth2Client;
  onSuccess: (user: typeof users.$inferSelect, token: string) => void;
  onError: (message: string) => void;
  timeout: ReturnType<typeof setTimeout>;
}

let pendingOAuth: PendingOAuth | null = null;

export function initiateOAuth(
  onSuccess: (user: typeof users.$inferSelect, token: string) => void,
  onError: (message: string) => void,
): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }

  // Clean up any previous pending auth
  if (pendingOAuth) {
    clearTimeout(pendingOAuth.timeout);
    pendingOAuth = null;
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
  });

  const timeout = setTimeout(() => {
    pendingOAuth = null;
    onError("OAuth timed out");
  }, 120000);

  pendingOAuth = { oauth2Client, onSuccess, onError, timeout };

  return authUrl;
}

/**
 * Handle the /auth/callback HTTP request on the manager's server.
 * Returns true if the request was handled.
 */
export async function handleOAuthCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  if (!req.url?.startsWith("/auth/callback")) return false;

  if (!pendingOAuth) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body style=\"font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;background:#1e1e2e;color:#cdd6f4\"><div style=\"text-align:center\"><h2>No pending authentication</h2><p>Please start sign-in from Genie first.</p></div></body></html>");
    return true;
  }

  const { oauth2Client, onSuccess, onError, timeout } = pendingOAuth;
  pendingOAuth = null;
  clearTimeout(timeout);

  try {
    const url = new URL(req.url, MANAGER_BASE_URL);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error || !code) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>");
      onError(error || "No authorization code received");
      return true;
    }

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const response = await oauth2Client.request<GoogleUserInfo>({
      url: "https://www.googleapis.com/oauth2/v3/userinfo",
    });
    const userInfo = response.data;

    // Upsert user in DB
    const db = getDb();
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.googleId, userInfo.sub))
      .limit(1);

    let user: typeof users.$inferSelect;
    if (existing.length > 0) {
      const [updated] = await db
        .update(users)
        .set({
          name: userInfo.name,
          avatarUrl: userInfo.picture || null,
          email: userInfo.email,
        })
        .where(eq(users.googleId, userInfo.sub))
        .returning();
      user = updated;
    } else {
      const [created] = await db
        .insert(users)
        .values({
          googleId: userInfo.sub,
          email: userInfo.email,
          name: userInfo.name,
          avatarUrl: userInfo.picture || null,
          isAgent: false,
        })
        .returning();
      user = created;
    }

    const token = createToken(user.id);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;background:#1e1e2e;color:#cdd6f4"><div style="text-align:center"><h2>Signed in as ${user.name}</h2><p>You can close this tab and return to Genie.</p></div></body></html>`);

    onSuccess(user, token);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[auth] OAuth callback error:", err);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body><h2>Authentication error</h2><p>${message || "Unknown error"}</p><p>You can close this tab.</p></body></html>`);
    onError(message || "OAuth exchange failed");
  }

  return true;
}
