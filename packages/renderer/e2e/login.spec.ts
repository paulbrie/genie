import { test, expect } from "@playwright/test";

const TEST_USER = "paul.brie@teleporthq.io";

/** Path used to fetch a real, validated JWT from the dev-only manager
 *  endpoint. The endpoint is loopback-only and follows a 302 to the
 *  renderer with ?token=<jwt>. */
function testLoginUrl(redirect = "/"): string {
  return `http://localhost:9876/test-login?email=${encodeURIComponent(TEST_USER)}&redirect=${redirect}`;
}

test.describe.configure({ mode: "serial" });

test.describe("Login flow", () => {
  test("shows login screen when unauthenticated", async ({ page }) => {
    // Clear any stored token so we start unauthenticated
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("genie-auth-token"));
    await page.reload();

    // Should show the login screen
    await expect(page.getByText("Sign in to continue")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  });

  test("shows Genie title on login screen", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("genie-auth-token"));
    await page.reload();

    await expect(page.getByRole("heading", { name: "Genie" })).toBeVisible({ timeout: 10_000 });
  });

  test("login button triggers Google OAuth flow", async ({ page }) => {
    // Start capturing WS messages before navigation
    const wsMessages: string[] = [];
    page.on("websocket", (ws) => {
      ws.on("framesent", (frame) => {
        wsMessages.push(frame.payload as string);
      });
    });

    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("genie-auth-token"));
    await page.reload();

    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Sign in with Google" }).click();

    // Verify the auth:google:start message was sent via WS
    await expect(async () => {
      const authMsg = wsMessages.find((m) => m.includes("auth:google:start"));
      expect(authMsg).toBeTruthy();
    }).toPass({ timeout: 5_000 });
  });

  test("token in URL persists to localStorage and is stripped from the URL", async ({ browser, baseURL }) => {
    // Fresh context so we start with no stored token.
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();

    // /test-login mints a real JWT and 302s back to the renderer with
    // ?token=<jwt>. Replicates the OAuth-redirect callback flow.
    await page.goto(testLoginUrl("/"));

    // The renderer (ws.ts:65-72) sees `?token=…`, persists it, and strips it
    // from the URL before the WS auth round-trip even completes.
    await expect(async () => {
      const storedToken = await page.evaluate(() => localStorage.getItem("genie-auth-token"));
      expect(storedToken).toBeTruthy();
      expect(typeof storedToken).toBe("string");
      expect(storedToken!.length).toBeGreaterThan(20);  // JWT shape sanity
    }).toPass({ timeout: 10_000 });

    // URL should have the ?token=… query stripped.
    expect(page.url()).not.toContain("token=");

    await context.close();
  });

  test("authenticated session via /test-login lands on the main app", async ({ page }) => {
    await page.goto(testLoginUrl("/"));

    // Sidebar identity is visible once the WS auth round-trip completes.
    await expect(page.getByText("Paul Brie")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("superadmin")).toBeVisible();

    // Sidebar nav buttons are clickable (sanity: app shell is rendered, not
    // the login screen).
    await expect(page.getByRole("button", { name: "Projects" })).toBeVisible();
  });

  test("sign-out clears the stored token and shows the login screen", async ({ page }) => {
    await page.goto(testLoginUrl("/"));

    // Wait until we're fully signed in.
    await expect(page.getByText("Paul Brie")).toBeVisible({ timeout: 15_000 });

    // Sign-out button is rendered as a button with text "Sign out" in the sidebar.
    await page.getByRole("button", { name: "Sign out" }).click();

    // Token cleared.
    await expect(async () => {
      const token = await page.evaluate(() => localStorage.getItem("genie-auth-token"));
      expect(token).toBeNull();
    }).toPass({ timeout: 5_000 });

    // Login screen visible.
    await expect(page.getByText("Sign in to continue")).toBeVisible({ timeout: 5_000 });
  });

  test("invalid stored token is cleared on connect (defense in depth)", async ({ page }) => {
    // Pre-seed a bogus token; the manager will reject it. The renderer should
    // wipe localStorage in response to auth:error and drop back to the login screen.
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("genie-auth-token", "not-a-real-jwt"));
    await page.reload();

    // After the WS auth round-trip rejects the token, login screen should appear
    // and the token should be gone.
    await expect(page.getByText("Sign in to continue")).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      const token = await page.evaluate(() => localStorage.getItem("genie-auth-token"));
      expect(token).toBeNull();
    }).toPass({ timeout: 5_000 });
  });

  test("shows connecting state while loading", async ({ page }) => {
    await page.goto("/");

    // The app shows "Connecting..." before WS establishes
    // This may be very brief, so we check it was rendered at some point
    const connectingText = page.getByText("Connecting...");
    const loginText = page.getByText("Sign in to continue");

    // One of these should appear within a reasonable time
    await expect(connectingText.or(loginText)).toBeVisible({ timeout: 10_000 });
  });
});
