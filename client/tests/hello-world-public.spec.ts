import { test, expect } from "@playwright/test";

const PUBLIC_URL = "http://51.20.10.247";

test.describe("Hello World public IP smoke test", () => {
  test("public IP serves Hello World page", async ({ page }) => {
    await page.goto(PUBLIC_URL);
    await expect(page.locator("h1")).toHaveText("Hello World");
  });

  test("public IP returns 200 status", async ({ request }) => {
    const response = await request.get(PUBLIC_URL);
    expect(response.status()).toBe(200);
  });

  test("public IP returns correct HTML content", async ({ request }) => {
    const response = await request.get(PUBLIC_URL);
    const body = await response.text();
    expect(body).toContain("Hello World");
  });
});
