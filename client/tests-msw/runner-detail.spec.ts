import { test, expect } from "./fixtures";

// fixtures.ts mocks raceId 914592 (Cheltenham Chase) with 3 runners.
// "Fact To File" (id 12347) has trainer "W P Mullins" with a 14-day form
// sample (3/14, 21%). "Springwell Bay" (id 12345) has trainer "W P Mullins"
// with no form sample.

test.describe("Runner Detail — tap-through from Races list (MSW mocked)", () => {
  test("tapping a runner navigates to Runner Detail with the full field set", async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-item-12347").click();

    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/runner");
    await expect(page.getByTestId("runner-detail-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-detail-course")).toHaveText("Cheltenham");
    await expect(page.getByTestId("runner-detail-status")).toHaveText("WINNER");
    await expect(page.getByTestId("runner-detail-isp")).toBeVisible();
    await expect(page.getByTestId("runner-detail-trainer-link")).toContainText("W P Mullins");
    await expect(page.getByTestId("runner-detail-trainer-form")).toContainText("3/14");
  });

  test("a runner with no trainer-form sample shows the no-sample message, not stale numbers", async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-item-12345").click();

    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-detail-trainer-form")).not.toBeVisible();
    await expect(page.getByText("No recent form sample.")).toBeVisible();
  });

  test("back button returns to Races list with its filter query string intact", async ({ page }) => {
    await page.goto("/isp/races?maxInIspRange=30&sort=desc");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-item-12347").click();
    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("runner-detail-back-button").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("maxInIspRange=30");
    expect(page.url()).toContain("sort=desc");
  });

  test("'View full history' navigates to Runner History, and its own back returns to Runner Detail, not the original list", async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-item-12347").click();
    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("runner-detail-view-history").click();
    await expect(page.getByTestId("runner-history-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/runner/history");

    await page.getByTestId("runner-history-back-button").click();
    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/runner");
    expect(page.url()).not.toContain("/isp/runner/history");
  });
});

test.describe("Runner Detail — tap-through from Meeting and Race screens (MSW mocked)", () => {
  test("tapping a runner on the meeting screen opens Runner Detail, back returns to the meeting", async ({ page }) => {
    await page.goto("/isp/meeting?id=" + encodeURIComponent("Cheltenham|2025-01-01"));
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-meeting-item-12347").click();

    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("runner-detail-back-button").click();
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
  });

  test("tapping a runner on the single race screen opens Runner Detail, back returns to the race", async ({ page }) => {
    await page.goto("/isp/race?id=914592");
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-race-item-12347").click();

    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("runner-detail-back-button").click();
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/race");
  });
});
