import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:8081/";
const API_URL = "http://localhost:3000";
const AUTH = "Basic " + Buffer.from("matthew:beyer").toString("base64");

async function goToEvents(page: import("@playwright/test").Page) {
  await page.goto(APP_URL);
  await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });
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

test.describe("All Runners screen (Expo web @ localhost:8081)", () => {
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

  test("All Runners screen shows event section headers for both events", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 90000 });

    await expect(page.getByTestId("all-runners-event-33858191")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("all-runners-event-33988522")).toBeVisible();
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

test.describe("# in SP range filter (real app at localhost:8081)", () => {
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
    await page.waitForTimeout(500);
    await page.getByTestId("all-runners-min-rir-value").fill("1");
    await page.getByTestId("all-runners-max-rir-value").fill("30");
    await page.getByTestId("all-runners-filter-apply").click();
    await page.waitForTimeout(500);
    const restored = await page.locator(`[data-testid^="all-runners-race-"]`).count();
    expect(restored).toBe(original);
  });
});

