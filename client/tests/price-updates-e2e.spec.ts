import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:8081/";

async function goToEvents(page: import("@playwright/test").Page) {
  await page.goto(APP_URL);
  await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });
}

test.describe("Price Updates feature (Expo web @ localhost:8081)", () => {
  test("app launches directly into the Events view", async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
  });

  test("Events view shows price-updates badge for known event", async ({ page }) => {
    await goToEvents(page);
    await expect(page.getByTestId("event-docs-badge-33858191")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-price-updates-badge-33858191")).toBeVisible();
  });

  test("clicking price-updates badge opens the price updates panel", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-price-updates-badge-33858191").click();
    await expect(page.getByTestId("price-updates-panel")).toBeVisible({ timeout: 10000 });
  });

  test("price updates panel loads records from the API", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-price-updates-badge-33858191").click();
    await expect(page.getByTestId("price-updates-loading")).not.toBeVisible({ timeout: 15000 });

    const items = page.locator('[data-testid^="price-update-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("price updates panel close button dismisses it", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-price-updates-badge-33858191").click();
    await expect(page.getByTestId("price-updates-panel")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("price-updates-close").click();
    await expect(page.getByTestId("price-updates-panel")).not.toBeVisible();
  });
});
