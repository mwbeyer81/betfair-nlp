import { test, expect } from "@playwright/test";

// End-to-end against a running app and a real API, with the fixture from
// src/commands/seed-model-experiment-fixture.ts in model_experiments (the
// local-ci run seeds it; see scripts/local-ci-e2e.sh).
//
// Gated on data presence rather than asserting a specific experiment exists:
// this collection is populated by ml/experiment.py, which is run by hand and
// may legitimately not have run yet against whatever database the app is
// pointed at. A screen correctly showing its empty state is a pass, not a
// failure — what must never happen is a crash or a silently blank page.

const APP_URL = process.env.APP_URL ?? "http://localhost:8081";

test.describe("Model Experiments — end to end", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${APP_URL}/model-experiments`);
    await expect(page.getByTestId("model-experiments-screen")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("model-experiments-loading")).not.toBeVisible({ timeout: 30000 });
  });

  test("the screen loads without erroring", async ({ page }) => {
    await expect(page.getByTestId("model-experiments-error")).toHaveCount(0);
    const hasList = await page.getByTestId("model-experiments-list").count();
    const hasEmpty = await page.getByTestId("model-experiments-empty").count();
    expect(hasList + hasEmpty).toBeGreaterThan(0);
  });

  test("is reachable from the burger menu", async ({ page }) => {
    await page.goto(`${APP_URL}/events`);
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("events-menu-model-experiments-link").click();
    await expect(page.getByTestId("model-experiments-screen")).toBeVisible({ timeout: 30000 });
    expect(page.url()).toContain("/model-experiments");
  });

  test("an experiment row opens its detail view", async ({ page }) => {
    const list = page.getByTestId("model-experiments-list");
    if ((await list.count()) === 0) test.skip(true, "no experiments recorded in this database");

    const firstRow = page.locator('[data-testid^="model-experiments-row-"]').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    await expect(page.getByTestId("model-experiments-detail")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("model-experiments-metrics")).toBeVisible();
    await expect(page.getByTestId("model-experiments-fold-table")).toBeVisible();
  });

  test("the detail view scores the model beside the market", async ({ page }) => {
    const list = page.getByTestId("model-experiments-list");
    if ((await list.count()) === 0) test.skip(true, "no experiments recorded in this database");

    await page.locator('[data-testid^="model-experiments-row-"]').first().click();
    const metrics = page.getByTestId("model-experiments-metrics");
    await expect(metrics).toBeVisible({ timeout: 15000 });
    // Both columns must be present: a model Brier on its own says nothing
    // about whether the model is any good, which is the mistake this whole
    // screen exists to avoid repeating.
    await expect(metrics).toContainText("Model");
    await expect(metrics).toContainText("Market (SP)");
    await expect(metrics).toContainText("Resolution");
  });

  test("the segment table renders and its dimension chips switch it", async ({ page }) => {
    const list = page.getByTestId("model-experiments-list");
    if ((await list.count()) === 0) test.skip(true, "no experiments recorded in this database");

    await page.locator('[data-testid^="model-experiments-row-"]').first().click();
    await expect(page.getByTestId("model-experiments-segment-table")).toBeVisible({ timeout: 15000 });

    const chips = page.locator('[data-testid^="model-experiments-segment-dimension-"]');
    const chipCount = await chips.count();
    expect(chipCount).toBeGreaterThan(0);
    if (chipCount > 1) {
      await chips.nth(1).click();
      await expect(page.locator('[data-testid^="model-experiments-segment-row-"]').first()).toBeVisible();
    }
  });

  test("back returns to the list", async ({ page }) => {
    const list = page.getByTestId("model-experiments-list");
    if ((await list.count()) === 0) test.skip(true, "no experiments recorded in this database");

    await page.locator('[data-testid^="model-experiments-row-"]').first().click();
    await expect(page.getByTestId("model-experiments-detail")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("model-experiments-back-to-list").click();
    await expect(page.getByTestId("model-experiments-list")).toBeVisible();
  });
});
