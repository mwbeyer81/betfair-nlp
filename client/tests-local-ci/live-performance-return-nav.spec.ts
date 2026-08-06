import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";

// Real browser, real frontend build, real backend, real (throwaway) Mongo —
// no mocking. Regression coverage for a real prod bug (reported live with
// screenshots): from a saved filter's Result page, tapping a meeting in the
// Live Performance section navigated to the meeting screen, but pressing
// back there did not return to the Result page — see
// client/scripts/prod-repro/live-perf-meeting-return-nav-2026-07-28.spec.ts
// for the confirmed-against-real-prod repro, and App.tsx's onNavigateToMeeting/
// onNavigateToRace + /isp/meeting's onBack for the fix (buildReturnParams/
// resolveReturn, same pattern the runner/trainer screens already used).
//
// Live Performance rows are normally written by the daily results-capture
// cron, which local-ci doesn't run — so this seeds one directly (via
// src/commands/seed-live-filter-result-fixture.ts) against the real saved
// filter set the test creates through the actual Save button, pointing at
// the CSV slice's own anchor race (raceId 919979, Nottingham, 2026-06-03).
// Overridable via LOCAL_CI_APP_URL so a second worktree can run this suite
// concurrently on its own claimed ports (see .claude/commands/worktree-ports.md
// and scripts/local-ci-e2e.sh's LOCAL_CI_FRONTEND_PORT). The script already
// let mongo/backend move; this hardcoded URL was what still forced every
// concurrent run onto the same frontend port. Default unchanged.
const APP_URL = process.env.LOCAL_CI_APP_URL ?? "http://localhost:8090/";
const REPO_ROOT = path.join(__dirname, "..", "..");
const MONGO_URI = `mongodb://localhost:${process.env.LOCAL_CI_MONGO_PORT ?? "27020"}`;
const MONGO_DB_NAME = "betfair_nlp_ci_test";

test("back from a Live Performance meeting returns to the Result page, not the Races list", async ({ page }) => {
  await page.goto(
    `${APP_URL}isp?email=matthew%40backbet.co.uk&password=beyer&courses=Nottingham&minDate=2026-06-03&maxDate=2026-06-03`
  );
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });

  await page.getByTestId("industry-sp-filter-save").click();
  await page.getByTestId("save-result-dialog-name-input").fill("Return-nav regression test");
  await page.getByTestId("save-result-dialog-confirm").click();
  await expect(page.getByTestId("save-result-dialog")).not.toBeVisible({ timeout: 10000 });

  await page.getByTestId("industry-sp-menu-results-link").click();
  await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 15000 });
  await page
    .locator('[data-testid^="saved-results-item-"]')
    .filter({ hasText: "Return-nav regression test" })
    .click();
  await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });

  const savedFilterSetId = new URL(page.url()).searchParams.get("id");
  expect(savedFilterSetId).toBeTruthy();

  execSync(`npx ts-node src/commands/seed-live-filter-result-fixture.ts ${savedFilterSetId}`, {
    cwd: REPO_ROOT,
    env: { ...process.env, MONGODB_URI: MONGO_URI, MONGODB_DB_NAME: MONGO_DB_NAME },
    stdio: "pipe",
  });

  await page.reload();
  await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });

  const meetingLink = page.getByTestId("saved-result-live-meeting-link-Nottingham|2026-06-03");
  await expect(meetingLink).toBeVisible({ timeout: 10000 });
  await meetingLink.click();

  await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-meeting-back-button").click();

  // The actual regression check: back from the meeting screen must return
  // to the Result page, not fall back to the Races list.
  await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });
  expect(page.url()).toContain(`/results/detail`);
  expect(page.url()).toContain(savedFilterSetId!);
});

test("back from a race reached via a Live Performance meeting also returns to the Result page", async ({ page }) => {
  await page.goto(
    `${APP_URL}isp?email=matthew%40backbet.co.uk&password=beyer&courses=Nottingham&minDate=2026-06-03&maxDate=2026-06-03`
  );
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });
  await page.getByTestId("industry-sp-filter-save").click();
  await page.getByTestId("save-result-dialog-name-input").fill("Return-nav race regression test");
  await page.getByTestId("save-result-dialog-confirm").click();
  await expect(page.getByTestId("save-result-dialog")).not.toBeVisible({ timeout: 10000 });

  await page.getByTestId("industry-sp-menu-results-link").click();
  await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 15000 });
  await page
    .locator('[data-testid^="saved-results-item-"]')
    .filter({ hasText: "Return-nav race regression test" })
    .click();
  await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });
  const savedFilterSetId = new URL(page.url()).searchParams.get("id");

  execSync(`npx ts-node src/commands/seed-live-filter-result-fixture.ts ${savedFilterSetId}`, {
    cwd: REPO_ROOT,
    env: { ...process.env, MONGODB_URI: MONGO_URI, MONGODB_DB_NAME: MONGO_DB_NAME },
    stdio: "pipe",
  });
  await page.reload();

  const raceRow = page.getByTestId("saved-result-live-race-919979");
  await expect(raceRow).toBeVisible({ timeout: 10000 });
  await raceRow.click();

  await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-race-back-button").click();

  // Race screen's back always goes "up" to its meeting first (unchanged,
  // deliberate app behavior) — from there, back again must reach the
  // Result page, same as the direct-meeting-link test above.
  await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-meeting-back-button").click();
  await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });
});
