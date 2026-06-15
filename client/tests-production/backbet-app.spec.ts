import { test, expect } from "@playwright/test";

const BASE_URL = "https://backbet.co.uk";
const AUTH_HEADER = "Basic " + Buffer.from("matthew:beyer").toString("base64");

test.describe("backbet.co.uk — HTTPS client app", () => {
  test("GET / returns 200 and serves HTML", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/`);
    expect(response.status()).toBe(200);
    const ct = response.headers()["content-type"] ?? "";
    expect(ct).toContain("text/html");
  });

  test("app loads and renders the events screen", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await expect(page.getByTestId("events-screen")).toBeVisible({
      timeout: 30000,
    });
  });

  test("no uncaught JS errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${BASE_URL}/`);
    await page.waitForTimeout(3000);
    expect(errors).toHaveLength(0);
  });

  test("http:// redirects to https://", async ({ page }) => {
    const response = await page.goto(`http://backbet.co.uk/`, {
      waitUntil: "networkidle",
    });
    expect(page.url()).toMatch(/^https:\/\/backbet\.co\.uk/);
    expect(response?.status()).toBe(200);
  });

  test("API /api/events/grouped is reachable", async ({ request }) => {
    const response = await request.get(
      `${BASE_URL}/api/events/grouped?page=1&limit=5`,
      { headers: { Authorization: AUTH_HEADER } }
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("static JS bundle loads", async ({ request }) => {
    // Confirm the Expo JS bundle is served correctly
    const indexResponse = await request.get(`${BASE_URL}/`);
    const html = await indexResponse.text();
    const scriptMatch = html.match(/src="(\/_expo\/static\/js\/web\/[^"]+)"/);
    expect(scriptMatch).not.toBeNull();
    const scriptUrl = `${BASE_URL}${scriptMatch![1]}`;
    const scriptResponse = await request.get(scriptUrl);
    expect(scriptResponse.status()).toBe(200);
    const ct = scriptResponse.headers()["content-type"] ?? "";
    expect(ct).toContain("javascript");
  });

  test("/hello-world still works alongside the client app", async ({
    page,
  }) => {
    const response = await page.goto(`${BASE_URL}/hello-world`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveText("Hello, World!");
  });
});
