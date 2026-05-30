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
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("all-runners-list")).toBeVisible({ timeout: 10000 });

    const items = page.locator('[data-testid^="all-runner-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("All Runners screen shows event section headers for both events", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId("all-runners-event-33858191")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("all-runners-event-33988522")).toBeVisible();
  });

  test("All Runners screen shows race time headers within each event", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });

    const raceHeaders = page.locator('[data-testid^="all-runners-race-"]');
    await expect(raceHeaders.first()).toBeVisible({ timeout: 10000 });
    expect(await raceHeaders.count()).toBeGreaterThan(1);
  });

  test("header shows total runners and races count", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("all-runners-screen")).toContainText("runners");
    await expect(page.getByTestId("all-runners-screen")).toContainText("races");
  });

  test("← Events button navigates back to /events", async ({ page }) => {
    await page.goto(`${APP_URL}runners`);
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("all-runners-screen-events-button").click();

    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("all-runners-screen")).not.toBeVisible();
  });
});
