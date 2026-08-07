import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * "What would backing the favourite have returned over these same races" — the
 * market baseline that sits under every filtered P&L. These tests exist for the
 * same reason the Brier ones beside them do: the value of the number is that it
 * reads identically on every surface, and nothing else in the suite would
 * notice if one screen quietly dropped it, formatted it differently, or
 * compared it against the wrong selection.
 *
 * Runs against a static build with every API call mocked (see fixtures.ts), so
 * these assert on what the app RENDERS from a known payload. The arithmetic
 * that produces the payload is pinned by the backend's own unit and integration
 * tests (src/lib/service/__tests__/fav-pnl.test.ts and
 * src/lib/dao/__tests__/industry-sp-dao-fav-pnl.integration.test.ts).
 */

// From MOCK_FAV in fixtures.ts: 800 races, £400 staked to win £1 returning
// £350 — -£50.00, -12.5%. Written out here rather than imported so a fixture
// change that moves the numbers has to be acknowledged in both places.
const FAV_PNL = "-£50.00";
const FAV_ROI = "-12.5%";
// The mocked selection returns +62.5% (£1.00 on £1.60), so it beats the
// baseline by 75.0 points.
const FAV_EDGE = "+75.0 pts";

async function gotoIspAndApplyDefaults(page: Page) {
  await page.goto("/isp");
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
}

test.describe("The back-the-favourite baseline on the filter surfaces", () => {
  test("the Filters screen shows the baseline for the whole set and per split", async ({ page }) => {
    await gotoIspAndApplyDefaults(page);

    const total = page.getByTestId("industry-sp-fav-total");
    await expect(total).toBeVisible();
    await expect(total).toContainText("Fav (all races)");
    await expect(total).toContainText(FAV_PNL);

    // Split B carries the baseline alongside its P&L headline. Split A does
    // NOT: the fixture has a single matching race and the default half/half
    // divide gives Split A none of it — so its card must show an em dash
    // rather than a fabricated baseline, exactly as its Brier does.
    const cardB = page.getByTestId("industry-sp-split-card-b");
    await expect(cardB.getByTestId("industry-sp-fav-b")).toContainText(FAV_PNL);

    const cardA = page.getByTestId("industry-sp-split-card-a");
    await expect(cardA.getByTestId("industry-sp-fav-a-empty")).toContainText("—");
  });

  test("the split card shows how far the selection beats the baseline, in points", async ({ page }) => {
    await gotoIspAndApplyDefaults(page);
    const cardB = page.getByTestId("industry-sp-split-card-b");
    // The number the whole feature exists for. Not a subtraction of two cash
    // P&Ls — the two books stake different totals — so it must read as points.
    await expect(cardB.getByTestId("industry-sp-fav-b-edge")).toContainText(FAV_EDGE);
  });

  test("the split's Details panel breaks the baseline into P&L, book and gap", async ({ page }) => {
    await gotoIspAndApplyDefaults(page);
    // Split B, not A — A is the empty split under this fixture (see above).
    await page.getByTestId("industry-sp-split-details-button-b").click();

    await expect(page.getByTestId("split-detail-panel-b")).toBeVisible();
    await expect(page.getByTestId("split-detail-fav-b-pnl")).toContainText(FAV_PNL);
    // 820 bets over 800 races — the pair has to be visible or the extra 20
    // bets read as an arithmetic error against the race count.
    await expect(page.getByTestId("split-detail-fav-b-book")).toContainText("820 bets");
    await expect(page.getByTestId("split-detail-fav-b-book")).toContainText("800 races");
    await expect(page.getByTestId("split-detail-fav-b-edge")).toContainText(FAV_EDGE);
    // Stated explicitly, because "Fav" alone never says that the baseline
    // ignores every filter currently on screen.
    await expect(page.getByTestId("split-detail-fav-b-caption")).toContainText("backed whatever the filters say");
    await expect(page.getByTestId("split-detail-fav-b-caption")).toContainText("20 joint favourites");
  });

  test("the filtered races list baselines the whole row range, not the page", async ({ page }) => {
    await page.goto("/isp/races?minRunners=1&maxRunners=30");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    const fav = page.getByTestId("industry-sp-races-fav");
    await expect(fav).toBeVisible();
    await expect(fav).toContainText("Fav (filtered)");
    await expect(fav).toContainText(FAV_PNL);
  });

  test("a saved result shows a baseline per split, in opposite directions", async ({ page }) => {
    await page.goto("/results/detail?id=mock-result-1");
    await expect(page.getByTestId("saved-result-split-card-a")).toBeVisible();

    // Split A: baseline -25.0% against the split's own +10.0% — beaten by 35
    // points. Split B: baseline +50.0% against -40.0% — trailing by 90. One
    // fixture, both verdicts, so the sign can't be a constant in the component.
    await expect(page.getByTestId("saved-result-fav-a-edge")).toContainText("+35.0 pts");
    await expect(page.getByTestId("saved-result-fav-b-edge")).toContainText("−90.0 pts");
    await expect(page.getByTestId("saved-result-fav-a-value")).toContainText("-£2.00");
    await expect(page.getByTestId("saved-result-fav-b-value")).toContainText("+£3.00");
  });

  test("a saved result flags a baseline computed over too few races", async ({ page }) => {
    await page.goto("/results/detail?id=mock-result-1");
    // 2 races. A baseline over 2 races is one horse's result wearing a
    // percentage, and these screens make that trivially easy to reach.
    await expect(page.getByTestId("saved-result-fav-a-small-sample")).toContainText("2 races");
  });

  test("a saved result from before this existed shows a dash, not a zero", async ({ page }) => {
    // mock-result-2 deliberately carries no favPnl on either split — the real
    // production documents saved before the field existed, which nothing
    // migrates. A £0.00 baseline would read as one that broke even.
    await page.goto("/results/detail?id=mock-result-2");
    await expect(page.getByTestId("saved-result-split-card-a")).toBeVisible();
    const empty = page.getByTestId("saved-result-fav-a-empty");
    await expect(empty).toContainText("—");
    await expect(empty).not.toContainText("£0.00");
  });

  test("the saved-results list combines both splits' baselines on one card", async ({ page }) => {
    await page.goto("/results");
    // Split A (-£2 on £8) + Split B (+£3 on £6) = +£1 on £14 = +7.1%, against
    // the card's own combined -15.0% — so the card reads 22.1 points BEHIND
    // even though Split A on its own is ahead. A card showing only Split A's
    // baseline would be measuring against the wrong races.
    const card = page.getByTestId("saved-results-item-mock-result-1-fav");
    await expect(card).toBeVisible();
    await expect(card).toContainText("+£1.00");
    await expect(card.getByTestId("saved-results-item-mock-result-1-fav-edge")).toContainText("−22.1 pts");
  });

  test("every surface formats the baseline the same way", async ({ page }) => {
    // The reason a single shared component exists. If one screen renders
    // "-£50.00 (-12.5%)" and another "-50 (-12%)", comparing across screens
    // silently stops working — and nothing else in this suite would catch it.
    await gotoIspAndApplyDefaults(page);
    const ispText = (await page.getByTestId("industry-sp-fav-total").textContent()) ?? "";

    await page.goto("/isp/races?minRunners=1&maxRunners=30");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    const racesText = (await page.getByTestId("industry-sp-races-fav").textContent()) ?? "";

    for (const text of [ispText, racesText]) {
      expect(text).toContain(FAV_PNL);
      expect(text).toContain(FAV_ROI);
    }
  });
});
