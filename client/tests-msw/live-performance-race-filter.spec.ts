import { test, expect } from "./fixtures";

// Regression coverage for a real prod bug (reported live with screenshots):
// tapping through from a saved filter's Live Performance section into a
// race showed every runner in the field, not just the one(s) that actually
// qualified under the filter — inconsistent with the Live Performance P&L
// for that same race, which already only reflects the qualifying
// runner(s). See client/scripts/prod-repro/live-perf-race-shows-all-runners-2026-07-28.spec.ts
// for the confirmed-against-real-prod repro, and ispFormat.ts's
// runnerQualifies/hasActiveQualifyingFilter + ispUrlParams.ts's
// urlQualifyingFilterParams/qualifyingFilterQueryFromParams for the fix.
const MEETING_ID = "Cheltenham|2025-01-01";
const RACE_ID = 914592;

// Only Fact To File (21%) beats its own SP (100/2.1≈47.6% — actually
// doesn't beat SP; deliberately using a low-isp favourite to prove
// modelBeatsSp, not just minModelWinProbability, is what gates it) AND
// clears the 20% confidence threshold — Springwell Bay/Gaelic Warrior carry
// no modelWinProbability at all, so neither qualifies under either test.
const QUALIFYING_MOCK_RACE = {
  raceId: RACE_ID,
  meetingId: MEETING_ID,
  meetingName: "Cheltenham — 1 January 2025",
  course: "Cheltenham",
  countryCode: "GB",
  raceTime: "2025-01-01T14:01:00",
  raceName: "Cheltenham Chase",
  raceType: "Hurdle",
  ran: 3,
  runners: [
    { id: 12345, name: "Springwell Bay", num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 4.5, ispFraction: "7/2", isFavourite: false },
    { id: 12346, name: "Gaelic Warrior", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 9.2, ispFraction: "41/5", isFavourite: false },
    // isp 20 -> SP-implied 5%; modelWinProbability 30% clears both the 20%
    // threshold and its own SP (30 > 5).
    { id: 12347, name: "Fact To File", num: 3, draw: null, status: "WINNER", sortPriority: 3, isp: 20, ispFraction: "19/1", isFavourite: true, modelWinProbability: 30 },
  ],
};

function mockLivePerformance(page: import("@playwright/test").Page) {
  return page.route((url) => url.pathname === "/api/saved-filter-sets/mock-result-1/live-performance", (route) =>
    route.fulfill({
      json: {
        success: true,
        count: 1,
        data: [
          {
            raceDate: "2025-01-01",
            raceId: RACE_ID,
            raceTime: "2025-01-01T14:01:00",
            raceName: "Cheltenham Chase",
            meetingId: MEETING_ID,
            meetingName: "Cheltenham — 1 January 2025",
            modelVersionId: "xgb-test-version",
            pnlStats: { staked: 0.0526, returns: 1.0526, pnl: 1, count: 1 },
          },
        ],
      },
    })
  );
}

function mockRaceEndpoint(page: import("@playwright/test").Page) {
  return page.route((url) => url.pathname === `/api/industry-sp/race/${RACE_ID}`, (route) =>
    route.fulfill({ json: { success: true, data: QUALIFYING_MOCK_RACE } })
  );
}

test.describe("Live Performance race drill-through respects the saved filter — MSW mocked network", () => {
  test("a race reached via Live Performance shows only its qualifying runner, not the whole field", async ({ page }) => {
    await mockLivePerformance(page);
    await mockRaceEndpoint(page);

    // mock-result-1's default filters (courses/minDate/maxDate) carry no
    // qualifying criteria — override to a filter that actually does, same
    // shape as the reported bug's "beats SP, conf >=20%" filter.
    await page.route((url) => url.pathname === "/api/saved-filter-sets/mock-result-1", (route) => {
      if (route.request().method() !== "GET") {
        route.continue();
        return;
      }
      route.fulfill({
        json: {
          success: true,
          data: {
            id: "mock-result-1",
            name: "Model edge (beats SP, conf >=20%)",
            filters: { onlyModelBeatsSp: "true", minModelWinProbability: "20" },
            splitA: { fromRow: 1, toRow: 1, total: 1, totalRunners: 1, pnlStats: { staked: 1, returns: 1, pnl: 0, count: 1 }, graphPoints: [] },
            splitB: { fromRow: 1, toRow: 1, total: 1, totalRunners: 1, pnlStats: { staked: 1, returns: 1, pnl: 0, count: 1 }, graphPoints: [] },
            createdAt: "2026-01-15T09:00:00.000Z",
          },
        },
      });
    });

    await page.goto("/results/detail?id=mock-result-1");
    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });

    const raceRow = page.getByTestId(`saved-result-live-race-${RACE_ID}`);
    await expect(raceRow).toBeVisible({ timeout: 10000 });
    await raceRow.click();

    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-list")).toBeVisible();

    await expect(page.getByTestId("industry-race-item-12347")).toBeVisible();
    await expect(page.getByTestId("industry-race-item-12345")).not.toBeVisible();
    await expect(page.getByTestId("industry-race-item-12346")).not.toBeVisible();
    await expect(page.getByTestId("industry-race-header")).toContainText("1 of 3 runners qualify");
  });

  test("the same race reached without a saved filter (plain browsing) shows every runner", async ({ page }) => {
    await mockRaceEndpoint(page);
    await page.goto(`/isp/race?id=${RACE_ID}`);

    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-list")).toBeVisible();

    await expect(page.getByTestId("industry-race-item-12345")).toBeVisible();
    await expect(page.getByTestId("industry-race-item-12346")).toBeVisible();
    await expect(page.getByTestId("industry-race-item-12347")).toBeVisible();
  });
});
