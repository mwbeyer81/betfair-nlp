import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Regression coverage for the isp-month-direct-load rework: within an
// expanded year, only that year's own literal first month (per the
// filter's effective range) is expanded+loaded by default — not wherever
// the year's earliest *matching* race happens to be (previously landed
// on July for a Jan-Dec 2024 filter whose real data happened to start
// there). Tapping any other month fetches *just that month* directly
// (scoped via subMinDate/subMaxDate), the same small paginated request
// every month uses — replacing "tapping an unloaded month does nothing"
// entirely. See AGENTS.md's isp-month-direct-load entry.
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

// Every real race is dated June, in both years — deliberately, so mount
// landing on a *different* month (January, the filter's own literal
// start) is unambiguously not just "wherever page 1 happens to fall".
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

test.describe("Industry SP races screen — per-month direct loading (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await mockPerMonthIndustrySp(page);
  });

  test("mount lands on the year with real data, but expands that year's own first month, not wherever the real data happens to start", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    // 2024 is the year with real data — still expanded automatically.
    await expect(page.getByTestId("industry-sp-year-2024")).toBeVisible();
    // Its own literal first month (January) is expanded+loaded by
    // default — confirmed empty via a real fetch, not just assumed.
    await expect(page.getByTestId("industry-sp-month-count-2024-01")).toHaveText("0 races", { timeout: 10000 });
    // June — where the real data actually is — stays collapsed/unloaded
    // until tapped.
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("Not loaded yet");
    await expect(page.getByTestId("industry-sp-day-2024-06-01")).not.toBeVisible();
    // A different year hasn't been touched at all.
    await expect(page.getByTestId("industry-sp-year-count-2025")).toHaveText("Tap to load");
  });

  test("every month in the expanded year renders a placeholder header, not just the loaded one", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-01")).toHaveText("0 races", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-month-2024-06")).toBeVisible();
    await expect(page.getByTestId("industry-sp-month-2024-12")).toBeVisible();
  });

  test("tapping a placeholder month fetches only that month directly — fixes 'tapping months did nothing'", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-01")).toHaveText("0 races", { timeout: 10000 });

    const requestsAfterTap: { subMinDate: string | null; subMaxDate: string | null }[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp?")) {
        const u = new URL(req.url());
        requestsAfterTap.push({ subMinDate: u.searchParams.get("subMinDate"), subMaxDate: u.searchParams.get("subMaxDate") });
      }
    });

    await page.getByTestId("industry-sp-month-toggle-2024-06").click();
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-day-2024-06-01")).toBeVisible();

    // January is untouched by tapping June.
    await expect(page.getByTestId("industry-sp-month-count-2024-01")).toHaveText("0 races");

    // Exactly one request, scoped to June alone.
    expect(requestsAfterTap).toHaveLength(1);
    expect(requestsAfterTap[0].subMinDate).toBe("2024-06-01");
    expect(requestsAfterTap[0].subMaxDate).toBe("2024-06-30");
  });

  test("a month's own Load more paginates only that month", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-01")).toHaveText("0 races", { timeout: 10000 });
    await page.getByTestId("industry-sp-month-toggle-2024-06").click();
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races", { timeout: 10000 });

    await page.getByTestId("industry-sp-month-load-more-2024-06").click();
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("40 races", { timeout: 10000 });

    await page.getByTestId("industry-sp-month-load-more-2024-06").click();
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("45 races", { timeout: 10000 });
    // All 45 loaded — the button disappears. January untouched throughout.
    await expect(page.getByTestId("industry-sp-month-load-more-2024-06")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-month-count-2024-01")).toHaveText("0 races");
  });

  test("expanding a different year for the first time loads its own first month too, independently of 2024's", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-01")).toHaveText("0 races", { timeout: 10000 });

    await page.getByTestId("industry-sp-year-toggle-2025").click();
    await expect(page.getByTestId("industry-sp-month-count-2025-01")).toHaveText("0 races", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-month-count-2025-06")).toHaveText("Not loaded yet");

    // 2024 untouched by expanding 2025.
    await expect(page.getByTestId("industry-sp-month-count-2024-01")).toHaveText("0 races");
  });

  test("re-collapsing and re-expanding a year doesn't reset which months the user already opened", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-01")).toHaveText("0 races", { timeout: 10000 });
    await page.getByTestId("industry-sp-month-toggle-2024-06").click();
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races", { timeout: 10000 });

    // Collapse the whole year, then re-expand it.
    await page.getByTestId("industry-sp-year-toggle-2024").click();
    await page.getByTestId("industry-sp-year-toggle-2024").click();

    // June's loaded data and expanded state survive — expandYearDefaultMonth
    // is a no-op on a year already interacted with, so it doesn't collapse
    // June back down or refetch January.
    await expect(page.getByTestId("industry-sp-month-count-2024-06")).toHaveText("20 races");
    await expect(page.getByTestId("industry-sp-day-2024-06-01")).toBeVisible();
  });

  test("Expand All loads every year's own default first month, not wherever its real data is", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-month-count-2024-01")).toHaveText("0 races", { timeout: 10000 });

    await page.getByTestId("industry-sp-collapse-all-toggle").click();
    await expect(page.getByTestId("industry-sp-collapse-all-toggle")).toHaveText("Expand All");
    await page.getByTestId("industry-sp-collapse-all-toggle").click();

    await expect(page.getByTestId("industry-sp-month-count-2025-01")).toHaveText("0 races", { timeout: 10000 });
    // 2024 was already initialized — its January state is untouched, not
    // reset or refetched from scratch.
    await expect(page.getByTestId("industry-sp-month-count-2024-01")).toHaveText("0 races");
  });
});
