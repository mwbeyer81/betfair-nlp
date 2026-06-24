import { test, expect } from "@playwright/test";

test.describe("Hello World CF app", () => {
  test("shows Hello World heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("hello-heading")).toHaveText("Hello World");
  });

  test("page title is correct", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Hello World/);
  });
});
