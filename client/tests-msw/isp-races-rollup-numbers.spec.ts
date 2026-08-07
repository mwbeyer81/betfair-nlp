import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Two related guarantees on the Industry SP races screen, both reported live.
//
// 1. **The numbers a header shows are the SERVER's, for that header's whole
//    window.** Saved result "Hoop", Split A — 1118 races, -£28.82 (-20.2%) on
//    its own card — used to open its Races view as "2016 · 11 races loaded ·
//    -£1.14 (-100.0%)", because every rollup was computed over the races the
//    client had actually paged in: one day's worth, whose 11 races all lost.
//    Every response already carries a `total`, `totalRunners` and `pnlStats`
//    scoped to exactly the window it asked about (the DAO's subDateMatchStage
//    sits ahead of the $facet), and those are what render now.
// 2. **Nothing waits to be asked.** "At all levels I want pnl revealed without
//    having to press Tap to load." Every row that renders is probed as it
//    appears — years up front, a year's months when it opens, a month's days
//    when it opens.
//
// The mock is the point of the test: it scopes total/totalRunners/pnlStats
// honestly to whatever subMinDate/subMaxDate is asked for, exactly like the
// real pipeline. If the screen ever goes back to counting loaded races, these
// numbers stop matching.

const FIRST_DAY_RACES = 3; // 1 Jan 2016, all losers — the day the mount chain lands on
const TOTAL_2016 = 60;
const ISP = 5; // stake = 1/(isp-1) = 0.25 per runner

function makeRace(index: number) {
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
function racesIn(prefix: string) {
  return RACES.filter(r => r.raceTime.startsWith(prefix));
}

const WHOLE_YEAR = pnlOver(RACES);
const FIRST_DAY = pnlOver(RACES.slice(0, FIRST_DAY_RACES));

interface Seen {
  window: string;
  limit: number;
}

// Records every request and, by holding each one open briefly, makes the
// in-flight concurrency observable — see the throttling test.
async function mockScopedIndustrySp(page: Page, seen: Seen[], peak?: { max: number }) {
  let inFlight = 0;
  await page.route((url) => url.pathname === "/api/industry-sp", async (route) => {
    const url = new URL(route.request().url());
    const pageNum = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const subMinDate = url.searchParams.get("subMinDate");
    const subMaxDate = url.searchParams.get("subMaxDate");
    seen.push({ window: `${subMinDate ?? "*"}..${subMaxDate ?? "*"}`, limit });
    inFlight += 1;
    if (peak) peak.max = Math.max(peak.max, inFlight);
    await new Promise(resolve => setTimeout(resolve, 40));
    let matched = RACES;
    if (subMinDate) matched = matched.filter(r => r.raceTime.slice(0, 10) >= subMinDate);
    if (subMaxDate) matched = matched.filter(r => r.raceTime.slice(0, 10) <= subMaxDate);
    const data = matched.slice((pageNum - 1) * limit, (pageNum - 1) * limit + limit);
    const stats = pnlOver(matched);
    inFlight -= 1;
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
      },
    });
  });
}

// The filter's range runs into January 2017 while the data stops at the end of
// 2016 — the reported shape, and what makes 2017 a real, provable zero.
const RACES_URL = "/isp/races?fromRow=1&toRow=1118&minDate=2016-01-01&maxDate=2017-01-31";

test.describe("Industry SP races screen — every row reveals the server's own numbers, unasked (MSW mocked)", () => {
  let seen: Seen[];

  test.beforeEach(async ({ page }) => {
    seen = [];
    await mockScopedIndustrySp(page, seen);
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

  test("every year in the filter's range shows its numbers without being tapped", async ({ page }) => {
    await page.goto(RACES_URL);
    // Neither year is touched by the user here — no clicks in this test at all.
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-year-count-2017")).toHaveText("0 races", { timeout: 10000 });
    // "Tap to load" now means only "this probe failed" — nothing on a healthy
    // screen should be wearing it.
    await expect(page.getByTestId("industry-sp-races-screen")).not.toContainText("Tap to load");
  });

  test("opening a year reveals every month's numbers, and opening a month every day's", async ({ page }) => {
    await page.goto(RACES_URL);
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });

    await page.getByTestId("industry-sp-year-toggle-2016").click();
    for (const month of ["2016-01", "2016-02", "2016-03"]) {
      const races = racesIn(month);
      await expect(page.getByTestId(`industry-sp-month-count-${month}`)).toHaveText(`${races.length} races`, { timeout: 10000 });
      await expect(page.getByTestId(`industry-sp-month-pnl-${month}`)).toHaveText(badge(pnlOver(races)));
    }

    await page.getByTestId("industry-sp-month-toggle-2016-01").click();
    // Both the day that holds the opening races and a day that holds none:
    // each states its own case rather than waiting to be asked.
    await expect(page.getByTestId("industry-sp-day-count-2016-01-01")).toHaveText(`${FIRST_DAY_RACES} races`, { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-day-pnl-2016-01-01")).toHaveText(badge(FIRST_DAY));
    await expect(page.getByTestId("industry-sp-day-count-2016-01-02")).toHaveText("0 races", { timeout: 10000 });
  });

  test("a day's races still load only when its row is opened", async ({ page }) => {
    await page.goto(RACES_URL);
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });
    await page.getByTestId("industry-sp-year-toggle-2016").click();
    await page.getByTestId("industry-sp-month-toggle-2016-01").click();
    await expect(page.getByTestId("industry-sp-day-count-2016-01-01")).toHaveText(`${FIRST_DAY_RACES} races`, { timeout: 10000 });

    // Revealing the numbers is not the same as pulling the races: the day's
    // meetings appear only once the row itself is opened.
    await expect(page.getByTestId("industry-sp-meeting-Synthetic|2016-01-01")).not.toBeVisible();
    await page.getByTestId("industry-sp-day-toggle-2016-01-01").click();
    await expect(page.getByTestId("industry-sp-meeting-Synthetic|2016-01-01")).toBeVisible({ timeout: 10000 });
  });

  test("stats probes ask for one race, stay capped in flight, and are never fired for a proven-empty window", async ({ page }) => {
    const peak = { max: 0 };
    const throttled: Seen[] = [];
    await page.unrouteAll();
    await mockScopedIndustrySp(page, throttled, peak);

    await page.goto(RACES_URL);
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });
    await page.getByTestId("industry-sp-year-toggle-2016").click();
    await page.getByTestId("industry-sp-month-toggle-2016-01").click();
    // 31 day rows plus 12 months plus 2 years is a lot of requests to have in
    // the air at once on a phone; they queue instead.
    await expect(page.getByTestId("industry-sp-day-count-2016-01-31")).toHaveText("0 races", { timeout: 15000 });
    expect(peak.max).toBeLessThanOrEqual(5);

    // Every probe asks for a single race — it wants the window's totals, not a
    // page of documents.
    const probes = throttled.filter(r => r.window !== "*..*");
    expect(probes.length).toBeGreaterThan(20);
    expect(probes.filter(r => r.limit === 1).length).toBeGreaterThan(20);

    // 2017 is a proven zero, so nothing inside it is ever requested: its
    // months and days derive their zeros instead.
    expect(throttled.filter(r => r.window.includes("2017-"))).toEqual([
      { window: "2017-01-01..2017-01-31", limit: 1 },
    ]);
  });

  test("flipping the sort order discards every window's numbers and asks again", async ({ page }) => {
    await page.goto(RACES_URL);
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });

    seen.length = 0;
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("Last → First");

    // A row range is "rows 1-N of the current order", so descending selects a
    // different set of races — every window's count and P&L has to be asked
    // for again rather than carried over from the ascending answers.
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-year-count-2017")).toHaveText("0 races", { timeout: 10000 });
    const reprobed = seen.filter(r => r.window === "2016-01-01..2016-12-31");
    expect(reprobed.length).toBeGreaterThan(0);
    expect(seen.every(r => r.window !== "" )).toBe(true);
  });

  test("the screen subtitle counts loaded runners against the range's real total", async ({ page }) => {
    await page.goto(RACES_URL);
    await expect(page.getByTestId("industry-sp-year-count-2016")).toHaveText(`${TOTAL_2016} races`, { timeout: 10000 });
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
