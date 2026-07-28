import { test, expect } from "./fixtures";

// fixtures.ts mocks 3 daily racecards across 2 events:
// newton-abbot-2026-06-03 (rac_test_0001, rac_test_0002) and
// ascot-2026-06-03 (rac_test_0003). rac_test_0001 has 2 runners
// (hrs_1 "Fixture Star", hrs_2 "Second Fixture"). hrs_1 has a
// modelWinProbability of 25 (-> breakeven decimal odds 4.00, "3/1");
// hrs_2 has none, so it never qualifies for the Today's Picks filters below.

test.describe("Daily Races — full drill-down chain (MSW mocked)", () => {
  test("burger menu link opens Daily Races", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("events-menu-daily-races-link").click();

    await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/daily-races");
  });

  test("list -> event -> race -> runner detail, and back navigates one level at a time", async ({ page }) => {
    await page.goto("/daily-races");
    await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-races-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-races-event-newton-abbot-2026-06-03")).toBeVisible();
    await expect(page.getByTestId("daily-races-event-ascot-2026-06-03")).toBeVisible();

    await page.getByTestId("daily-races-event-newton-abbot-2026-06-03").click();
    await expect(page.getByTestId("daily-race-event-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/daily-races/event");
    await expect(page.getByTestId("daily-race-event-race-rac_test_0001")).toBeVisible();
    await expect(page.getByTestId("daily-race-event-race-rac_test_0002")).toBeVisible();

    await page.getByTestId("daily-race-event-race-rac_test_0001").click();
    await expect(page.getByTestId("daily-race-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/daily-races/race");
    await expect(page.getByTestId("daily-race-item-hrs_1")).toBeVisible();
    await expect(page.getByTestId("daily-race-item-hrs_2")).toBeVisible();

    // Click the horse name specifically, not the row's own testID — with
    // three tap-to-reveal pills now present (form/model/fair-odds), the
    // row's bounding-box center (Playwright's default click point for a
    // whole-row locator) can land on a pill instead, which by design opens
    // its tooltip and stops the row's own navigation from firing.
    await page.getByTestId("daily-race-item-horse-hrs_1").click();
    await expect(page.getByTestId("daily-runner-detail-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/daily-races/runner");
    await expect(page.getByTestId("daily-runner-detail-course")).toHaveText("Newton Abbot");
    await expect(page.getByTestId("daily-runner-detail-trainer")).toHaveText("A Trainer");
    await expect(page.getByTestId("daily-runner-detail-jockey")).toHaveText("B Jockey");

    // Back from runner detail returns to the race, not the event or list.
    await page.getByTestId("daily-runner-detail-back-button").click();
    await expect(page.getByTestId("daily-race-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/daily-races/race");

    // Back from race returns to the event.
    await page.getByTestId("daily-race-back-button").click();
    await expect(page.getByTestId("daily-race-event-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/daily-races/event");

    // Back from event returns to the top-level list.
    await page.getByTestId("daily-race-event-back-button").click();
    await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/daily-races");
    expect(page.url()).not.toContain("/daily-races/event");
  });

  test("a race not found in the mocked data shows the error state", async ({ page }) => {
    await page.goto("/daily-races/race?id=rac_does_not_exist");
    await expect(page.getByTestId("daily-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-race-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-race-list")).not.toBeVisible();
  });

  test("applying a model win% filter narrows Today's Picks and shows the fair-odds badge, and a pick navigates to its race", async ({ page }) => {
    await page.goto("/daily-races");
    await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-races-loading")).not.toBeVisible({ timeout: 10000 });

    // No Apply pressed yet — Today's Picks hasn't appeared.
    await expect(page.getByTestId("daily-races-picks-list")).not.toBeVisible();

    await page.getByTestId("daily-races-min-model-win-probability").fill("20");
    await page.getByTestId("daily-races-filter-apply").click();

    await expect(page.getByTestId("daily-races-picks-list")).toBeVisible();
    await expect(page.getByTestId("daily-races-pick-hrs_1")).toBeVisible();
    await expect(page.getByTestId("daily-races-pick-fair-odds-hrs_1")).toHaveText("Fair 3/1 (4.00)");
    await expect(page.getByTestId("daily-races-pick-hrs_2")).not.toBeVisible();

    await page.getByTestId("daily-races-pick-hrs_1").click();
    await expect(page.getByTestId("daily-race-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/daily-races/race");
    await expect(page.getByTestId("daily-race-item-hrs_1")).toBeVisible();
    await expect(page.getByTestId("daily-race-item-fair-odds-hrs_1")).toHaveText("Fair 3/1 (4.00)");
  });
});
