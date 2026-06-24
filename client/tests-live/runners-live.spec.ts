import { test, expect } from "@playwright/test";

const BASE = "https://app.backbet.co.uk";
const AUTH_PARAMS = "?auth=bWF0dGhldzpiZXllcg==";

// EC2 instance (app.backbet.co.uk) has been terminated — these tests are deprecated
test.describe.skip("runners-live", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/runners${AUTH_PARAMS}`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("all-runners-list")).toBeVisible({ timeout: 10000 });
  });

  test("runners list loads with at least one row", async ({ page }) => {
    const rows = page.locator('[data-testid^="all-runner-item-"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("sort toggle changes sort order", async ({ page }) => {
    const rows = page.locator('[data-testid^="all-runner-item-"]');
    await expect(rows.first()).toBeVisible();
    const firstBefore = await rows.first().textContent();

    await page.getByTestId("all-runners-sort-toggle").click();
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 30000 });
    await expect(rows.first()).toBeVisible();
    const firstAfter = await rows.first().textContent();

    expect(firstAfter).not.toBe(firstBefore);
  });

  test("filter Apply button reloads results", async ({ page }) => {
    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("all-runners-list")).toBeVisible();
    const rows = page.locator('[data-testid^="all-runner-item-"]');
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("export button opens export modal", async ({ page }) => {
    await page.getByTestId("all-runners-export-btn").click();
    await expect(page.getByTestId("all-runners-export-modal")).toBeVisible();
  });

  test("Events button navigates back to /events", async ({ page }) => {
    await page.getByTestId("all-runners-screen-events-button").click();
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
  });
});
