import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:80/";
const API_URL = "http://localhost:3000";
const AUTH = "Basic " + Buffer.from("matthew:beyer").toString("base64");

async function goToEvents(page: import("@playwright/test").Page) {
  await page.goto(APP_URL);
  await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 90000 });
}

test.describe("GET /api/industry-sp (live server @ localhost:3000)", () => {
  test("returns races array with raceId on each race", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/industry-sp`, {
      headers: { Authorization: AUTH },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.count).toBe(body.data.length);
    expect(typeof body.totalRunners).toBe("number");
  });

  test("each race has raceId, course, countryCode, runners", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/industry-sp`, {
      headers: { Authorization: AUTH },
    });
    const body = await res.json();
    const race = body.data[0];
    expect(typeof race.raceId).toBe("number");
    expect(typeof race.course).toBe("string");
    expect(typeof race.countryCode).toBe("string");
    expect(Array.isArray(race.runners)).toBe(true);
  });

  test("returns 401 without Authorization header", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/industry-sp`);
    expect(res.status()).toBe(401);
  });

  test("runners include isp field", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/industry-sp`, {
      headers: { Authorization: AUTH },
    });
    const body = await res.json();
    const allRunners = body.data.flatMap((r: any) => r.runners);
    const runnersWithIsp = allRunners.filter((r: any) => r.isp != null);
    expect(runnersWithIsp.length).toBeGreaterThan(0);
    for (const runner of runnersWithIsp) {
      expect(typeof runner.isp).toBe("number");
    }
  });
});

test.describe("Industry SP screen (Expo web @ localhost:80)", () => {
  test("nav link on Events screen navigates to /isp full-screen view", async ({ page }) => {
    await goToEvents(page);
    await expect(page.getByTestId("events-stats-bar")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-nav-isp").click();

    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("/isp URL shows Industry SP screen directly", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  });

  test("Industry SP screen loads data and shows runner rows", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-list")).toBeVisible({ timeout: 10000 });

    const items = page.locator('[data-testid^="industry-sp-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("Industry SP screen shows meeting section headers", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    const meetingHeaders = page.locator('[data-testid^="industry-sp-meeting-"]');
    await expect(meetingHeaders.first()).toBeVisible({ timeout: 10000 });
    expect(await meetingHeaders.count()).toBeGreaterThan(0);
  });

  test("Industry SP screen shows race time headers within each meeting", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    const raceHeaders = page.locator('[data-testid^="industry-sp-race-"]');
    await expect(raceHeaders.first()).toBeVisible({ timeout: 10000 });
    expect(await raceHeaders.count()).toBeGreaterThan(1);
  });

  test("header shows total runners and races count", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-screen")).toContainText("runners");
    await expect(page.getByTestId("industry-sp-screen")).toContainText("races");
  });

  test("ISP price is displayed for runners", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    const ispBadges = page.locator('[data-testid^="industry-sp-isp-"]');
    await expect(ispBadges.first()).toBeVisible({ timeout: 10000 });
    expect(await ispBadges.count()).toBeGreaterThan(0);

    const firstIspText = await ispBadges.first().textContent();
    expect(firstIspText).toMatch(/^ISP \d/);
  });

  test("← Events button navigates back to /events", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-screen-events-button").click();

    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("industry-sp-screen")).not.toBeVisible();
  });
});

test.describe("# in ISP range filter (real app at localhost:80)", () => {
  test("# in ISP filter controls are visible on /isp", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-min-rir-value")).toBeVisible();
    await expect(page.getByTestId("industry-sp-max-rir-value")).toBeVisible();
  });

  test("setting maxRunnersInRange=1 hides multi-runner races", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    const before = await page.locator(`[data-testid^="industry-sp-race-"]`).count();
    await page.getByTestId("industry-sp-max-rir-value").fill("1");
    await page.getByTestId("industry-sp-filter-apply").click();
    await page.waitForTimeout(500);
    const after = await page.locator(`[data-testid^="industry-sp-race-"]`).count();
    expect(after).toBeLessThan(before);
  });

  test("resetting filter restores original race count", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    const original = await page.locator(`[data-testid^="industry-sp-race-"]`).count();
    await page.getByTestId("industry-sp-max-rir-value").fill("1");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("industry-sp-min-rir-value").fill("1");
    await page.getByTestId("industry-sp-max-rir-value").fill("30");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    const restored = await page.locator(`[data-testid^="industry-sp-race-"]`).count();
    expect(restored).toBe(original);
  });
});

test.describe("Sort order toggle (real app at localhost:80)", () => {
  test("sort toggle button is visible on /isp", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-sort-toggle")).toBeVisible();
  });

  test("sort toggle starts showing 'First → Last'", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("First → Last");
  });

  test("clicking toggle switches to 'Last → First' and reloads data", async ({ page }) => {
    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("Last → First");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("industry-sp-list")).toBeVisible();
  });

  test("desc sort sends sort=desc to the API", async ({ page }) => {
    let sortParam: string | null = null;
    await page.route(`${API_URL}/api/industry-sp**`, (route) => {
      const url = new URL(route.request().url());
      sortParam = url.searchParams.get("sort");
      route.continue();
    });

    await page.goto(`${APP_URL}isp`);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });

    expect(sortParam).toBe("desc");
  });
});
