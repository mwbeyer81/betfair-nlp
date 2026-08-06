import { test, expect } from "@playwright/test";

// One-off prod repro — see .claude/commands/prod-repro-scripts.md. Run once,
// against the REAL deployed app.backbet.co.uk bundle, to confirm the reported
// bug is present in what's live right now.
//
// User report (three screenshots, build 28b117b): saved result "Hoop", Split A
// — races 1–1118, 1266 runners, staked £142.95, returned £114.13, P&L −£28.82
// (−20.2%). Tapped "View 1118 Races" and got a Races screen reading
// "11 runners · 11/1118 races", a 2016 header of "11 races loaded −£1.14
// (−100.0%)", and 2017 / January 2017 both reading "0 races". Their words:
// the numbers in the year/month races views don't match. Zero races etc.
//
// The rollups are computed purely from whatever races the client has actually
// paged in — one day's worth, on arrival — even though EVERY response the
// screen already receives carries a `total` and a `pnlStats` scoped to exactly
// the window it asked about (subMinDate/subMaxDate; see the DAO's
// subDateMatchStage, which sits ahead of the $facet precisely so the counts
// and P&L describe the sub-range and not just the returned page). So a year
// that genuinely holds 1118 races and −20.2% is captioned with the first day's
// 11 losers and −100.0%, and the honest server numbers are discarded.
//
// Can't be driven through the real backend from here: the row range needed is
// 1118 rows and /api/industry-sp caps anonymous callers to 100 (clampRowSpan,
// router.ts), plus "Hoop" is a user-owned saved result this agent can't sign
// in to. Per the "authenticated state or a specific data shape" case in
// prod-repro-scripts.md, this intercepts just /api/industry-sp with a
// synthetic 1118-race Split A shaped like the report — and, crucially, a mock
// that computes `total`/`pnlStats` HONESTLY for whatever sub-window is asked
// for. The server side is therefore correct by construction here; anything
// wrong in what renders is the deployed bundle's own doing.

// Split A = rows 1–1118 of a 2236-race set, all of it inside 2016; the
// filter's own date range runs on into January 2017 (which is why the live
// screen renders a 2017 header at all). 1118 races, one runner each.
const TOTAL_ROWS = 1118;
const ISP = 5; // stake = 1/(isp-1) = 0.25 per runner
const FIRST_DAY = "2016-01-01";

// The first day is deliberately all losers, exactly as reported: it is what
// makes the live bundle caption the whole year "−100.0%".
const FIRST_DAY_RACES = 11;

function makeRace(index: number) {
  // Race 0..10 on 1 Jan 2016 (the day the mount chain lands on and loads),
  // the rest spread across the remaining 365 days of 2016.
  const date =
    index < FIRST_DAY_RACES
      ? FIRST_DAY
      : new Date(Date.UTC(2016, 0, 2 + Math.floor(((index - FIRST_DAY_RACES) / (TOTAL_ROWS - FIRST_DAY_RACES)) * 364), 12, 0, 0))
          .toISOString()
          .slice(0, 10);
  // ~16% winners after the opening day, none on it.
  const isWinner = index >= FIRST_DAY_RACES && index % 6 === 0;
  return {
    raceId: 700000 + index,
    meetingId: `Synthetic|${date}`,
    meetingName: `Synthetic — ${date}`,
    course: "Synthetic",
    countryCode: "GB",
    raceTime: `${date}T13:00:00`,
    raceName: `Race ${index}`,
    raceType: "Flat",
    ran: 1,
    runners: [
      {
        id: 770000 + index,
        name: `Runner ${index}`,
        num: 1,
        draw: null,
        status: isWinner ? "WINNER" : "LOSER",
        sortPriority: 1,
        isp: ISP,
        ispFraction: "4/1",
        isFavourite: false,
      },
    ],
  };
}

const RACES = Array.from({ length: TOTAL_ROWS }, (_, i) => makeRace(i));

// The same staking math the app itself uses (ispFormat.computeRangePnl), so
// the mock's pnlStats is what an honest backend would return for the window.
function pnlOver(races: typeof RACES) {
  let staked = 0, returns = 0, count = 0;
  for (const race of races) {
    for (const runner of race.runners) {
      count++;
      const stake = 1 / (runner.isp - 1);
      staked += stake;
      if (runner.status === "WINNER") returns += stake + 1;
    }
  }
  return { staked, returns, pnl: returns - staked, count };
}

const WHOLE_SPLIT = pnlOver(RACES);
const TRUE_YEAR_PCT = `${((WHOLE_SPLIT.pnl / WHOLE_SPLIT.staked) * 100).toFixed(1)}%`;

test("REPRO (2026-08-06): year/month headers caption the whole window with one day's numbers", async ({ page }) => {
  test.setTimeout(120000);

  await page.route("**/api/industry-sp?*", async route => {
    const url = new URL(route.request().url());
    const pageNum = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const subMinDate = url.searchParams.get("subMinDate");
    const subMaxDate = url.searchParams.get("subMaxDate");
    // Honest sub-window scoping, exactly like the real pipeline: narrow
    // first, then count/aggregate over the narrowed set, then page it.
    let matched = RACES;
    if (subMinDate) matched = matched.filter(r => r.raceTime.slice(0, 10) >= subMinDate);
    if (subMaxDate) matched = matched.filter(r => r.raceTime.slice(0, 10) <= subMaxDate);
    const skip = (pageNum - 1) * limit;
    const data = matched.slice(skip, skip + limit);
    const stats = pnlOver(matched);
    await route.fulfill({
      json: {
        success: true,
        data,
        count: data.length,
        total: matched.length,
        page: pageNum,
        limit,
        totalPages: Math.ceil(matched.length / limit),
        totalRunners: stats.count,
        pnlStats: stats,
        brier: { model: null, market: null, scored: 0 },
      },
    });
  });

  await page.goto(
    "/isp/races?minRunners=1&maxRunners=30&minIsp=1&maxIsp=1000&sort=asc&minInIspRange=1&maxInIspRange=30&fromRow=1&toRow=1118&minDate=2016-01-01&maxDate=2017-01-31"
  );
  await page.waitForSelector('[data-testid="industry-sp-year-toggle-2016"]', { timeout: 30000 });

  // Wait for the mount chain (year probe -> month probe -> first day) to
  // settle, i.e. for 2016 to stop saying "Tap to load"/"Loading…".
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="industry-sp-year-count-2016"]');
      const t = el?.textContent ?? "";
      return t !== "" && !t.includes("Tap to load") && !t.includes("Loading");
    },
    { timeout: 30000 }
  );

  const yearCount = (await page.getByTestId("industry-sp-year-count-2016").textContent()) ?? "";
  const yearPnl = (await page.getByTestId("industry-sp-year-pnl-2016").textContent()) ?? "";
  console.log(`2016 header reads: "${yearCount}"  "${yearPnl}"`);
  console.log(`Server's own answer for 2016: ${TOTAL_ROWS} races, ${TRUE_YEAR_PCT}`);

  // Both expected to FAIL on this run (before the fix ships): the live bundle
  // reports the 11 races it has paged in, and their −100.0%, for a year the
  // server told it holds 1118 races at ${TRUE_YEAR_PCT}.
  expect(yearCount).toBe(`${TOTAL_ROWS} races`);
  expect(yearPnl).toContain(TRUE_YEAR_PCT);
});
