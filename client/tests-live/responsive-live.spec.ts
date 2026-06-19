/**
 * Responsive smoke tests against the live production site at app.backbet.co.uk.
 * Tests use URL-based auth (?u=matthew&p=beyer) to bypass the login screen.
 */
import { test, expect } from "@playwright/test";

const BASE = "https://app.backbet.co.uk";
const AUTH_PARAMS = "?u=matthew&p=beyer";

const MOBILE  = { width: 375,  height: 667  };
const TABLET  = { width: 768,  height: 1024 };
const DESKTOP = { width: 1280, height: 800  };

// ─── /runners at 375px ───────────────────────────────────────────────────────

test.describe("Live /runners — iPhone 375px", () => {
  test.use({ viewport: MOBILE });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/runners${AUTH_PARAMS}`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("all-runners-list")).toBeVisible({ timeout: 10000 });
  });

  test("sort toggle visible and within 375px", async ({ page }) => {
    const btn = page.getByTestId("all-runners-sort-toggle");
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("← Events button visible and within 375px", async ({ page }) => {
    const btn = page.getByTestId("all-runners-screen-events-button");
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("filter-apply reachable by scrolling filter bar", async ({ page }) => {
    const applyBtn = page.getByTestId("all-runners-filter-apply");
    await expect(applyBtn).toBeAttached();
    await page.getByTestId("all-runners-filter-bar").evaluate(el => {
      el.parentElement?.scrollBy({ left: 9999, behavior: "instant" });
    });
    await expect(applyBtn).toBeVisible();
  });

  test("runner rows do not overflow 375px", async ({ page }) => {
    const row = page.locator('[data-testid^="all-runner-item-"]').first();
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("export modal fits 375px", async ({ page }) => {
    await page.getByTestId("all-runners-export-btn").click();
    const modal = page.getByTestId("all-runners-export-modal");
    await expect(modal).toBeVisible();
    const box = await modal.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("PnL bar stays within 375px", async ({ page }) => {
    const bar = page.getByTestId("all-runners-pnl-bar");
    await expect(bar).toBeVisible({ timeout: 10000 });
    const box = await bar.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("filter still works after scrolling to Apply on mobile", async ({ page }) => {
    await page.getByTestId("all-runners-filter-bar").evaluate(el => {
      el.parentElement?.scrollBy({ left: 9999, behavior: "instant" });
    });
    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("all-runners-list")).toBeVisible();
  });
});

// ─── /runners at 768px ───────────────────────────────────────────────────────

test.describe("Live /runners — tablet 768px", () => {
  test.use({ viewport: TABLET });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/runners${AUTH_PARAMS}`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
  });

  test("header buttons visible, filter apply visible", async ({ page }) => {
    await expect(page.getByTestId("all-runners-sort-toggle")).toBeVisible();
    await expect(page.getByTestId("all-runners-screen-events-button")).toBeVisible();
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
  });
});

// ─── /runners at 1280px ──────────────────────────────────────────────────────

test.describe("Live /runners — desktop 1280px", () => {
  test.use({ viewport: DESKTOP });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/runners${AUTH_PARAMS}`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
  });

  test("all controls visible at full width", async ({ page }) => {
    await expect(page.getByTestId("all-runners-sort-toggle")).toBeVisible();
    await expect(page.getByTestId("all-runners-screen-events-button")).toBeVisible();
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
    await expect(page.getByTestId("all-runners-list")).toBeVisible();
  });
});

// ─── /events at 375px ────────────────────────────────────────────────────────

test.describe("Live /events — iPhone 375px", () => {
  test.use({ viewport: MOBILE });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/events${AUTH_PARAMS}`);
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 90000 });
  });

  test("sort toggle, Chat and Logout buttons all within 375px", async ({ page }) => {
    for (const id of ["events-sort-toggle", "events-screen-chat-button", "events-screen-logout-button"]) {
      const btn = page.getByTestId(id);
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
    }
  });

  test("event items visible and do not overflow", async ({ page }) => {
    const item = page.locator('[data-testid^="event-group-item-"]').first();
    await expect(item).toBeVisible({ timeout: 10000 });
    const box = await item.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });
});
