import { test, expect } from "./fixtures";

// Tests run against a static build with all API calls mocked via page.route().
// Each describe block sets the viewport to a narrow size and verifies the
// layout does not overflow or clip essential controls.

const MOBILE_VIEWPORT = { width: 375, height: 667 };  // iPhone SE
const TABLET_VIEWPORT = { width: 768, height: 1024 }; // narrow laptop / iPad
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

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

  test("filter-apply button is reachable by scrolling the filter bar", async ({ page }) => {
    const applyBtn = page.getByTestId("all-runners-filter-apply");
    await expect(applyBtn).toBeAttached();

    // Scroll the filter bar to the right to reveal Apply
    await page.getByTestId("all-runners-filter-bar").evaluate(el => {
      el.parentElement?.scrollBy({ left: 999, behavior: "instant" });
    });

    await expect(applyBtn).toBeVisible();
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
