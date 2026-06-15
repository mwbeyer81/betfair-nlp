import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:80/";
const API_URL = "http://localhost:3000";
const AUTH = "Basic " + Buffer.from("matthew:beyer").toString("base64");

async function goToEvents(page: import("@playwright/test").Page) {
  await page.goto(APP_URL);
  await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });
}

test.describe("Runners API (live server @ localhost:3000)", () => {
  test("GET /api/events/:eventId/runners returns races array", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/33152096/runners`, {
      headers: { Authorization: AUTH },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.count).toBe(body.data.length);
  });

  test("each race has marketId, marketType, marketTime, runners array", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/33152096/runners`, {
      headers: { Authorization: AUTH },
    });
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);
    const race = body.data[0];
    expect(typeof race.marketId).toBe("string");
    expect(typeof race.marketType).toBe("string");
    expect(typeof race.marketTime).toBe("string");
    expect(Array.isArray(race.runners)).toBe(true);
    const runner = race.runners[0];
    expect(typeof runner.id).toBe("number");
    expect(typeof runner.name).toBe("string");
    expect(typeof runner.status).toBe("string");
    expect(typeof runner.sortPriority).toBe("number");
  });

  test("BSP market runners include bsp field", async ({ request }) => {
    // Chepstow WIN markets have bspReconciled=true
    const res = await request.get(`${API_URL}/api/events/33152096/runners`, {
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

  test("no REMOVED runners in any race", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/33152096/runners`, {
      headers: { Authorization: AUTH },
    });
    const body = await res.json();
    for (const race of body.data) {
      for (const runner of race.runners) {
        expect(runner.status).not.toBe("REMOVED");
      }
    }
  });

  test("returns 401 without Authorization header", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/33152096/runners`);
    expect(res.status()).toBe(401);
  });

  test("returns empty data for unknown eventId", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/unknown-event-xyz-000/runners`, {
      headers: { Authorization: AUTH },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
  });
});

test.describe("Runners feature (Expo web @ localhost:80)", () => {
  test("app launches directly into the Events view", async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("chat-screen")).not.toBeVisible();
  });

  test("Events view shows runners badge for known event", async ({ page }) => {
    await goToEvents(page);
    await expect(page.getByTestId("event-docs-badge-33152096")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-runners-badge-33152096")).toBeVisible();
    await expect(page.getByTestId("event-price-updates-badge-33152096")).toBeVisible();
  });

  test("clicking runners badge opens the runners panel", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-runners-badge-33152096").click();
    await expect(page.getByTestId("runners-panel")).toBeVisible({ timeout: 10000 });
  });

  test("runners panel loads runner list from the API", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-runners-badge-33152096").click();
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

    const items = page.locator('[data-testid^="runner-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("runners panel header shows event name", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-runners-badge-33152096").click();
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("runners-panel")).toContainText("Chepstow 1st Apr");
  });

  test("runners panel close button dismisses it", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-runners-badge-33152096").click();
    await expect(page.getByTestId("runners-panel")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("runners-panel-close").click();
    await expect(page.getByTestId("runners-panel")).not.toBeVisible();
  });

  test("BSP price is displayed for runners in a BSP market", async ({ page }) => {
    // Chepstow 33152096 has WIN markets with bspReconciled=true
    await goToEvents(page);
    await page.getByTestId("event-runners-badge-33152096").click();
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

    const bspBadges = page.locator('[data-testid^="runner-bsp-"]');
    await expect(bspBadges.first()).toBeVisible({ timeout: 10000 });
    expect(await bspBadges.count()).toBeGreaterThan(0);

    const firstBspText = await bspBadges.first().textContent();
    expect(firstBspText).toMatch(/^SP \d/);
  });
});
