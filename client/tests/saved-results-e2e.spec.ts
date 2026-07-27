import { test, expect } from "@playwright/test";

// Traditional e2e tier — assumes a dev backend (localhost:3000) and
// frontend (localhost:80, via the Apache proxy) already running by hand
// against the shared dev Mongo. Sampling-style assertions (not exact),
// since this tier doesn't control the dataset — see client/tests-local-ci/
// saved-results-*.spec.ts for the exact-assertion tier against a known
// seeded slice.
const APP_URL = "http://localhost:80/";

async function gotoIsp(page: import("@playwright/test").Page) {
  await page.goto(`${APP_URL}isp?email=matthew%40backbet.co.uk&password=beyer`);
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
}

test.describe("Saved Results — full loop (dev backend/frontend, shared dev Mongo)", () => {
  test("save, list, view detail, view graph, restore, delete", async ({ page }) => {
    await gotoIsp(page);

    await page.getByTestId("industry-sp-filter-save").click();
    await expect(page.getByTestId("save-result-dialog")).toBeVisible();
    await page.getByTestId("save-result-dialog-name-input").fill("Dev e2e save");
    await page.getByTestId("save-result-dialog-confirm").click();
    await expect(page.getByTestId("save-result-dialog")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-save-confirmed-banner")).toBeVisible();

    await page.getByTestId("industry-sp-menu-results-link").click();
    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 30000 });

    const item = page.locator('[data-testid^="saved-results-item-"]').filter({ hasText: "Dev e2e save" });
    await expect(item).toBeVisible();
    await item.click();

    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("split-detail-pnl-a")).toBeVisible();

    await page.getByTestId("saved-result-detail-view-graph").click();
    await expect(page.getByTestId("pnl-convergence-panel")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("pnl-convergence-panel-close").click();

    await page.getByTestId("saved-result-detail-restore").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-menu-results-link").click();
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 30000 });
    const target = page.locator('[data-testid^="saved-results-item-"]').filter({ hasText: "Dev e2e save" });
    const targetTestId = await target.getAttribute("data-testid");
    await target.locator(`[data-testid="${targetTestId}-delete"]`).click();
    await page.locator(`[data-testid="${targetTestId}-confirm-delete"]`).click();
    await expect(page.locator('[data-testid^="saved-results-item-"]').filter({ hasText: "Dev e2e save" })).toHaveCount(0);
  });

  test("badge/nav is reachable from the Events screen", async ({ page }) => {
    await page.goto(`${APP_URL}events?email=matthew%40backbet.co.uk&password=beyer`);
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("events-menu-results-link").click();
    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });
  });
});
