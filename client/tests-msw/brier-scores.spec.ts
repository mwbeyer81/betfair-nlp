import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * The Brier score appears on every screen where horses can be filtered. These
 * tests exist because that consistency is the whole point of the feature — a
 * user comparing what the Filters screen says against what a saved result says
 * has to be reading the same quantity, formatted the same way — and nothing
 * else in the suite would notice if one screen quietly dropped it.
 *
 * Runs against a static build with every API call mocked (see fixtures.ts),
 * so these assert on what the app RENDERS from a known payload, not on any
 * arithmetic — the arithmetic is pinned by the backend's own unit and
 * integration tests.
 */

// From MOCK_BRIER in fixtures.ts: model 0.0871, market 0.0902, model ahead by
// 0.0031. Written out here rather than imported so a fixture change that moves
// the numbers has to be acknowledged in both places.
const MODEL = "0.0871";
const MARKET = "0.0902";
const EDGE = "+0.0031";

// A bare /isp load deliberately fetches nothing until Apply is pressed (see
// the "bare load applies nothing" block in industry-sp.spec.ts) — same helper
// shape that suite uses, so these tests exercise the loaded state rather than
// racing the idle one.
async function gotoIspAndApplyDefaults(page: Page) {
  await page.goto("/isp");
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
}

test.describe("Brier scores on the filter surfaces", () => {
  test("the Filters screen shows a whole-set score and one per split", async ({ page }) => {
    await gotoIspAndApplyDefaults(page);

    const total = page.getByTestId("industry-sp-brier-total");
    await expect(total).toBeVisible();
    await expect(total).toContainText(MODEL);
    await expect(total).toContainText(MARKET);

    // Split B carries its own score alongside the P&L headline rather than
    // instead of it. Split A does NOT: the fixture has a single matching
    // race, and the default half/half divide gives Split A zero of it — so
    // its card must show an em dash, not a fabricated score. Both halves of
    // that are worth asserting, and only a fixture with an empty split can.
    const cardB = page.getByTestId("industry-sp-split-card-b");
    await expect(cardB.getByTestId("industry-sp-brier-b")).toContainText(MODEL);

    const cardA = page.getByTestId("industry-sp-split-card-a");
    await expect(cardA.getByTestId("industry-sp-brier-a-empty")).toContainText("—");
  });

  test("the split's Details panel breaks the score into model, SP and the gap", async ({ page }) => {
    await gotoIspAndApplyDefaults(page);
    // Split B, not A — A is the empty split under this fixture (see above).
    await page.getByTestId("industry-sp-split-details-button-b").click();

    await expect(page.getByTestId("split-detail-panel-b")).toBeVisible();
    await expect(page.getByTestId("split-detail-brier-b-model")).toContainText(MODEL);
    await expect(page.getByTestId("split-detail-brier-b-market")).toContainText(MARKET);
    await expect(page.getByTestId("split-detail-brier-b-edge")).toContainText(EDGE);
    // "Lower is better" is stated explicitly because it inverts the reading
    // direction of every other number on this panel.
    await expect(page.getByTestId("split-detail-brier-b-caption")).toContainText("Lower is better");
  });

  test("the filtered races list scores the whole row range, not the page", async ({ page }) => {
    await page.goto("/isp/races?minRunners=1&maxRunners=30");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    const brier = page.getByTestId("industry-sp-races-brier");
    await expect(brier).toBeVisible();
    await expect(brier).toContainText(MODEL);
    await expect(brier).toContainText("Brier (filtered)");
  });

  test("a saved result shows a score per split, in opposite directions", async ({ page }) => {
    await page.goto("/results/detail?id=mock-result-1");
    await expect(page.getByTestId("saved-result-split-card-a")).toBeVisible();

    // Split A's fixture has the model ahead (0.08 vs 0.09), Split B's has it
    // behind (0.11 vs 0.09) — so this proves the sign is read per split
    // rather than being a constant baked into the component.
    await expect(page.getByTestId("saved-result-brier-a-edge")).toContainText("+0.0100");
    await expect(page.getByTestId("saved-result-brier-b-edge")).toContainText("−0.0200");
  });

  test("the saved-results list shows both splits combined on one card", async ({ page }) => {
    await page.goto("/results");
    // (0.08 x 6 + 0.11 x 6) / 12 = 0.095 model, 0.09 market flat — so the
    // combined card must read the model 0.005 BEHIND, even though Split A on
    // its own is ahead. A card that showed only Split A's number would be
    // misleading, which is why it combines.
    const card = page.getByTestId("saved-results-item-mock-result-1-brier");
    await expect(card).toBeVisible();
    await expect(card).toContainText("0.0950");
    await expect(card.getByTestId("saved-results-item-mock-result-1-brier-edge")).toContainText("−0.0050");
  });

  test("Model vs SP scores the runners its difference filter selects", async ({ page }) => {
    await page.goto("/model-vs-sp?minDate=2025-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("model-vs-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("model-vs-sp-loading")).not.toBeVisible({ timeout: 15000 });
    const summary = page.getByTestId("model-vs-sp-summary");
    await expect(summary).toBeVisible();
    await expect(page.getByTestId("model-vs-sp-brier")).toContainText(MODEL);
    await expect(page.getByTestId("model-vs-sp-brier")).toContainText("Brier (selected)");
  });

  test("the Betfair-SP screen shows a market score and no model one", async ({ page }) => {
    // This dataset has no model column at all — the score must degrade to the
    // market's alone rather than inventing a model number.
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
    const bar = page.getByTestId("all-runners-pnl-bar");
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId("all-runners-brier")).toContainText("Brier (SP)");
  });

  test("every surface formats the score to the same 4 decimal places", async ({ page }) => {
    // The reason a single shared component exists. If one screen ever renders
    // 0.087 and another 0.08710, comparing across screens silently stops
    // working — and nothing else in this suite would catch it.
    await gotoIspAndApplyDefaults(page);
    const ispText = (await page.getByTestId("industry-sp-brier-total").textContent()) ?? "";

    await page.goto("/isp/races?minRunners=1&maxRunners=30");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    const racesText = (await page.getByTestId("industry-sp-races-brier").textContent()) ?? "";

    const fourDp = /0\.\d{4}\b/;
    expect(ispText).toMatch(fourDp);
    expect(racesText).toMatch(fourDp);
    // Same numbers from the same mocked payload, so the digits must match
    // character for character across the two screens.
    expect(ispText).toContain(MODEL);
    expect(racesText).toContain(MODEL);
  });
});
