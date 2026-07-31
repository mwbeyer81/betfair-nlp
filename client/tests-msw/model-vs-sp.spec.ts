import { test, anonTest, expect } from "./fixtures";

// The fixture rows are flattened from the same race fixtures /isp/races uses
// (see MODEL_VS_SP_ROWS in fixtures.ts), so every number below is derived from
// values other specs already assert against, not invented here.
//
// 2025 (the window these tests use — the endpoint caps any window at 366 days,
// so a single calendar year is the widest useful scope):
//   +25.0  June Value Runner  raceId 667788 runnerId 66601   2025-06-15
//    -2.6  Gaelic Warrior     raceId 914592 runnerId 12346   2025-01-01
//    -4.0  June Outsider      raceId 667788 runnerId 66602   2025-06-15
//    -8.4  Fact To File       raceId 914592 runnerId 12347   2025-01-01
//    -9.7  Springwell Bay     raceId 914592 runnerId 12345   2025-01-01
const JUNE_VALUE_ROW = "model-vs-sp-row-667788-66601";
const JUNE_OUTSIDER_ROW = "model-vs-sp-row-667788-66602";
const SPRINGWELL_ROW = "model-vs-sp-row-914592-12345";
const GAELIC_ROW = "model-vs-sp-row-914592-12346";

const Y2025 = "minDate=2025-01-01&maxDate=2025-12-31";

// The mandatory three-step open: a `.not.toBeVisible()` assertion on an element
// that hasn't rendered yet passes instantly, so the loading check has to follow a
// positive assertion that the screen itself mounted.
async function openScreen(page: import("@playwright/test").Page, query = Y2025) {
  await page.goto(`/model-vs-sp?${query}`);
  await expect(page.getByTestId("model-vs-sp-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("model-vs-sp-loading")).not.toBeVisible({ timeout: 15000 });
}

function firstRow(page: import("@playwright/test").Page) {
  return page.getByTestId("model-vs-sp-list").locator("> *").first();
}

test.describe("Model vs SP screen (MSW mocked)", () => {
  test("renders the runner list with a result count and page status", async ({ page }) => {
    await openScreen(page);
    await expect(page.getByTestId("model-vs-sp-list")).toBeVisible();
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("5 runners");
    await expect(page.getByTestId("model-vs-sp-pagination-top-status")).toHaveText("Page 1 of 1");
    await expect(page.getByTestId("model-vs-sp-page-range")).toContainText("Showing 1–5 of 5");
  });

  test("each row shows the model probability, the SP-implied probability and the signed gap", async ({ page }) => {
    await openScreen(page);
    // Springwell Bay: isp 4.5 -> 22.2% implied, model 12.5% -> -9.7 pts.
    await expect(page.getByTestId("model-vs-sp-model-914592-12345")).toHaveText("Model 12.5%");
    await expect(page.getByTestId("model-vs-sp-sp-914592-12345")).toHaveText("SP 22.2%");
    await expect(page.getByTestId("model-vs-sp-edge-914592-12345")).toHaveText("-9.7 pts");
    await expect(page.getByTestId("model-vs-sp-runner-914592-12345")).toHaveText("Springwell Bay");
  });

  test("a positive gap renders with an explicit plus sign", async ({ page }) => {
    await openScreen(page);
    await expect(page.getByTestId("model-vs-sp-edge-667788-66601")).toHaveText("+25.0 pts");
  });

  test("sorting by gap reorders the list biggest-first, then smallest-first", async ({ page }) => {
    await openScreen(page);
    await page.getByTestId("model-vs-sp-sort-edge").click();
    await expect(firstRow(page)).toHaveAttribute("data-testid", JUNE_VALUE_ROW);

    await page.getByTestId("model-vs-sp-sort-edge").click();
    await expect(page.getByTestId("model-vs-sp-sort-edge")).toContainText("Smallest first");
    await expect(firstRow(page)).toHaveAttribute("data-testid", SPRINGWELL_ROW);
  });

  test("sorting by date toggles newest-first and oldest-first", async ({ page }) => {
    await openScreen(page);
    // Default is newest first, so the June race leads.
    await expect(firstRow(page)).toHaveAttribute("data-testid", /model-vs-sp-row-667788-/);

    await page.getByTestId("model-vs-sp-sort-date").click();
    await expect(page.getByTestId("model-vs-sp-sort-date")).toContainText("Oldest first");
    await expect(firstRow(page)).toHaveAttribute("data-testid", /model-vs-sp-row-914592-/);
  });

  // The filter is unsigned: it selects on the SIZE of the disagreement, so a
  // runner rated 9.7 points BELOW its SP and one rated 25 points ABOVE are judged
  // by magnitude alone. 2025 gaps are +25.0, -2.6, -4.0, -8.4, -9.7.
  test("the difference filter matches on gap size regardless of direction", async ({ page }) => {
    await openScreen(page);
    await page.getByTestId("model-vs-sp-min-edge").fill("5");
    await page.getByTestId("model-vs-sp-max-edge").fill("30");
    await page.getByTestId("model-vs-sp-apply-button").click();

    // |−8.4|, |−9.7| and |+25.0| qualify — a negative and a positive row together,
    // which is the whole point of the change.
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("3 runners");
    await expect(page.getByTestId(JUNE_VALUE_ROW)).toBeVisible();
    await expect(page.getByTestId(SPRINGWELL_ROW)).toBeVisible();
    // |−2.6| and |−4.0| are too close to qualify.
    await expect(page.getByTestId(GAELIC_ROW)).toHaveCount(0);
    await expect(page.getByTestId(JUNE_OUTSIDER_ROW)).toHaveCount(0);
  });

  test("a small maximum finds only the runners the model agrees with most closely", async ({ page }) => {
    await openScreen(page);
    await page.getByTestId("model-vs-sp-max-edge").fill("5");
    await page.getByTestId("model-vs-sp-apply-button").click();

    // |−2.6| and |−4.0| only.
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("2 runners");
    await expect(page.getByTestId(GAELIC_ROW)).toBeVisible();
    await expect(page.getByTestId(JUNE_OUTSIDER_ROW)).toBeVisible();
    await expect(page.getByTestId(JUNE_VALUE_ROW)).toHaveCount(0);
  });

  test("a negative bound is treated as zero rather than rejected", async ({ page }) => {
    await openScreen(page);
    // |edge| can never be negative, so this is meaningless input rather than an
    // error — it should widen to the full range, not empty the list.
    await page.getByTestId("model-vs-sp-min-edge").fill("-20");
    await page.getByTestId("model-vs-sp-apply-button").click();

    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("5 runners");
    await expect(page.getByTestId("model-vs-sp-min-edge")).toHaveValue("0");
  });

  test("the model-probability filter narrows the list", async ({ page }) => {
    await openScreen(page);
    await page.getByTestId("model-vs-sp-min-model-prob").fill("25");
    await page.getByTestId("model-vs-sp-apply-button").click();
    // Fact To File (39.2) and June Value Runner (45) clear 25; the rest don't.
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("2 runners");
  });

  test("Next then Prev walks pages and restores the first page's leading row", async ({ page }) => {
    await openScreen(page, `${Y2025}&limit=2`);
    await expect(page.getByTestId("model-vs-sp-pagination-top-status")).toHaveText("Page 1 of 3");
    const firstRowId = await firstRow(page).getAttribute("data-testid");

    await page.getByTestId("model-vs-sp-pagination-top-next").click();
    await expect(page.getByTestId("model-vs-sp-pagination-top-status")).toHaveText("Page 2 of 3");
    await expect(page.getByTestId(firstRowId!)).toHaveCount(0);

    await page.getByTestId("model-vs-sp-pagination-top-prev").click();
    await expect(page.getByTestId("model-vs-sp-pagination-top-status")).toHaveText("Page 1 of 3");
    await expect(page.getByTestId(firstRowId!)).toBeVisible();
  });

  test("Last jumps to the final page and disables Next", async ({ page }) => {
    await openScreen(page, `${Y2025}&limit=2`);
    await page.getByTestId("model-vs-sp-pagination-top-last").click();
    await expect(page.getByTestId("model-vs-sp-pagination-top-status")).toHaveText("Page 3 of 3");
    await expect(page.getByTestId("model-vs-sp-pagination-top-next")).toBeDisabled();
    await expect(page.getByTestId("model-vs-sp-pagination-top-prev")).toBeEnabled();
  });

  test("the running total stays on screen across a page step", async ({ page }) => {
    await openScreen(page, `${Y2025}&limit=2`);
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("5 runners");
    await page.getByTestId("model-vs-sp-pagination-top-next").click();
    await expect(page.getByTestId("model-vs-sp-pagination-top-status")).toHaveText("Page 2 of 3");
    // The page-step request opts out of the count (includeTotal=false), so the
    // screen must keep the total it already had rather than showing "0 runners".
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("5 runners");
  });

  test("changing rows per page resets to page 1", async ({ page }) => {
    await openScreen(page, `${Y2025}&limit=2`);
    await page.getByTestId("model-vs-sp-pagination-top-next").click();
    await expect(page.getByTestId("model-vs-sp-pagination-top-status")).toHaveText("Page 2 of 3");

    await page.getByTestId("model-vs-sp-pagination-top-rows-per-page-100").click();
    await expect(page.getByTestId("model-vs-sp-pagination-top-status")).toHaveText("Page 1 of 1");
  });

  test("tapping a year pill narrows the list to that year and updates the URL", async ({ page }) => {
    await openScreen(page, "minDate=2022-01-01&maxDate=2022-12-31");
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("2 runners");

    await page.getByTestId("model-vs-sp-year-pill-2025").click();
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("5 runners");
    await expect(page).toHaveURL(/minDate=2025-01-01/);
    await expect(page).toHaveURL(/maxDate=2025-12-31/);
  });

  test("tapping a month pill narrows to that whole month, leap year included", async ({ page }) => {
    await openScreen(page, "minDate=2024-01-01&maxDate=2024-12-31");
    // February 2024 has 29 days — an off-by-one in the last-day-of-month
    // calculation would show up here as 2024-02-28.
    await page.getByTestId("model-vs-sp-month-pill-2024-02").click();
    await expect(page).toHaveURL(/minDate=2024-02-01/);
    await expect(page).toHaveURL(/maxDate=2024-02-29/);
  });

  test("a whole-year range highlights that year's pill and no other", async ({ page }) => {
    await openScreen(page);
    // Paper renders a Chip as role="button", for which React Native Web emits no
    // aria-selected at all — so the pill carries its state in its accessible
    // label instead (see the Chip in ModelVsSpScreen).
    await expect(page.getByTestId("model-vs-sp-year-pill-2025")).toHaveAttribute("aria-label", "2025 (selected)");
    await expect(page.getByTestId("model-vs-sp-year-pill-2024")).toHaveAttribute("aria-label", "2024");
  });

  test("an arbitrary date range highlights no year or month pill", async ({ page }) => {
    await openScreen(page, "minDate=2025-03-07&maxDate=2025-05-19");
    // Pill selection is derived from the applied range rather than stored, so a
    // range that is neither a whole year nor a whole month lights nothing.
    await expect(page.getByTestId("model-vs-sp-year-pill-2025")).toHaveAttribute("aria-label", "2025");
    await expect(page.getByTestId("model-vs-sp-month-pill-2025-03")).toHaveAttribute("aria-label", "2025-03");
  });

  test("a whole-month range highlights that month's pill", async ({ page }) => {
    await openScreen(page, "minDate=2025-06-01&maxDate=2025-06-30");
    await expect(page.getByTestId("model-vs-sp-month-pill-2025-06")).toHaveAttribute("aria-label", "2025-06 (selected)");
    await expect(page.getByTestId("model-vs-sp-month-pill-2025-07")).toHaveAttribute("aria-label", "2025-07");
    // The June race's two runners only.
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("2 runners");
  });

  test("the URL round-trips: reloading a filtered, sorted URL restores the same view", async ({ page }) => {
    await openScreen(page);
    await page.getByTestId("model-vs-sp-sort-edge").click();
    await page.getByTestId("model-vs-sp-min-edge").fill("5");
    await page.getByTestId("model-vs-sp-apply-button").click();
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("3 runners");

    const url = page.url();
    await page.goto(url);
    await expect(page.getByTestId("model-vs-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("model-vs-sp-loading")).not.toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("3 runners");
    await expect(page.getByTestId("model-vs-sp-sort-edge")).toContainText("Biggest first");
    await expect(firstRow(page)).toHaveAttribute("data-testid", JUNE_VALUE_ROW);
    await expect(page.getByTestId("model-vs-sp-min-edge")).toHaveValue("5");
  });

  test("Reset restores the defaults", async ({ page }) => {
    await openScreen(page);
    await page.getByTestId("model-vs-sp-min-edge").fill("20");
    await page.getByTestId("model-vs-sp-apply-button").click();
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("1 runners");

    await page.getByTestId("model-vs-sp-reset-button").click();
    await expect(page.getByTestId("model-vs-sp-min-edge")).toHaveValue("0");
    await expect(page.getByTestId("model-vs-sp-pagination-top-status")).toContainText("Page 1");
  });

  test("an unsatisfiable filter shows an empty state that explains why", async ({ page }) => {
    await openScreen(page);
    await page.getByTestId("model-vs-sp-min-edge").fill("90");
    await page.getByTestId("model-vs-sp-apply-button").click();

    const empty = page.getByTestId("model-vs-sp-empty");
    await expect(empty).toBeVisible();
    // Says WHY, not just "no results" — a row needs both a model score and a real
    // industry SP, so an unsatisfiable filter otherwise looks like a data gap.
    await expect(empty).toContainText(/model score/i);
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("0 runners");
  });

  test("shows a distribution summary over all runners in the window", async ({ page }) => {
    await openScreen(page);
    const summary = page.getByTestId("model-vs-sp-summary");
    await expect(summary).toBeVisible();
    // 2025 gaps: 25.0, 2.6, 4.0, 8.4, 9.7 -> mean |gap| = 9.94 -> 9.9
    await expect(page.getByTestId("model-vs-sp-summary-headline")).toContainText("all 5 runners");
    await expect(page.getByTestId("model-vs-sp-summary-headline")).toContainText("9.9 pts");
  });

  test("the summary answers 'what share is the model within ±N of?'", async ({ page }) => {
    await openScreen(page);
    // Cumulative shares of the 5 runners: within ±2 -> 0; ±5 -> 2.6 and 4.0 = 40%;
    // ±10 -> plus 8.4 and 9.7 = 80%; ±20 -> still 80%; ±50 -> plus 25.0 = 100%.
    await expect(page.getByTestId("model-vs-sp-summary-percent-2")).toHaveText("0.0%");
    await expect(page.getByTestId("model-vs-sp-summary-percent-5")).toHaveText("40.0%");
    await expect(page.getByTestId("model-vs-sp-summary-percent-10")).toHaveText("80.0%");
    await expect(page.getByTestId("model-vs-sp-summary-percent-20")).toHaveText("80.0%");
    await expect(page.getByTestId("model-vs-sp-summary-percent-50")).toHaveText("100.0%");
  });

  test("the summary's denominator ignores the difference filter", async ({ page }) => {
    await openScreen(page);
    await page.getByTestId("model-vs-sp-min-edge").fill("20");
    await page.getByTestId("model-vs-sp-apply-button").click();
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("1 runners");

    // Still describes all 5 runners — otherwise narrowing the filter would move
    // its own baseline and every band would read 100%.
    await expect(page.getByTestId("model-vs-sp-summary-headline")).toContainText("all 5 runners");
    await expect(page.getByTestId("model-vs-sp-summary-selection")).toContainText("selects 1 of them");
    await expect(page.getByTestId("model-vs-sp-summary-selection")).toContainText("20.0%");
  });

  test("the selection line is hidden while the difference filter is at its default", async ({ page }) => {
    await openScreen(page);
    // At the full 0-100 range it would only restate the total as 100%.
    await expect(page.getByTestId("model-vs-sp-summary")).toBeVisible();
    await expect(page.getByTestId("model-vs-sp-summary-selection")).toHaveCount(0);
  });

  test("the summary survives a page step, like the total does", async ({ page }) => {
    await openScreen(page, `${Y2025}&limit=2`);
    await expect(page.getByTestId("model-vs-sp-summary-headline")).toContainText("all 5 runners");
    await page.getByTestId("model-vs-sp-pagination-top-next").click();
    await expect(page.getByTestId("model-vs-sp-pagination-top-status")).toHaveText("Page 2 of 3");
    // The page-step response carries summary: null alongside total: null.
    await expect(page.getByTestId("model-vs-sp-summary-headline")).toContainText("all 5 runners");
  });

  test("tapping a runner row opens the runner detail screen", async ({ page }) => {
    await openScreen(page);
    await page.getByTestId(SPRINGWELL_ROW).click();
    await expect(page).toHaveURL(/\/isp\/runner/);
    await expect(page).toHaveURL(/raceId=914592/);
    await expect(page).toHaveURL(/runnerId=12345/);
  });

  test("the burger menu's Model vs SP link navigates from the Backtest screen", async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-menu-model-vs-sp-link").click();
    await expect(page.getByTestId("model-vs-sp-screen")).toBeVisible({ timeout: 10000 });
  });

  test("nothing overflows a 375px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openScreen(page);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
});

// The document-level check above passed all along on the broken layout: the
// filter hints spilled past the card's right border but still landed inside the
// 375px viewport, and the pill strips overflowed into an ancestor that clips.
// Nothing scrolled, so nothing failed — while on a real phone the "Difference"
// hint visibly ran off the edge of the card. These assertions are per-element
// against the card's own box, which is the only thing that catches that.
test.describe("Model vs SP — narrow viewport layout", () => {
  const PHONE = { width: 375, height: 812 };
  const DESKTOP = { width: 1280, height: 900 };

  // The card's padded content box, not its border box — content sitting on the
  // border is still wrong, so the padding is included in the bound.
  async function cardContentBox(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const el = document.querySelector('[data-testid="model-vs-sp-filter-bar"]') as HTMLElement;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        left: r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth),
        right: r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth),
      };
    });
  }

  async function boxOf(page: import("@playwright/test").Page, testId: string) {
    const box = await page.getByTestId(testId).boundingBox();
    if (!box) throw new Error(`no bounding box for ${testId}`);
    return { ...box, right: box.x + box.width, bottom: box.y + box.height };
  }

  // The clipping element of a horizontal ScrollView — the strip's own viewport,
  // as distinct from its content container, whose children legitimately extend
  // beyond it (that is what "scrollable" means).
  async function stripViewportBox(page: import("@playwright/test").Page, rowTestId: string) {
    return page.evaluate(rowId => {
      const row = document.querySelector(`[data-testid="${rowId}"]`) as HTMLElement;
      const el = Array.from(row.querySelectorAll("*")).find(node =>
        ["scroll", "auto"].includes(getComputedStyle(node).overflowX)
      ) as HTMLElement | undefined;
      if (!el) throw new Error(`no horizontal scroller inside ${rowId}`);
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }, rowTestId);
  }

  for (const filterKey of ["modelProb", "impliedSp", "edge"]) {
    test(`the ${filterKey} hint stays inside the filter card at 375px`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await openScreen(page);
      const card = await cardContentBox(page);
      const hint = await boxOf(page, `model-vs-sp-filter-hint-${filterKey}`);
      // 0.5px of tolerance for sub-pixel layout, not enough to hide the ~11px
      // the "pts apart, ± ignored" hint used to escape by.
      expect(hint.right).toBeLessThanOrEqual(card.right + 0.5);
      expect(hint.x).toBeGreaterThanOrEqual(card.left - 0.5);
    });
  }

  test("the longest hint drops below the inputs at 375px instead of squeezing beside them", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openScreen(page);
    const maxInput = await boxOf(page, "model-vs-sp-max-edge");
    const hint = await boxOf(page, "model-vs-sp-filter-hint-edge");
    expect(hint.y).toBeGreaterThanOrEqual(maxInput.bottom);
    // Its whole reason for moving: the full text is still there, on one line.
    await expect(page.getByTestId("model-vs-sp-filter-hint-edge")).toHaveText("pts apart, ± ignored");
  });

  test("both number inputs still fit side by side at 375px", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openScreen(page);
    const min = await boxOf(page, "model-vs-sp-min-edge");
    const max = await boxOf(page, "model-vs-sp-max-edge");
    const card = await cardContentBox(page);
    // Same line, min then max, both inside the card.
    expect(Math.abs(min.y - max.y)).toBeLessThanOrEqual(1);
    expect(min.right).toBeLessThanOrEqual(max.x);
    expect(max.right).toBeLessThanOrEqual(card.right + 0.5);
    // Wide enough to still read a three-digit value.
    expect(min.width).toBeGreaterThanOrEqual(56);
  });

  test("the year and month pill strips are clipped by the card, not by the screen edge", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openScreen(page);
    const card = await cardContentBox(page);
    for (const row of ["model-vs-sp-year-pills", "model-vs-sp-month-pills"]) {
      const strip = await stripViewportBox(page, row);
      expect(strip.right).toBeLessThanOrEqual(card.right + 0.5);
      expect(strip.left).toBeGreaterThanOrEqual(card.left - 0.5);
    }
    // Still a scroller, not a truncation — the earliest year is reachable.
    await page.getByTestId("model-vs-sp-year-pill-2015").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("model-vs-sp-year-pill-2015")).toBeVisible();
  });

  test("the pills still apply their date range at 375px", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openScreen(page);
    await page.getByTestId("model-vs-sp-month-pill-2025-06").click();
    await expect(page).toHaveURL(/minDate=2025-06-01/);
    await expect(page).toHaveURL(/maxDate=2025-06-30/);
    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText("2 runners");
  });

  test("the desktop layout keeps the hint inline beside the inputs", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openScreen(page);
    const maxInput = await boxOf(page, "model-vs-sp-max-edge");
    const hint = await boxOf(page, "model-vs-sp-filter-hint-edge");
    // Guards the other direction: the stacked phone layout must not leak into
    // widths that have room for the original single-line grid.
    expect(hint.x).toBeGreaterThanOrEqual(maxInput.right);
    expect(hint.y).toBeLessThan(maxInput.bottom);
    const yearRow = await boxOf(page, "model-vs-sp-year-pills");
    const yearStrip = await stripViewportBox(page, "model-vs-sp-year-pills");
    // Label to the left of the strip, both on one line.
    expect(yearStrip.left).toBeGreaterThan(yearRow.x);
  });
});

test.describe("Model vs SP — auth gating", () => {
  anonTest("an anonymous visit lands on the auth screen, not the runner list", async ({ page }) => {
    await page.goto("/model-vs-sp");
    // Only the /isp family renders anonymously (see isIspRoute in App.tsx), so
    // this route must fall through to the login wall. AuthScreen has no root
    // testID, so its email field stands in for it.
    await expect(page.getByTestId("auth-email-input")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("model-vs-sp-list")).toHaveCount(0);
  });

  anonTest("the Model vs SP menu item is absent when logged out", async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    // It sits inside AppHeader's isAuthenticated guard, alongside Results/Bets.
    await expect(page.getByTestId("industry-sp-menu-model-vs-sp-link")).toHaveCount(0);
  });
});
