import { test, expect } from "@playwright/test";

// One-off prod repro — see .claude/commands/prod-repro-scripts.md. Run
// once, against the REAL deployed app.backbet.co.uk bundle, to confirm
// the reported bug is actually present in what's live right now.
//
// User report (screenshot): filtered Industry SP results to Jan 2024 ->
// Jan 2025 (Split A, ~4924 races), tapped the collapsed "2025" year
// header, and it stayed on "Loading..." with "Load more" greyed out —
// described as "seems like a loop where 2025 doesn't load".
//
// Root cause: ensureYearLoaded (added earlier this session for lazy
// per-year loading) walks the paginated cursor forward ONE PAGE (20
// races) at a time, sequentially awaiting each request, until a race in
// the target year appears. 2025 is a single boundary day at the very
// tail of a year-long range — reaching it means walking almost the
// entire ~4900-race Split, roughly one request per 20 races (~245
// requests). Not literally an infinite loop, but on the reported
// single-signal-bar mobile connection, indistinguishable from one.
//
// This can't be reproduced against the real *backend* without an
// authenticated session — /api/industry-sp caps anonymous requests to
// 100 total rows (see clampRowSpan/router.ts), far too small for the
// old and new algorithms to differ meaningfully. Per the "authenticated
// state or a specific data shape" case in prod-repro-scripts.md, this
// intercepts just the API responses (page.route()) with a synthetic
// 4924-race dataset shaped like the real report — the JS actually
// exercising that interception is still the real, currently-deployed
// app.backbet.co.uk bundle, so this proves the bug is live right now,
// not a local-only reproduction.
const TOTAL = 4924;
// Races [0, YEAR_BOUNDARY) are dated across 2024; races
// [YEAR_BOUNDARY, TOTAL) are dated 2025-01-01 — mirrors the real report
// exactly: 2025 is a thin sliver at the very end of a year-long,
// ascending-sorted range.
const YEAR_BOUNDARY = 4900;

function makeRace(index: number) {
  let raceTime: string;
  if (index >= YEAR_BOUNDARY) {
    const hour = 8 + ((index - YEAR_BOUNDARY) % 12);
    raceTime = `2025-01-01T${String(hour).padStart(2, "0")}:00:00`;
  } else {
    const dayOfYear = Math.floor((index / YEAR_BOUNDARY) * 365);
    const ms = Date.UTC(2024, 0, 1 + dayOfYear, 12, 0, 0);
    raceTime = new Date(ms).toISOString().slice(0, 19);
  }
  const date = raceTime.slice(0, 10);
  return {
    raceId: 900000 + index,
    meetingId: `SyntheticCourse|${date}`,
    meetingName: `Synthetic Course — ${date}`,
    course: "Synthetic Course",
    countryCode: "GB",
    raceTime,
    raceName: `Race ${index}`,
    raceType: "Flat",
    ran: 1,
    runners: [
      {
        id: 1000000 + index,
        name: `Runner ${index}`,
        num: 1,
        draw: null,
        status: "LOSER",
        sortPriority: 1,
        isp: 5,
        ispFraction: "4/1",
        isFavourite: false,
        modelWinProbability: 30,
      },
    ],
  };
}

test("REPRO (2026-07-28): tapping a distant year walks one 20-race page at a time on the live bundle", async ({ page }) => {
  test.setTimeout(150000);
  let requestCount = 0;

  await page.route("**/api/industry-sp?*", async route => {
    const url = new URL(route.request().url());
    const pageNum = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    requestCount++;
    const skip = (pageNum - 1) * limit;
    const data = skip >= TOTAL ? [] : Array.from({ length: Math.min(limit, TOTAL - skip) }, (_, i) => makeRace(skip + i));
    await route.fulfill({
      json: {
        success: true,
        data,
        count: data.length,
        total: TOTAL,
        page: pageNum,
        limit,
        totalPages: Math.ceil(TOTAL / limit),
        totalRunners: TOTAL,
        pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 },
      },
    });
  });

  await page.goto(
    "/isp/races?minRunners=1&maxRunners=20&minIsp=1&maxIsp=1000&sort=asc&minInIspRange=1&maxInIspRange=30&fromRow=1&toRow=4924&minModelWinProbability=20&onlyModelBeatsSp=true&minDate=2024-01-01&maxDate=2025-01-01"
  );
  await page.waitForSelector('[data-testid="industry-sp-year-toggle-2025"]', { timeout: 20000 });
  await expect(page.getByTestId("industry-sp-year-count-2025")).toHaveText("Tap to load");

  requestCount = 0; // only count requests made by the walk itself
  await page.click('[data-testid="industry-sp-year-toggle-2025"]');

  // Expected on this run (before the fix ships): the deployed
  // one-page-at-a-time walk needs on the order of 245 individual
  // requests (4900 races / 20 per page) to cross the year boundary,
  // each a real round trip plus a full hierarchy rebuild/re-render of
  // an ever-growing, unvirtualized race list — slow enough in practice
  // that the page/browser doesn't survive to resolve within 90s at all
  // in this sandboxed run (compounding evidence of the same underlying
  // problem: too many small sequential state updates). Whatever
  // requestCount reached before that is itself the reproduction.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="industry-sp-year-count-2025"]');
        return el && !el.textContent?.includes("Tap to load") && !el.textContent?.includes("Loading");
      },
      { timeout: 90000 }
    )
    .catch(() => {
      console.log(`Walk did not resolve within 90s. Requests fired so far: ${requestCount}`);
    });

  console.log(`Final request count toward /api/industry-sp: ${requestCount}`);

  // Expected to FAIL on this run (before the fix ships).
  expect(requestCount).toBeLessThan(20);
});
