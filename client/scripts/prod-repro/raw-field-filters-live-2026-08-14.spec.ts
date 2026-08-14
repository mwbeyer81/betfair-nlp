import { test, expect } from "@playwright/test";

// Post-deploy verification against the LIVE bundle at app.backbet.co.uk, per
// the prod-repro convention in AGENTS.md. Anonymous — /isp is optionalJwtAuth,
// so this exercises exactly what a logged-out visitor sees (reduced race cap
// and all).
//
// Everything else in the suite proves the feature works somewhere: mocked, on a
// throwaway DB, or against a dev server. This is the only check that the thing
// actually shipped — CloudFront serving a stale index.html against a pruned
// bundle hash is a failure mode this repo has already hit once.

const PROD = "https://app.backbet.co.uk";

test("the raw model fields picker is live and narrows a real query", async ({ page }) => {
  await page.goto(`${PROD}/isp?minDate=2024-01-06&maxDate=2024-01-06`);
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 30000 });

  // The catalogue comes from the live Lambda, not a fixture.
  await expect(page.getByTestId("filter-field-picker")).toBeVisible({ timeout: 30000 });
  await page.getByTestId("filter-field-picker-add").click();
  await expect(page.getByTestId("filter-field-picker-list")).toBeVisible();
  await expect(page.getByTestId("filter-field-option-officialRating")).toBeVisible();

  // Measured coverage, served from field-registry.ts rather than hardcoded here.
  await expect(page.getByTestId("filter-field-option-officialRating-coverage")).toContainText("78.1%");

  await page.getByTestId("filter-field-option-officialRating").click();
  await page.getByTestId("filter-field-min-officialRating").fill("90");

  const request = page.waitForRequest(req =>
    req.url().includes("/api/industry-sp/splits") && req.url().includes("minOfficialRating=90")
  );
  await page.getByTestId("industry-sp-filter-apply").click();
  const response = await (await request).response();
  expect(response?.status()).toBe(200);

  // Ground truth for 2024-01-06, verified directly against production Mongo:
  // 30 races that day, 12 of them holding a runner rated 90+.
  const body = await response!.json();
  expect(body.success).toBe(true);
  expect(body.totalRaces).toBe(12);

  await expect.poll(() => page.url()).toContain("minOfficialRating=90");
});

test("the three dead fields are listed but not selectable", async ({ page }) => {
  await page.goto(`${PROD}/isp?minDate=2024-01-06&maxDate=2024-01-06`);
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 30000 });
  await page.getByTestId("filter-field-picker-add").click();

  // 100% null in production because runners[].comment was never seeded. Shown
  // with the reason rather than hidden, so someone who knows the model's column
  // list learns why it is empty instead of hunting for a missing field.
  for (const name of ["horseAvgExcuseScore", "horseTroubleInRunningRate", "horseTravelledWellRate"]) {
    await expect(page.getByTestId(`filter-field-option-${name}-coverage`)).toContainText("Not filterable");
  }
});
