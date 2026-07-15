import { test, expect } from "./fixtures";

// fixtures.ts mocks 1 race (914592 Cheltenham Chase) with 3 runners (ISP 4.5, 9.2, 2.1).
// Default ISP range 1-1000 means all 3 runners are in range. Default maxRIR=30 shows the race.

test.describe("Industry SP screen - sort order toggle (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("sort toggle button is present with default 'First → Last' label", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-sort-toggle")).toBeVisible();
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("First → Last");
  });

  test("clicking sort toggle changes label to 'Last → First'", async ({ page }) => {
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("Last → First");
  });

  test("clicking sort toggle twice returns to 'First → Last'", async ({ page }) => {
    await page.getByTestId("industry-sp-sort-toggle").click();
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("First → Last");
  });

  test("sort toggle sends sort=desc query param to /api/industry-sp", async ({ page }) => {
    let capturedSort: string | null = null;
    await page.route("**/api/industry-sp*", async (route) => {
      const url = new URL(route.request().url());
      capturedSort = url.searchParams.get("sort");
      await route.continue();
    });

    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(capturedSort).toBe("desc");
  });

  test("sort=asc is sent on initial load", async ({ page }) => {
    const sorts: string[] = [];
    await page.route("**/api/industry-sp*", async (route) => {
      const url = new URL(route.request().url());
      const s = url.searchParams.get("sort");
      if (s) sorts.push(s);
      await route.continue();
    });

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    expect(sorts.some(s => s === "asc")).toBe(true);
  });
});

test.describe("Industry SP screen - # in ISP range filter (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("# in ISP filter controls are present", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-min-rir-value")).toBeVisible();
    await expect(page.getByTestId("industry-sp-max-rir-value")).toBeVisible();
  });

  test("default state shows the mocked race (3 runners in range, default maxRIR=30)", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-race-914592")).toBeVisible({ timeout: 5000 });
  });

  test("setting maxRunnersInRange=2 hides the mocked race (it has 3 runners in range)", async ({ page }) => {
    const maxInput = page.getByTestId("industry-sp-max-rir-value");
    await maxInput.fill("2");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-race-914592")).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId("industry-sp-list")).toContainText("No races found.");
  });

  test("setting minRunnersInRange=3 maxRunnersInRange=3 keeps the mocked race visible", async ({ page }) => {
    await page.getByTestId("industry-sp-min-rir-value").fill("3");
    await page.getByTestId("industry-sp-max-rir-value").fill("3");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-race-914592")).toBeVisible({ timeout: 3000 });
  });

  test("resetting filter to defaults restores the mocked race", async ({ page }) => {
    await page.getByTestId("industry-sp-max-rir-value").fill("1");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-race-914592")).not.toBeVisible({ timeout: 3000 });
    await page.getByTestId("industry-sp-min-rir-value").fill("1");
    await page.getByTestId("industry-sp-max-rir-value").fill("30");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-race-914592")).toBeVisible({ timeout: 3000 });
  });
});

test.describe("Industry SP screen - navigation (MSW mocked)", () => {
  test("nav link from /events opens /isp", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("events-nav-isp").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  });

  test("← Events button navigates back to /events", async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-screen-events-button").click();
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("industry-sp-screen")).not.toBeVisible();
  });

  test("/ (home page) shows Industry SP screen directly", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });
});

test.describe("Industry SP screen - filter URL persistence + Reset (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("applying a filter writes it to the URL query string", async ({ page }) => {
    await page.getByTestId("industry-sp-max-rir-value").fill("2");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("maxInIspRange=2");
  });

  test("loading /isp with filter params in the URL pre-fills those filters", async ({ page }) => {
    await page.goto("/isp?maxInIspRange=2&sort=desc");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-max-rir-value")).toHaveValue("2");
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("Last → First");
  });

  test("Reset button restores default filter values and clears the URL", async ({ page }) => {
    await page.getByTestId("industry-sp-max-rir-value").fill("2");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("maxInIspRange=2");

    await page.getByTestId("industry-sp-filter-reset").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("industry-sp-max-rir-value")).toHaveValue("30");
    expect(page.url()).not.toContain("maxInIspRange");
    await expect(page.getByTestId("industry-sp-race-914592")).toBeVisible({ timeout: 3000 });
  });
});
