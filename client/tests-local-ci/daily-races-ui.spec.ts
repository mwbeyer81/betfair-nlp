import { test, expect } from "@playwright/test";

// Real browser, real frontend build, real backend, real (throwaway) Mongo —
// no mocking anywhere. Mirrors isp-races-ui.spec.ts's ?email=&password=
// URL-login convention. Seeded via src/commands/seed-daily-races-fixture.ts
// (see local-ci-e2e.sh Step 3b) — 5 races across 3 courses on 2026-06-03.
// Also seeded (Step 3c-3e): the industry-sp overlap fixture (real prior
// history for trainer "A Trainer"/horse "Fixture Star"), the committed
// CI-fixture model, and a real compute-daily-race-features.ts +
// predict_daily_races.py run — so Fixture Star has a real, non-null
// modelWinProbability by the time these tests run.
// Overridable via LOCAL_CI_APP_URL so a second worktree can run this suite
// concurrently on its own claimed ports (see .claude/commands/worktree-ports.md
// and scripts/local-ci-e2e.sh's LOCAL_CI_FRONTEND_PORT). The script already
// let mongo/backend move; this hardcoded URL was what still forced every
// concurrent run onto the same frontend port. Default unchanged.
const APP_URL = process.env.LOCAL_CI_APP_URL ?? "http://localhost:8090/";

async function gotoDailyRaces(page: import("@playwright/test").Page) {
  await page.goto(`${APP_URL}daily-races?email=matthew%40backbet.co.uk&password=beyer&date=2026-06-03`);
  await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("daily-races-loading")).not.toBeVisible({ timeout: 15000 });
}

test.describe("Daily Races against the seeded fixture (real frontend + backend)", () => {
  test("list shows an event per seeded course", async ({ page }) => {
    await gotoDailyRaces(page);
    await expect(page.getByTestId("daily-races-event-newton-abbot-2026-06-03")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("daily-races-event-ascot-2026-06-03")).toBeVisible();
    await expect(page.getByTestId("daily-races-event-chepstow-2026-06-03")).toBeVisible();
  });

  test("full drill-down: event -> race -> runner shows the seeded fixture data", async ({ page }) => {
    await gotoDailyRaces(page);
    await page.getByTestId("daily-races-event-newton-abbot-2026-06-03").click();
    await expect(page.getByTestId("daily-race-event-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-race-event-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("daily-race-event-race-rac_test_0001")).toBeVisible();

    await page.getByTestId("daily-race-event-race-rac_test_0001").click();
    await expect(page.getByTestId("daily-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-race-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("daily-race-item-hrs_test_0001")).toContainText("Fixture Star");

    // Click the horse name specifically, not the row's own testID — with
    // three tap-to-reveal pills now present (form/model/fair-odds), the
    // row's bounding-box center (Playwright's default click point for a
    // whole-row locator) can land on a pill instead, which by design opens
    // its tooltip and stops the row's own navigation from firing.
    await page.getByTestId("daily-race-item-horse-hrs_test_0001").click();
    await expect(page.getByTestId("daily-runner-detail-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-runner-detail-course")).toHaveText("Newton Abbot");
    await expect(page.getByTestId("daily-runner-detail-trainer")).toHaveText("A Trainer");
  });

  test("model win-probability badge is visible and numeric for the overlap-fixture horse", async ({ page }) => {
    await gotoDailyRaces(page);
    await page.getByTestId("daily-races-event-newton-abbot-2026-06-03").click();
    await expect(page.getByTestId("daily-race-event-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("daily-race-event-race-rac_test_0001").click();
    await expect(page.getByTestId("daily-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-race-loading")).not.toBeVisible({ timeout: 15000 });

    const badge = page.getByTestId("daily-race-item-model-hrs_test_0001");
    await expect(badge).toBeVisible();
    const text = (await badge.textContent()) ?? "";
    const match = text.match(/Model (\d+)%/);
    expect(match).not.toBeNull();
    const pct = Number(match![1]);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);

    // Click the horse name specifically, not the row's own testID — with
    // three tap-to-reveal pills now present (form/model/fair-odds), the
    // row's bounding-box center (Playwright's default click point for a
    // whole-row locator) can land on a pill instead, which by design opens
    // its tooltip and stops the row's own navigation from firing.
    await page.getByTestId("daily-race-item-horse-hrs_test_0001").click();
    await expect(page.getByTestId("daily-runner-detail-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-runner-detail-model-win-probability")).toBeVisible();
  });

  test("Today's Picks surfaces the overlap-fixture horse with a fair-odds badge, and it navigates to its race", async ({ page }) => {
    await gotoDailyRaces(page);

    // Default filters (no threshold raised) are enough — Fixture Star has a
    // real, non-null modelWinProbability from the seeded model run, so
    // pressing Apply once is all that's needed to surface it.
    await page.getByTestId("daily-races-filter-apply").click();
    await expect(page.getByTestId("daily-races-picks-list")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-races-pick-hrs_test_0001")).toBeVisible();

    const oddsBadge = page.getByTestId("daily-races-pick-fair-odds-hrs_test_0001");
    await expect(oddsBadge).toBeVisible();
    const oddsText = (await oddsBadge.textContent()) ?? "";
    expect(oddsText).toMatch(/^Fair (\d+\/\d+|Evens) \(\d+\.\d{2}\)$/);

    await page.getByTestId("daily-races-pick-hrs_test_0001").click();
    await expect(page.getByTestId("daily-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-race-loading")).not.toBeVisible({ timeout: 15000 });
    const raceOddsBadge = page.getByTestId("daily-race-item-fair-odds-hrs_test_0001");
    await expect(raceOddsBadge).toBeVisible();
    await expect(raceOddsBadge).toHaveText(oddsText);
  });
});
