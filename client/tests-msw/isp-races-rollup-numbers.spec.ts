import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Regression coverage for the isp-races-rollup-mismatch fix. Reported with
// three screenshots: saved result "Hoop", Split A — 1118 races, -£28.82
// (-20.2%) on its own card — opened its Races view as "2016 · 11 races loaded
// · -£1.14 (-100.0%)", with 2017 and January 2017 both reading "0 races".
//
// Every response this screen receives already carries a `total`,
// `totalRunners` and `pnlStats` scoped to exactly the window it asked about
// (the DAO's subDateMatchStage sits ahead of the $facet so they describe the
// sub-range, not the returned page). The screen used to discard all three and
// caption each header with a rollup over the races it had actually paged in —
// one day's worth, on arrival. Now every probed node reports the server's own
// numbers for its whole window, so a year header and the saved result's card
// agree by construction.
//
// The mock below is the point of the test: it scopes total/totalRunners/
// pnlStats honestly to whatever subMinDate/subMaxDate is asked for, exactly
// like the real pipeline. If the screen ever goes back to counting loaded
// races, these numbers stop matching.

const FIRST_DAY_RACES = 3; // 1 Jan 2016, all losers — the day the mount chain lands on
const TOTAL_2016 = 60;
const ISP = 5; // stake = 1/(isp-1) = 0.25 per runner

function makeRace(index: number) {
  // Days 1..3 of January hold the opening 3 races; the rest are spread one
  // per day across February onward, so no other single day is complete.
  const date =
    index < FIRST_DAY_RACES
      ? "2016-01-01"
      : `2016-${String(2 + Math.floor((index - FIRST_DAY_RACES) / 28)).padStart(2, "0")}-${String(((index - FIRST_DAY_RACES) % 28) + 1).padStart(2, "0")}`;
  const isWinner = index >= FIRST_DAY_RACES && index % 3 === 0;
  return {
    raceId: 800000 + index,
    meetingId: `Synthetic|${date}`,
    meetingName: `Synthetic — ${date}`,
    course: "Synthetic",
    countryCode: "GB",
    raceTime: `${date}T13:00:00`,
    raceName: `Race ${index}`,
    raceType: "Flat",
    raceClass: "Class 1",
    going: "Good",
    ran: 1,
    runners: [
      { id: 880000 + index, name: `Runner ${index}`, num: 1, draw: null, status: isWinner ? "WINNER" : "LOSER", sortPriority: 1, isp: ISP, ispFraction: "4/1", isFavourite: false },
    ],
  };
}

const RACES = Array.from({ length: TOTAL_2016 }, (_, i) => makeRace(i));

// The same staking math the app uses (ispFormat.computeRangePnl), so the
// mock's pnlStats is what an honest backend returns for the window.
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

function gbp(val: number) {
  return `${val >= 0 ? "+" : "-"}£${Math.abs(val).toFixed(2)}`;
}
function pct(pnl: number, staked: number) {
  const p = (pnl / staked) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}
function badge(stats: { pnl: number; staked: number }) {
  return `${gbp(stats.pnl)} (${pct(stats.pnl, stats.staked)})`;
}

const WHOLE_YEAR = pnlOver(RACES);
const FIRST_DAY = pnlOver(RACES.slice(0, FIRST_DAY_RACES));

async function mockScopedIndustrySp(page: Page) {
  await page.route((url) => url.pathname === "/api/industry-sp", (route) => {
    const url = new URL(route.request().url());
    const pageNum = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const subMinDate = url.searchParams.get("subMinDate");
    const subMaxDate = url.searchParams.get("subMaxDate");
    let matched = RACES;
    if (subMinDate) matched = matched.filter(r => r.raceTime.slice(0, 10) >= subMinDate);
    if (subMaxDate) matched = matched.filter(r => r.raceTime.slice(0, 10) <= subMaxDate);
    const skip = (pageNum - 1) * limit;
    const data = matched.slice(skip, skip + limit);
    const stats = pnlOver(matched);
    route.fulfill({
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
      },
    });
  });
}

// The filter's range runs into January 2017 while the data stops at the end
// of 2016 — the reported shape, and what makes 2017 a real, provable zero
// rather than an unprobed unknown.
const RACES_URL = "/isp/races?fromRow=1&toRow=1118&minDate=2016-01-01&maxDate=2017-01-31";

test.describe("Industry SP races screen — headers report the server's numbers for their whole window (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await mockScopedIndustrySp(page);
  });

  test("a year header reports the whole year, not the one day the mount chain loaded", async ({ page }) => {
    await page.goto(RACES_URL);
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });

    // The reported bug: this read "3 races loaded" and the first day's -100.0%.
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-year-pnl-2016")).toHaveText(badge(WHOLE_YEAR));

    // ...and the year genuinely holds far more than has been fetched, which is
    // the whole reason the loaded-races rollup was wrong.
    expect(FIRST_DAY.pnl).not.toBeCloseTo(WHOLE_YEAR.pnl, 2);
  });

  test("a month header reports the whole month once probed", async ({ page }) => {
    await page.goto(RACES_URL);
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });
    await page.getByTestId("industry-sp-year-toggle-2016").click();

    const january = RACES.filter(r => r.raceTime.startsWith("2016-01"));
    await expect(page.getByTestId("industry-sp-month-count-2016-01")).toHaveText(`${january.length} races`);
    await expect(page.getByTestId("industry-sp-month-pnl-2016-01")).toHaveText(badge(pnlOver(january)));

    // An unprobed month still offers its own load, and answers in place.
    await expect(page.getByTestId("industry-sp-month-count-2016-03")).toHaveText("Tap to load");
    await page.getByTestId("industry-sp-month-load-2016-03").click();
    const march = RACES.filter(r => r.raceTime.startsWith("2016-03"));
    await expect(page.getByTestId("industry-sp-month-count-2016-03")).toHaveText(`${march.length} races`, { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-month-pnl-2016-03")).toHaveText(badge(pnlOver(march)));
  });

  test("a day header reports the day's own total before every page of it is fetched", async ({ page }) => {
    await page.goto(RACES_URL);
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });
    await page.getByTestId("industry-sp-year-toggle-2016").click();
    await page.getByTestId("industry-sp-month-toggle-2016-01").click();

    const firstDay = RACES.filter(r => r.raceTime.startsWith("2016-01-01"));
    await expect(page.getByTestId("industry-sp-day-count-2016-01-01")).toHaveText(`${firstDay.length} races`);
    await expect(page.getByTestId("industry-sp-day-pnl-2016-01-01")).toHaveText(badge(pnlOver(firstDay)));
    // Days the filter covers but that nobody has looked at offer their own
    // load, exactly like an unprobed year or month.
    await expect(page.getByTestId("industry-sp-day-count-2016-01-02")).toHaveText("Tap to load");
  });

  // Reported with a screenshot of build 924fb98: "when I tap on day it still
  // expands. It should load pnl but not expand. Tapping [anywhere] else other
  // than tap to load should expand." Days were the one level still missing the
  // load-only tap target years and months already had.
  test("tapping a day's Tap to load count fetches its P&L and leaves the row collapsed", async ({ page }) => {
    await page.goto(RACES_URL);
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });
    await page.getByTestId("industry-sp-year-toggle-2016").click();
    await page.getByTestId("industry-sp-month-toggle-2016-01").click();

    // 2 Jan is a day the filter covers that nobody has looked at yet.
    await expect(page.getByTestId("industry-sp-day-count-2016-01-02")).toHaveText("Tap to load");

    await page.getByTestId("industry-sp-day-load-2016-01-02").click();

    // Its own numbers arrive in place — and this fixture has nothing on 2 Jan,
    // so the honest answer is a zero, delivered without unfurling the row.
    await expect(page.getByTestId("industry-sp-day-count-2016-01-02")).toHaveText("0 races", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-day-load-2016-01-02")).not.toBeVisible();

    // A day that does hold races reports its real P&L, still shut: no meeting
    // rows appear until the row itself is tapped.
    const firstDay = RACES.filter(r => r.raceTime.startsWith("2016-01-01"));
    await expect(page.getByTestId("industry-sp-day-pnl-2016-01-01")).toHaveText(badge(pnlOver(firstDay)));
    await expect(page.getByTestId("industry-sp-meeting-Synthetic|2016-01-01")).not.toBeVisible();
    // ...and tapping anywhere other than that count still expands, as before.
    await page.getByTestId("industry-sp-day-toggle-2016-01-01").click();
    await expect(page.getByTestId("industry-sp-meeting-Synthetic|2016-01-01")).toBeVisible();
  });

  test("a year the row range never reaches reports a real zero, not a loaded-races guess", async ({ page }) => {
    await page.goto(RACES_URL);
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });

    await expect(page.getByTestId("industry-sp-year-count-2017")).toHaveText("Tap to load");
    await page.getByTestId("industry-sp-year-load-2017").click();
    await expect(page.getByTestId("industry-sp-year-count-2017")).toHaveText("0 races", { timeout: 10000 });
    // A zero window has no P&L badge to disagree with anything.
    await expect(page.getByTestId("industry-sp-year-pnl-2017")).not.toBeVisible();
  });

  test("the screen subtitle counts loaded runners against the range's real total", async ({ page }) => {
    await page.goto(RACES_URL);
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });
    // Loaded is whatever the mount chain landed on (each starting month's own
    // first day — deliberately not pinned here, it's the lazy-loading
    // machinery's business); the totals after each slash are the whole row
    // range's, the same numbers the saved result's own card shows.
    const subtitle = page.getByText(/^Races · \d+\/\d+ runners · \d+\/\d+ races$/);
    await expect(subtitle).toBeVisible();
    const text = (await subtitle.textContent()) ?? "";
    const [, loadedRunners, totalRunners, loadedRaces, totalRaces] = text.match(/(\d+)\/(\d+) runners · (\d+)\/(\d+) races/) ?? [];
    expect(Number(totalRunners)).toBe(WHOLE_YEAR.count);
    expect(Number(totalRaces)).toBe(TOTAL_2016);
    // And the point of the "/": far less than the total is actually loaded.
    expect(Number(loadedRaces)).toBeLessThan(TOTAL_2016);
    expect(Number(loadedRunners)).toBeLessThan(WHOLE_YEAR.count);
  });
});
