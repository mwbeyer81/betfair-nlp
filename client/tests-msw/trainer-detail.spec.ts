import { test, expect } from "./fixtures";

// fixtures.ts mocks trainer "W P Mullins" / formCategory "Flat" with 3 runs
// (2025-01-01, 2025-01-08, 2025-01-15 — 2 wins, 1 loser).

test.describe("Trainer Detail — tap-through from runner rows (MSW mocked)", () => {
  test("tapping the trainer-form badge on the races list navigates to Trainer Detail", async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-item-trainer-12347").click();

    await expect(page.getByTestId("trainer-detail-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/trainer");
    await expect(page.getByTestId("trainer-detail-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("trainer-detail-runs")).toContainText("3");
    await expect(page.getByTestId("trainer-detail-wins")).toContainText("2");
    await expect(page.getByTestId("trainer-detail-item-914592-12347")).toBeVisible();
  });

  test("back returns to the races list", async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-item-trainer-12347").click();
    await expect(page.getByTestId("trainer-detail-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("trainer-detail-back").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
  });

  test("tapping the trainer link from Runner Detail navigates to Trainer Detail, back returns to Runner Detail", async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-item-12347").click();
    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("runner-detail-trainer-link").click();
    await expect(page.getByTestId("trainer-detail-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("trainer-detail-back").click();
    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/runner");
  });

  test("tapping a run in the trainer's list navigates to that run's Runner Detail", async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-item-trainer-12347").click();
    await expect(page.getByTestId("trainer-detail-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("trainer-detail-item-914592-12347").click();
    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });
  });

  test("an unknown trainer shows the not-found state", async ({ page }) => {
    await page.goto("/isp/trainer?trainer=Nobody&formCategory=Flat");
    await expect(page.getByTestId("trainer-detail-not-found")).toBeVisible({ timeout: 10000 });
  });
});
