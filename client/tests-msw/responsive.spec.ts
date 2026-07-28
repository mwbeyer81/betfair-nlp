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
const LAPTOP_VIEWPORT = { width: 1440, height: 900 }; // also the isWide breakpoint (see useResponsive)
const JUST_BELOW_WIDE_VIEWPORT = { width: 1439, height: 900 };
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

  // Header actions collapse behind a burger icon below the tablet breakpoint
  // (768px) — see all-runners-menu-button/all-runners-nav-menu in
  // AllRunnersScreen.tsx. Closed by default; opening it reveals the same
  // sort-toggle/Export/← Events buttons the tablet+ inline row always had.
  test("burger menu opens to reveal sort toggle and ← Events buttons, both within viewport width", async ({ page }) => {
    await expect(page.getByTestId("all-runners-nav-menu")).not.toBeVisible();
    await page.getByTestId("all-runners-menu-button").click();

    const sortBtn = page.getByTestId("all-runners-sort-toggle");
    const eventsBtn = page.getByTestId("all-runners-menu-events-link");

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
    await page.getByTestId("all-runners-menu-button").click();
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

// Same burger-menu pattern as IndustrySpScreen/AllRunnersScreen, applied
// consistently to every screen whose header has more than one action button
// (see useHeaderMenu/HeaderActionsContainer) — /events and /chat each get
// their own narrow-viewport coverage here rather than relying only on the
// /isp and /runners checks above.
test.describe("Responsive layout — /events (MSW mocked, iPhone 12 mini, 375px)", () => {
  test.use({ viewport: IPHONE_12_MINI_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-group-item-33858191")).toBeVisible({ timeout: 10000 });
  });

  test("burger menu is closed by default and the inline row is absent", async ({ page }) => {
    await expect(page.getByTestId("events-menu-button")).toBeVisible();
    await expect(page.getByTestId("events-nav-menu")).not.toBeVisible();
    await expect(page.getByTestId("events-header-actions")).toHaveCount(0);
  });

  test("opening the burger reveals the sort toggle and Chat button, both within viewport", async ({ page }) => {
    await page.getByTestId("events-menu-button").click();
    await expect(page.getByTestId("events-nav-menu")).toBeVisible();

    for (const testId of ["events-sort-toggle", "events-menu-chat-link"]) {
      const el = page.getByTestId(testId);
      await expect(el).toBeVisible();
      const box = (await el.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);
    }
  });
});

test.describe("Responsive layout — /chat (MSW mocked, iPhone 12 mini, 375px)", () => {
  test.use({ viewport: IPHONE_12_MINI_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 10000 });
  });

  test("burger menu is closed by default and the inline row is absent", async ({ page }) => {
    await expect(page.getByTestId("chat-menu-button")).toBeVisible();
    await expect(page.getByTestId("chat-nav-menu")).not.toBeVisible();
    await expect(page.getByTestId("chat-header-actions")).toHaveCount(0);
  });

  test("opening the burger reveals ← Events and Logout, both within viewport", async ({ page }) => {
    await page.getByTestId("chat-menu-button").click();
    const menu = page.getByTestId("chat-nav-menu");
    await expect(menu).toBeVisible();

    for (const testId of ["chat-menu-events-link", "chat-logout-button"]) {
      const el = page.getByTestId(testId);
      await expect(el).toBeVisible();
      const box = (await el.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);
    }
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

  // Regression test: the header action buttons (Show/Hide filters, Model
  // Performance, Account/Log Out) used to render inline at every viewport
  // width, including phone widths where there wasn't room — the row
  // overflowed and painted over the "BackBet" title. They're now collapsed
  // behind a burger icon on phone widths (`!isTablet`, <768px) instead, with
  // Chat/Events/Runners links added to the same dropdown (see
  // `renderHeaderActions` in IndustrySpScreen.tsx). Tablet+ keeps the old
  // always-visible inline row unchanged — see the 768px+ describe blocks
  // below, which never open the burger and still assert on
  // industry-sp-header-actions directly.
  test("burger menu button is visible, and the menu is closed by default", async ({ page }) => {
    const menuBtn = page.getByTestId("industry-sp-menu-button");
    await expect(menuBtn).toBeVisible();
    const box = (await menuBtn.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);

    await expect(page.getByTestId("industry-sp-nav-menu")).not.toBeVisible();
    // The inline row is a tablet+-only element — it must not sneak into the
    // DOM at phone widths even hidden, since that's exactly the bug that
    // caused the original overlap.
    await expect(page.getByTestId("industry-sp-header-actions")).toHaveCount(0);
  });

  test("tapping the burger menu reveals filters/Model Performance/nav links/Log Out, all fitting within the viewport", async ({ page }) => {
    await page.getByTestId("industry-sp-menu-button").click();
    const menu = page.getByTestId("industry-sp-nav-menu");
    await expect(menu).toBeVisible();

    const items = [
      "industry-sp-filters-toggle",
      "industry-sp-model-performance-button",
      "industry-sp-menu-chat-link",
      "industry-sp-menu-events-link",
      "industry-sp-menu-runners-link",
      "industry-sp-logout-button",
    ];
    for (const testId of items) {
      const el = page.getByTestId(testId);
      await expect(el).toBeVisible();
      const box = (await el.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);
    }
  });

  test("header title does not overlap the open nav menu", async ({ page }) => {
    await page.getByTestId("industry-sp-menu-button").click();
    const title = page.getByTestId("industry-sp-title");
    const menu = page.getByTestId("industry-sp-nav-menu");
    await expect(title).toBeVisible();
    await expect(menu).toBeVisible();

    const titleBox = (await title.boundingBox())!;
    const menuBox = (await menu.boundingBox())!;

    // The menu must start at or below the title's bottom edge — any overlap
    // means the dropdown is painting over the "BackBet" title.
    expect(menuBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
  });

  test("tapping a nav menu item closes the menu", async ({ page }) => {
    await page.getByTestId("industry-sp-menu-button").click();
    await expect(page.getByTestId("industry-sp-nav-menu")).toBeVisible();

    await page.getByTestId("industry-sp-filters-toggle").click();
    await expect(page.getByTestId("industry-sp-nav-menu")).not.toBeVisible();
  });

  test("Chat/Events/Runners links in the nav menu actually navigate", async ({ page }) => {
    await page.getByTestId("industry-sp-menu-button").click();
    await page.getByTestId("industry-sp-menu-chat-link").click();
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 10000 });

    await page.goBack();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-menu-button").click();
    await page.getByTestId("industry-sp-menu-events-link").click();
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });

    await page.goBack();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-menu-button").click();
    await page.getByTestId("industry-sp-menu-runners-link").click();
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
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
    const backBtn = page.getByTestId("industry-sp-races-back-button");
    await expect(sortBtn).toBeVisible();
    await expect(backBtn).toBeVisible();

    const backBox = await backBtn.boundingBox();
    expect(backBox!.x + backBox!.width).toBeLessThanOrEqual(IPHONE_12_MINI_VIEWPORT.width + 1);
  });
});

// Regression test for a real narrow-viewport bug reported against
// production (iPhone 12 mini, real Safari): DailyRacesScreen.tsx's filter
// bar overflowed the whole page horizontally, cutting off inputs/buttons at
// the right edge. Root cause was the same flexbox bug class as the ISP
// filters screen's own filterStepper fix (see the /isp filters screen
// describe block above and its "filter grid's rows/inputs had no width
// constraint" comment): filterGridRow/chipFilterRow/countryBar (a flex:1
// child) had no flexShrink/minWidth:0, so they grew to fit their own
// unwrapped content and forced the whole scrollable page wider than the
// viewport before any internal wrap could engage.
//
// The shared MOCK_DAILY_RACES fixture (2 courses, 1 going/class/type) isn't
// diverse enough to reproduce this — confirmed by testing against it first,
// which didn't overflow even before the fix. A real day's card easily spans
// a dozen+ distinct courses/goings/classes/types/regions, so this block
// mocks a richer, self-contained dataset (not touching the shared fixture,
// to avoid affecting other daily-races tests' assumed counts) sized to
// actually exercise the failure mode.
function dailyRaceRunnerForResponsiveTest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runnerId: "hrs_1", horse: "Fixture Star", age: "6", sex: "gelding", sexCode: "G", colour: "b",
    region: "GB", dam: "Star Dam", damId: "dam_1", sire: "Star Sire", sireId: "sir_1",
    damsire: "Star Damsire", damsireId: "dsi_1", trainer: "A Trainer", trainerId: "trn_1",
    owner: "Owner", ownerId: "own_1", number: "1", draw: "0", headgear: "", lbs: "154",
    officialRating: "98", jockey: "B Jockey", jockeyId: "jky_1", lastRun: "21", form: "1-21",
    modelWinProbability: 25,
    ...overrides,
  };
}
const DAILY_RACES_COURSES = ["Beverley", "Compiegne", "Ffos Las", "Newton Abbot", "Ascot", "Chepstow", "Nottingham", "Ripon", "Warwick", "Curragh"];
const DAILY_RACES_GOINGS = ["Good", "Good To Firm", "Good To Soft", "Soft", "Heavy"];
const DAILY_RACES_CLASSES = ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6"];
const DAILY_RACES_TYPES = ["Flat", "Hurdle", "Chase", "NH Flat"];
const DAILY_RACES_REGIONS = ["GB", "IRE", "FR"];
const MOCK_DAILY_RACES_RICH = DAILY_RACES_COURSES.map((course, i) => ({
  raceId: `rac_${i}`, eventId: `${course.toLowerCase().replace(/\s+/g, "-")}-2026-06-03`, course, date: "2026-06-03",
  offTime: "1:50", offDt: "2026-06-03T13:50:00+01:00", raceName: "Novices' Hurdle",
  distanceF: "16.0", region: DAILY_RACES_REGIONS[i % DAILY_RACES_REGIONS.length],
  raceClass: DAILY_RACES_CLASSES[i % DAILY_RACES_CLASSES.length],
  type: DAILY_RACES_TYPES[i % DAILY_RACES_TYPES.length], ageBand: "4yo+",
  prize: "£3,769", fieldSize: "1", going: DAILY_RACES_GOINGS[i % DAILY_RACES_GOINGS.length], surface: "Turf",
  runners: [dailyRaceRunnerForResponsiveTest({ runnerId: `hrs_${i}` })],
}));

for (const width of [320, 375, 390]) {
  test.describe(`Responsive layout — Daily Races filter bar (MSW mocked, ${width}px)`, () => {
    test.use({ viewport: { width, height: 812 } });

    test.beforeEach(async ({ page }) => {
      await page.route((url) => url.pathname === "/api/daily-races", (route) =>
        route.fulfill({ json: { success: true, data: MOCK_DAILY_RACES_RICH, count: MOCK_DAILY_RACES_RICH.length } })
      );
      await page.goto("/daily-races");
      await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("daily-races-loading")).not.toBeVisible({ timeout: 10000 });
      await page.getByTestId("daily-races-filter-apply").click();
    });

    // Deliberately NOT the findOverflowingElements element-scan used
    // elsewhere in this file — the Course/Going/Class/Type/Region chip rows
    // are intentionally horizontally-scrollable, so with this many distinct
    // values, chips genuinely (and correctly) sit off-screen inside their
    // own ScrollView. getBoundingClientRect doesn't know the difference
    // between "off-screen inside a properly clipping scroll container" and
    // "actually overflowing the page", so that scan produces false
    // positives here. document.scrollWidth doesn't have that problem — it
    // reflects the page's real, laid-out width regardless of what's
    // scrolled off-screen inside a child container.
    test(`page does not overflow horizontally at ${width}px`, async ({ page }) => {
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(width);
    });

    test("filter bar, Apply, and Reset all fit within the viewport", async ({ page }) => {
      const bar = page.getByTestId("daily-races-filter-bar");
      await expect(bar).toBeVisible();
      const barBox = (await bar.boundingBox())!;
      expect(barBox.x + barBox.width).toBeLessThanOrEqual(width + 1);

      for (const testId of ["daily-races-filter-apply", "daily-races-filter-reset"]) {
        const el = page.getByTestId(testId);
        await expect(el).toBeVisible();
        const box = (await el.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      }
    });
  });
}

test.describe("Responsive layout — Runner Detail screen (MSW mocked, iPhone 12 mini, 375px)", () => {
  test.use({ viewport: IPHONE_12_MINI_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-item-12347").click();
    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-detail-loading")).not.toBeVisible({ timeout: 10000 });
  });

  test("no element on the page overflows the 375px viewport", async ({ page }) => {
    const overflowing = await findOverflowingElements(page, IPHONE_12_MINI_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });
});

test.describe("Responsive layout — Runner History screen (MSW mocked, iPhone 12 mini, 375px)", () => {
  test.use({ viewport: IPHONE_12_MINI_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/runner/history?runnerName=" + encodeURIComponent("Fact To File"));
    await expect(page.getByTestId("runner-history-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-history-loading")).not.toBeVisible({ timeout: 10000 });
  });

  test("no element on the page overflows the 375px viewport", async ({ page }) => {
    // Likely the tightest fit of the three new screens — 4 chip rows plus a
    // date range and ISP range packed into the filter bar.
    const overflowing = await findOverflowingElements(page, IPHONE_12_MINI_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });
});

test.describe("Responsive layout — Trainer Detail screen (MSW mocked, iPhone 12 mini, 375px)", () => {
  test.use({ viewport: IPHONE_12_MINI_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/trainer?trainer=" + encodeURIComponent("W P Mullins") + "&formCategory=Flat");
    await expect(page.getByTestId("trainer-detail-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("trainer-detail-loading")).not.toBeVisible({ timeout: 10000 });
  });

  test("no element on the page overflows the 375px viewport", async ({ page }) => {
    const overflowing = await findOverflowingElements(page, IPHONE_12_MINI_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
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
    await expect(page.getByTestId("all-runners-menu-events-link")).toBeVisible();
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
    await expect(page.getByTestId("all-runners-menu-events-link")).toBeVisible();
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
    await expect(page.getByTestId("events-menu-chat-link")).toBeVisible();
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

// Regression test for a real production screenshot (app.backbet.co.uk/isp,
// a wide desktop browser window): the shared AppHeader (see AppHeader.tsx)
// always rendered its "BackBet" brand and its nav/action buttons as two
// separate lines — a deliberate choice from the header-overlap-fix/
// unified-header work (always-wrap regardless of viewport, so it can never
// overflow at any width) — but at wide desktop widths there's clearly
// enough room for both on one line, and stacking them there just reads as
// broken. Fixed via `isWide` (>=1440px, the pre-existing but previously
// unused BREAKPOINTS.wide) folding the actions row up into the same line
// as the brand; narrower tablet/laptop widths keep the original
// stacked-two-lines layout unchanged.
test.describe("Header layout — /isp (MSW mocked, wide desktop widths)", () => {
  test("title and header actions share one line at the 1440px wide breakpoint", async ({ page }) => {
    await page.setViewportSize(LAPTOP_VIEWPORT);
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    const title = page.getByTestId("industry-sp-title");
    const actions = page.getByTestId("industry-sp-header-actions");
    await expect(title).toBeVisible();
    await expect(actions).toBeVisible();

    const titleBox = (await title.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;

    // Same line means near-equal y (small tolerance for differing button/
    // text heights) and the actions row sitting to the right of the title,
    // not below it.
    expect(Math.abs(titleBox.y - actionsBox.y)).toBeLessThan(20);
    expect(actionsBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(LAPTOP_VIEWPORT.width + 1);
  });

  test("title and header actions share one line at MacBook landscape (1728px)", async ({ page }) => {
    await page.setViewportSize(MACBOOK_LANDSCAPE_VIEWPORT);
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    const title = page.getByTestId("industry-sp-title");
    const actions = page.getByTestId("industry-sp-header-actions");
    const titleBox = (await title.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;

    expect(Math.abs(titleBox.y - actionsBox.y)).toBeLessThan(20);
    expect(actionsBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
  });

  test("header actions still stack below the title just under the wide breakpoint (1439px)", async ({ page }) => {
    // Locks in the pre-existing stacked layout for the tablet/laptop range
    // below 1440px — the fix must not accidentally widen its own threshold.
    await page.setViewportSize(JUST_BELOW_WIDE_VIEWPORT);
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    const title = page.getByTestId("industry-sp-title");
    const actions = page.getByTestId("industry-sp-header-actions");
    const titleBox = (await title.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;

    expect(actionsBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
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

test.describe("Responsive layout — /results (MSW mocked, iPhone 12 mini, 375px)", () => {
  test.use({ viewport: IPHONE_12_MINI_VIEWPORT });

  test("no element overflows the viewport at 375px", async ({ page }) => {
    await page.goto("/results");
    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 10000 });
    const overflowing = await findOverflowingElements(page, IPHONE_12_MINI_VIEWPORT.width);
    expect(overflowing, JSON.stringify(overflowing, null, 2)).toEqual([]);
  });

  test("result cards stack in a single column and remain tappable", async ({ page }) => {
    await page.goto("/results");
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 10000 });
    // The screen sorts newest-first by createdAt (SavedResultsListScreen.tsx),
    // and mock-result-2 has the later createdAt in fixtures.ts, so it's the
    // top card and mock-result-1 is second, not the other way around.
    const topCard = page.getByTestId("saved-results-item-mock-result-2");
    const bottomCard = page.getByTestId("saved-results-item-mock-result-1");
    await expect(topCard).toBeVisible();
    await expect(bottomCard).toBeVisible();
    const topBox = await topCard.boundingBox();
    const bottomBox = await bottomCard.boundingBox();
    // Stacked, not side-by-side — same x, bottomCard starts below topCard ends.
    expect(bottomBox!.x).toBe(topBox!.x);
    expect(bottomBox!.y).toBeGreaterThanOrEqual(topBox!.y + topBox!.height - 1);
  });
});
