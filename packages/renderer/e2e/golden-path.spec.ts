/**
 * Golden-path Playwright spec — covers the highest-value end-to-end flow:
 *   1. Login via /test-login (the dev-only bypass that exchanges an email for
 *      a JWT, redirecting to the renderer with the token in the URL).
 *   2. Renderer auto-picks up the token, opens the WebSocket to the manager,
 *      and lands on /recipes.
 *   3. Recipes page loads, built-in recipes are visible.
 *   4. Sidebar navigation between Recipes and Help works.
 *   5. "New Recipe" form opens and can be cancelled (no DB writes).
 *
 * This spec is intentionally read-only — no recipe creation, no cloud API
 * calls — so it can run repeatedly against the dev DB without side effects.
 *
 * The /test-login endpoint requires an existing validated user. The CI/local
 * setup must have `paul.brie@teleporthq.io` (superadmin) in the database;
 * see packages/manager/src/ws-server.ts for the loopback-only handler.
 */

import { test, expect } from "@playwright/test";

const TEST_USER = "paul.brie@teleporthq.io";

test.describe.configure({ mode: "serial" });

test.describe("Golden path: login → recipes → navigate", () => {
  test("test-login redirects to the renderer with a token in the URL", async ({ page }) => {
    // The manager runs on :9876; /test-login is loopback-only and returns a 302
    // to the renderer carrying ?token=<JWT>. The renderer's ws.ts (line 65) sees
    // that token, persists it to localStorage, and strips it from the URL.
    const response = await page.goto(
      `http://localhost:9876/test-login?email=${encodeURIComponent(TEST_USER)}&redirect=/recipes`,
      { waitUntil: "domcontentloaded" },
    );

    // After following the 302 we should be on the renderer's /recipes page.
    await expect(page).toHaveURL(/localhost:3000\/recipes/);
    expect(response?.status()).toBeLessThan(400);
  });

  test("authenticated session lands on /recipes and shows the user", async ({ page }) => {
    await page.goto(`http://localhost:9876/test-login?email=${encodeURIComponent(TEST_USER)}&redirect=/recipes`);

    // Sidebar shows user identity once the WS auth round-trip completes.
    await expect(page.getByText("Paul Brie")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("superadmin")).toBeVisible();
  });

  test("recipes page renders the built-in + user recipes table", async ({ page }) => {
    await page.goto(`http://localhost:9876/test-login?email=${encodeURIComponent(TEST_USER)}&redirect=/recipes`);

    // Page heading.
    await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible({ timeout: 15_000 });

    // At least one built-in recipe must render (Chrome is one of the static ones).
    await expect(page.getByText("chrome", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Install headless Chrome browser")).toBeVisible();

    // The "built-in" badge should appear on at least one row.
    await expect(page.locator("text=built-in").first()).toBeVisible();
  });

  test("sidebar navigation between Recipes and Help is reactive", async ({ page }) => {
    await page.goto(`http://localhost:9876/test-login?email=${encodeURIComponent(TEST_USER)}&redirect=/recipes`);

    // Wait until the recipes page is fully rendered before navigating.
    await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Help" }).click();
    await expect(page).toHaveURL(/\/help$/);

    await page.getByRole("button", { name: "Recipes" }).click();
    await expect(page).toHaveURL(/\/recipes$/);
    await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
  });

  test("'New Recipe' opens the form and can be cancelled without DB writes", async ({ page }) => {
    await page.goto(`http://localhost:9876/test-login?email=${encodeURIComponent(TEST_USER)}&redirect=/recipes`);
    await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible({ timeout: 15_000 });

    // The +New Recipe button is in the top toolbar.
    await page.getByRole("button", { name: /New Recipe/ }).click();

    // Form heading (the in-panel "New recipe" label, exact match to disambiguate
    // from the "+ New Recipe" toolbar button).
    await expect(page.getByText("New recipe", { exact: true })).toBeVisible();
    // Script tab labels (rendered as plain <button>s with their JS field names).
    await expect(page.getByText("installScript", { exact: true })).toBeVisible();
    await expect(page.getByText("checkScript", { exact: true })).toBeVisible();

    // Cancel returns to the list without saving.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
    await expect(page.getByText("New recipe", { exact: true })).not.toBeVisible();
  });
});
