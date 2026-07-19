import { test, expect } from "./fixtures";

// Tests run against a static build with all API calls mocked via page.route().
// Each describe block sets the viewport to a narrow size and verifies the
// layout does not overflow or clip essential controls.

const MOBILE_VIEWPORT = { width: 375, height: 667 };  // iPhone SE
// iPhone 12 / 13 / 12 mini / 13 mini viewport width is 390 or 375 depending on
// model. Using a plain {width,height} object rather than the Playwright
// devices["iPhone 12"] preset: spreading a full device preset (which also
// carries defaultBrowserType) inside test.use() inside a describe block is
// rejected by Playwright 1.55 ("forces a new worker"); a plain viewport
// object doesn't hit that restriction.
const IPHONE_12_VIEWPORT = { width: 390, height: 844 };
const IPHONE_12_MINI_VIEWPORT = { width: 375, height: 812 };
const TABLET_VIEWPORT = { width: 768, height: 1024 }; // narrow laptop / iPad
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const IPAD_LANDSCAPE_VIEWPORT = { width: 1024, height: 768 }; // also the isDesktop breakpoint (see useResponsive)
const JUST_BELOW_DESKTOP_VIEWPORT = { width: 1023, height: 768 };
const LAPTOP_VIEWPORT = { width: 1440, height: 900 };
const MACBOOK_LANDSCAPE_VIEWPORT = { width: 1728, height: 1117 };
// A real phone's *visible* viewport once Safari's address bar and bottom tab
// bar chrome are accounted for — shorter than the device's full screen height.
const SHORT_MOBILE_VIEWPORT = { width: 390, height: 500 };

// /isp now shows nothing until Apply is pressed (a bare load fetches
// nothing and renders an idle placeholder — see IndustrySpScreen.tsx and
// its own dedicated bare-load tests in industry-sp.spec.ts). These layout
// tests care about the *populated* state — real chips, real split cards —
// since that's the actual overflow/positioning risk they guard against.
async function gotoIspAndApplyDefaults(page: import("@playwright/test").Page) {
  await page.goto("/isp");
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
}

// Scans every element in the page and returns any whose right edge extends
// past the viewport width — used to catch text/badges clipped off-screen
// rather than just checking a handful of known container elements.
async function findOverflowingElements(page: import("@playwright/test").Page, viewportWidth: number) {
  return page.evaluate((w) => {
    const results: { tag: string; testid: string | null; right: number; text: string }[] = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > w + 1) {
        results.push({
          tag: el.tagName,
          testid: el.getAttribute("data-testid"),
          right: Math.round(r.right),
          text: (el.textContent || "").slice(0, 40),
        });
      }
    });
    return results;
  }, viewportWidth);
}

test.describe("Responsive layout — /runners (MSW mocked, 375px)", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("sort toggle and ← Events buttons are within viewport width", async ({ page }) => {
    const sortBtn = page.getByTestId("all-runners-sort-toggle");
    const eventsBtn = page.getByTestId("all-runners-screen-events-button");

    await expect(sortBtn).toBeVisible();
    await expect(eventsBtn).toBeVisible();

    const sortBox = await sortBtn.boundingBox();
    const eventsBox = await eventsBtn.boundingBox();

    expect(sortBox!.x + sortBox!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    expect(eventsBox!.x + eventsBox!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });

  test("filter bar fits within 375px — no horizontal scroll needed", async ({ page }) => {
    const bar = page.getByTestId("all-runners-filter-bar");
    await expect(bar).toBeVisible();

    const box = await bar.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

    // Apply button must be visible without any manual scrolling
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
  });

  test("runner rows do not overflow viewport width", async ({ page }) => {
    const firstRow = page.locator('[data-testid^="all-runner-item-"]').first();
    await expect(firstRow).toBeVisible();

    const box = await firstRow.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });

  test("export modal fits within 375px viewport", async ({ page }) => {
    const exportBtn = page.getByTestId("all-runners-export-btn");
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    const modal = page.getByTestId("all-runners-export-modal");
    await expect(modal).toBeVisible();

    const box = await modal.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });

  test("PnL bar is fully within viewport", async ({ page }) => {
    const bar = page.getByTestId("all-runners-pnl-bar");
    await expect(bar).toBeVisible();

    const box = await bar.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });
});

test.describe("Responsive layout — /runners (MSW mocked, iPhone 12)", () => {
  test.use({ viewport: IPHONE_12_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("filter bar and numeric inputs fit within the iPhone 12 viewport", async ({ page }) => {
    const bar = page.getByTestId("all-runners-filter-bar");
    await expect(bar).toBeVisible();

    const viewportWidth = 390;
    const box = await bar.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(viewportWidth);
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
  });

  test("BSP and Race numeric inputs render entered values without clipping", async ({ page }) => {
    const minBsp = page.getByTestId("all-runners-min-bsp");
    await minBsp.fill("1234.5");
    const minBspClip = await minBsp.evaluate(
      (el: HTMLInputElement) => el.scrollWidth <= el.clientWidth
    );
    expect(minBspClip).toBe(true);

    const toRow = page.getByTestId("all-runners-to-row");
    await toRow.fill("12345");
    const toRowClip = await toRow.evaluate(
      (el: HTMLInputElement) => el.scrollWidth <= el.clientWidth
    );
    expect(toRowClip).toBe(true);
  });

  test("runner rows do not overflow the iPhone 12 viewport width", async ({ page }) => {
    const firstRow = page.locator('[data-testid^="all-runner-item-"]').first();
    await expect(firstRow).toBeVisible();

    const box = await firstRow.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1);
  });
});

test.describe("Responsive layout — /isp filters screen (MSW mocked, iPhone 12 mini, 375px)", () => {
  test.use({ viewport: IPHONE_12_MINI_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await gotoIspAndApplyDefaults(page);
  });

  test("no element on the page overflows the 375px viewport", async ({ page }) => {
    // Regression test: the filter grid's rows/inputs had no width constraint
    // as children of the outer wrap container, so they grew to fit their
    // unwrapped content and overflowed their own parent before any internal
    // wrap could engage.
    const overflowing = await findOverflowingElements(page, IPHONE_12_MINI_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });

  test("filter bar and Apply button fit within the viewport", async ({ page }) => {
    const bar = page.getByTestId("industry-sp-filter-bar");
    await expect(bar).toBeVisible();
    const barBox = await bar.boundingBox();
    expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);

    await expect(page.getByTestId("industry-sp-filter-apply")).toBeVisible();
  });

  test("header buttons ('← Events') fit within the viewport", async ({ page }) => {
    const eventsBtn = page.getByTestId("industry-sp-screen-events-button");
    await expect(eventsBtn).toBeVisible();

    const eventsBox = await eventsBtn.boundingBox();
    expect(eventsBox!.x + eventsBox!.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);
  });
});

test.describe("Responsive layout — /isp filters screen on a short viewport (MSW mocked)", () => {
  test.use({ viewport: SHORT_MOBILE_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await gotoIspAndApplyDefaults(page);
  });

  test("split B's PnL headline and its View Races button don't overlap", async ({ page }) => {
    // Regression test: the split card used to cram Races/Horses/Staked/
    // Return/PnL into one flex-wrapped row, which wrapped onto the View
    // Races button on narrow phones. That detail moved to a dedicated
    // SplitDetailPanel; the card itself now shows only a single-line PnL
    // headline, but this guards against a future regression reintroducing
    // overlap between the headline and the button row below it.
    //
    // Uses split B specifically: this fixture's mocked dataset has exactly
    // 1 matching race, and the default split is an even half/half divide
    // of the total — with a total of 1, split A's window (1-0) is empty
    // and split B's (1-<end>) is the one that covers the single race, so
    // B is the one with a PnL headline to check.
    const pnlHeadline = page.getByTestId("industry-sp-pnl-b");
    const card = page.getByTestId("industry-sp-split-card-b");
    const button = page.getByTestId("industry-sp-view-races-button-b");
    await expect(pnlHeadline).toBeVisible();
    await expect(card).toBeVisible();

    const pnlBox = (await pnlHeadline.boundingBox())!;
    const buttonBox = (await button.boundingBox())!;

    // The button must start at or below the PnL headline's bottom edge —
    // any overlap means the button is painting over the PnL figure.
    expect(buttonBox.y).toBeGreaterThanOrEqual(pnlBox.y + pnlBox.height - 1);
  });

  test("split A's Details button opens a full-screen panel that fits the viewport", async ({ page }) => {
    await page.getByTestId("industry-sp-split-details-button-a").click();
    const panel = page.getByTestId("split-detail-panel-a");
    await expect(panel).toBeVisible();

    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(SHORT_MOBILE_VIEWPORT.width + 1);
  });

  test("both split cards are reachable on the page", async ({ page }) => {
    // This screen now scrolls (it holds two independent split cards, plus
    // the filter grid), so unlike the old single-card layout it's fine —
    // expected, even — for the whole page to exceed one short viewport.
    // What matters is that both split cards' View Races buttons actually
    // exist and are scrollable into view.
    const buttonA = page.getByTestId("industry-sp-view-races-button-a");
    const buttonB = page.getByTestId("industry-sp-view-races-button-b");
    await buttonA.scrollIntoViewIfNeeded();
    await expect(buttonA).toBeVisible();
    await buttonB.scrollIntoViewIfNeeded();
    await expect(buttonB).toBeVisible();
  });
});

test.describe("Responsive layout — /isp/races screen (MSW mocked, iPhone 12 mini, 375px)", () => {
  test.use({ viewport: IPHONE_12_MINI_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("no element on the page overflows the 375px viewport", async ({ page }) => {
    // Regression test: raceHeader (race time/type/runner-count/PnL%) and
    // runnerRow (ISP/stake/PnL/status pill) were flexDirection:row with no
    // flexWrap and no flexShrink protection, so on a narrow viewport the
    // trailing element (PnL% or the WINNER/LOSER/PLACED pill) got pushed
    // off-screen with nothing to wrap it onto a second line.
    const overflowing = await findOverflowingElements(page, IPHONE_12_MINI_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });

  test("race header and runner rows fit within the viewport", async ({ page }) => {
    const raceHeader = page.locator('[data-testid^="industry-sp-race-"]:not([data-testid="industry-sp-race-bound"])').first();
    await expect(raceHeader).toBeVisible();
    const raceBox = await raceHeader.boundingBox();
    expect(raceBox!.x + raceBox!.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);

    const runnerRow = page.locator('[data-testid^="industry-sp-item-"]').first();
    await expect(runnerRow).toBeVisible();
    const runnerBox = await runnerRow.boundingBox();
    expect(runnerBox!.x + runnerBox!.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);
  });

  test("PnL percentage text and status pill are visible, not clipped", async ({ page }) => {
    // These are the two specific pieces of text that were clipped off-screen
    // on a real iPhone 12 mini before the flexWrap fix.
    const raceHeader = page.locator('[data-testid^="industry-sp-race-"]:not([data-testid="industry-sp-race-bound"])').first();
    await expect(raceHeader).toContainText("%");

    const runnerRow = page.locator('[data-testid^="industry-sp-item-"]').first();
    const runnerText = await runnerRow.textContent();
    expect(runnerText).toMatch(/LOSER|WINNER|PLACED/);
    await expect(runnerRow).toBeVisible();
  });

  test("header buttons ('First → Last', '← Filters') fit within the viewport", async ({ page }) => {
    const sortBtn = page.getByTestId("industry-sp-sort-toggle");
    const backBtn = page.getByTestId("industry-sp-races-back");
    await expect(sortBtn).toBeVisible();
    await expect(backBtn).toBeVisible();

    const backBox = await backBtn.boundingBox();
    expect(backBox!.x + backBox!.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);
  });
});

test.describe("Responsive layout — /runners (MSW mocked, 768px)", () => {
  test.use({ viewport: TABLET_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("all header buttons visible at 768px", async ({ page }) => {
    await expect(page.getByTestId("all-runners-sort-toggle")).toBeVisible();
    await expect(page.getByTestId("all-runners-screen-events-button")).toBeVisible();
  });

  test("filter-apply button visible without scrolling at 768px", async ({ page }) => {
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
  });
});

test.describe("Responsive layout — /runners (MSW mocked, 1280px)", () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("all header buttons visible at 1280px", async ({ page }) => {
    await expect(page.getByTestId("all-runners-sort-toggle")).toBeVisible();
    await expect(page.getByTestId("all-runners-screen-events-button")).toBeVisible();
    await expect(page.getByTestId("all-runners-filter-apply")).toBeVisible();
  });
});

// --- Wide viewports (tablet-landscape through MacBook) ------------------
//
// PageContainer (see src/components/PageContainer.tsx) caps each screen's
// scrollable content to a max-width and centers it once the viewport is
// wide enough that content would otherwise stretch edge-to-edge — verified
// here by checking the content never grows past its cap plus a small
// tolerance, rather than just "doesn't overflow the viewport" (which a
// naively-unconstrained full-bleed layout would also satisfy).

async function contentWidth(page: import("@playwright/test").Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  return box!.width;
}

test.describe("Responsive layout — /events (MSW mocked, laptop 1440px)", () => {
  test.use({ viewport: LAPTOP_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-group-item-33858191")).toBeVisible({ timeout: 10000 });
  });

  test("no element overflows the viewport at 1440px", async ({ page }) => {
    const overflowing = await findOverflowingElements(page, LAPTOP_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });

  test("event list content is capped well short of the full viewport width", async ({ page }) => {
    // event-group-list is the ScrollView itself (full-bleed by design, for
    // scroll physics) — its PageContainer child is what's actually capped,
    // so measure the first event item instead.
    const width = await contentWidth(page, "event-group-item-33858191");
    expect(width).toBeLessThan(LAPTOP_VIEWPORT.width - 200);
  });

  test("header buttons still visible at 1440px", async ({ page }) => {
    await expect(page.getByTestId("events-sort-toggle")).toBeVisible();
    await expect(page.getByTestId("events-screen-chat-button")).toBeVisible();
  });
});

test.describe("Responsive layout — /events (MSW mocked, MacBook landscape 1728px)", () => {
  test.use({ viewport: MACBOOK_LANDSCAPE_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-group-item-33858191")).toBeVisible({ timeout: 10000 });
  });

  test("no element overflows the viewport at 1728px", async ({ page }) => {
    const overflowing = await findOverflowingElements(page, MACBOOK_LANDSCAPE_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });

  test("event list content is capped well short of the full viewport width", async ({ page }) => {
    const width = await contentWidth(page, "event-group-item-33858191");
    expect(width).toBeLessThan(MACBOOK_LANDSCAPE_VIEWPORT.width - 500);
  });
});

test.describe("Responsive layout — /isp filters screen (MSW mocked, laptop 1440px)", () => {
  test.use({ viewport: LAPTOP_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await gotoIspAndApplyDefaults(page);
  });

  test("no element overflows the viewport at 1440px", async ({ page }) => {
    const overflowing = await findOverflowingElements(page, LAPTOP_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });

  test("filter grid content is capped well short of the full viewport width", async ({ page }) => {
    const width = await contentWidth(page, "industry-sp-filter-bar");
    expect(width).toBeLessThan(LAPTOP_VIEWPORT.width - 400);
  });

  test("Split A and Split B cards sit side by side at desktop width", async ({ page }) => {
    const boxA = await page.getByTestId("industry-sp-split-card-a").boundingBox();
    const boxB = await page.getByTestId("industry-sp-split-card-b").boundingBox();
    // Side-by-side means roughly the same vertical position and B strictly
    // to the right of A — stacked would instead show B well below A.
    expect(Math.abs(boxA!.y - boxB!.y)).toBeLessThan(5);
    expect(boxB!.x).toBeGreaterThan(boxA!.x + boxA!.width - 5);
  });
});

test.describe("Responsive layout — /isp split cards at the 1024px isDesktop breakpoint (MSW mocked)", () => {
  test.use({ viewport: IPAD_LANDSCAPE_VIEWPORT });

  test("cards are side by side right at 1024px", async ({ page }) => {
    await gotoIspAndApplyDefaults(page);
    const boxA = await page.getByTestId("industry-sp-split-card-a").boundingBox();
    const boxB = await page.getByTestId("industry-sp-split-card-b").boundingBox();
    expect(Math.abs(boxA!.y - boxB!.y)).toBeLessThan(5);
  });
});

test.describe("Responsive layout — /isp split cards just below the 1024px isDesktop breakpoint (MSW mocked)", () => {
  test.use({ viewport: JUST_BELOW_DESKTOP_VIEWPORT });

  test("cards stack vertically just below 1024px", async ({ page }) => {
    await gotoIspAndApplyDefaults(page);
    const boxA = await page.getByTestId("industry-sp-split-card-a").boundingBox();
    const boxB = await page.getByTestId("industry-sp-split-card-b").boundingBox();
    expect(boxB!.y).toBeGreaterThan(boxA!.y + boxA!.height - 5);
  });
});

test.describe("Responsive layout — /isp/races screen (MSW mocked, laptop 1440px)", () => {
  test.use({ viewport: LAPTOP_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("no element overflows the viewport at 1440px", async ({ page }) => {
    const overflowing = await findOverflowingElements(page, LAPTOP_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });

  test("race list content is capped well short of the full viewport width", async ({ page }) => {
    // industry-sp-list is the ScrollView itself (full-bleed by design, for
    // scroll physics) — its PageContainer child is what's actually capped,
    // so measure the first meeting row instead.
    const meetingBox = await page.locator('[data-testid^="industry-sp-meeting-"]').first().boundingBox();
    expect(meetingBox!.width).toBeLessThan(LAPTOP_VIEWPORT.width - 400);
  });
});

test.describe("Responsive layout — /isp/meeting screen (MSW mocked, laptop 1440px)", () => {
  test.use({ viewport: LAPTOP_VIEWPORT });

  test("no element overflows the viewport at 1440px", async ({ page }) => {
    await page.goto("/isp/meeting?id=Cheltenham%7C2025-01-01");
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-meeting-list")).toBeVisible({ timeout: 15000 });
    const overflowing = await findOverflowingElements(page, LAPTOP_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });
});

test.describe("Responsive layout — /isp/race screen (MSW mocked, laptop 1440px)", () => {
  test.use({ viewport: LAPTOP_VIEWPORT });

  test("no element overflows the viewport at 1440px", async ({ page }) => {
    await page.goto("/isp/race?id=914592");
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-list")).toBeVisible({ timeout: 15000 });
    const overflowing = await findOverflowingElements(page, LAPTOP_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });
});

test.describe("Responsive layout — /runners (MSW mocked, MacBook landscape 1728px)", () => {
  test.use({ viewport: MACBOOK_LANDSCAPE_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("no element overflows the viewport at 1728px", async ({ page }) => {
    const overflowing = await findOverflowingElements(page, MACBOOK_LANDSCAPE_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });

  test("filter bar fits in at most 2 rows at 1728px (not the pre-cap 3+ wrap)", async ({ page }) => {
    // Regression guard for the PageContainer maxWidth={1200} tuning on this
    // screen — too narrow a cap makes the already-reflowing filter bar wrap
    // into 3 rows even at very wide viewports, wasting vertical space for
    // no reason since there's plenty of horizontal room.
    const applyBox = await page.getByTestId("all-runners-filter-apply").boundingBox();
    const barBox = await page.getByTestId("all-runners-filter-bar").boundingBox();
    expect(applyBox!.y - barBox!.y).toBeLessThan(80);
  });

  test("runner list content is capped well short of the full viewport width", async ({ page }) => {
    const width = await contentWidth(page, "all-runners-filter-bar");
    expect(width).toBeLessThan(MACBOOK_LANDSCAPE_VIEWPORT.width - 400);
  });
});
