import { test, expect } from "@playwright/test";

const BASE_URL = "https://app.backbet.co.uk";

test.describe("app.backbet.co.uk — date range picker + stale-split self-heal", () => {
  test("date picker trigger shows the 2024 default and looks correct", async ({ page }) => {
    await page.goto(`${BASE_URL}/isp?u=matthew&p=beyer`);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 15000 });

    const trigger = page.getByTestId("industry-sp-date-range-picker");
    await expect(trigger).toContainText("Jan 1, 2024");
    await expect(trigger).toContainText("Dec 31, 2024");
  });

  test("replicates the exact reported bug: stale full-dataset split rows land on the 2024 default", async ({ page }) => {
    // This is the exact scenario from the screenshot: an old bookmark with
    // fromRowA/fromRowB computed against the ~110k full dataset (before
    // the date filter existed), now landing on the new 2024-scoped default.
    await page.goto(`${BASE_URL}/isp?u=matthew&p=beyer&fromRowA=1&toRowA=54621&fromRowB=54622`);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 60000 });

    // Should self-heal to a sane default split rather than showing
    // "races 1-54621" / "races 54622-9800 (0 races)".
    await expect(page.getByTestId("industry-sp-split-card-a")).not.toContainText("54621", { timeout: 15000 });
    await expect(page.getByTestId("industry-sp-split-empty-b")).not.toBeVisible();
  });

  test("picker opens, jumps to a year via the header, and picks a day", async ({ page }) => {
    await page.goto(`${BASE_URL}/isp?u=matthew&p=beyer`);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 15000 });

    const prefix = "industry-sp-date-range-picker";
    await page.getByTestId(prefix).click();
    await expect(page.getByTestId(`${prefix}-modal`)).toBeVisible();
    await page.getByTestId(`${prefix}-header-title`).click();
    await expect(page.getByTestId(`${prefix}-year-2023`)).toBeVisible();
    await page.getByTestId(`${prefix}-year-2023`).click();
    await expect(page.getByTestId(`${prefix}-day-2023-01-15`)).toBeVisible();
    await page.getByTestId(`${prefix}-day-2023-01-15`).click();
    await page.getByTestId(`${prefix}-day-2023-01-20`).click();
    await page.getByTestId(`${prefix}-apply`).click();

    await expect(page.getByTestId(prefix)).toContainText("Jan 15, 2023");
    await expect(page.getByTestId(prefix)).toContainText("Jan 20, 2023");
  });
});
