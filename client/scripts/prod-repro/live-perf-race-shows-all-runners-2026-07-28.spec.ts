import { test, expect } from "@playwright/test";

// One-off prod repro — see .claude/commands/prod-repro-scripts.md. Run
// once, against the REAL deployed app.backbet.co.uk, to confirm the
// reported bug is actually present in what's live right now.
//
// User report (with screenshots): from a saved filter's Result page,
// tapping a race in the "Live Performance" section (a filter with
// "conf >=20%, beats SP") opened the race screen showing EVERY runner in
// the field with its own stake/return, not just the runner(s) that
// actually qualified under the filter — inconsistent with the Live
// Performance P&L for that same race, which only ever reflects the
// qualifying runner(s).
//
// Root cause: IndustryMeetingScreen.tsx/IndustryRaceScreen.tsx never read
// any filter query params at all — App.tsx's onNavigateToMeeting/
// onNavigateToRace never carried a saved filter's own criteria along when
// navigating there, and even if it had, neither screen had any concept of
// "qualifying" vs "non-qualifying" runners (see ispFormat.ts's new
// runnerQualifies/hasActiveQualifyingFilter, ispUrlParams.ts's new
// urlQualifyingFilterParams/qualifyingFilterQueryFromParams).
//
// No real production credentials are used or needed — the client only
// checks locally that a plausibly-shaped JWT hasn't expired (same
// technique the other prod-repro scripts in this directory use); every
// network call this reproduction depends on is intercepted.
const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiJwcm9kLXJlcHJvIiwiZXhwIjo5OTk5OTk5OTk5fQ==" +
  ".fakesignature";

const RESULT_ID = "prod-repro-result-2";
const RACE_ID = 245562115135228;

test("REPRO (2026-07-28): a race reached via Live Performance shows every runner, not just qualifying ones, on live prod", async ({ page }) => {
  await page.addInitScript((token) => {
    localStorage.setItem("auth_token", token);
  }, FAKE_JWT);

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { success: true, email: "prod-repro@example.com", emailVerified: true } })
  );

  await page.route(`**/api/saved-filter-sets/${RESULT_ID}`, (route) => {
    if (route.request().method() !== "GET") {
      route.continue();
      return;
    }
    route.fulfill({
      json: {
        success: true,
        data: {
          id: RESULT_ID,
          name: "Model edge (beats SP, conf >=20%) vs baseline",
          // The exact filter criteria the reported bug's race should have
          // been narrowed by.
          filters: { onlyModelBeatsSp: "true", minModelWinProbability: "20" },
          splitA: { fromRow: 1, toRow: 1, total: 1, totalRunners: 1, pnlStats: { staked: 1, returns: 1, pnl: 0, count: 1 }, graphPoints: [] },
          splitB: { fromRow: 1, toRow: 1, total: 1, totalRunners: 1, pnlStats: { staked: 1, returns: 1, pnl: 0, count: 1 }, graphPoints: [] },
          createdAt: "2026-01-15T09:00:00.000Z",
        },
      },
    });
  });

  await page.route(`**/api/saved-filter-sets/${RESULT_ID}/live-performance`, (route) =>
    route.fulfill({
      json: {
        success: true,
        count: 1,
        data: [
          {
            raceDate: "2026-07-28",
            raceId: RACE_ID,
            raceTime: "2026-07-28T01:35:00",
            raceName: "Lady Jane Bethell Memorial Amateur Jockeys' Handicap Stakes",
            meetingId: "Beverley|2026-07-28",
            meetingName: "Beverley — 28 July 2026",
            modelVersionId: "xgb-20260727-171521",
            pnlStats: { staked: 0.0625, returns: 1.0625, pnl: 1, count: 1 },
          },
        ],
      },
    })
  );

  // Same 8-runner field the user's own screenshot showed — only one
  // (Alazwar) has a modelWinProbability high enough (21%) to beat both
  // its own SP and the 20% confidence threshold.
  await page.route(`**/api/industry-sp/race/${RACE_ID}`, (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          raceId: RACE_ID,
          meetingId: "Beverley|2026-07-28",
          meetingName: "Beverley — 28 July 2026",
          course: "Beverley",
          countryCode: "GB",
          raceTime: "2026-07-28T01:35:00",
          raceName: "Lady Jane Bethell Memorial Amateur Jockeys' Handicap Stakes",
          raceType: "Flat",
          ran: 8,
          runners: [
            { id: 1, name: "Sandret (IRE)", num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 15, ispFraction: "14/1", isFavourite: false, modelWinProbability: 10 },
            { id: 2, name: "Perfidia (IRE)", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 5, ispFraction: "4/1", isFavourite: false, modelWinProbability: 11 },
            { id: 3, name: "Stipulation (IRE)", num: 3, draw: null, status: "LOSER", sortPriority: 3, isp: 13, ispFraction: "12/1", isFavourite: false, modelWinProbability: 8 },
            { id: 4, name: "Sunny Orange (IRE)", num: 4, draw: null, status: "PLACED", sortPriority: 4, isp: 3.75, ispFraction: "11/4", isFavourite: false, modelWinProbability: 10 },
            { id: 5, name: "Alazwar (IRE)", num: 5, draw: null, status: "WINNER", sortPriority: 5, isp: 17, ispFraction: "16/1", isFavourite: false, modelWinProbability: 21 },
            { id: 6, name: "Star Start (IRE)", num: 6, draw: null, status: "PLACED", sortPriority: 6, isp: 3.5, ispFraction: "5/2", isFavourite: false, modelWinProbability: 10 },
            { id: 7, name: "Little She (FR)", num: 7, draw: null, status: "LOSER", sortPriority: 7, isp: 7, ispFraction: "6/1", isFavourite: false, modelWinProbability: 15 },
            { id: 8, name: "The Pug (IRE)", num: 8, draw: null, status: "LOSER", sortPriority: 8, isp: 15, ispFraction: "14/1", isFavourite: false, modelWinProbability: 15 },
          ],
        },
      },
    })
  );

  await page.goto(`/results/detail?id=${RESULT_ID}`);
  await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });

  const raceRow = page.getByTestId(`saved-result-live-race-${RACE_ID}`);
  await expect(raceRow).toBeVisible({ timeout: 10000 });
  await raceRow.click();

  await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("industry-race-list")).toBeVisible();

  // This is the actual bug report: only the one runner that qualifies
  // under this filter (Alazwar, id 5) should show. Expected to FAIL on
  // this run (before the fix ships) — every one of the 8 runners shows
  // instead. That failure is the confirmation.
  await expect(page.getByTestId("industry-race-item-5")).toBeVisible();
  await expect(page.getByTestId("industry-race-item-1")).not.toBeVisible();
  await expect(page.getByTestId("industry-race-item-2")).not.toBeVisible();
  await expect(page.getByTestId("industry-race-item-3")).not.toBeVisible();
});
