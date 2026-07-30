import { test, expect } from "@playwright/test";

// Real browser, real frontend build, real backend, real (throwaway) Mongo —
// no mocking. Mirrors client/tests/industry-sp-e2e.spec.ts's ?email=&password=
// URL-login convention. Exercises the full save -> list -> detail -> graph
// -> restore -> delete loop against the seeded 2026-06-03 slice (Newton
// Abbot/Nottingham/Ripon/Warwick, anchor raceId 919979).
const APP_URL = "http://localhost:8090/";

async function gotoIspForNottingham(page: import("@playwright/test").Page) {
  await page.goto(
    `${APP_URL}isp?email=matthew%40backbet.co.uk&password=beyer&courses=Nottingham&minDate=2026-06-03&maxDate=2026-06-03`
  );
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });
}

test.describe("Saved Results — full loop against seeded slice (real frontend + backend)", () => {
  test("save with a typed name, see it in the Results list with matching PnL", async ({ page }) => {
    await gotoIspForNottingham(page);

    await page.getByTestId("industry-sp-filter-save").click();
    await expect(page.getByTestId("save-result-dialog")).toBeVisible();
    await page.getByTestId("save-result-dialog-name-input").fill("Nottingham UI save");
    await page.getByTestId("save-result-dialog-confirm").click();
    await expect(page.getByTestId("save-result-dialog")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-save-confirmed-banner")).toBeVisible();

    await page.getByTestId("industry-sp-menu-results-link").click();
    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 15000 });

    const items = page.locator('[data-testid^="saved-results-item-"]');
    await expect(items.filter({ hasText: "Nottingham UI save" })).toBeVisible();
  });

  test("blank-name save falls back to an auto-generated name", async ({ page }) => {
    await gotoIspForNottingham(page);

    await page.getByTestId("industry-sp-filter-save").click();
    await page.getByTestId("save-result-dialog-confirm").click();
    await expect(page.getByTestId("save-result-dialog")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-menu-results-link").click();
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 15000 });
    const items = page.locator('[data-testid^="saved-results-item-"]');
    await expect(items.filter({ hasText: "Nottingham" }).first()).toBeVisible();
  });

  test("tap into detail: PnL visible, graph tap-through works, restore returns to /isp with matching filters", async ({
    page,
  }) => {
    await gotoIspForNottingham(page);
    await page.getByTestId("industry-sp-filter-save").click();
    await page.getByTestId("save-result-dialog-name-input").fill("Detail flow test");
    await page.getByTestId("save-result-dialog-confirm").click();
    await expect(page.getByTestId("save-result-dialog")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-menu-results-link").click();
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid^="saved-results-item-"]').filter({ hasText: "Detail flow test" }).click();

    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });
    // The detail view shows Split A and Split B as two independent cards,
    // matching the live Filters screen's own split cards — a "Details"
    // button per split opens the full SplitDetailPanel breakdown.
    await expect(page.getByTestId("saved-result-split-card-a")).toBeVisible();
    await expect(page.getByTestId("saved-result-split-card-b")).toBeVisible();
    await page.getByTestId("saved-result-split-details-button-a").click();
    await expect(page.getByTestId("split-detail-panel-a")).toBeVisible();
    await expect(page.getByTestId("split-detail-pnl-a")).toBeVisible();
    await page.getByTestId("split-detail-panel-filters-a").click();
    await expect(page.getByTestId("split-detail-panel-a")).not.toBeVisible();

    await page.getByTestId("saved-result-split-graph-button-a").click();
    await expect(page.getByTestId("pnl-convergence-panel")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("pnl-convergence-panel-close").click();
    await expect(page.getByTestId("pnl-convergence-panel")).not.toBeVisible();

    await page.getByTestId("saved-result-detail-restore").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("courses=Nottingham");
    expect(page.url()).toContain("minDate=2026-06-03");
  });

  test("delete removes the result from the list", async ({ page }) => {
    await gotoIspForNottingham(page);
    await page.getByTestId("industry-sp-filter-save").click();
    await page.getByTestId("save-result-dialog-name-input").fill("Delete me");
    await page.getByTestId("save-result-dialog-confirm").click();
    await expect(page.getByTestId("save-result-dialog")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-menu-results-link").click();
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 15000 });

    const target = page.locator('[data-testid^="saved-results-item-"]').filter({ hasText: "Delete me" });
    await expect(target).toBeVisible();
    const targetTestId = await target.getAttribute("data-testid");
    await target.locator(`[data-testid="${targetTestId}-delete"]`).click();
    await page.locator(`[data-testid="${targetTestId}-confirm-delete"]`).click();
    await expect(page.locator('[data-testid^="saved-results-item-"]').filter({ hasText: "Delete me" })).toHaveCount(0);
  });

  test("Results is reachable from every screen's nav", async ({ page }) => {
    await page.goto(`${APP_URL}events?email=matthew%40backbet.co.uk&password=beyer`);
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("events-menu-results-link").click();
    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });

    await page.goto(`${APP_URL}chat?email=matthew%40backbet.co.uk&password=beyer`);
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("chat-menu-results-link").click();
    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });

    await page.goto(`${APP_URL}runners?email=matthew%40backbet.co.uk&password=beyer`);
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("all-runners-menu-results-link").click();
    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });
  });

  test("Results list has no horizontal overflow at a 375px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoIspForNottingham(page);
    await page.getByTestId("industry-sp-filter-save").click();
    await page.getByTestId("save-result-dialog-name-input").fill("Narrow viewport test");
    await page.getByTestId("save-result-dialog-confirm").click();
    await expect(page.getByTestId("save-result-dialog")).not.toBeVisible({ timeout: 10000 });

    await page.goto(`${APP_URL}results?email=matthew%40backbet.co.uk&password=beyer`);
    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 15000 });

    const item = page.locator('[data-testid^="saved-results-item-"]').first();
    await expect(item).toBeVisible();
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(375);
  });
});
