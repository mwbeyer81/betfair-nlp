import { test, expect } from "@playwright/test";

// One-off prod repro — see .claude/commands/prod-repro-scripts.md. Run
// once, against the REAL deployed app.backbet.co.uk bundle, to confirm
// the reported bug is actually present in what's live right now.
//
// User report (screenshots): filtered Industry SP to Jan 2024 -> Jan
// 2025 with NO other narrowing filters (Split B, ~9511 races — nearly
// double the ~4900-race case the isp-lazy-year-slow-walk fix targeted,
// since nothing else thins the match set), tapped the collapsed "2025"
// year header. Three screenshots taken within the same minute show
// progress creeping from 20 -> 160 -> 640 races loaded, still stuck on
// "Loading…" throughout, with "Load more" greyed out — "Still broke",
// even after the request-doubling fix shipped earlier today.
//
// Root cause: the doubling fix (isp-lazy-year-slow-walk) genuinely
// reduced the walk to ~9 network requests, but every one of those
// requests appends its batch into whichever year is *currently
// expanded* — the default first year ("2024" here), which stays
// expanded throughout the whole walk. Each append forces React to
// reconcile/lay out that year's entire, ever-growing rendered race
// list (up to ~9480 rows plus nested runner rows just before the walk
// resolves) — pure client-side render cost, not network, and it grows
// with every iteration since the accumulating year never collapses.
//
// Same anonymous-request-cap constraint as the two fixes earlier today
// (backend caps unauthenticated requests to 100 rows total) — this
// intercepts just the API responses (page.route()) with a synthetic
// ~9500-race dataset shaped like the real report, layered on the real,
// currently-deployed JS bundle.
const TOTAL = 9511;
// Matches the real report's shape: 2025 is a thin sliver (~31 races) at
// the very end of a year-long, ascending-sorted range with nothing else
// narrowing it.
const YEAR_BOUNDARY = 9480;

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
        id: 2000000 + index,
        name: `Runner ${index}`,
        num: 1,
        draw: null,
        status: "LOSER",
        sortPriority: 1,
        isp: 5,
        ispFraction: "4/1",
        isFavourite: false,
      },
    ],
  };
}

test("REPRO (2026-07-28): walking a distant year with no other filters is slow due to render cost, not request count", async ({ page }) => {
  test.setTimeout(120000);

  await page.route("**/api/industry-sp?*", async route => {
    const url = new URL(route.request().url());
    const pageNum = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
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
    "/isp/races?minRunners=1&maxRunners=20&minIsp=1&maxIsp=1000&sort=asc&minInIspRange=1&maxInIspRange=30&fromRow=338&toRow=9848&minDate=2024-01-01&maxDate=2025-01-01"
  );
  await page.waitForSelector('[data-testid="industry-sp-year-toggle-2025"]', { timeout: 20000 });

  const start = Date.now();
  await page.click('[data-testid="industry-sp-year-toggle-2025"]');

  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="industry-sp-year-count-2025"]');
      return el && !el.textContent?.includes("Tap to load") && !el.textContent?.includes("Loading");
    },
    { timeout: 90000 }
  );
  const elapsedSeconds = (Date.now() - start) / 1000;
  console.log(`Wall-clock time to resolve the walk to 2025 (~9500 races, no other filters): ${elapsedSeconds.toFixed(1)}s`);

  // Expected to FAIL on this run (before the render-cost fix ships): the
  // request-doubling fix alone still leaves the source year ("2024")
  // expanded throughout, so total wall-clock time is dominated by
  // re-rendering its ever-growing race list on every batch — confirmed
  // locally at ~19s for this exact scenario (vs. ~5.7s once the source
  // year is collapsed during the walk too).
  expect(elapsedSeconds).toBeLessThan(10);
});
