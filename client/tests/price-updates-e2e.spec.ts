import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:8081/";

// Helper: log in with matthew/beyer credentials
async function login(page: import("@playwright/test").Page) {
  await page.goto(APP_URL);
  await page.getByTestId("auth-username-input").fill("matthew");
  await page.getByTestId("auth-password-input").fill("beyer");
  await page.getByTestId("auth-login-button").click();
  // Wait for ChatScreen to appear
  await expect(page.getByTestId("events-button")).toBeVisible({ timeout: 5000 });
}

test.describe("Price Updates feature (Expo web @ localhost:8081)", () => {
  test("can log in and reach the chat screen", async ({ page }) => {
    await login(page);
    await expect(page.getByTestId("events-button")).toBeVisible();
  });

  test("Events panel shows price-updates badge next to docs badge", async ({ page }) => {
    await login(page);
    await page.getByTestId("events-button").click();

    // Wait for events to load
    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    // Both badges should appear for Cheltenham event
    await expect(page.getByTestId("event-docs-badge-33858191")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-price-updates-badge-33858191")).toBeVisible();
  });

  test("clicking price-updates badge opens the price updates panel", async ({ page }) => {
    await login(page);
    await page.getByTestId("events-button").click();

    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    await page.getByTestId("event-price-updates-badge-33858191").click();

    await expect(page.getByTestId("price-updates-panel")).toBeVisible({ timeout: 10000 });
  });

  test("price updates panel loads records from the API", async ({ page }) => {
    await login(page);
    await page.getByTestId("events-button").click();

    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    await page.getByTestId("event-price-updates-badge-33858191").click();

    // Wait for loading to finish
    await expect(page.getByTestId("price-updates-loading")).not.toBeVisible({ timeout: 15000 });

    // At least one price update item should appear
    const items = page.locator('[data-testid^="price-update-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("price updates panel close button dismisses it", async ({ page }) => {
    await login(page);
    await page.getByTestId("events-button").click();

    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    await page.getByTestId("event-price-updates-badge-33858191").click();
    await expect(page.getByTestId("price-updates-panel")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("price-updates-close").click();
    await expect(page.getByTestId("price-updates-panel")).not.toBeVisible();
  });
});
