import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:8081/";

test.describe("Event Groups feature (Expo web @ localhost:8081)", () => {
  test("app loads and Events button is visible", async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.getByTestId("events-button")).toBeVisible({ timeout: 15000 });
  });

  test("clicking Events button opens the panel", async ({ page }) => {
    await page.goto(APP_URL);
    await page.getByTestId("events-button").click();
    await expect(page.getByTestId("events-panel")).toBeVisible({ timeout: 10000 });
  });

  test("panel shows event group rows after loading", async ({ page }) => {
    await page.goto(APP_URL);
    await page.getByTestId("events-button").click();

    // Wait for loading to finish (loading indicator disappears)
    await expect(page.getByTestId("event-group-loading")).toBeVisible({ timeout: 5000 }).catch(() => {});
    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    // At least one event group item should be present
    const items = page.locator('[data-testid^="event-group-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("close button dismisses the panel", async ({ page }) => {
    await page.goto(APP_URL);
    await page.getByTestId("events-button").click();
    await expect(page.getByTestId("events-panel")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-panel-close").click();
    await expect(page.getByTestId("events-panel")).not.toBeVisible();
  });

  test("panel shows Cheltenham event from real data", async ({ page }) => {
    await page.goto(APP_URL);
    await page.getByTestId("events-button").click();

    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId("event-group-item-33858191")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Cheltenham 1st Jan")).toBeVisible();
  });
});
