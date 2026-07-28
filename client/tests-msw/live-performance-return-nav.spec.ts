import { test, expect } from "./fixtures";

// Regression coverage for a real prod bug (reported live with screenshots):
// from a saved filter's Result page, tapping a meeting/race in the Live
// Performance section navigated away correctly, but pressing back there did
// not return to the Result page — it fell back to the Races list instead.
// See client/scripts/prod-repro/live-perf-meeting-return-nav-2026-07-28.spec.ts
// for the confirmed-against-real-prod repro and App.tsx's onNavigateToMeeting/
// onNavigateToRace + resolveReturn-based onBack for the fix.
//
// fixtures.ts's default /api/saved-filter-sets/:id handler also (correctly)
// 404s a `.../live-performance` sub-path, since its id-matching splits on
// the full remainder of the URL — each test here overrides that route
// specifically, same pattern the rest of tests-msw/*.spec.ts already uses
// for per-test API shape overrides.
const MEETING_ID = "Cheltenham|2025-01-01";

function mockLivePerformance(page: import("@playwright/test").Page) {
  return page.route((url) => url.pathname === "/api/saved-filter-sets/mock-result-1/live-performance", (route) =>
    route.fulfill({
      json: {
        success: true,
        count: 1,
        data: [
          {
            raceDate: "2025-01-01",
            raceId: 914592,
            raceTime: "2025-01-01T14:01:00",
            raceName: "Cheltenham Chase",
            meetingId: MEETING_ID,
            meetingName: "Cheltenham — 1 January 2025",
            modelVersionId: "xgb-test-version",
            pnlStats: { staked: 1, returns: 2, pnl: 1, count: 1 },
          },
        ],
      },
    })
  );
}

test.describe("Live Performance meeting/race return navigation — MSW mocked network", () => {
  test("back from a meeting reached via the Live Performance section returns to the Result page", async ({ page }) => {
    await mockLivePerformance(page);
    await page.goto("/results/detail?id=mock-result-1");
    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });

    const meetingLink = page.getByTestId(`saved-result-live-meeting-link-${MEETING_ID}`);
    await expect(meetingLink).toBeVisible({ timeout: 10000 });
    await meetingLink.click();

    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-meeting-back-button").click();

    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/results/detail");
    expect(page.url()).toContain("id=mock-result-1");
  });

  test("back from a race reached via a Live Performance meeting also returns to the Result page", async ({ page }) => {
    await mockLivePerformance(page);
    await page.goto("/results/detail?id=mock-result-1");
    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });

    const raceRow = page.getByTestId("saved-result-live-race-914592");
    await expect(raceRow).toBeVisible({ timeout: 10000 });
    await raceRow.click();

    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-race-back-button").click();

    // Race screen's back always goes "up" to its meeting first (unchanged,
    // deliberate app behavior) — that hop must forward this chain's return
    // pointer rather than create a new one, or back-from-meeting would loop
    // to the race instead of continuing on to the Result page.
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-meeting-back-button").click();
    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });
  });
});
