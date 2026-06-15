import { test, expect } from "@playwright/test";

test.describe("Hello World app", () => {
  test("serves Hello World on port 80", async ({ page }) => {
    await page.goto("http://localhost:80");
    await expect(page.locator("h1")).toHaveText("Hello World");
  });

  test("responds with 200 status", async ({ request }) => {
    const response = await request.get("http://localhost:80");
    expect(response.status()).toBe(200);
  });
});
