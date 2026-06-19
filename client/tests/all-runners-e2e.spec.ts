import { test, expect } from "@playwright/test";
import { promises as fs } from "fs";

const APP_URL = "http://localhost:80/";
const API_URL = "http://localhost:3000";
const AUTH = "Basic " + Buffer.from("matthew:beyer").toString("base64");

async function goToEvents(page: import("@playwright/test").Page) {
  await page.goto(APP_URL);
  await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 90000 });
}

test.describe("GET /api/runners (live server @ localhost:3000)", () => {
  test("returns races array with eventId on each race", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/runners`, {
      headers: { Authorization: AUTH },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.count).toBe(body.data.length);
    expect(typeof body.totalRunners).toBe("number");
  });

  test("each race has eventId, eventName, marketId, runners", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/runners`, {
      headers: { Authorization: AUTH },
    });
    const body = await res.json();
    const race = body.data[0];
    expect(typeof race.eventId).toBe("string");
    expect(typeof race.eventName).toBe("string");
    expect(typeof race.marketId).toBe("string");
    expect(Array.isArray(race.runners)).toBe(true);
  });

  test("returns 401 without Authorization header", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/runners`);
    expect(res.status()).toBe(401);
  });

  test("BSP market runners include bsp field", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/runners`, {
      headers: { Authorization: AUTH },
    });
    const body = await res.json();
    const winRaces = body.data.filter((r: any) => r.marketType === "WIN");
    expect(winRaces.length).toBeGreaterThan(0);
    const allRunners = winRaces.flatMap((r: any) => r.runners);
    const runnersWithBsp = allRunners.filter((r: any) => r.bsp != null);
    expect(runnersWithBsp.length).toBeGreaterThan(0);
    for (const runner of runnersWithBsp) {
      expect(typeof runner.bsp).toBe("number");
    }
  });
});

test.describe("All Runners screen (Expo web @ localhost:80)", () => {
  test("clicking runners stat navigates to /runners full-screen view", async ({ page }) => {
    await goToEvents(page);
    await expect(page.getByTestId("events-stats-bar")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-total-runners").click();

    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("/runners URL shows All Runners screen directly", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
  });

  test("All Runners screen loads data and shows runner rows", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("all-runners-list")).toBeVisible({ timeout: 10000 });

    const items = page.locator('[data-testid^="all-runner-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("All Runners screen shows event section headers", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });

    const eventHeaders = page.locator('[data-testid^="all-runners-event-"]');
    await expect(eventHeaders.first()).toBeVisible({ timeout: 10000 });
    expect(await eventHeaders.count()).toBeGreaterThan(0);
  });

  test("All Runners screen shows race time headers within each event", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });

    const raceHeaders = page.locator('[data-testid^="all-runners-race-"]');
    await expect(raceHeaders.first()).toBeVisible({ timeout: 10000 });
    expect(await raceHeaders.count()).toBeGreaterThan(1);
  });

  test("header shows total runners and races count", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("all-runners-screen")).toContainText("runners");
    await expect(page.getByTestId("all-runners-screen")).toContainText("races");
  });

  test("BSP price is displayed for runners in WIN markets", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });

    const bspBadges = page.locator('[data-testid^="all-runner-bsp-"]');
    await expect(bspBadges.first()).toBeVisible({ timeout: 10000 });
    expect(await bspBadges.count()).toBeGreaterThan(0);

    const firstBspText = await bspBadges.first().textContent();
    expect(firstBspText).toMatch(/^SP \d/);
  });

  test("← Events button navigates back to /events", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("all-runners-screen-events-button").click();

    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("all-runners-screen")).not.toBeVisible();
  });
});

test.describe("# in SP range filter (real app at localhost:80)", () => {
  test("# in SP filter controls are visible on /runners", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("all-runners-min-rir-value")).toBeVisible();
    await expect(page.getByTestId("all-runners-max-rir-value")).toBeVisible();
  });

  test("setting maxRunnersInRange=1 hides multi-runner races", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    const before = await page.locator(`[data-testid^="all-runners-race-"]`).count();
    await page.getByTestId("all-runners-max-rir-value").fill("1");
    await page.getByTestId("all-runners-filter-apply").click();
    await page.waitForTimeout(500);
    const after = await page.locator(`[data-testid^="all-runners-race-"]`).count();
    expect(after).toBeLessThan(before);
  });

  test("resetting filter restores original race count", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    const original = await page.locator(`[data-testid^="all-runners-race-"]`).count();
    await page.getByTestId("all-runners-max-rir-value").fill("1");
    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("all-runners-min-rir-value").fill("1");
    await page.getByTestId("all-runners-max-rir-value").fill("30");
    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    const restored = await page.locator(`[data-testid^="all-runners-race-"]`).count();
    expect(restored).toBe(original);
  });
});

test.describe("Export runners", () => {
  test("export button is visible after data loads", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("all-runners-export-btn")).toBeVisible();
  });

  test("clicking export button shows CSV and Excel options", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("all-runners-export-btn").click();
    await expect(page.getByTestId("all-runners-export-modal")).toBeVisible();
    await expect(page.getByTestId("all-runners-export-csv")).toBeVisible();
    await expect(page.getByTestId("all-runners-export-xlsx")).toBeVisible();
  });

  test("CSV export triggers a file download with .csv extension", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("all-runners-export-btn").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("all-runners-export-csv").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test("Excel export triggers a file download with .xlsx extension", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("all-runners-export-btn").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("all-runners-export-xlsx").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test("cancel button closes the export modal", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("all-runners-export-btn").click();
    await expect(page.getByTestId("all-runners-export-modal")).toBeVisible();
    await page.getByTestId("all-runners-export-cancel").click();
    await expect(page.getByTestId("all-runners-export-modal")).not.toBeVisible();
  });

  test("# in SP filter does not reduce export row count (export matches P&L, not display)", async ({ page }) => {
    // Reproduce: BSP 4–6.999 creates races with 1 horse in range (visible with # in SP=1)
    // AND races with 2+ horses in range (hidden by # in SP=1 but counted in P&L).
    // Exporting with # in SP=1 should give the SAME rows as exporting with no # in SP
    // restriction — RIR is a display-only filter and must not shrink the export.
    test.setTimeout(300000); // two exports + two data loads

    function parseDataRows(csv: string): number {
      return csv
        .replace(/^﻿/, "")   // strip BOM
        .split(/\r?\n/)
        .slice(3)                 // skip P&L header, blank, column header
        .filter(r => r.trim().length > 0).length;
    }

    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });

    // Narrow BSP range so some races have exactly 1 horse in range, some have 2+
    await page.getByTestId("all-runners-min-bsp").fill("4");
    await page.getByTestId("all-runners-max-bsp").fill("6.999");
    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });

    // Export A — no # in SP restriction (default 1–30), captures all BSP-filtered runners
    await page.getByTestId("all-runners-export-btn").click();
    const [downloadA] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("all-runners-export-csv").click(),
    ]);
    const rowsA = parseDataRows(await fs.readFile(await downloadA.path(), "utf-8"));
    expect(rowsA).toBeGreaterThan(0);

    // Now set restrictive # in SP = 1 (hides races with 2+ horses in range)
    await page.getByTestId("all-runners-max-rir-value").fill("1");
    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });

    // Export B — same BSP, but # in SP = 1 restricts the display
    await page.getByTestId("all-runners-export-btn").click();
    const [downloadB] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("all-runners-export-csv").click(),
    ]);
    const rowsB = parseDataRows(await fs.readFile(await downloadB.path(), "utf-8"));

    // Export B must equal Export A: # in SP is a display filter only, not an export filter
    expect(rowsB).toBe(rowsA);
  });

  test("BSP range filter export row count matches pnlStats.count (all BSP-range runners across all races)", async ({ page, request }) => {
    // Reproduce: old code applied BSP filter on 100-race-capped data → only ~112 rows.
    // Fix: server limit raised to 10 000 so all matching races are fetched; export applies
    // BSP filter client-side → row count equals pnlStats.count (runners in range across ALL
    // matched races), matching the "horses" figure shown in the P&L bar.
    test.setTimeout(300000);

    function parseDataRows(csv: string): number {
      return csv
        .replace(/^﻿/, "")
        .split(/\r?\n/)
        .slice(3)
        .filter((r) => r.trim().length > 0).length;
    }

    // Cheap query (limit=1) — pnlStats aggregates across ALL matching races regardless of limit.
    const res = await request.get(
      `${API_URL}/api/runners?page=1&limit=1&minRunners=3&maxRunners=5&minBsp=4&maxBsp=6.99`,
      { headers: { Authorization: AUTH } }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const expectedRows: number = body.pnlStats.count;
    expect(expectedRows).toBeGreaterThan(0);

    // Apply the same filter in the UI
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("all-runners-min-value").fill("3");
    await page.getByTestId("all-runners-max-value").fill("5");
    await page.getByTestId("all-runners-min-bsp").fill("4");
    await page.getByTestId("all-runners-max-bsp").fill("6.99");
    await page.getByTestId("all-runners-filter-apply").click();
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });

    // Export CSV
    await page.getByTestId("all-runners-export-btn").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("all-runners-export-csv").click(),
    ]);
    const csvRows = parseDataRows(await fs.readFile(await download.path(), "utf-8"));

    // Export row count must match pnlStats.count: every runner contributing to the P&L
    // calculation appears as exactly one row in the CSV.
    expect(csvRows).toBe(expectedRows);
  });
});

test.describe("Sort order toggle (real app at localhost:80)", () => {
  test("sort toggle button is visible on /runners", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("all-runners-sort-toggle")).toBeVisible();
  });

  test("sort toggle starts showing 'First → Last'", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("all-runners-sort-toggle")).toHaveText("First → Last");
  });

  test("clicking toggle switches to 'Last → First' and reloads data", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });

    await page.getByTestId("all-runners-sort-toggle").click();
    await expect(page.getByTestId("all-runners-sort-toggle")).toHaveText("Last → First");
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("all-runners-list")).toBeVisible();
  });

  test("clicking toggle twice returns to 'First → Last'", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });

    await page.getByTestId("all-runners-sort-toggle").click();
    await expect(page.getByTestId("all-runners-sort-toggle")).toHaveText("Last → First");
    await page.getByTestId("all-runners-sort-toggle").click();
    await expect(page.getByTestId("all-runners-sort-toggle")).toHaveText("First → Last");
  });

  test("desc sort sends sort=desc to the API", async ({ page }) => {
    let sortParam: string | null = null;
    await page.route(`${API_URL}/api/runners**`, (route) => {
      const url = new URL(route.request().url());
      sortParam = url.searchParams.get("sort");
      route.continue();
    });

    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("all-runners-sort-toggle").click();
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 30000 });

    expect(sortParam).toBe("desc");
  });

  test("desc order returns races with most recent first", async ({ page, request }) => {
    const ascRes = await request.get(`${API_URL}/api/runners?sort=asc&limit=50`, {
      headers: { Authorization: AUTH },
    });
    const descRes = await request.get(`${API_URL}/api/runners?sort=desc&limit=50`, {
      headers: { Authorization: AUTH },
    });
    const ascBody = await ascRes.json();
    const descBody = await descRes.json();
    expect(ascBody.data.length).toBeGreaterThan(1);
    expect(descBody.data.length).toBeGreaterThan(1);

    const firstAscTime = new Date(ascBody.data[0].marketTime).getTime();
    const firstDescTime = new Date(descBody.data[0].marketTime).getTime();
    expect(firstDescTime).toBeGreaterThanOrEqual(firstAscTime);
  });
});

