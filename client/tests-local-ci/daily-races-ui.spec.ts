import { test, expect } from "@playwright/test";

// Real browser, real frontend build, real backend, real (throwaway) Mongo —
// no mocking anywhere. Mirrors isp-races-ui.spec.ts's ?email=&password=
// URL-login convention. Seeded via src/commands/seed-daily-races-fixture.ts
// (see local-ci-e2e.sh Step 3b) — 5 races across 3 courses on 2026-06-03.
const APP_URL = "http://localhost:8090/";

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

    await page.getByTestId("daily-race-item-hrs_test_0001").click();
    await expect(page.getByTestId("daily-runner-detail-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-runner-detail-course")).toHaveText("Newton Abbot");
    await expect(page.getByTestId("daily-runner-detail-trainer")).toHaveText("A Trainer");
  });
});
