import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:8081";

test.describe("App smoke tests", () => {
  test("app loads and renders root element", async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator("body")).toBeVisible();
  });

  test("app has interactive content", async ({ page }) => {
    await page.goto(APP_URL);
    // App loads into the events screen
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 15000 });
  });

  test("no uncaught JS errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", err => errors.push(err.message));

    await page.goto(APP_URL);
    // Give the app a moment to settle
    await page.waitForTimeout(2000);

    expect(errors).toHaveLength(0);
  });
});
