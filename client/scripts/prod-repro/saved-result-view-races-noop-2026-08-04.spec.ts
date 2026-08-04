import { test, expect } from "@playwright/test";

// One-off prod repro — see .claude/commands/prod-repro-scripts.md. Run
// once, against the REAL deployed app.backbet.co.uk, to confirm the
// reported bug is present in the bundle live right now.
//
// User report (2026-08-04, screenshots on app.backbet.co.uk build 7beb6d8):
// open a saved Result ("Goop") from the Results view, tap "Details" on a
// split card, then tap the big "View 675 Races →" button at the bottom of
// the split detail panel — nothing happens. No navigation, no error, the
// panel just sits there.
//
// Root cause: SavedResultDetailScreen renders the shared SplitDetailPanel
// (the same component IndustrySpScreen uses) but wires its onViewRaces
// prop to an empty arrow function — `onViewRaces={() => {}}`. On /isp that
// same prop navigates to /isp/races carrying the applied filters plus the
// clicked split's fromRow/toRow (see App.tsx's /isp branch); from a saved
// result nobody ever supplied an equivalent, so the button is inert by
// construction. The panel still renders the button unconditionally, so
// there is no visual hint that it does nothing here.
//
// No real production credentials are used or needed — the client only
// checks locally that a plausibly-shaped JWT hasn't expired (same
// technique client/tests-msw/fixtures.ts and the 2026-07-27 repro use),
// and every request this reproduction depends on is intercepted, so the
// real backend/database is never written to. The /isp/races screen the
// button *should* reach is left un-intercepted on purpose: it is a public
// endpoint, and letting it hit real prod data is what proves the
// destination genuinely works and only the wiring is missing.
const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiJwcm9kLXJlcHJvIiwiZXhwIjo5OTk5OTk5OTk5fQ==" +
  ".fakesignature";

const RESULT_ID = "prod-repro-goop";

// The filters the reported saved result carried, in the exact raw string
// map shape SavedFilterSet.filters uses (what IndustrySpScreen's syncUrl
// writes). These are what the button is supposed to carry through to
// /isp/races — the assertions at the bottom check for them by name.
const SAVED_FILTERS: Record<string, string> = {
  minRunners: "6",
  maxRunners: "16",
  minDate: "2024-01-01",
  maxDate: "2026-08-04",
  minModelWinProbability: "0.2",
  onlyModelBeatsSp: "true",
};

test("REPRO (2026-08-04): 'View N Races' in a saved Result's split detail does nothing on live prod", async ({ page }) => {
  await page.addInitScript((token) => {
    localStorage.setItem("auth_token", token);
  }, FAKE_JWT);

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { success: true, email: "prod-repro@example.com", emailVerified: true } })
  );

  // The saved result itself: a current-shape doc (splitA/splitB present),
  // so this is emphatically NOT the legacy-shape bug the 2026-07-27 repro
  // covered — the screen renders perfectly, one button on it is dead.
  await page.route(
    (url) => url.pathname === `/api/saved-filter-sets/${RESULT_ID}`,
    (route) => {
      if (route.request().method() !== "GET") {
        route.continue();
        return;
      }
      route.fulfill({
        json: {
          success: true,
          data: {
            id: RESULT_ID,
            name: "Goop",
            filters: SAVED_FILTERS,
            splitA: {
              fromRow: 1,
              toRow: 675,
              total: 675,
              totalRunners: 3200,
              pnlStats: { staked: 225.4, returns: 167.24, pnl: -58.15, count: 3200 },
              graphPoints: [
                { raceRowNumber: 1, cumulativeStaked: 0.33, cumulativeReturns: 0, cumulativePnl: -0.33, roiPercent: -100 },
                { raceRowNumber: 675, cumulativeStaked: 225.4, cumulativeReturns: 167.24, cumulativePnl: -58.15, roiPercent: -25.8 },
              ],
              brier: { scored: 3200, priced: 3200, model: 0.0457, market: 0.0414 },
            },
            splitB: {
              fromRow: 64,
              toRow: 675,
              total: 612,
              totalRunners: 2900,
              pnlStats: { staked: 200.1, returns: 142.98, pnl: -57.12, count: 2900 },
              graphPoints: [
                { raceRowNumber: 64, cumulativeStaked: 0.33, cumulativeReturns: 0, cumulativePnl: -0.33, roiPercent: -100 },
                { raceRowNumber: 675, cumulativeStaked: 200.1, cumulativeReturns: 142.98, cumulativePnl: -57.12, roiPercent: -28.5 },
              ],
              brier: { scored: 2900, priced: 2900, model: 0.0437, market: 0.0392 },
            },
            createdAt: "2026-08-04T20:00:00.000Z",
            createdBy: "user",
          },
        },
      });
    }
  );

  // Live Performance is a second, independent fetch on this screen. Empty
  // is fine — it is not part of the reported flow, and an empty list keeps
  // the split cards at the top of the scroll view.
  await page.route(
    (url) => url.pathname === `/api/saved-filter-sets/${RESULT_ID}/live-performance`,
    (route) => route.fulfill({ json: { success: true, count: 0, data: [] } })
  );

  await page.goto(`/results/detail?id=${RESULT_ID}`);

  await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("saved-result-detail-loading")).not.toBeVisible({ timeout: 15000 });

  // Screenshot 3 of the report: Split A card → "Details".
  await page.getByTestId("saved-result-split-details-button-a").click();
  await expect(page.getByTestId("split-detail-panel-a")).toBeVisible();

  const viewRaces = page.getByTestId("split-detail-view-races-button-a");
  await expect(viewRaces).toBeVisible();
  await expect(viewRaces).toHaveText(/View 675 Races/);

  // Screenshot 2 of the report: tap it. Nothing happens.
  await viewRaces.click();

  // Expected to FAIL on this run (before the fix ships) — that failure is
  // the confirmation. The URL never leaves /results/detail because the
  // handler is a no-op.
  await expect(page).toHaveURL(/\/isp\/races/, { timeout: 10000 });
  await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 15000 });

  // ...and it must arrive carrying the saved result's own filters plus the
  // clicked split's race range, not a bare /isp/races that would list every
  // race in the dataset. This is the half of the fix that a plain "did it
  // navigate" check would miss.
  const query = new URL(page.url()).searchParams;
  expect(query.get("fromRow")).toBe("1");
  expect(query.get("toRow")).toBe("675");
  for (const [key, value] of Object.entries(SAVED_FILTERS)) {
    expect(query.get(key), `expected saved filter ${key} to carry through to /isp/races`).toBe(value);
  }
});
