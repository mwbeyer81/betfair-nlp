import { test, expect } from "@playwright/test";

const BASE_URL = "https://app.backbet.co.uk";

// Verifies the session-cache fix and the SplitDetailPanel "← Filters" button
// against the deployed develop build, not just MSW-mocked data.
test.describe("app.backbet.co.uk — /isp session cache + Details Filters button", () => {
  test("returning to /isp via ← Filters reuses the cached splits result instantly", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await page.goto(`${BASE_URL}/isp?email=matthew%40backbet.co.uk&password=beyer`);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 15000 });
    expect(splitsRequests.length).toBe(1);

    await page.getByTestId("industry-sp-view-races-button-a").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 15000 });

    const backStart = Date.now();
    await page.getByTestId("industry-sp-races-back").click();
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 15000 });
    const backElapsed = Date.now() - backStart;

    // No second /splits request fired, and returning was fast — a real
    // network re-fetch on this dataset takes multiple seconds.
    expect(splitsRequests.length).toBe(1);
    expect(backElapsed).toBeLessThan(2000);
  });

  test("Details panel shows a ← Filters button that returns to the split cards", async ({ page }) => {
    await page.goto(`${BASE_URL}/isp?email=matthew%40backbet.co.uk&password=beyer`);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("industry-sp-split-details-button-a").click();
    const panel = page.getByTestId("split-detail-panel-a");
    await expect(panel).toBeVisible({ timeout: 10000 });

    const filtersBtn = page.getByTestId("split-detail-panel-filters-a");
    await expect(filtersBtn).toBeVisible();
    await expect(filtersBtn).toContainText("Filters");

    await filtersBtn.click();
    await expect(panel).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible();
  });

  test("pressing Apply on /isp always fetches fresh, even with unchanged filters", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await page.goto(`${BASE_URL}/isp?email=matthew%40backbet.co.uk&password=beyer`);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 15000 });
    expect(splitsRequests.length).toBe(1);

    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 15000 });
    expect(splitsRequests.length).toBe(2);
  });
});
