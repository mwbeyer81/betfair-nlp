import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:8081/";
const API_URL = "http://localhost:3000";
const AUTH = "Basic " + Buffer.from("matthew:beyer").toString("base64");

const EVENT_ID = "33988522";
const EVENT_NAME = "Leopardstown 1st Feb";

async function goToEvents(page: import("@playwright/test").Page) {
  await page.goto(APP_URL);
  await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });
}

test.describe(`${EVENT_NAME} — API (live server @ localhost:3000)`, () => {
  test("event appears in /api/events/grouped", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/grouped`, {
      headers: { Authorization: AUTH },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const event = body.data.find((g: { eventId: string }) => g.eventId === EVENT_ID);
    expect(event).toBeDefined();
    expect(event.eventName).toBe(EVENT_NAME);
  });

  test("runners endpoint returns races with runners for the event", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/${EVENT_ID}/runners`, {
      headers: { Authorization: AUTH },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const race = body.data[0];
    expect(typeof race.marketId).toBe("string");
    expect(typeof race.marketType).toBe("string");
    expect(Array.isArray(race.runners)).toBe(true);
  });

  test("price-updates endpoint returns data for the event", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/${EVENT_ID}/price-updates`, {
      headers: { Authorization: AUTH },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].eventId).toBe(EVENT_ID);
  });

  test("runner price-updates endpoint returns data for a specific runner", async ({ request }) => {
    const runnersRes = await request.get(`${API_URL}/api/events/${EVENT_ID}/runners`, {
      headers: { Authorization: AUTH },
    });
    const { data: races } = await runnersRes.json();
    // Pick first runner from first race
    const runnerId = races[0].runners[0].id;

    const res = await request.get(
      `${API_URL}/api/events/${EVENT_ID}/runners/${runnerId}/price-updates`,
      { headers: { Authorization: AUTH } }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    for (const doc of body.data) {
      expect(doc.runnerId).toBe(runnerId);
      expect(doc.eventId).toBe(EVENT_ID);
    }
  });
});

test.describe(`${EVENT_NAME} — UI (Expo web @ localhost:8081)`, () => {
  test("Leopardstown event badge is visible in the Events view", async ({ page }) => {
    await goToEvents(page);
    await expect(page.getByTestId(`event-docs-badge-${EVENT_ID}`)).toBeVisible({ timeout: 10000 });
  });

  test("all three action badges are present for Leopardstown", async ({ page }) => {
    await goToEvents(page);
    await expect(page.getByTestId(`event-docs-badge-${EVENT_ID}`)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId(`event-runners-badge-${EVENT_ID}`)).toBeVisible();
    await expect(page.getByTestId(`event-price-updates-badge-${EVENT_ID}`)).toBeVisible();
  });

  test("clicking Runners badge opens the runners panel for Leopardstown", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId(`event-runners-badge-${EVENT_ID}`).click();
    await expect(page.getByTestId("runners-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runners-panel")).toContainText(EVENT_NAME);
  });

  test("Leopardstown runners panel loads runners from the API", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId(`event-runners-badge-${EVENT_ID}`).click();
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

    const items = page.locator('[data-testid^="runner-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("clicking a Leopardstown runner opens its price updates panel", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId(`event-runners-badge-${EVENT_ID}`).click();
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

    const firstRunner = page.locator('[data-testid^="runner-item-"]').first();
    await firstRunner.click();

    await expect(page.getByTestId("price-updates-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("price-updates-loading")).not.toBeVisible({ timeout: 15000 });
    const priceItems = page.locator('[data-testid^="price-update-item-"]');
    await expect(priceItems.first()).toBeVisible({ timeout: 10000 });
  });

  test("clicking Price Updates badge opens the price updates panel for Leopardstown", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId(`event-price-updates-badge-${EVENT_ID}`).click();
    await expect(page.getByTestId("price-updates-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("price-updates-loading")).not.toBeVisible({ timeout: 15000 });

    const items = page.locator('[data-testid^="price-update-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });
});
