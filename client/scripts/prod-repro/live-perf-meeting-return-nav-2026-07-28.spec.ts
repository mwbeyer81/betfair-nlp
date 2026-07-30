import { test, expect } from "@playwright/test";

// One-off prod repro — see .claude/commands/prod-repro-scripts.md. Run
// once, against the REAL deployed app.backbet.co.uk, to confirm the
// reported bug is actually present in what's live right now.
//
// User report (with screenshots): from a saved filter's Result page
// (SavedResultDetailScreen.tsx), tapping a meeting name in the new "Live
// Performance" section navigates to the meeting screen (IndustryMeetingScreen,
// /isp/meeting) — but pressing back there does NOT return to the Result page.
//
// Root cause: onNavigateToMeeting's navigate("/isp/meeting", ...) call never
// attached buildReturnParams(route), and /isp/meeting's own onBack was
// hardcoded to always navigate("/isp/races") regardless of where the user
// actually came from (see App.tsx). Confirmed by reading the deployed
// source: the meeting screen has no way to know it was reached from a
// Result page at all, so it falls back to the one destination it always
// assumed — the Races list, not Results.
//
// No real production credentials are used or needed — the client only
// checks locally that a plausibly-shaped JWT hasn't expired (same technique
// results-white-screen-2026-07-27.spec.ts uses), every network call this
// reproduction depends on is intercepted.
const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiJwcm9kLXJlcHJvIiwiZXhwIjo5OTk5OTk5OTk5fQ==" +
  ".fakesignature";

const RESULT_ID = "prod-repro-result-1";
const MEETING_ID = "Yarmouth|2026-07-28";

test("REPRO (2026-07-28): back from a Live Performance meeting does not return to the Result page on live prod", async ({ page }) => {
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
          filters: { onlyModelBeatsSp: "true" },
          splitA: { fromRow: 1, toRow: 5545, total: 5545, totalRunners: 16000, pnlStats: { staked: 908.75, returns: 1208.64, pnl: 299.89, count: 16000 }, graphPoints: [] },
          splitB: { fromRow: 5546, toRow: 11091, total: 5546, totalRunners: 16000, pnlStats: { staked: 878.48, returns: 1150.81, pnl: 272.33, count: 16000 }, graphPoints: [] },
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
            raceId: 245562115135228,
            raceTime: "2026-07-28T14:00:00",
            raceName: "British Stallion Studs Fillies' Handicap",
            meetingId: MEETING_ID,
            meetingName: "Yarmouth — 28 July 2026",
            modelVersionId: "xgb-20260727-171521",
            pnlStats: { staked: 0.22, returns: 0, pnl: -0.22, count: 1 },
          },
        ],
      },
    })
  );

  await page.route(`**/api/industry-sp/meeting/${encodeURIComponent(MEETING_ID)}`, (route) =>
    route.fulfill({ json: { success: true, data: [] } })
  );

  await page.goto(`/results/detail?id=${RESULT_ID}`);
  await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });

  const meetingLink = page.getByTestId(`saved-result-live-meeting-link-${MEETING_ID}`);
  await expect(meetingLink).toBeVisible({ timeout: 10000 });
  await meetingLink.click();

  await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-meeting-back-button").click();

  // This is the actual bug report: back from the meeting screen should
  // return to the Result page it was reached from. Expected to FAIL on
  // this run (before the fix ships) — it lands on the Races list instead.
  // That failure is the confirmation.
  await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible();
});
