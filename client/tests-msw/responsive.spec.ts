import { test, expect } from "./fixtures";

// Tests run against a static build with all API calls mocked via page.route().
// Each describe block sets the viewport to a narrow size and verifies the
// layout does not overflow or clip essential controls.

const MOBILE_VIEWPORT = { width: 375, height: 667 };  // iPhone SE
// iPhone 12 / 13 / 12 mini / 13 mini viewport width is 390 or 375 depending on
// model. Using a plain {width,height} object rather than the Playwright
// devices["iPhone 12"] preset: spreading a full device preset (which also
// carries defaultBrowserType) inside test.use() inside a describe block is
// rejected by Playwright 1.55 ("forces a new worker"); a plain viewport
// object doesn't hit that restriction.
const IPHONE_12_VIEWPORT = { width: 390, height: 844 };
const IPHONE_12_MINI_VIEWPORT = { width: 375, height: 812 };
const TABLET_VIEWPORT = { width: 768, height: 1024 }; // narrow laptop / iPad
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

// Scans every element in the page and returns any whose right edge extends
// past the viewport width — used to catch text/badges clipped off-screen
// rather than just checking a handful of known container elements.
async function findOverflowingElements(page: import("@playwright/test").Page, viewportWidth: number) {
  return page.evaluate((w) => {
    const results: { tag: string; testid: string | null; right: number; text: string }[] = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > w + 1) {
        results.push({
          tag: el.tagName,
          testid: el.getAttribute("data-testid"),
          right: Math.round(r.right),
          text: (el.textContent || "").slice(0, 40),
        });
      }
    });
    return results;
  }, viewportWidth);
}

test.describe("Responsive layout — /runners (MSW mocked, 375px)", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("sort toggle and ← Events buttons are within viewport width", async ({ page }) => {
    const sortBtn = page.getByTestId("all-runners-sort-toggle");
    const eventsBtn = page.getByTestId("all-runners-screen-events-button");

    await expect(sortBtn).toBeVisible();
    await expect(eventsBtn).toBeVisible();

    const sortBox = await sortBtn.boundingBox();
    const eventsBox = await eventsBtn.boundingBox();

    expect(sortBox!.x + sortBox!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    expect(eventsBox!.x + eventsBox!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });

  test("filter bar fits within 375px — no horizontal scroll needed", async ({ page }) => {
    const bar = page.getByTestId("all-runners-filter-bar");
    await expect(bar).toBeVisible();

    const box = await bar.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

    // Apply button must be visible without any manual scrolling
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
  });

  test("runner rows do not overflow viewport width", async ({ page }) => {
    const firstRow = page.locator('[data-testid^="all-runner-item-"]').first();
    await expect(firstRow).toBeVisible();

    const box = await firstRow.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });

  test("export modal fits within 375px viewport", async ({ page }) => {
    const exportBtn = page.getByTestId("all-runners-export-btn");
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    const modal = page.getByTestId("all-runners-export-modal");
    await expect(modal).toBeVisible();

    const box = await modal.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });

  test("PnL bar is fully within viewport", async ({ page }) => {
    const bar = page.getByTestId("all-runners-pnl-bar");
    await expect(bar).toBeVisible();

    const box = await bar.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });
});

test.describe("Responsive layout — /runners (MSW mocked, iPhone 12)", () => {
  test.use({ viewport: IPHONE_12_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("filter bar and numeric inputs fit within the iPhone 12 viewport", async ({ page }) => {
    const bar = page.getByTestId("all-runners-filter-bar");
    await expect(bar).toBeVisible();

    const viewportWidth = 390;
    const box = await bar.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(viewportWidth);
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
  });

  test("BSP and Race numeric inputs render entered values without clipping", async ({ page }) => {
    const minBsp = page.getByTestId("all-runners-min-bsp");
    await minBsp.fill("1234.5");
    const minBspClip = await minBsp.evaluate(
      (el: HTMLInputElement) => el.scrollWidth <= el.clientWidth
    );
    expect(minBspClip).toBe(true);

    const toRow = page.getByTestId("all-runners-to-row");
    await toRow.fill("12345");
    const toRowClip = await toRow.evaluate(
      (el: HTMLInputElement) => el.scrollWidth <= el.clientWidth
    );
    expect(toRowClip).toBe(true);
  });

  test("runner rows do not overflow the iPhone 12 viewport width", async ({ page }) => {
    const firstRow = page.locator('[data-testid^="all-runner-item-"]').first();
    await expect(firstRow).toBeVisible();

    const box = await firstRow.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1);
  });
});

test.describe("Responsive layout — /isp (MSW mocked, iPhone 12 mini, 375px)", () => {
  test.use({ viewport: IPHONE_12_MINI_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("no element on the page overflows the 375px viewport", async ({ page }) => {
    // Regression test: raceHeader (race time/type/runner-count/PnL%) and
    // runnerRow (ISP/stake/PnL/status pill) were flexDirection:row with no
    // flexWrap and no flexShrink protection, so on a narrow viewport the
    // trailing element (PnL% or the WINNER/LOSER/PLACED pill) got pushed
    // off-screen with nothing to wrap it onto a second line. filterStepper
    // had a related but distinct bug: it wrapped its own children correctly,
    // but had no width constraint on itself as a child of the outer
    // filterBar wrap, so it grew to fit its unwrapped content and overflowed
    // its own parent before its internal wrap could ever engage.
    const overflowing = await findOverflowingElements(page, IPHONE_12_MINI_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });

  test("filter bar, race header, and runner rows fit within the viewport", async ({ page }) => {
    const bar = page.getByTestId("industry-sp-filter-bar");
    await expect(bar).toBeVisible();
    const barBox = await bar.boundingBox();
    expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);

    const raceHeader = page.locator('[data-testid^="industry-sp-race-"]:not([data-testid="industry-sp-race-bound"])').first();
    await expect(raceHeader).toBeVisible();
    const raceBox = await raceHeader.boundingBox();
    expect(raceBox!.x + raceBox!.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);

    const runnerRow = page.locator('[data-testid^="industry-sp-item-"]').first();
    await expect(runnerRow).toBeVisible();
    const runnerBox = await runnerRow.boundingBox();
    expect(runnerBox!.x + runnerBox!.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);

    await expect(page.getByTestId("industry-sp-filter-apply")).toBeVisible();
  });

  test("PnL percentage text and status pill are visible, not clipped", async ({ page }) => {
    // These are the two specific pieces of text that were clipped off-screen
    // on a real iPhone 12 mini before the flexWrap fix.
    const raceHeader = page.locator('[data-testid^="industry-sp-race-"]:not([data-testid="industry-sp-race-bound"])').first();
    await expect(raceHeader).toContainText("%");

    const runnerRow = page.locator('[data-testid^="industry-sp-item-"]').first();
    const runnerText = await runnerRow.textContent();
    expect(runnerText).toMatch(/LOSER|WINNER|PLACED/);
    await expect(runnerRow).toBeVisible();
  });

  test("header buttons ('First → Last', '← Events') fit within the viewport", async ({ page }) => {
    const sortBtn = page.getByTestId("industry-sp-sort-toggle");
    const eventsBtn = page.getByTestId("industry-sp-screen-events-button");
    await expect(sortBtn).toBeVisible();
    await expect(eventsBtn).toBeVisible();

    const eventsBox = await eventsBtn.boundingBox();
    expect(eventsBox!.x + eventsBox!.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);
  });
});

test.describe("Responsive layout — /runners (MSW mocked, 768px)", () => {
  test.use({ viewport: TABLET_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("all header buttons visible at 768px", async ({ page }) => {
    await expect(page.getByTestId("all-runners-sort-toggle")).toBeVisible();
    await expect(page.getByTestId("all-runners-screen-events-button")).toBeVisible();
  });

  test("filter-apply button visible without scrolling at 768px", async ({ page }) => {
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
  });
});

test.describe("Responsive layout — /runners (MSW mocked, 1280px)", () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("all header buttons visible at 1280px", async ({ page }) => {
    await expect(page.getByTestId("all-runners-sort-toggle")).toBeVisible();
    await expect(page.getByTestId("all-runners-screen-events-button")).toBeVisible();
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
  });
});

// Note: /events responsive tests are in tests/responsive-e2e.spec.ts (real server) because
// the events screen requires an authenticated session that the static MSW build cannot mock.
