import { test, expect } from "@playwright/test";

const URL = "https://app.backbet.co.uk/market-gap?k=43643d43-bdaa-40a3-ad4c-8deaf4735d2c";

test("keyed link renders the page signed-out", async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByTestId("market-gap-screen")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("market-gap-internal-note")).toContainText(/internal strategy note/i);
  await expect(page.getByTestId("market-gap-summary")).toBeVisible();
});

test("without the key it does NOT render, signed-out", async ({ page }) => {
  await page.goto("https://app.backbet.co.uk/market-gap");
  await expect(page.getByTestId("market-gap-screen")).toHaveCount(0, { timeout: 30000 });
});
