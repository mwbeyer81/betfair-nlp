import { test, expect } from "@playwright/test";

// Both the bare IP (HTTP) and the domain (HTTPS) must serve the Hello World page.
const TARGETS = [
  { label: "IP (HTTP)",      url: "http://51.20.10.247/hello-world" },
  { label: "domain (HTTPS)", url: "https://backbet.co.uk/hello-world" },
];

for (const { label, url } of TARGETS) {
  test.describe(`Hello World — ${label}`, () => {
    test("returns 200 and renders Hello World heading", async ({ page }) => {
      const response = await page.goto(url);
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveText("Hello, World!");
    });

    test("page title is 'Hello World'", async ({ page }) => {
      await page.goto(url);
      await expect(page).toHaveTitle("Hello World");
    });

    test("content-type is text/html", async ({ page }) => {
      const response = await page.goto(url);
      const contentType = response?.headers()["content-type"] ?? "";
      expect(contentType).toContain("text/html");
    });
  });
}

// HTTP must redirect to HTTPS for the domain
test("http://backbet.co.uk redirects to https", async ({ page }) => {
  const response = await page.goto("http://backbet.co.uk/hello-world", {
    waitUntil: "networkidle",
  });
  // After the 301 redirect Playwright lands on the HTTPS URL
  expect(page.url()).toMatch(/^https:\/\/backbet\.co\.uk/);
  expect(response?.status()).toBe(200);
});
