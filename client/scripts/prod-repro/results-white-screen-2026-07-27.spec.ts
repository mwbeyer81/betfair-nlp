import { test, expect } from "@playwright/test";

// One-off prod repro — see .claude/commands/prod-repro-scripts.md. Run
// once, against the REAL deployed app.backbet.co.uk, to confirm the
// reported bug ("clicking Results shows a white screen") is actually
// present in what's live right now — not a local-only reproduction.
//
// User report: 2 saved results existed in production from before the
// Split A/B schema change landed (feat/saved-results-splits), stored in
// the old flat pnlStats/graphPoints shape. SavedResultsListScreen's
// combinedPnlStats() reads result.splitA.pnlStats directly with no guard —
// on a legacy doc, result.splitA is undefined, so this throws mid-render.
// There is no error boundary anywhere in this app (confirmed by grep), so
// React unmounts the entire tree instead of just the broken card: a blank
// white screen, exactly as reported.
//
// No real production credentials are used or needed — the client only
// checks locally that a plausibly-shaped JWT hasn't expired
// (see FAKE_JWT below, same technique client/tests-msw/fixtures.ts uses);
// every network call the reproduction depends on is intercepted, so the
// real backend/database is never touched.
const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiJwcm9kLXJlcHJvIiwiZXhwIjo5OTk5OTk5OTk5fQ==" +
  ".fakesignature";

test("REPRO (2026-07-27): a legacy pre-split saved result blanks the Results screen on live prod", async ({ page }) => {
  await page.addInitScript((token) => {
    localStorage.setItem("auth_token", token);
  }, FAKE_JWT);

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { success: true, email: "prod-repro@example.com", emailVerified: true } })
  );

  await page.route((url) => url.pathname === "/api/saved-filter-sets", (route) => {
    if (route.request().method() !== "GET") {
      route.continue();
      return;
    }
    route.fulfill({
      json: {
        success: true,
        count: 1,
        data: [
          {
            id: "legacy-result-1",
            name: "All races",
            filters: {},
            // The exact old shape saveResult() used to write, before the
            // Split A/B fix — no splitA/splitB fields at all.
            pnlStats: { staked: 3638.86, returns: 3988.48, pnl: 349.62, count: 10000 },
            graphPoints: [
              { raceRowNumber: 1, cumulativeStaked: 3638.86, cumulativeReturns: 3988.48, cumulativePnl: 349.62, roiPercent: 9.6 },
            ],
            createdAt: "2026-07-27T08:00:00.000Z",
          },
        ],
      },
    });
  });

  await page.goto("/results");
  await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 10000 });

  // This is the actual bug report: after loading finishes, the whole
  // screen — not just the one bad card — is gone. Expected to FAIL on
  // this run (before the fix ships); that failure is the confirmation.
  await expect(page.getByTestId("saved-results-screen")).toBeVisible();
  await expect(page.getByTestId("saved-results-item-legacy-result-1")).toBeVisible();
});
