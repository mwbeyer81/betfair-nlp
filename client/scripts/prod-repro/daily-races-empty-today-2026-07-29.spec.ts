import { test, expect } from "@playwright/test";

// One-off prod repro — see .claude/commands/prod-repro-scripts.md. Run
// once, against the REAL deployed app.backbet.co.uk bundle, to confirm
// the reported bug is actually present in what's live right now.
//
// User report (screenshot, taken 2026-07-29 ~07:29 local/BST — real UTC
// time confirmed 2026-07-29 06:34 via this VM's own clock): opened
// "Daily Races", landed on "Thu, 30 Jul 2026" (tomorrow, not today) with
// "0 events, 0 races", and the empty-state read "No races found for
// today." — read literally, that says today's cron produced nothing.
//
// Two things were checked independently and ruled out:
//  1. scripts/prod-repro-daily-races-empty-today-2026-07-29.ts (direct-
//     to-Mongo, bypassing HTTP/auth): the cron IS healthy — 40 races
//     landed in daily_racecards for 2026-07-29 (the real today) at
//     06:00 UTC. 0 races for 2026-07-30 is expected — RacingAPI's free
//     racecards endpoint only ever returns *today's* card, so tomorrow
//     genuinely has no data yet.
//  2. The deployed bundle's build-commit meta tag (767e9b1) matches
//     local develop HEAD exactly, so this isn't a stale-deploy issue —
//     whatever's live is exactly today's source.
//
// Root cause: DailyRacesScreen.tsx's empty-state text was hardcoded as
// "No races found for today." regardless of which date is actually
// selected (`currentDate`, driven by ?date=, defaulting to real UTC
// today only when absent). Landing on/navigating to ANY other date with
// no data (tomorrow, being looked at ahead of its own cron run; a past
// date with no card) shows the same "today" wording, which is what
// generated this report — the user (or a stale/forwarded ?date= URL)
// was on tomorrow's card, correctly empty, but the message claimed it
// was "today".
//
// No real production credentials used — same fake-JWT + page.route()
// technique as results-white-screen-2026-07-27.spec.ts. daily_racecards
// is intercepted with a synthetic response for one date and an empty
// response for a different date, mirroring the real "today has data,
// some other selected date doesn't" shape.
const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiJwcm9kLXJlcHJvIiwiZXhwIjo5OTk5OTk5OTk5fQ==" +
  ".fakesignature";

test("empty daily-races state names the actual selected date, not always 'today'", async ({ page }) => {
  await page.addInitScript((token) => {
    localStorage.setItem("auth_token", token);
  }, FAKE_JWT);

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { success: true, email: "prod-repro@example.com", emailVerified: true } })
  );

  // A date deliberately different from "real today" — mirrors the
  // reported scenario of viewing a day (e.g. tomorrow) with no card yet.
  const emptyDate = "2026-08-15";

  await page.route((url) => url.pathname === "/api/daily-races", (route) => {
    route.fulfill({ json: { success: true, data: [], count: 0 } });
  });

  await page.goto(`/daily-races?date=${emptyDate}`);

  const dateLabel = page.getByTestId("daily-races-current-date");
  await expect(dateLabel).toBeVisible({ timeout: 15000 });
  await expect(dateLabel).toHaveText("Sat, 15 Aug 2026");

  const emptyState = page.getByTestId("daily-races-empty");
  await expect(emptyState).toBeVisible();
  const emptyText = await emptyState.textContent();
  console.log(`Empty-state text for a non-today date: "${emptyText}"`);

  // Before the fix this was always "No races found for today." even
  // though the page was showing 15 Aug, not today — misleading exactly
  // the way the user's report described.
  expect(emptyText).toContain("15 Aug 2026");
  expect(emptyText).not.toBe("No races found for today.");
});
