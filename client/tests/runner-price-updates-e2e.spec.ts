import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:8081/";
const API_URL = "http://localhost:3000";
const AUTH = "Basic " + Buffer.from("matthew:beyer").toString("base64");

async function goToEvents(page: import("@playwright/test").Page) {
  await page.goto(APP_URL);
  await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });
}

test.describe("Runner price updates API (live server @ localhost:3000)", () => {
  test("route exists — returns 200 not 404 (regression: stale server)", async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/events/33858191/runners/26817268/price-updates`,
      { headers: { Authorization: AUTH } }
    );
    expect(res.status()).not.toBe(404);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("GET /api/events/:eventId/runners/:runnerId/price-updates returns 200", async ({ request }) => {
    // Data is now Race[] — pick the first runner from the first race
    const runnersRes = await request.get(`${API_URL}/api/events/33858191/runners`, {
      headers: { Authorization: AUTH },
    });
    const runnersBody = await runnersRes.json();
    expect(runnersBody.data.length).toBeGreaterThan(0);
    const runnerId = runnersBody.data[0].runners[0].id;

    const res = await request.get(
      `${API_URL}/api/events/33858191/runners/${runnerId}/price-updates`,
      { headers: { Authorization: AUTH } }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.count).toBe(body.data.length);
  });

  test("each price update belongs to the requested runner", async ({ request }) => {
    const runnersRes = await request.get(`${API_URL}/api/events/33858191/runners`, {
      headers: { Authorization: AUTH },
    });
    const runnersBody = await runnersRes.json();
    const runnerId = runnersBody.data[0].runners[0].id;

    const res = await request.get(
      `${API_URL}/api/events/33858191/runners/${runnerId}/price-updates`,
      { headers: { Authorization: AUTH } }
    );
    const body = await res.json();
    for (const doc of body.data) {
      expect(doc.runnerId).toBe(runnerId);
    }
  });

  test("returns 400 for non-numeric runnerId", async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/events/33858191/runners/not-a-number/price-updates`,
      { headers: { Authorization: AUTH } }
    );
    expect(res.status()).toBe(400);
  });

  test("returns 401 without Authorization header", async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/events/33858191/runners/12345/price-updates`
    );
    expect(res.status()).toBe(401);
  });
});

test.describe("Runner price updates feature (Expo web @ localhost:8081)", () => {
  test("runner items show a chevron indicating they are clickable", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-runners-badge-33858191").click();
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

    const firstItem = page.locator('[data-testid^="runner-item-"]').first();
    await expect(firstItem).toBeVisible({ timeout: 10000 });
    await expect(firstItem).toContainText("›");
  });

  test("clicking a runner opens the price updates panel for that runner", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-runners-badge-33858191").click();
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

    const firstItem = page.locator('[data-testid^="runner-item-"]').first();
    await firstItem.click();

    await expect(page.getByTestId("price-updates-panel")).toBeVisible({ timeout: 10000 });
  });

  test("runner price updates panel loads records from the API", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-runners-badge-33858191").click();
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

    const firstItem = page.locator('[data-testid^="runner-item-"]').first();
    await firstItem.click();

    await expect(page.getByTestId("price-updates-loading")).not.toBeVisible({ timeout: 15000 });
    const items = page.locator('[data-testid^="price-update-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("runner price updates panel header shows price updates subtitle", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-runners-badge-33858191").click();
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

    const firstItem = page.locator('[data-testid^="runner-item-"]').first();
    await firstItem.click();

    await expect(page.getByTestId("price-updates-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("price-updates-panel")).toContainText("Price updates ·");
  });

  test("runner price updates panel close button dismisses it", async ({ page }) => {
    await goToEvents(page);
    await page.getByTestId("event-runners-badge-33858191").click();
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

    const firstItem = page.locator('[data-testid^="runner-item-"]').first();
    await firstItem.click();

    await expect(page.getByTestId("price-updates-panel")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("price-updates-close").click();
    await expect(page.getByTestId("price-updates-panel")).not.toBeVisible();
  });
});
