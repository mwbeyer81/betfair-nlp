import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:8081/";
const API_URL = "http://localhost:3000";
const AUTH = "Basic " + Buffer.from("matthew:beyer").toString("base64");

// Direct API e2e tests — these hit the live server on port 3000 and would
// have caught the missing route before any UI tests ran.
test.describe("Runners API (live server @ localhost:3000)", () => {
  test("GET /api/events/:eventId/runners returns 200 with runners array", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/33858191/runners`, {
      headers: { Authorization: AUTH },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.count).toBe("number");
    expect(body.count).toBe(body.data.length);
  });

  test("each runner has id, name, status, sortPriority", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/33858191/runners`, {
      headers: { Authorization: AUTH },
    });

    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);

    for (const runner of body.data) {
      expect(typeof runner.id).toBe("number");
      expect(typeof runner.name).toBe("string");
      expect(typeof runner.status).toBe("string");
      expect(typeof runner.sortPriority).toBe("number");
    }
  });

  test("runner ids are unique — no duplicates", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/33858191/runners`, {
      headers: { Authorization: AUTH },
    });

    const body = await res.json();
    const ids: number[] = body.data.map((r: { id: number }) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("returns 401 without Authorization header", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/events/33858191/runners`);
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

async function login(page: import("@playwright/test").Page) {
  await page.goto(APP_URL);
  await page.getByTestId("auth-username-input").fill("matthew");
  await page.getByTestId("auth-password-input").fill("beyer");
  await page.getByTestId("auth-login-button").click();
  await expect(page.getByTestId("events-button")).toBeVisible({ timeout: 5000 });
}

test.describe("Runners feature (Expo web @ localhost:8081)", () => {
  test("can log in and reach the chat screen", async ({ page }) => {
    await login(page);
    await expect(page.getByTestId("events-button")).toBeVisible();
  });

  test("Events panel shows runners badge between docs and price-updates badges", async ({ page }) => {
    await login(page);
    await page.getByTestId("events-button").click();

    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId("event-docs-badge-33858191")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-runners-badge-33858191")).toBeVisible();
    await expect(page.getByTestId("event-price-updates-badge-33858191")).toBeVisible();
  });

  test("clicking runners badge opens the runners panel", async ({ page }) => {
    await login(page);
    await page.getByTestId("events-button").click();

    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    await page.getByTestId("event-runners-badge-33858191").click();

    await expect(page.getByTestId("runners-panel")).toBeVisible({ timeout: 10000 });
  });

  test("runners panel loads runner list from the API", async ({ page }) => {
    await login(page);
    await page.getByTestId("events-button").click();

    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    await page.getByTestId("event-runners-badge-33858191").click();

    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

    const items = page.locator('[data-testid^="runner-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("runners panel header shows event name and runner count", async ({ page }) => {
    await login(page);
    await page.getByTestId("events-button").click();

    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    await page.getByTestId("event-runners-badge-33858191").click();

    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId("runners-panel")).toContainText("Cheltenham 1st Jan");
    await expect(page.getByTestId("runners-panel")).toContainText("Runners ·");
  });

  test("runners panel close button dismisses it", async ({ page }) => {
    await login(page);
    await page.getByTestId("events-button").click();

    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    await page.getByTestId("event-runners-badge-33858191").click();
    await expect(page.getByTestId("runners-panel")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("runners-panel-close").click();
    await expect(page.getByTestId("runners-panel")).not.toBeVisible();
  });
});
