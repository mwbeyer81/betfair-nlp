import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// fixtures.ts mocks 1 race (914592 Cheltenham Chase) with 3 runners (ISP 4.5, 9.2, 2.1).
// Default ISP range 1-1000 means all 3 runners are in range. Default maxRIR=30 shows the race.
// /isp is the filters + PnL screen (no race list of its own); /isp/races is the
// dedicated races-list screen that reads whatever filters are in the URL.

// Drives the DateRangePicker (see DateRangePicker.tsx): open the picker,
// jump straight to a year via the header's year-grid (selecting a year
// always resets the visible month to January, making month navigation
// from there fully deterministic regardless of whatever month happened to
// be showing beforehand), step forward to the target month, tap the day,
// repeat for the second date, then Apply.
async function pickDateRange(page: Page, fromDate: string, toDate: string) {
  const prefix = "industry-sp-date-range-picker";
  await page.getByTestId(prefix).click();
  await expect(page.getByTestId(`${prefix}-modal`)).toBeVisible();

  for (const dateStr of [fromDate, toDate]) {
    const [year, month] = dateStr.split("-").map(Number);
    await page.getByTestId(`${prefix}-header-title`).click();
    await expect(page.getByTestId(`${prefix}-year-grid`)).toBeVisible();
    await page.getByTestId(`${prefix}-year-${year}`).click();
    for (let i = 0; i < month - 1; i++) {
      await page.getByTestId(`${prefix}-next-month`).click();
    }
    await page.getByTestId(`${prefix}-day-${dateStr}`).click();
  }

  await page.getByTestId(`${prefix}-apply`).click();
}

test.describe("Industry SP filters screen (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("nav link from /events opens /isp", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("events-nav-isp").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  });

  test("← Events button navigates back to /events", async ({ page }) => {
    await page.getByTestId("industry-sp-screen-events-button").click();
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("industry-sp-screen")).not.toBeVisible();
  });

  test("/ (home page) shows Industry SP screen directly", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("View Races button navigates to /isp/races", async ({ page }) => {
    await page.getByTestId("industry-sp-view-races-button-a").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/races");
  });

  test("both split cards are shown, each with their own View Races button", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible();
    await expect(page.getByTestId("industry-sp-split-card-b")).toBeVisible();
    await expect(page.getByTestId("industry-sp-view-races-button-a")).toBeVisible();
    await expect(page.getByTestId("industry-sp-view-races-button-b")).toBeVisible();
  });

  test("# in ISP filter controls are present", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-min-rir-value")).toBeVisible();
    await expect(page.getByTestId("industry-sp-max-rir-value")).toBeVisible();
  });

  test("setting maxRunnersInRange=2 zeroes out the aggregate (mocked race has 3 runners in range)", async ({ page }) => {
    const maxInput = page.getByTestId("industry-sp-max-rir-value");
    await maxInput.fill("2");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-split-card-a")).toContainText("View 0 Races");
    await expect(page.getByTestId("industry-sp-split-card-b")).toContainText("View 0 Races");
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
});

test.describe("Industry SP filters screen - session cache across navigation (MSW mocked)", () => {
  // Regression coverage for: navigating away from /isp and back used to
  // re-fetch /api/industry-sp/splits from scratch every time (component
  // unmounts on route change, wiping all state) — reported live as
  // "tapped Filters and it reloaded, which took ages". Filters should only
  // ever be *reapplied* (a genuine network request) when Apply or Reset is
  // pressed; any other reason this screen re-mounts should reuse the
  // sessionStorage-cached result instead.
  test("returning to /isp via ← Filters reuses the cached result — no second /splits request", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    expect(splitsRequests.length).toBe(1);

    await page.getByTestId("industry-sp-view-races-button-a").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-races-back").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    // The split cards must still show real data immediately — proves the
    // cache actually populated state, not just that no request fired.
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible();

    expect(splitsRequests.length).toBe(1);
  });

  test("closing the split detail panel doesn't trigger a new /splits request either", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    expect(splitsRequests.length).toBe(1);

    await page.getByTestId("industry-sp-split-details-button-a").click();
    await expect(page.getByTestId("split-detail-panel-a")).toBeVisible();
    await page.getByTestId("split-detail-panel-filters-a").click();
    await expect(page.getByTestId("split-detail-panel-a")).not.toBeVisible();

    expect(splitsRequests.length).toBe(1);
  });

  test("pressing Apply always fetches fresh, even with unchanged filters", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    expect(splitsRequests.length).toBe(1);

    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(splitsRequests.length).toBe(2);
  });

  test("changing filters and returning later reuses each combination's own cached result", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    expect(splitsRequests.length).toBe(1);

    // Apply a real filter change — a genuine new request, new cache entry.
    await page.getByTestId("industry-sp-max-rir-value").fill("2");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(splitsRequests.length).toBe(2);

    // Leave and come back — reuses the filtered result's cache entry.
    await page.getByTestId("industry-sp-view-races-button-a").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-races-back").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible();
    expect(splitsRequests.length).toBe(2);
  });
});

test.describe("Industry SP filters screen - filter URL persistence + Reset (MSW mocked)", () => {
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
    await page.goto("/isp?maxInIspRange=2");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-max-rir-value")).toHaveValue("2");
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
  });

  test("View Races carries the applied filter query string over to /isp/races", async ({ page }) => {
    await page.getByTestId("industry-sp-max-rir-value").fill("2");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-view-races-button-a").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    // Regression: the router's queryParams state goes stale after
    // history.replaceState calls, which could silently drop just-applied
    // filters when navigating to the races screen.
    expect(page.url()).toContain("maxInIspRange=2");
  });

  test("date filter defaults to 2024-01-01 – 2024-12-31 and stays out of the URL at that default", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-date-range-picker")).toContainText("Jan 1, 2024");
    await expect(page.getByTestId("industry-sp-date-range-picker")).toContainText("Dec 31, 2024");
    expect(page.url()).not.toContain("minDate");
    expect(page.url()).not.toContain("maxDate");
  });

  test("applying a custom date range writes minDate/maxDate to the URL and the /splits request", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await pickDateRange(page, "2023-01-01", "2023-06-30");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    expect(page.url()).toContain("minDate=2023-01-01");
    expect(page.url()).toContain("maxDate=2023-06-30");
    const lastRequest = splitsRequests[splitsRequests.length - 1];
    expect(lastRequest).toContain("minDate=2023-01-01");
    expect(lastRequest).toContain("maxDate=2023-06-30");
  });

  test("Reset restores the date range to the 2024 default and clears it from the URL", async ({ page }) => {
    await pickDateRange(page, "2023-01-01", "2023-06-30");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("minDate=2023-01-01");

    await page.getByTestId("industry-sp-filter-reset").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("industry-sp-date-range-picker")).toContainText("Jan 1, 2024");
    await expect(page.getByTestId("industry-sp-date-range-picker")).toContainText("Dec 31, 2024");
    expect(page.url()).not.toContain("minDate");
    expect(page.url()).not.toContain("maxDate");
  });

  test("a stale explicit split beyond the current total self-heals back to the default split", async ({ page }) => {
    // Reproduces a bookmarked/old URL carrying fromRowA/fromRowB row numbers
    // computed against a much larger total (e.g. from before the date
    // filter existed) landing on today's smaller default — Split B should
    // never render as a broken, permanently-empty "races 54622-9800/9800"
    // split; it should self-correct back to an even default split.
    //
    // Overrides the fixture's normal 1-race mock with a fixed totalRaces
    // of 2500 — large enough that the corrected 1000/1000-window default
    // (see getSplitStats) has real, non-empty content in both splits,
    // which the standard 1-race mock can never demonstrate.
    await page.route("**/api/industry-sp/splits*", async (route) => {
      const url = new URL(route.request().url());
      const totalRaces = 2500;
      const fromRowARaw = url.searchParams.get("fromRowA");
      let fromRowA: number, toRowA: number, fromRowB: number, toRowB: number;
      if (fromRowARaw == null) {
        fromRowA = 1; toRowA = 1000; fromRowB = 1001; toRowB = 2000;
      } else {
        fromRowA = parseInt(fromRowARaw, 10);
        toRowA = parseInt(url.searchParams.get("toRowA") ?? String(totalRaces), 10);
        fromRowB = parseInt(url.searchParams.get("fromRowB") ?? "1", 10);
        toRowB = totalRaces;
      }
      const totalA = Math.max(0, Math.min(toRowA, totalRaces) - fromRowA + 1);
      const totalB = Math.max(0, Math.min(toRowB, totalRaces) - fromRowB + 1);
      const pnl = { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 };
      await route.fulfill({
        json: {
          success: true,
          totalRaces,
          totalRunners: totalRaces * 2,
          filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
          countries: ["GB", "IE"],
          splitA: { fromRow: fromRowA, toRow: toRowA, total: totalA, totalRunners: totalA * 2, pnlStats: totalA > 0 ? pnl : { staked: 0, returns: 0, pnl: 0, count: 0 } },
          splitB: { fromRow: fromRowB, toRow: toRowB, total: totalB, totalRunners: totalB * 2, pnlStats: totalB > 0 ? pnl : { staked: 0, returns: 0, pnl: 0, count: 0 } },
        },
      });
    });

    await page.goto("/isp?fromRowA=1&toRowA=54621&fromRowB=54622");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });

    // The self-heal fires a second fetch, so isLoading briefly cycles
    // false→true→false again — poll on the split card's own text settling
    // rather than the loading indicator's timing, which could otherwise
    // catch the transient gap between the two fetches.
    await expect(page.getByTestId("industry-sp-split-card-a")).not.toContainText("54621", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-split-empty-b")).not.toBeVisible();
  });
});

test.describe("Industry SP races screen (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("default state shows the mocked race (3 runners in range, default maxRIR=30)", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-race-914592")).toBeVisible({ timeout: 5000 });
  });

  test("filters applied via the URL query string are respected", async ({ page }) => {
    await page.goto("/isp/races?maxInIspRange=2");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-list")).toContainText("No races found.");
  });

  test("← Filters button returns to /isp", async ({ page }) => {
    await page.getByTestId("industry-sp-races-back").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Industry SP races screen - sort order toggle (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
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

    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    expect(sorts.some(s => s === "asc")).toBe(true);
  });

  test("loading /isp/races with sort=desc in the URL starts sorted descending", async ({ page }) => {
    await page.goto("/isp/races?sort=desc");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("Last → First");
  });
});

test.describe("Industry SP meeting/race drill-down (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("tapping the meeting header opens a full-screen meeting view", async ({ page }) => {
    await page.getByTestId("industry-sp-meeting-link-Cheltenham|2025-01-01").click();

    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-races-screen")).not.toBeVisible();
    await expect(page.getByTestId("industry-meeting-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/meeting?id=");

    // Both mocked races for this meeting are shown.
    await expect(page.getByTestId("industry-meeting-race-914592")).toBeVisible();
    await expect(page.getByTestId("industry-meeting-race-914593")).toBeVisible();
  });

  test("meeting screen back button returns to /isp/races", async ({ page }) => {
    await page.getByTestId("industry-sp-meeting-link-Cheltenham|2025-01-01").click();
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-meeting-back").click();

    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toMatch(/\/isp\/races(\?|$)/);
  });

  test("tapping a race from the races list opens a full-screen race view", async ({ page }) => {
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

test.describe("Odds display mode (MSW mocked, on the races screen)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
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
