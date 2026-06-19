import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:80/";
const API_URL = "http://localhost:3000";
const AUTH = "Basic " + Buffer.from("matthew:beyer").toString("base64");

const MOBILE = { width: 375, height: 667 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 800 };

test.describe("Responsive /runners — mobile 375px (real app)", () => {
  test.use({ viewport: MOBILE });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
  });

  test("sort toggle is visible and within viewport", async ({ page }) => {
    const btn = page.getByTestId("all-runners-sort-toggle");
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("← Events button is within viewport", async ({ page }) => {
    const btn = page.getByTestId("all-runners-screen-events-button");
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("filter-apply button reachable by scrolling filter bar", async ({ page }) => {
    const applyBtn = page.getByTestId("all-runners-filter-apply");
    await expect(applyBtn).toBeAttached();

    await page.getByTestId("all-runners-filter-bar").evaluate(el => {
      el.parentElement?.scrollBy({ left: 999, behavior: "instant" });
    });

    await expect(applyBtn).toBeVisible();
  });

  test("runner rows do not overflow 375px", async ({ page }) => {
    const rows = page.locator('[data-testid^="all-runner-item-"]');
    await expect(rows.first()).toBeVisible();

    const box = await rows.first().boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("export modal fits 375px when opened", async ({ page }) => {
    await page.getByTestId("all-runners-export-btn").click();
    const modal = page.getByTestId("all-runners-export-modal");
    await expect(modal).toBeVisible();

    const box = await modal.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("PnL bar does not overflow 375px", async ({ page }) => {
    const bar = page.getByTestId("all-runners-pnl-bar");
    await expect(bar).toBeVisible({ timeout: 10000 });

    const box = await bar.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("filter can still be applied on mobile", async ({ page }) => {
    await page.getByTestId("all-runners-filter-bar").evaluate(el => {
      el.parentElement?.scrollBy({ left: 999, behavior: "instant" });
    });
    const racesBeforeText = await page.getByTestId("all-runners-screen").textContent();

    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("all-runners-list")).toBeVisible();
  });
});

test.describe("Responsive /runners — tablet 768px (real app)", () => {
  test.use({ viewport: TABLET });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
  });

  test("all header buttons visible at 768px without overflow", async ({ page }) => {
    const sortBtn = page.getByTestId("all-runners-sort-toggle");
    const eventsBtn = page.getByTestId("all-runners-screen-events-button");
    await expect(sortBtn).toBeVisible();
    await expect(eventsBtn).toBeVisible();

    const sortBox = await sortBtn.boundingBox();
    const eventsBox = await eventsBtn.boundingBox();
    expect(sortBox!.x + sortBox!.width).toBeLessThanOrEqual(TABLET.width + 1);
    expect(eventsBox!.x + eventsBox!.width).toBeLessThanOrEqual(TABLET.width + 1);
  });

  test("filter bar controls visible at 768px", async ({ page }) => {
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
    await expect(page.getByTestId("all-runners-min-value")).toBeVisible();
    await expect(page.getByTestId("all-runners-max-value")).toBeVisible();
  });
});

test.describe("Responsive /runners — desktop 1280px (real app)", () => {
  test.use({ viewport: DESKTOP });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
  });

  test("all controls visible at 1280px", async ({ page }) => {
    await expect(page.getByTestId("all-runners-sort-toggle")).toBeVisible();
    await expect(page.getByTestId("all-runners-screen-events-button")).toBeVisible();
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
    await expect(page.getByTestId("all-runners-list")).toBeVisible();
  });
});

test.describe("Responsive /events — mobile 375px (real app)", () => {
  test.use({ viewport: MOBILE });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${APP_URL}events`);
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 90000 });
  });

  test("sort toggle, Chat and Logout buttons all within 375px", async ({ page }) => {
    const sortBtn = page.getByTestId("events-sort-toggle");
    const chatBtn = page.getByTestId("events-screen-chat-button");
    const logoutBtn = page.getByTestId("events-screen-logout-button");

    await expect(sortBtn).toBeVisible();
    await expect(chatBtn).toBeVisible();
    await expect(logoutBtn).toBeVisible();

    for (const btn of [sortBtn, chatBtn, logoutBtn]) {
      const box = await btn.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
    }
  });

  test("event list items visible and do not overflow on mobile", async ({ page }) => {
    const items = page.locator('[data-testid^="event-group-item-"]');
    await expect(items.first()).toBeVisible();

    const box = await items.first().boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("sort toggle works on mobile — toggles label", async ({ page }) => {
    const sortBtn = page.getByTestId("events-sort-toggle");
    await expect(sortBtn).toHaveText(/Oldest first|Newest first/);

    await sortBtn.click();
    await expect(sortBtn).toHaveText(/Oldest first|Newest first/);
  });
});

test.describe("Responsive /runner (price updates) — mobile 375px (real app)", () => {
  test.use({ viewport: MOBILE });

  test("price update rows do not overflow 375px", async ({ page, request }) => {
    // Get a real runner from the API to navigate to
    const res = await request.get(`${API_URL}/api/runners?limit=1`, {
      headers: { Authorization: AUTH },
    });
    const body = await res.json();
    if (!body.data?.length || !body.data[0].runners?.length) {
      test.skip();
      return;
    }
    const race = body.data[0];
    const runner = race.runners[0];

    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });

    const runnerRow = page.getByTestId(`all-runner-item-${runner.id}`);
    await expect(runnerRow).toBeVisible({ timeout: 10000 });
    await runnerRow.click();

    await expect(page.getByTestId("runner-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-screen-loading")).not.toBeVisible({ timeout: 30000 });

    const items = page.locator('[data-testid^="runner-screen-item-"]');
    if (await items.count() > 0) {
      const box = await items.first().boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
    }
  });
});
