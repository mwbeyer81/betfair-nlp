import { test, expect } from "@playwright/test";

// One-off prod repro — see .claude/commands/prod-repro-scripts.md. Run
// once, against the REAL deployed app.backbet.co.uk, to confirm the
// reported bug is actually present in what's live right now — not a
// local-only reproduction.
//
// User report (screenshots): Industry SP filters set Date to
// "Jan 1, 2024 -> Jan 1, 2025", Apply pressed, then "View X Races" ->
// /isp/races showed races from January 2015 at the top — years before the
// applied date range.
//
// Root cause: IndustrySpScreen.tsx's syncUrl() only writes minDate/maxDate
// into the URL when they differ from FILTER_DEFAULTS.minDate/maxDate
// ("2024-01-01"/"2024-01-31") — an arbitrary "last month" convenience
// default, not a "no date filter" sentinel. minDate="2024-01-01" is a
// wholly plausible real choice (matches this exact bug report), so it gets
// silently omitted from the URL. IspRacesScreen then reads minDate from
// the URL with its own fallback of "" (no lower bound at all, not
// "2024-01-01") — so /isp/races fetches with no lower bound, matching
// races back to the dataset's true earliest year (2015) instead of the
// one actually applied.
//
// No production credentials needed — /api/industry-sp and
// /api/industry-sp/splits are public (no auth gate), and this reproduction
// only reads real data, never writes anything.
test("REPRO (2026-07-28): applying a date filter matching IndustrySpScreen's own default drops it from the URL on live prod", async ({ page }) => {
  // Mirrors what "Apply" actually commits after a user picks Jan 1 2024 ->
  // Jan 1 2025 in the DateRangePicker — going straight to the URL (rather
  // than driving the calendar UI) keeps this script focused on the bug
  // (the URL-sync step), not on re-proving the calendar widget itself.
  await page.goto("/isp?minDate=2024-01-01&maxDate=2025-01-01");
  await page.waitForSelector('[data-testid="industry-sp-view-races-button-a"]', { timeout: 20000 });

  // This is the actual bug: even before any further interaction, the
  // mount+syncUrl cycle has already dropped minDate from the real browser
  // URL. Expected to FAIL on this run (before the fix ships) — that
  // failure is the confirmation.
  expect(page.url()).toContain("minDate=2024-01-01");

  await page.click('[data-testid="industry-sp-view-races-button-a"]');
  await page.waitForSelector('[data-testid="industry-sp-list"]', { timeout: 20000 });

  // Carries the same loss forward: /isp/races' own URL is missing minDate
  // too, so it fetches with no lower bound at all instead of 2024-01-01.
  expect(page.url()).toContain("minDate=2024-01-01");

  // Direct proof in the rendered data: the collapsible hierarchy shouldn't
  // have a 2015 year group at all once minDate=2024-01-01 is actually
  // applied — but it does, because the request went out with no lower
  // bound.
  await expect(page.locator('[data-testid="industry-sp-year-toggle-2015"]')).toHaveCount(0);
});
