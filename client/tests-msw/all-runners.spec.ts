import { test, expect } from "./fixtures";

// fixtures.ts mocks 1 race (1.237066150 Cheltenham Chase) with 3 runners (BSP 4.5, 9.2, 2.1).
// Default SP range 1-1000 means all 3 runners are in range. Default maxRIR=30 shows the race.

test.describe("All Runners screen - sort order toggle (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("sort toggle button is present with default 'First → Last' label", async ({ page }) => {
    await expect(page.getByTestId("all-runners-sort-toggle")).toBeVisible();
    await expect(page.getByTestId("all-runners-sort-toggle")).toHaveText("First → Last");
  });

  test("clicking sort toggle changes label to 'Last → First'", async ({ page }) => {
    await page.getByTestId("all-runners-sort-toggle").click();
    await expect(page.getByTestId("all-runners-sort-toggle")).toHaveText("Last → First");
  });

  test("clicking sort toggle twice returns to 'First → Last'", async ({ page }) => {
    await page.getByTestId("all-runners-sort-toggle").click();
    await page.getByTestId("all-runners-sort-toggle").click();
    await expect(page.getByTestId("all-runners-sort-toggle")).toHaveText("First → Last");
  });

  test("sort toggle sends sort=desc query param to /api/runners", async ({ page }) => {
    let capturedSort: string | null = null;
    await page.route("**/api/runners*", async (route) => {
      const url = new URL(route.request().url());
      capturedSort = url.searchParams.get("sort");
      await route.continue();
    });

    await page.getByTestId("all-runners-sort-toggle").click();
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 10000 });
    expect(capturedSort).toBe("desc");
  });

  test("sort=asc is sent on initial load", async ({ page }) => {
    const sorts: string[] = [];
    await page.route("**/api/runners*", async (route) => {
      const url = new URL(route.request().url());
      const s = url.searchParams.get("sort");
      if (s) sorts.push(s);
      await route.continue();
    });

    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
    expect(sorts.some(s => s === "asc")).toBe(true);
  });
});

test.describe("All Runners screen - # in SP range filter (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("# in SP filter controls are present", async ({ page }) => {
    await expect(page.getByTestId("all-runners-min-rir-value")).toBeVisible();
    await expect(page.getByTestId("all-runners-max-rir-value")).toBeVisible();
  });

  test("default state shows the mocked race (3 runners in range, default maxRIR=30)", async ({ page }) => {
    await expect(page.getByTestId("all-runners-race-1.237066150")).toBeVisible({ timeout: 5000 });
  });

  test("setting maxRunnersInRange=2 hides the mocked race (it has 3 runners in range)", async ({ page }) => {
    const maxInput = page.getByTestId("all-runners-max-rir-value");
    await maxInput.fill("2");
    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-race-1.237066150")).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId("all-runners-list")).toContainText("No runners found.");
  });

  test("setting minRunnersInRange=3 maxRunnersInRange=3 keeps the mocked race visible", async ({ page }) => {
    await page.getByTestId("all-runners-min-rir-value").fill("3");
    await page.getByTestId("all-runners-max-rir-value").fill("3");
    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-race-1.237066150")).toBeVisible({ timeout: 3000 });
  });

  test("resetting filter to defaults restores the mocked race", async ({ page }) => {
    await page.getByTestId("all-runners-max-rir-value").fill("1");
    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-race-1.237066150")).not.toBeVisible({ timeout: 3000 });
    await page.getByTestId("all-runners-min-rir-value").fill("1");
    await page.getByTestId("all-runners-max-rir-value").fill("30");
    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-race-1.237066150")).toBeVisible({ timeout: 3000 });
  });
});
