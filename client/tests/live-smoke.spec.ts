import { test, expect } from "@playwright/test";

const LIVE_URL = "https://cf.backbet.co.uk";

test.describe("Live site smoke tests — cf.backbet.co.uk", () => {
  test("/runners page loads with data from Atlas", async ({ page }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    // Use ?u=&p= query param to auto-login without touching the UI
    await page.goto(`${LIVE_URL}/?u=matthew&p=beyer`);

    // Should be authenticated and on the events screen
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 15000 });

    // Navigate to /runners
    await page.goto(`${LIVE_URL}/runners`);

    // AllRunnersScreen should be visible
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 15000 });

    // Loading spinner should disappear
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 20000 });

    // At least one runner item must be present (confirms Atlas is serving data)
    const firstRunner = page.locator('[data-testid^="all-runner-item-"]').first();
    await expect(firstRunner).toBeVisible({ timeout: 15000 });

    // No uncaught JS errors
    expect(jsErrors).toHaveLength(0);
  });
});
