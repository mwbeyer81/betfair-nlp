import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Regression coverage for the isp-month-data-bound fix: a row range
// (Split A/B) doesn't necessarily start at a year's own January 1st — it
// starts wherever its own fromRow lands chronologically, which can
// genuinely be mid-year with zero possible races before that point for
// *this* filter specifically. An earlier version of this feature
// (isp-month-direct-load) always defaulted to the year's own literal
// first calendar month, which was wrong for exactly this case — reverted
// to data-driven: expandYearDefaultMonth now probes the year's own
// row-ranged window (no sub-month restriction) and expands+loads
// whichever month(s) that probe actually lands in, the same way the
// outer mount effect finds which *year* to land in. Months confirmed to
// be before that real start don't render a placeholder header at all —
// they're provably impossible for this filter, not just "not loaded
// yet". Tapping any other month still fetches *just that month* directly
// (scoped via subMinDate/subMaxDate). See AGENTS.md's isp-month-data-bound
// entry.
//
// Overrides the shared fixture's /api/industry-sp handler outright (no
// .fallback()) with one that actually understands subMinDate/subMaxDate,
// since the shared handler (fixtures.ts) is a small fixed 3-race set with
// no date-range awareness — not useful for exercising per-month scoping.

function perYearRace(year: number, index: number, idOffset: number) {
  const day = (index % 27) + 1;
  const date = `${year}-06-${String(day).padStart(2, "0")}`;
  return {
    raceId: 500000 + idOffset + index,
    meetingId: `Ascot|${date}`,
    meetingName: `Ascot — ${day} June ${year}`,
    course: "Ascot",
    countryCode: "GB",
    raceTime: `${date}T13:00:00`,
    raceName: "Ascot 13:00",
    raceType: "Flat",
    raceClass: "Class 1",
    going: "Good",
    ran: 1,
    runners: [
      { id: 50100 + idOffset + index, name: `Runner ${year}-${index}`, num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 5, ispFraction: "4/1", isFavourite: false },
    ],
  };
}

// Every real race is dated June, in both years — deliberately, so the
// year's own data-driven start (June) is unambiguously not "wherever
// page 1 of the calendar year happens to fall" (January).
const YEAR_RACES = [
  ...Array.from({ length: 45 }, (_, i) => perYearRace(2024, i, 0)),
  ...Array.from({ length: 3 }, (_, i) => perYearRace(2025, i, 1000)),
];

async function mockPerMonthIndustrySp(page: Page) {
  await page.route((url) => url.pathname === "/api/industry-sp", (route) => {
    const url = new URL(route.request().url());
    const pageNum = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const subMinDate = url.searchParams.get("subMinDate");
    const subMaxDate = url.searchParams.get("subMaxDate");
    let matched = YEAR_RACES;
    if (subMinDate) matched = matched.filter(r => r.raceTime.slice(0, 10) >= subMinDate);
    if (subMaxDate) matched = matched.filter(r => r.raceTime.slice(0, 10) <= subMaxDate);
    const skip = (pageNum - 1) * limit;
    const data = matched.slice(skip, skip + limit);
    route.fulfill({
      json: {
        success: true,
        data,
        count: data.length,
        total: matched.length,
        page: pageNum,
        limit,
        totalPages: Math.ceil(matched.length / limit),
        totalRunners: matched.length,
        pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 },
      },
    });
  });
}

test.describe("Industry SP races screen — per-month direct loading, data-driven default (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await mockPerMonthIndustrySp(page);
  });

  test("mount lands on the year AND month with real data — not the year's own calendar-first month", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-year-2024")).toBeVisible();
    // June — where the real data actually is — is expanded and loaded by
    // default, confirmed via a real fetch.
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-day-2024-06-01")).toBeVisible();
    // January isn't shown at all — it's provably before this filter's
    // real start, not just "not loaded yet".
    await expect(page.getByTestId("industry-sp-month-2024-01")).not.toBeVisible();
    // A different year hasn't been touched at all.
    await expect(page.getByTestId("industry-sp-year-count-2025")).toHaveText("Tap to load");
  });

  test("months before the confirmed real start don't render a placeholder header at all", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races", { timeout: 10000 });
    for (const month of ["2024-01", "2024-02", "2024-03", "2024-04", "2024-05"]) {
      await expect(page.getByTestId(`industry-sp-month-${month}`)).not.toBeVisible();
    }
    // June onward still renders (June has data; July onward are
    // legitimate "not loaded yet" placeholders since the real start is
    // confirmed to be on-or-before them).
    await expect(page.getByTestId("industry-sp-month-2024-07")).toBeVisible();
    await expect(page.getByTestId("industry-sp-month-count-2024-07")).toHaveText("Not loaded yet");
    await expect(page.getByTestId("industry-sp-month-2024-12")).toBeVisible();
  });

  test("tapping a placeholder month after the confirmed start fetches only that month directly", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races", { timeout: 10000 });

    const requestsAfterTap: { subMinDate: string | null; subMaxDate: string | null }[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp?")) {
        const u = new URL(req.url());
        requestsAfterTap.push({ subMinDate: u.searchParams.get("subMinDate"), subMaxDate: u.searchParams.get("subMaxDate") });
      }
    });

    await page.getByTestId("industry-sp-month-toggle-2024-07").click();
    await expect(page.getByTestId("industry-sp-month-count-2024-07")).toHaveText("0 races", { timeout: 10000 });

    // June is untouched by tapping July.
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races");

    // Exactly one request, scoped to July alone.
    expect(requestsAfterTap).toHaveLength(1);
    expect(requestsAfterTap[0].subMinDate).toBe("2024-07-01");
    expect(requestsAfterTap[0].subMaxDate).toBe("2024-07-31");
  });

  test("a month's own Load more paginates only that month", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races", { timeout: 10000 });

    await page.getByTestId("industry-sp-month-load-more-2024-06").click();
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("40 races", { timeout: 10000 });

    await page.getByTestId("industry-sp-month-load-more-2024-06").click();
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("45 races", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-month-load-more-2024-06")).not.toBeVisible();
  });

  test("expanding a different year for the first time loads its own real starting month, independently of 2024's", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races", { timeout: 10000 });

    await page.getByTestId("industry-sp-year-toggle-2025").click();
    await expect(page.getByTestId("industry-sp-month-count-2025-06")).toHaveText("3 races", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-month-2025-01")).not.toBeVisible();

    // 2024 untouched by expanding 2025.
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races");
  });

  test("re-collapsing and re-expanding a year doesn't reset which months the user already opened", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races", { timeout: 10000 });
    await page.getByTestId("industry-sp-month-toggle-2024-07").click();
    await expect(page.getByTestId("industry-sp-month-count-2024-07")).toHaveText("0 races", { timeout: 10000 });

    // Collapse the whole year, then re-expand it.
    await page.getByTestId("industry-sp-year-toggle-2024").click();
    await page.getByTestId("industry-sp-year-toggle-2024").click();

    // June's loaded data and July's own probed state survive —
    // expandYearDefaultMonth is a no-op on a year already interacted
    // with, so it doesn't re-probe or reset anything.
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races");
    await expect(page.getByTestId("industry-sp-day-2024-06-01")).toBeVisible();
    await expect(page.getByTestId("industry-sp-month-count-2024-07")).toHaveText("0 races");
  });

  // The "Tap to load" count on a year/month header is its own tap target,
  // separate from the row's expand toggle, and does only what it says.
  // Reported live via screenshot: a 2024 with ten "Tap to load" months, where
  // tapping one just to see its number opened it onto a wall of "Not loaded
  // yet" day rows and pushed every other month off-screen.
  //
  // Written against the current collapsed-on-load behaviour, unlike the older
  // tests in this file — see the note in AGENTS.md.
  test("tapping a year's Tap to load count fetches it and leaves the row collapsed", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-year-count-2025")).toHaveText("Tap to load", { timeout: 10000 });

    await page.getByTestId("industry-sp-year-load-2025").click();

    // The server's own count for the whole 2025 window, not the one day the
    // load chain paged in (isp-races-rollup-mismatch).
    await expect(page.getByTestId("industry-sp-year-count-2025")).toHaveText("3 races", { timeout: 10000 });
    // Loaded, and still shut — none of 2025's months rendered.
    await expect(page.getByTestId("industry-sp-month-2025-06")).not.toBeVisible();
    // Its own tap target is gone now it has a real count; the row toggle
    // still opens it, exactly as before.
    await expect(page.getByTestId("industry-sp-year-load-2025")).not.toBeVisible();
    await page.getByTestId("industry-sp-year-toggle-2025").click();
    await expect(page.getByTestId("industry-sp-month-2025-06")).toBeVisible();
  });

  test("tapping a month's Tap to load count fetches it and leaves the row collapsed", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-year-count-2024")).toHaveText("45 races", { timeout: 10000 });
    await page.getByTestId("industry-sp-year-toggle-2024").click();
    await expect(page.getByTestId("industry-sp-month-count-2024-07")).toHaveText("Tap to load");

    await page.getByTestId("industry-sp-month-load-2024-07").click();

    // July genuinely has nothing in this fixture — the point is that the
    // answer arrives in place, with no day rows unfurled to deliver it.
    await expect(page.getByTestId("industry-sp-month-count-2024-07")).toHaveText("0 races", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-day-2024-07-01")).not.toBeVisible();
    // June, the month the mount chain landed on, is untouched by the tap.
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("45 races");
  });

  test("Expand All loads every year's own real starting month, not its calendar-first one", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races", { timeout: 10000 });

    await page.getByTestId("industry-sp-collapse-all-toggle").click();
    await expect(page.getByTestId("industry-sp-collapse-all-toggle")).toHaveText("Expand All");
    await page.getByTestId("industry-sp-collapse-all-toggle").click();

    await expect(page.getByTestId("industry-sp-month-count-2025-06")).toHaveText("3 races", { timeout: 10000 });
    // 2024 was already initialized — its June state is untouched, not
    // reset or refetched from scratch.
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races");
  });
});
