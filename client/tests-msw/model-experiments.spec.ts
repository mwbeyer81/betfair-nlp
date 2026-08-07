import { test, expect } from "./fixtures";

test.describe("Model Experiments — MSW mocked network", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/model-experiments");
    await expect(page.getByTestId("model-experiments-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("model-experiments-loading")).not.toBeVisible({ timeout: 10000 });
  });

  test("lists every recorded iteration, newest first", async ({ page }) => {
    await expect(page.getByTestId("model-experiments-list")).toBeVisible();
    await expect(page.getByTestId("model-experiments-row-exp-20260806-190210")).toBeVisible();
    await expect(page.getByTestId("model-experiments-row-exp-20260806-183001")).toBeVisible();
  });

  test("a row shows the feature set, objective and headline metrics", async ({ page }) => {
    const row = page.getByTestId("model-experiments-row-exp-20260806-190210");
    await expect(row).toContainText("rel-softmax");
    await expect(row).toContainText("conditional logit");
    await expect(row).toContainText("143 features");
    await expect(row).toContainText("0.0931");
  });

  // The number the whole exercise is about. Resolution is discrimination, and
  // discrimination is 99.2% of the model's Brier deficit against industry SP —
  // so it has to be on the row, not buried in the detail view.
  test("resolution and top-1 rate are on the list row, not just Brier", async ({ page }) => {
    const row = page.getByTestId("model-experiments-row-exp-20260806-190210");
    await expect(row).toContainText("Resolution");
    await expect(row).toContainText("Top-1");
  });

  // The single most likely misread on this screen: a NEGATIVE Brier delta is
  // an IMPROVEMENT. If the tooltip and the colouring ever disagree, every
  // result on the screen reads backwards.
  test("explains that a negative Brier delta is an improvement", async ({ page }) => {
    await page.getByTestId("model-experiments-tooltip-toggle-delta").click();
    await expect(page.getByTestId("model-experiments-tooltip-text-delta")).toContainText(
      "NEGATIVE number is an IMPROVEMENT"
    );
  });

  test("opening a row shows its metrics, folds and segments", async ({ page }) => {
    await page.getByTestId("model-experiments-row-exp-20260806-190210").click();
    await expect(page.getByTestId("model-experiments-detail")).toBeVisible();
    await expect(page.getByTestId("model-experiments-meta")).toBeVisible();
    await expect(page.getByTestId("model-experiments-metrics")).toBeVisible();
    await expect(page.getByTestId("model-experiments-fold-table")).toBeVisible();
    await expect(page.getByTestId("model-experiments-fold-row-2022")).toBeVisible();
    await expect(page.getByTestId("model-experiments-segment-table")).toBeVisible();
  });

  test("the detail view scores the model against the market on the same rows", async ({ page }) => {
    await page.getByTestId("model-experiments-row-exp-20260806-190210").click();
    const metrics = page.getByTestId("model-experiments-metrics");
    await expect(metrics).toContainText("Model");
    await expect(metrics).toContainText("Market (SP)");
    await expect(metrics).toContainText("0.0888");
  });

  test("back returns to the list", async ({ page }) => {
    await page.getByTestId("model-experiments-row-exp-20260806-190210").click();
    await expect(page.getByTestId("model-experiments-detail")).toBeVisible();
    await page.getByTestId("model-experiments-back-to-list").click();
    await expect(page.getByTestId("model-experiments-list")).toBeVisible();
  });

  test("switching segment dimension swaps the rows rather than appending", async ({ page }) => {
    await page.getByTestId("model-experiments-row-exp-20260806-190210").click();
    await expect(page.getByTestId("model-experiments-segment-row-raceType-Chase")).toBeVisible();
    await page.getByTestId("model-experiments-segment-dimension-spBand").click();
    await expect(page.getByTestId("model-experiments-segment-row-spBand-5.0-10.0")).toBeVisible();
    await expect(page.getByTestId("model-experiments-segment-row-raceType-Chase")).toHaveCount(0);
  });

  test("a discovered segment links through to the Filters screen with its slice applied", async ({ page }) => {
    await page.getByTestId("model-experiments-row-exp-20260806-190210").click();
    await expect(page.getByTestId("model-experiments-discovered-list")).toBeVisible();
    await page.getByTestId("model-experiments-discovered-view-in-filters-0").click();
    await expect(page).toHaveURL(/\/isp\?.*minIsp=5\.0.*maxIsp=10\.0/);
  });

  // A discovery the Filters screen cannot express must say so, rather than
  // offering a link that would quietly drop the constraint and show a
  // different set of races than the one that was measured.
  test("a segment with no filter param says so instead of offering a link", async ({ page }) => {
    await page.getByTestId("model-experiments-row-exp-20260806-190210").click();
    const row = page.getByTestId("model-experiments-discovered-row-1");
    await expect(row).toContainText("Not expressible as a saved filter");
    await expect(page.getByTestId("model-experiments-discovered-view-in-filters-1")).toHaveCount(0);
  });

  // The lesson from the earlier P&L work, put in front of whoever is reading a
  // result rather than left in a markdown file nobody opens.
  test("explains why a slice must be profitable under both staking conventions", async ({ page }) => {
    await page.getByTestId("model-experiments-row-exp-20260806-190210").click();
    await page.getByTestId("model-experiments-tooltip-toggle-bothStakings").click();
    await expect(page.getByTestId("model-experiments-tooltip-text-bothStakings")).toContainText(
      "noise, not an edge"
    );
  });

  test("shows an error rather than an empty list when the request fails", async ({ page }) => {
    // An empty list would read as "no experiments have been run", which is a
    // different claim from "we could not find out".
    await page.route((url) => url.pathname === "/api/model-experiments", (route) =>
      route.fulfill({ status: 500, json: { success: false } })
    );
    await page.goto("/model-experiments");
    await expect(page.getByTestId("model-experiments-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("model-experiments-list")).toHaveCount(0);
    await expect(page.getByTestId("model-experiments-empty")).toHaveCount(0);
  });

  test("shows an empty state when no experiments have been recorded", async ({ page }) => {
    await page.route((url) => url.pathname === "/api/model-experiments", (route) =>
      route.fulfill({ json: { success: true, data: [], count: 0 } })
    );
    await page.goto("/model-experiments");
    await expect(page.getByTestId("model-experiments-empty")).toBeVisible({ timeout: 10000 });
  });
});
