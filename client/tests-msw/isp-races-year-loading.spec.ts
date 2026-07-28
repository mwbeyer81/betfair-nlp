import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Regression coverage for the isp-year-direct-load rework: tapping a
// collapsed year now fetches *just that year* directly (scoped via
// subMinDate/subMaxDate), the same small paginated request every year
// uses — replacing the old "walk forward from page 1 until you happen to
// reach it" approach entirely. See AGENTS.md's isp-year-direct-load entry.
//
// Overrides the shared fixture's /api/industry-sp handler outright (no
// .fallback()) with one that actually understands subMinDate/subMaxDate,
// since the shared handler (fixtures.ts) is a small fixed 3-race set with
// no date-range awareness — not useful for exercising per-year scoping.

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

const YEAR_RACES = [
  ...Array.from({ length: 45 }, (_, i) => perYearRace(2024, i, 0)),
  ...Array.from({ length: 3 }, (_, i) => perYearRace(2025, i, 1000)),
];

async function mockPerYearIndustrySp(page: Page) {
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

test.describe("Industry SP races screen — per-year direct loading (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await mockPerYearIndustrySp(page);
  });

  test("mount lands on the year with real data and expands it, other years start collapsed", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-year-count-2024")).toHaveText("20 races", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-day-2024-06-01")).toBeVisible();
    await expect(page.getByTestId("industry-sp-year-count-2025")).toHaveText("Tap to load");
    await expect(page.getByTestId("industry-sp-day-2025-06-01")).not.toBeVisible();
  });

  test("tapping a collapsed year fetches only that year, without touching the already-loaded year", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-year-count-2024")).toHaveText("20 races", { timeout: 10000 });

    const requestsAfterTap: { subMinDate: string | null; subMaxDate: string | null }[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp?")) {
        const u = new URL(req.url());
        requestsAfterTap.push({ subMinDate: u.searchParams.get("subMinDate"), subMaxDate: u.searchParams.get("subMaxDate") });
      }
    });

    await page.getByTestId("industry-sp-year-toggle-2025").click();
    await expect(page.getByTestId("industry-sp-year-count-2025")).toHaveText("3 races", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-day-2025-06-01")).toBeVisible();

    // 2024's own count is untouched by tapping 2025 — this is the direct
    // regression check for the live report ("2024's numbers change when I
    // tap 2025"), which was a side effect of the old walk-forward-from-
    // page-1 approach appending into whichever year happened to already
    // be expanded.
    await expect(page.getByTestId("industry-sp-year-count-2024")).toHaveText("20 races");

    // Exactly one request, scoped to 2025 — not a walk through 2024 first.
    expect(requestsAfterTap).toHaveLength(1);
    expect(requestsAfterTap[0].subMinDate).toBe("2025-01-01");
    expect(requestsAfterTap[0].subMaxDate).toBe("2025-12-31");
  });

  test("a year's own Load more paginates only that year", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-year-count-2024")).toHaveText("20 races", { timeout: 10000 });

    await page.getByTestId("industry-sp-year-load-more-2024").click();
    await expect(page.getByTestId("industry-sp-year-count-2024")).toHaveText("40 races", { timeout: 10000 });

    await page.getByTestId("industry-sp-year-load-more-2024").click();
    await expect(page.getByTestId("industry-sp-year-count-2024")).toHaveText("45 races", { timeout: 10000 });
    // All 45 loaded — the button disappears.
    await expect(page.getByTestId("industry-sp-year-load-more-2024")).not.toBeVisible();
  });

  test("Expand All loads every not-yet-loaded year independently", async ({ page }) => {
    await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-12-31");
    await expect(page.getByTestId("industry-sp-year-count-2024")).toHaveText("20 races", { timeout: 10000 });

    await page.getByTestId("industry-sp-collapse-all-toggle").click();
    await expect(page.getByTestId("industry-sp-collapse-all-toggle")).toHaveText("Expand All");
    await page.getByTestId("industry-sp-collapse-all-toggle").click();

    await expect(page.getByTestId("industry-sp-year-count-2025")).toHaveText("3 races", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-day-2025-06-01")).toBeVisible();
    // 2024 was already loaded from mount — still shows its real count, not
    // reset or refetched from scratch.
    await expect(page.getByTestId("industry-sp-year-count-2024")).toHaveText("20 races");
  });
});
