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

test.describe("Industry SP meeting/race drill-down (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("tapping the meeting header opens a full-screen meeting view", async ({ page }) => {
    await page.getByTestId("industry-sp-meeting-link-Cheltenham|2025-01-01").click();

    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-screen")).not.toBeVisible();
    await expect(page.getByTestId("industry-meeting-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/meeting?id=");

    // Both mocked races for this meeting are shown.
    await expect(page.getByTestId("industry-meeting-race-914592")).toBeVisible();
    await expect(page.getByTestId("industry-meeting-race-914593")).toBeVisible();
  });

  test("meeting screen back button returns to /isp", async ({ page }) => {
    await page.getByTestId("industry-sp-meeting-link-Cheltenham|2025-01-01").click();
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-meeting-back").click();

    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toMatch(/\/isp(\?|$)/);
  });

  test("tapping a race from the main list opens a full-screen race view", async ({ page }) => {
    await page.getByTestId("industry-sp-race-914592").click();

    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/race?id=914592");

    await expect(page.getByTestId("industry-race-item-12345")).toBeVisible();
    await expect(page.getByTestId("industry-race-item-12346")).toBeVisible();
    await expect(page.getByTestId("industry-race-item-12347")).toBeVisible();
  });

  test("race screen back button returns to the race's meeting", async ({ page }) => {
    await page.getByTestId("industry-sp-race-914592").click();
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-race-back").click();

    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/meeting?id=");
  });

  test("404 race shows an error state", async ({ page }) => {
    await page.goto("/isp/race?id=999999");
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-error")).toBeVisible();
  });
});

test.describe("Odds display mode + filters visibility toggle (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("ISP defaults to fraction display", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-odds-mode-toggle")).toHaveText("Odds: Fraction");
    await expect(page.getByTestId("industry-sp-isp-12345")).toHaveText("ISP 7/2");
  });

  test("toggling switches to decimal, rounded to 2dp", async ({ page }) => {
    await page.getByTestId("industry-sp-odds-mode-toggle").click();
    await expect(page.getByTestId("industry-sp-odds-mode-toggle")).toHaveText("Odds: Decimal");
    await expect(page.getByTestId("industry-sp-isp-12345")).toHaveText("ISP 4.50");
  });

  test("filter bar is visible by default and the toggle hides/shows it", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-filter-bar")).toBeVisible();
    await expect(page.getByTestId("industry-sp-filters-toggle")).toHaveText("Hide filters ▾");

    await page.getByTestId("industry-sp-filters-toggle").click();
    await expect(page.getByTestId("industry-sp-filter-bar")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-filters-toggle")).toHaveText("Show filters ▸");

    await page.getByTestId("industry-sp-filters-toggle").click();
    await expect(page.getByTestId("industry-sp-filter-bar")).toBeVisible();
  });

  test("meeting screen has its own fraction/decimal toggle", async ({ page }) => {
    await page.getByTestId("industry-sp-meeting-link-Cheltenham|2025-01-01").click();
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-meeting-loading")).not.toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("industry-meeting-isp-12345")).toHaveText("ISP 7/2");
    await page.getByTestId("industry-meeting-odds-mode-toggle").click();
    await expect(page.getByTestId("industry-meeting-isp-12345")).toHaveText("ISP 4.50");
  });

  test("race screen has its own fraction/decimal toggle", async ({ page }) => {
    await page.getByTestId("industry-sp-race-914592").click();
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("industry-race-isp-12345")).toHaveText("ISP 7/2");
    await page.getByTestId("industry-race-odds-mode-toggle").click();
    await expect(page.getByTestId("industry-race-isp-12345")).toHaveText("ISP 4.50");
  });
});
